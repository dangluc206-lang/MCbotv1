'use strict';

const Result = require('../../shared/result/Result');
const Status = require('../../shared/result/Status');
const FlowError = require('../../shared/errors/FlowError');

class KhoWithdrawGuiSession {
    constructor({ storage, guiManager, textParser, config, quantityResolver, logger = null } = {}) {
        Object.assign(this, { storage, guiManager, textParser, config: config || {}, quantityResolver, logger });
        this.withdrawConfig = this.config.withdraw || {};
    }

    reconfigure(config) {
        this.config = config || {};
        this.withdrawConfig = this.config.withdraw || {};
        return this;
    }

    async prepare(logicalId, options = {}) {
        const reusable = this.#reuseQuantity(logicalId, options);
        if (reusable) return Result.ok(reusable);

        const detailReuse = await this.#reuseDetail(logicalId, options);
        if (detailReuse) return detailReuse;

        options.metrics?.increment('overviewOpenCount');
        const overview = await this.storage.read({
            ...options,
            refresh: true,
            forceReopen: true
        });
        if (!overview.success) return overview;
        const stored = Math.max(0, Number(overview.data?.items?.[logicalId] || 0));
        const materialSlot = Number(overview.data?.sources?.[logicalId]?.slot);
        const remaining = Math.max(0, Number(options.requiredRemaining || 0));
        if (!Number.isInteger(materialSlot) || materialSlot < 0) {
            return Result.fail(Status.NOT_FOUND, 'B1 material is not visible in /kho.', null, {
                code: 'KHO_WITHDRAW_MATERIAL_NOT_FOUND', operation: 'KhoWithdrawOperation',
                step: 'select-material', resource: logicalId,
                details: { stored, available: Object.keys(overview.data?.sources || {}) }
            });
        }
        if (stored <= 0 || stored < remaining) {
            return Result.fail(Status.NOT_READY, 'B1 material in /kho is below the remaining withdrawal amount.', null, {
                code: 'KHO_WITHDRAW_MATERIAL_NOT_READY', operation: 'KhoWithdrawOperation',
                step: 'select-material', resource: logicalId,
                details: { stored, requiredRemaining: remaining }
            });
        }

        let detail;
        try {
            options.metrics?.increment('detailOpenCount');
            detail = await this.guiManager.clickAndWaitForTransition(materialSlot, {
                timeoutMs: this.#timeout(), cancellationToken: options.cancellationToken,
                expectedGeneration: options.expectedGeneration,
                label: `open storage detail ${logicalId}`, requireNewWindow: true,
                settleMs: Number(this.config.openSettleMs || 0),
                source: this.#source(logicalId, ['material-detail'])
            });
        } catch (error) {
            return this.#failure(error, 'KHO_WITHDRAW_DETAIL_NOT_OPENED', 'open-detail', logicalId, { materialSlot });
        }
        const withdrawSlot = this.findPatternSlot(detail?.window, this.withdrawConfig.withdrawPatterns);
        if (withdrawSlot < 0) {
            return Result.fail(Status.NOT_FOUND, 'Withdraw action is not visible in material detail GUI.', null, {
                code: 'KHO_WITHDRAW_ACTION_NOT_FOUND', operation: 'KhoWithdrawOperation',
                step: 'resolve-withdraw-action', resource: logicalId,
                details: { materialSlot, gui: this.guiManager.describeCurrent?.() || null }
            });
        }
        return this.#openQuantity(logicalId, {
            ...options,
            stored,
            overview: overview.data,
            materialSlot,
            withdrawSlot
        });
    }

    actionSlots(window, { stackSize = 64, fillInventoryAmount = 0 } = {}) {
        const numericSlots = {};
        let stackSlot = null;
        let fillInventorySlot = null;
        const end = Number.isInteger(window?.inventoryStart) ? window.inventoryStart : (window?.slots?.length || 0);
        for (let slot = 0; slot < end; slot += 1) {
            const item = window?.slots?.[slot];
            if (!item) continue;
            const text = this.itemText(item);
            if (stackSlot === null && this.matches(text, this.withdrawConfig.stackPatterns)) {
                stackSlot = slot;
                continue;
            }
            if (fillInventorySlot === null && this.matches(text, this.withdrawConfig.fullInventoryPatterns)) {
                fillInventorySlot = slot;
                continue;
            }
            const lines = this.textParser.itemLines(item).map(line => this.textParser.normalizeText(line));
            const primary = this.textParser.normalizeText(item.displayName || item.customName || '');
            const matched = this.quantityResolver.numericQuantities.filter(quantity => {
                const exact = new RegExp(`^(?:(?:rut|withdraw|amount|quantity|so luong)\\s*[:x-]?\\s*)?${quantity}$`, 'i');
                const action = new RegExp(`^(?:rut|withdraw)\\s+(?:x\\s*)?${quantity}(?:\\s+(?:item|items|vat\\s+pham))?$`, 'i');
                return exact.test(primary) || lines.some(line => exact.test(line) || action.test(line));
            });
            if (matched.length === 1 && numericSlots[matched[0]] === undefined) numericSlots[matched[0]] = slot;
        }
        return Object.freeze({ numericSlots: Object.freeze(numericSlots), stackSlot, stackSize, fillInventorySlot, fillInventoryAmount });
    }

    findPatternSlot(window, patterns) {
        const end = Number.isInteger(window?.inventoryStart) ? window.inventoryStart : (window?.slots?.length || 0);
        for (let slot = 0; slot < end; slot += 1) {
            const item = window?.slots?.[slot];
            if (item && this.matches(this.itemText(item), patterns)) return slot;
        }
        return -1;
    }

    matches(text, patterns) {
        return (patterns || []).some(pattern => {
            try { return new RegExp(pattern, 'i').test(text); } catch { return false; }
        });
    }

    itemText(item) {
        return this.textParser.normalizeText(this.textParser.itemLines(item).join('\n'));
    }

    #reuseQuantity(logicalId, options) {
        if (this.withdrawConfig.reuseQuantityGui === false) return null;
        const current = this.guiManager.current?.();
        const window = current?.active === false ? null : current?.window;
        if (!window) return null;
        const actionSlots = this.actionSlots(window, options.actionAmounts || {});
        if (Object.keys(actionSlots.numericSlots).length === 0 && actionSlots.stackSlot === null && actionSlots.fillInventorySlot === null) return null;
        options.metrics?.increment('quantityReuseCount');
        return {
            reused: 'quantity',
            overview: options.previous?.overview || null,
            stored: options.previous?.stored ?? null,
            materialSlot: options.previous?.materialSlot ?? null,
            withdrawSlot: options.previous?.withdrawSlot ?? null,
            quantityWindow: window,
            actionSlots
        };
    }

    async #reuseDetail(logicalId, options) {
        if (this.withdrawConfig.reuseQuantityGui === false) return null;
        const current = this.guiManager.current?.();
        const window = current?.active === false ? null : current?.window;
        if (!window) return null;
        const withdrawSlot = this.findPatternSlot(window, this.withdrawConfig.withdrawPatterns);
        if (withdrawSlot < 0) return null;
        options.metrics?.increment('detailReuseCount');
        return this.#openQuantity(logicalId, {
            ...options,
            stored: options.previous?.stored ?? null,
            overview: options.previous?.overview || null,
            materialSlot: options.previous?.materialSlot ?? null,
            withdrawSlot
        });
    }

    async #openQuantity(logicalId, options) {
        let quantitySession;
        try {
            options.metrics?.increment('quantityOpenCount');
            quantitySession = await this.guiManager.clickAndWaitForTransition(options.withdrawSlot, {
                timeoutMs: this.#timeout(), cancellationToken: options.cancellationToken,
                expectedGeneration: options.expectedGeneration,
                label: `open withdraw quantities ${logicalId}`, requireNewWindow: true,
                settleMs: Number(this.config.openSettleMs || 0),
                source: this.#source(logicalId, ['material-detail', 'withdraw'])
            });
        } catch (error) {
            return this.#failure(error, 'KHO_WITHDRAW_QUANTITY_GUI_NOT_OPENED', 'open-withdraw-quantity', logicalId, {
                materialSlot: options.materialSlot, withdrawSlot: options.withdrawSlot
            });
        }
        const actionSlots = this.actionSlots(quantitySession?.window, options.actionAmounts || {});
        return Result.ok({
            reused: null,
            overview: options.overview || null,
            stored: options.stored ?? null,
            materialSlot: options.materialSlot ?? null,
            withdrawSlot: options.withdrawSlot,
            quantityWindow: quantitySession?.window || null,
            actionSlots
        });
    }

    #source(logicalId, actions) {
        return {
            commandKey: this.config.commandKey,
            command: '/kho',
            clicks: [],
            actions: [`material:${logicalId}`, ...actions],
            source: 'operation'
        };
    }

    #timeout() {
        return Math.max(250, Number(this.withdrawConfig.detailTimeoutMs || this.config.guiTimeoutMs || 5000));
    }

    #failure(error, code, step, resource, details = {}) {
        const wrapped = FlowError.wrap(error, {
            code: error?.code || code,
            subsystem: 'storage',
            operation: 'KhoWithdrawOperation',
            step,
            action: 'withdraw B1 from /kho to inventory',
            resource,
            retryable: true,
            details
        });
        return Result.fail(code.includes('NOT_OPENED') ? Status.NOT_READY : Status.FAILED, wrapped.message, wrapped, wrapped.toDiagnostic());
    }
}

module.exports = KhoWithdrawGuiSession;
