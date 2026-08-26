'use strict';

const FlowError = require('../../shared/errors/FlowError');
const { containerEnd } = require('../../gui/ContainerSlotRange');

class KhoMaterialTransfer {
    constructor({ storage, logger = null } = {}) {
        if (!storage?.read) throw new TypeError('KhoMaterialTransfer storage service is required.');
        if (!storage?.guiManager) throw new TypeError('KhoMaterialTransfer requires storage.guiManager.');
        if (!storage?.reader) throw new TypeError('KhoMaterialTransfer requires storage.reader.');
        this.storage = storage;
        this.guiManager = storage.guiManager;
        this.guiKnowledge = storage.guiKnowledge || null;
        this.reader = storage.reader;
        this.logger = logger;
    }

    withdrawUpTo(logicalId, options = {}) {
        return this.#transfer('withdraw', logicalId, {
            minRequired: Math.max(1, Math.floor(Number(options.minRequired) || 1)),
            reserveEmptySlots: Math.max(0, Math.floor(Number(options.reserveEmptySlots) || 0)),
            cancellationToken: options.cancellationToken || options.operationContext?.cancellation?.token || null,
            operationContext: options.operationContext || null,
            expectedGeneration: options.expectedGeneration ?? options.operationContext?.connectionGeneration ?? null
        });
    }

    depositAll(logicalId, options = {}) {
        return this.#transfer('deposit', logicalId, {
            minRequired: 0,
            reserveEmptySlots: 0,
            cancellationToken: options.cancellationToken || options.operationContext?.cancellation?.token || null,
            operationContext: options.operationContext || null,
            expectedGeneration: options.expectedGeneration ?? options.operationContext?.connectionGeneration ?? null
        });
    }

    async #transfer(direction, logicalId, { minRequired, reserveEmptySlots, cancellationToken, operationContext, expectedGeneration }) {
        cancellationToken?.throwIfCancelled?.();

        const rootRead = await this.storage.read({ refresh: true, cancellationToken, operationContext, expectedGeneration });
        if (rootRead?.success === false) throw rootRead.error || new Error(rootRead.message || 'Cannot read /kho before material transfer.');

        const rootSession = this.guiManager.syncCurrentWindow?.() || this.guiManager.current();
        if (!rootSession?.active || !rootSession.window) return this.#wait(direction, logicalId, 'kho-root-not-open');

        const beforeStored = Math.max(0, Number(rootRead.data?.items?.[logicalId] || 0));
        const beforeInventory = this.#countPlayer(rootSession.window, logicalId);
        const inventoryCapacity = this.#safeInventoryCapacity(rootSession.window, logicalId, direction === 'withdraw' ? reserveEmptySlots : 0);

        if (direction === 'withdraw') {
            if (beforeStored <= 0 || inventoryCapacity <= 0) {
                if (beforeInventory >= minRequired) {
                    return this.#success(direction, logicalId, {
                        moved: 0, beforeStored, afterStored: beforeStored,
                        beforeInventory, afterInventory: beforeInventory,
                        storageDelta: 0, inventoryDelta: 0, skipped: true,
                        reason: beforeStored <= 0 ? 'storage-empty-but-inventory-fundable' : 'inventory-full-but-fundable'
                    });
                }
                return this.#wait(direction, logicalId, 'b1-transfer-not-ready', { beforeStored, beforeInventory, inventoryCapacity, minRequired, reserveEmptySlots });
            }
        } else if (beforeInventory <= 0) {
            return this.#success(direction, logicalId, {
                moved: 0, beforeStored, afterStored: beforeStored,
                beforeInventory, afterInventory: beforeInventory,
                storageDelta: 0, inventoryDelta: 0, skipped: true, reason: 'inventory-empty'
            });
        }

        const materialSlot = Number(rootRead.data?.sources?.[logicalId]?.slot);
        if (!Number.isInteger(materialSlot) || materialSlot < 0 || materialSlot >= containerEnd(rootSession.window)) {
            return this.#wait(direction, logicalId, 'kho-material-not-found', { materialSlot, beforeStored, beforeInventory });
        }

        const childSource = {
            commandKey: this.storage.config?.commandKey || 'storage',
            command: '/kho',
            clicks: [materialSlot],
            actions: [`material:${logicalId}`],
            source: 'operation'
        };
        const child = await this.guiManager.clickAndWaitForTransition(materialSlot, {
            timeoutMs: Math.max(1000, Number(this.storage.config?.guiTimeoutMs || 5000)),
            cancellationToken,
            expectedGeneration,
            label: `/kho material ${logicalId}`,
            source: childSource,
            settleMs: 160,
            // /kho emits an in-place refresh on the root window before the
            // material detail window opens. Accepting any transition races that
            // refresh and returns the root session, so control detection then
            // inspects /kho instead of the material GUI. The server behavior
            // observed in production is a real replacement window (e.g.
            // title "Than" for coal), therefore wait for that new window.
            requireNewWindow: true
        });

        // Capture before interpreting controls so an unknown child layout still
        // becomes learnable data instead of disappearing before debounce fires.
        const observed = await this.guiKnowledge?.observe?.(child, { source: childSource }) || null;
        const controls = this.#detectControls(child.window, direction);
        await this.#rememberControls(child, childSource, direction, controls);

        if (controls.length === 0) {
            await this.#closeObservedChild(childSource, cancellationToken);
            return this.#wait(direction, logicalId, 'kho-child-controls-not-learned', {
                route: observed?.key || null, title: child.window?.title ?? null, occupied: this.#occupied(child.window)
            });
        }

        const target = direction === 'withdraw' ? Math.min(beforeStored, inventoryCapacity) : beforeInventory;
        const plan = this.#planSafeClicks(controls, target);
        if (plan.total <= 0) {
            await this.#closeObservedChild(childSource, cancellationToken);
            return this.#wait(direction, logicalId, 'kho-child-quantity-not-safe', { route: observed?.key || null, target, remaining: plan.remaining });
        }
        if (direction === 'deposit' && plan.remaining > 0) {
            await this.#closeObservedChild(childSource, cancellationToken);
            return this.#wait(direction, logicalId, 'kho-child-quantity-not-safe', {
                route: observed?.key || null, target, planned: plan.total, remaining: plan.remaining, exactDepositRequired: true
            });
        }
        if (direction === 'withdraw' && beforeInventory + plan.total < minRequired) {
            await this.#closeObservedChild(childSource, cancellationToken);
            return this.#wait(direction, logicalId, 'b1-inventory-below-one-b2', { minRequired, beforeInventory, plannedMove: plan.total });
        }

        this.logger?.info?.('KHO MATERIAL TRANSFER START', {
            operation: 'KhoMaterialTransfer', step: 'material-transfer', phase: 'START',
            action: direction, resource: logicalId, route: observed?.key || null,
            materialSlot, target, planned: plan.total,
            controls: controls.map(({ slot, amount, name }) => ({ slot, amount, name }))
        });

        let completedClicks = 0;
        try {
            for (const click of plan.clicks) {
                cancellationToken?.throwIfCancelled?.();
                const current = this.guiManager.syncCurrentWindow?.() || this.guiManager.current();
                if (!current?.active || !current.window) {
                    if (completedClicks === 0) return this.#wait(direction, logicalId, 'kho-child-not-stable');
                    throw this.#verificationError(`/kho child GUI closed after ${completedClicks} transfer click(s).`, {
                        direction, logicalId, completedClicks, plannedClicks: plan.clicks.length, plannedAmount: plan.total
                    });
                }
                await this.guiManager.click(click.slot, { cancellationToken, expectedGeneration });
                completedClicks += 1;
                await this.#delay(110, cancellationToken);
            }
        } catch (error) {
            if (completedClicks === 0 || error?.code === 'GUI_CLICK_VERIFY_FAILED') throw error;
            throw this.#verificationError(`/kho ${direction} became uncertain after ${completedClicks} transfer click(s).`, {
                direction, logicalId, completedClicks, plannedClicks: plan.clicks.length,
                plannedAmount: plan.total, causeCode: error?.code || null, causeMessage: error?.message || String(error || '')
            }, error);
        }

        const liveAfterInventory = await this.#waitForPlayerDelta({ logicalId, direction, beforeInventory, expected: plan.total, cancellationToken });
        const currentChild = this.guiManager.syncCurrentWindow?.() || this.guiManager.current();
        if (currentChild?.active) {
            await this.guiKnowledge?.observe?.(currentChild, { source: childSource });
            await this.guiManager.closeCurrentWindow();
            await this.#delay(180, cancellationToken);
        }

        this.storage.invalidateSnapshot?.();
        const afterRead = await this.storage.read({ refresh: true, cancellationToken, operationContext, expectedGeneration });
        const afterSession = this.guiManager.syncCurrentWindow?.() || this.guiManager.current();
        const rootAfterInventory = afterSession?.window ? this.#countPlayer(afterSession.window, logicalId) : liveAfterInventory.count;
        const inventoryDelta = direction === 'withdraw'
            ? Math.max(0, Math.max(liveAfterInventory.count, rootAfterInventory) - beforeInventory)
            : Math.max(0, beforeInventory - Math.min(liveAfterInventory.count, rootAfterInventory));
        const afterStored = afterRead?.success === false ? null : Math.max(0, Number(afterRead.data?.items?.[logicalId] || 0));

        if (inventoryDelta < plan.total) {
            throw this.#verificationError(`/kho ${direction} transport completed but player inventory delta was not verified.`, {
                direction, logicalId, expected: plan.total, inventoryDelta, beforeInventory,
                liveAfterInventory: liveAfterInventory.count, rootAfterInventory, beforeStored, afterStored,
                afterReadStatus: afterRead?.status || null
            }, afterRead?.success === false ? afterRead.error : null);
        }

        const storageDelta = afterStored === null ? null : (direction === 'withdraw'
            ? Math.max(0, beforeStored - afterStored)
            : Math.max(0, afterStored - beforeStored));

        this.logger?.info?.('KHO MATERIAL TRANSFER OK', {
            operation: 'KhoMaterialTransfer', step: 'verify-transfer', phase: 'OK', action: direction,
            resource: logicalId, route: observed?.key || null, moved: plan.total,
            inventoryDelta, storageDelta, beforeInventory, afterInventory: rootAfterInventory, beforeStored, afterStored
        });
        return this.#success(direction, logicalId, {
            route: observed?.key || null, moved: plan.total, inventoryDelta, storageDelta,
            beforeInventory, afterInventory: rootAfterInventory, beforeStored, afterStored, materialSlot, verified: true
        });
    }

    async #closeObservedChild(source, cancellationToken) {
        const current = this.guiManager.syncCurrentWindow?.() || this.guiManager.current();
        if (!current?.active) return;
        await this.guiKnowledge?.observe?.(current, { source });
        await this.guiManager.closeCurrentWindow();
        await this.#delay(120, cancellationToken);
    }

    async #rememberControls(session, source, direction, controls) {
        if (controls.length === 0 || typeof this.guiKnowledge?.learnSlot !== 'function') return;
        for (const control of controls) {
            await this.guiKnowledge.learnSlot(session, {
                source,
                roleId: `storage:${direction}:${control.amount}`,
                slot: control.slot,
                logicalItemId: null,
                context: 'storage-material-transfer',
                bootstrapSlot: control.slot
            });
        }
    }

    #detectControls(window, direction) {
        const result = [];
        const end = containerEnd(window);
        for (let slot = 0; slot < end; slot += 1) {
            const raw = window?.slots?.[slot];
            if (!raw) continue;
            const name = String(raw.name || '').trim().toLowerCase();
            const directionColor = direction === 'withdraw'
                ? (name === 'red_stained_glass_pane' || /(?:^|_)red_(?:glass_pane|concrete|wool|terracotta)$/.test(name))
                : (name === 'green_stained_glass_pane' || name === 'lime_stained_glass_pane' || /(?:^|_)(?:green|lime)_(?:glass_pane|concrete|wool|terracotta)$/.test(name));
            if (!directionColor) continue;

            const text = this.#itemText(raw);
            if (/\b(?:all|tat\s*ca|toan\s*bo)\b/i.test(text)) continue;
            const directionWords = direction === 'withdraw'
                ? /\b(?:rut|lay|withdraw|take)\b/i
                : /\b(?:nap|gui|deposit|store|put)\b/i;
            const quantityOnly = text.match(/^\s*(?:x\s*)?(1|64)(?:\s*x)?\s*$/i);
            const directional = directionWords.test(text);
            let amount = null;
            if (directional && /(?:^|\D)64(?:\D|$)/.test(text)) amount = 64;
            else if (directional && /(?:^|\D)1(?:\D|$)/.test(text)) amount = 1;
            else if (quantityOnly) amount = Number(quantityOnly[1]);
            if (!Number.isSafeInteger(amount) || amount <= 0) continue;
            result.push({ slot, amount, name, text });
        }
        return result.sort((a, b) => b.amount - a.amount || a.slot - b.slot);
    }

    #planSafeClicks(controls, target) {
        let remaining = Math.max(0, Math.floor(Number(target) || 0));
        const clicks = [];
        for (const control of controls) {
            while (remaining >= control.amount && clicks.length < 128) {
                clicks.push({ index: clicks.length, slot: control.slot, amount: control.amount });
                remaining -= control.amount;
            }
            if (remaining <= 0 || clicks.length >= 128) break;
        }
        return { clicks, total: Math.max(0, Math.floor(Number(target) || 0) - remaining), remaining };
    }

    #safeInventoryCapacity(window, logicalId, reserveEmptySlots = 0) {
        const range = this.#playerRange(window);
        if (!range) return 0;
        let empty = 0;
        let stackHeadroom = 0;
        for (let slot = range.start; slot < range.end; slot += 1) {
            const raw = window.slots[slot];
            if (!raw) { empty += 1; continue; }
            if (this.#matches(raw, logicalId)) stackHeadroom += Math.max(0, 64 - Math.max(0, Number(raw.count) || 0));
        }
        return Math.max(0, empty - Math.max(0, Number(reserveEmptySlots) || 0)) * 64 + stackHeadroom;
    }

    #countPlayer(window, logicalId) {
        const range = this.#playerRange(window);
        if (!range) return 0;
        let total = 0;
        for (let slot = range.start; slot < range.end; slot += 1) {
            const raw = window.slots[slot];
            if (raw && this.#matches(raw, logicalId)) total += Math.max(0, Number(raw.count) || 0);
        }
        return total;
    }

    async #waitForPlayerDelta({ logicalId, direction, beforeInventory, expected, cancellationToken }) {
        const deadline = Date.now() + 2400;
        let best = beforeInventory;
        while (Date.now() <= deadline) {
            cancellationToken?.throwIfCancelled?.();
            const current = this.guiManager.syncCurrentWindow?.() || this.guiManager.current();
            const count = current?.window ? this.#countPlayer(current.window, logicalId) : best;
            best = direction === 'withdraw' ? Math.max(best, count) : Math.min(best, count);
            const delta = direction === 'withdraw' ? Math.max(0, best - beforeInventory) : Math.max(0, beforeInventory - best);
            if (delta >= expected) return { count: best, delta };
            await this.#delay(50, cancellationToken);
        }
        return { count: best, delta: direction === 'withdraw' ? Math.max(0, best - beforeInventory) : Math.max(0, beforeInventory - best) };
    }

    #matches(raw, logicalId) {
        try { if (this.guiKnowledge?.matchesLogical?.(raw, logicalId, 'inventory')) return true; } catch (_) {}
        try { if (this.reader?.itemResolver?.resolve?.(raw, 'inventory')?.id === logicalId) return true; } catch (_) {}
        return String(raw?.name || '').toLowerCase() === String(logicalId || '').toLowerCase();
    }

    #itemText(raw) {
        try {
            const parser = this.reader?.textParser;
            const lines = parser?.itemLines?.(raw);
            if (Array.isArray(lines) && lines.length) {
                const joined = lines.join(' ');
                if (typeof parser?.normalizeText === 'function') return String(parser.normalizeText(joined) || '');
                return this.#normalizeText(joined);
            }
        } catch (_) {}
        return this.#normalizeText(`${raw?.displayName || ''} ${raw?.name || ''}`);
    }

    #normalizeText(value) {
        return String(value || '').replace(/§[0-9a-fk-or]/gi, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
    }

    #playerRange(window) {
        if (!window || !Array.isArray(window.slots)) return null;
        const start = Number(window.inventoryStart);
        if (!Number.isInteger(start) || start < 0 || start >= window.slots.length) return null;
        const configuredEnd = Number(window.inventoryEnd);
        const end = Number.isInteger(configuredEnd) && configuredEnd > start ? Math.min(configuredEnd, window.slots.length) : window.slots.length;
        return end > start ? { start, end } : null;
    }

    #occupied(window) {
        const result = [];
        const end = containerEnd(window);
        for (let slot = 0; slot < end; slot += 1) {
            const raw = window?.slots?.[slot];
            if (!raw) continue;
            result.push({ slot, name: raw.name || null, count: Number(raw.count) || 0, displayName: String(raw.displayName || ''), text: this.#itemText(raw) });
        }
        return result;
    }

    #wait(direction, logicalId, reason, details = null) {
        this.logger?.info?.('KHO MATERIAL TRANSFER WAIT', {
            operation: 'KhoMaterialTransfer', step: 'material-transfer', phase: 'WAIT', action: direction, resource: logicalId, reason, details
        });
        return { ready: false, verified: false, direction, logicalId, moved: 0, reason, details };
    }

    #success(direction, logicalId, data = {}) { return { ready: true, direction, logicalId, ...data }; }

    #verificationError(message, details, cause = null) {
        return new FlowError(message, {
            code: 'GUI_CLICK_VERIFY_FAILED', subsystem: 'storage', operation: 'KhoMaterialTransfer',
            step: 'verify-material-transfer', action: 'verify /kho child transfer against player inventory',
            resource: details?.logicalId || null, retryable: false, details, cause
        });
    }

    #delay(ms, cancellationToken = null) {
        const timeout = Math.max(0, Number(ms) || 0);
        if (!cancellationToken) return new Promise(resolve => setTimeout(resolve, timeout));
        return new Promise((resolve, reject) => {
            let unsubscribe = () => {};
            const timer = setTimeout(() => { unsubscribe(); resolve(); }, timeout);
            unsubscribe = cancellationToken.onCancelled(reason => {
                clearTimeout(timer); unsubscribe();
                const error = new Error(String(reason || 'Cancelled')); error.code = 'CANCELLED'; reject(error);
            });
        });
    }
}

module.exports = KhoMaterialTransfer;
