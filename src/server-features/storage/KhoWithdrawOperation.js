'use strict';

const Timeout = require('../../shared/time/Timeout');
const FlowError = require('../../shared/errors/FlowError');
const Result = require('../../shared/result/Result');
const Status = require('../../shared/result/Status');
const StorageTextParser = require('./StorageTextParser');
const B1WithdrawQuantityResolver = require('../../planning/storage/B1WithdrawQuantityResolver');
const B1InventoryWithdrawalPlanner = require('../../planning/storage/B1InventoryWithdrawalPlanner');

class KhoWithdrawOperation {
    constructor({
        storage,
        guiManager,
        context,
        itemResolver,
        inventoryReader,
        inventoryCounter,
        config,
        textParser = new StorageTextParser(),
        quantityResolver = null,
        capacityPlanner = new B1InventoryWithdrawalPlanner(),
        logger = null,
        workloadMetrics = null
    } = {}) {
        if (!storage?.read) throw new TypeError('KhoWithdrawOperation storage is required.');
        if (!guiManager?.clickAndWaitForTransition || !guiManager?.click) throw new TypeError('KhoWithdrawOperation GuiManager is required.');
        if (!inventoryReader || !inventoryCounter) throw new TypeError('KhoWithdrawOperation inventory capability is required.');
        Object.assign(this, { storage, guiManager, context, itemResolver, inventoryReader, inventoryCounter, textParser, capacityPlanner, logger, workloadMetrics });
        this.config = config || {};
        this.withdrawConfig = this.config.withdraw || {};
        this.quantityResolver = quantityResolver || new B1WithdrawQuantityResolver({
            numericQuantities: this.withdrawConfig.numericQuantities
        });
    }

    reconfigure(config) {
        this.config = config || {};
        this.withdrawConfig = this.config.withdraw || {};
        this.quantityResolver = new B1WithdrawQuantityResolver({ numericQuantities: this.withdrawConfig.numericQuantities });
        return this;
    }

    async execute(logicalId, {
        requiredAmount,
        outputId = null,
        expectedOutputAmount = 1,
        minimumFreeSlots = null,
        cancellationToken = null,
        expectedGeneration = null,
        operationContext = null
    } = {}) {
        const options = { requiredAmount, outputId, expectedOutputAmount, minimumFreeSlots, cancellationToken, expectedGeneration, operationContext };
        if (!this.workloadMetrics) return this.#execute(logicalId, options, null);
        return this.workloadMetrics.measure('storage.withdraw', tracker => this.#execute(logicalId, options, tracker));
    }

    async #execute(logicalId, {
        requiredAmount,
        outputId = null,
        expectedOutputAmount = 1,
        minimumFreeSlots = null,
        cancellationToken = null,
        expectedGeneration = null,
        operationContext = null
    } = {}, metrics = null) {
        const requested = Number(requiredAmount);
        if (!Number.isInteger(requested) || requested < 0) {
            return Result.fail(Status.INVALID_INPUT, 'B1 withdrawal requires a non-negative integer amount.');
        }
        if (this.withdrawConfig.enabled === false) {
            return Result.fail(Status.NOT_READY, 'B1 inventory withdrawal is disabled.', null, {
                code: 'KHO_WITHDRAW_DISABLED', step: 'b1-withdraw', resource: logicalId
            });
        }
        const generation = expectedGeneration ?? operationContext?.connectionGeneration ?? this.context?.getGeneration?.() ?? null;
        cancellationToken = operationContext?.cancellation?.token || cancellationToken;
        cancellationToken?.throwIfCancelled?.();
        this.#assertGeneration(generation);

        const beforeSnapshot = this.#inventorySnapshot();
        const inventoryBefore = this.#count(beforeSnapshot, logicalId);
        const needed = Math.max(0, requested - inventoryBefore);
        if (needed === 0) return Result.ok({
            source: 'inventory', resource: logicalId, requestedAmount: requested,
            inventoryBefore, inventoryAfter: inventoryBefore, actualDelta: 0,
            actions: [], withdrawalRequired: false
        });

        let safety = this.#inventorySafety(beforeSnapshot, {
            logicalId,
            needed,
            requested,
            outputId,
            expectedOutputAmount,
            minimumFreeSlots
        });
        if (!safety.safe) {
            return Result.fail(Status.NOT_READY, 'Inventory capacity is reserved for B2 output.', null, {
                code: 'KHO_WITHDRAW_INVENTORY_CAPACITY', operation: 'KhoWithdrawOperation',
                step: 'plan-inventory-capacity', resource: logicalId, details: safety
            });
        }

        const actions = [];
        let remaining = needed;
        while (remaining > 0) {
            cancellationToken?.throwIfCancelled?.();
            this.#assertGeneration(generation);
            safety = this.#inventorySafety(this.#inventorySnapshot(), {
                logicalId,
                needed: remaining,
                requested,
                outputId,
                expectedOutputAmount,
                minimumFreeSlots
            });
            if (!safety.safe) {
                return Result.fail(Status.NOT_READY, 'Inventory capacity changed while reserving B2 output.', null, {
                    code: 'KHO_WITHDRAW_INVENTORY_CAPACITY', operation: 'KhoWithdrawOperation',
                    step: 'recheck-inventory-capacity', resource: logicalId, details: safety
                });
            }
            const prepared = await this.#prepareQuantityGui(logicalId, {
                cancellationToken,
                expectedGeneration: generation,
                operationContext,
                requiredRemaining: remaining,
                metrics
            });
            if (!prepared.success) return prepared;

            const available = Object.keys(prepared.data.quantitySlots || {}).map(Number);
            const plan = this.quantityResolver.resolve(remaining, available);
            if (!plan || plan.length === 0) {
                return Result.fail(Status.NOT_READY, 'No exact withdrawal quantity combination is available.', null, {
                    code: 'KHO_WITHDRAW_QUANTITY_UNAVAILABLE', operation: 'KhoWithdrawOperation',
                    step: 'resolve-withdraw-action', resource: logicalId,
                    details: { requestedAmount: requested, remaining, availableQuantities: available }
                });
            }
            const quantity = plan[0];
            const attemptResult = await this.#clickAndReconcile(logicalId, quantity, prepared.data.quantitySlots[String(quantity)], {
                cancellationToken,
                expectedGeneration: generation,
                metrics
            });
            if (!attemptResult.success) return attemptResult;
            actions.push(attemptResult.data);
            if (attemptResult.data.actualDelta <= 0) {
                return Result.fail(Status.NOT_READY, 'Withdrawal produced no inventory delta.', null, {
                    code: 'KHO_WITHDRAW_NO_EFFECT', operation: 'KhoWithdrawOperation',
                    step: 'verify-inventory', resource: logicalId,
                    details: { requestedAmount: requested, remaining, quantity, actions }
                });
            }
            remaining = Math.max(0, requested - attemptResult.data.inventoryAfter);
        }

        const inventoryAfter = this.#count(this.#inventorySnapshot(), logicalId);
        const actualDelta = Math.max(0, inventoryAfter - inventoryBefore);
        this.logger?.info?.('B5 B1 withdrawal complete.', {
            operation: 'KhoWithdrawOperation', step: 'b1-withdraw', resource: logicalId,
            requested: requested, actions: actions.map(action => action.quantity),
            inventoryBefore, inventoryAfter, actualDelta,
            freeSlotsBefore: safety.emptySlots,
            freeSlotsAfter: this.#inventorySnapshot().emptySlotCount ?? null,
            result: inventoryAfter >= requested ? 'success' : 'partial'
        });
        return Result.ok({
            source: 'inventory', resource: logicalId, requestedAmount: requested,
            selectedActions: actions.map(action => action.quantity), actions,
            inventoryBefore, inventoryAfter, actualDelta,
            withdrawalRequired: true, safety
        });
    }

    async #prepareQuantityGui(logicalId, options) {
        options.metrics?.increment('overviewOpenCount');
        const overview = await this.storage.read({ ...options, refresh: true, forceReopen: true });
        if (!overview.success) return overview;
        const stored = Math.max(0, Number(overview.data?.items?.[logicalId] || 0));
        const materialSlot = Number(overview.data?.sources?.[logicalId]?.slot);
        if (!Number.isInteger(materialSlot) || materialSlot < 0) {
            return Result.fail(Status.NOT_FOUND, 'B1 material is not visible in /kho.', null, {
                code: 'KHO_WITHDRAW_MATERIAL_NOT_FOUND', operation: 'KhoWithdrawOperation',
                step: 'select-material', resource: logicalId,
                details: { stored, available: Object.keys(overview.data?.sources || {}) }
            });
        }
        if (stored <= 0) {
            return Result.fail(Status.NOT_READY, 'B1 material is not available in /kho.', null, {
                code: 'KHO_WITHDRAW_MATERIAL_NOT_READY', operation: 'KhoWithdrawOperation',
                step: 'select-material', resource: logicalId, details: { stored }
            });
        }
        if (stored < Number(options.requiredRemaining || 0)) {
            return Result.fail(Status.NOT_READY, 'B1 material in /kho is below the remaining withdrawal amount.', null, {
                code: 'KHO_WITHDRAW_MATERIAL_NOT_READY', operation: 'KhoWithdrawOperation',
                step: 'select-material', resource: logicalId,
                details: { stored, requiredRemaining: Number(options.requiredRemaining || 0) }
            });
        }

        const detailSource = this.#source(logicalId, ['material-detail']);
        let detail;
        try {
            options.metrics?.increment('detailOpenCount');
            detail = await this.guiManager.clickAndWaitForTransition(materialSlot, {
                timeoutMs: this.#timeout(), cancellationToken: options.cancellationToken,
                expectedGeneration: options.expectedGeneration,
                label: `open storage detail ${logicalId}`, requireNewWindow: true,
                settleMs: Number(this.config.openSettleMs || 0), source: detailSource
            });
        } catch (error) {
            return this.#failure(error, 'KHO_WITHDRAW_DETAIL_NOT_OPENED', 'open-detail', logicalId, { materialSlot });
        }
        this.#assertGeneration(options.expectedGeneration);
        const withdrawSlot = this.#findPatternSlot(detail?.window, this.withdrawConfig.withdrawPatterns);
        if (withdrawSlot < 0) {
            return Result.fail(Status.NOT_FOUND, 'Withdraw action is not visible in material detail GUI.', null, {
                code: 'KHO_WITHDRAW_ACTION_NOT_FOUND', operation: 'KhoWithdrawOperation',
                step: 'resolve-withdraw-action', resource: logicalId,
                details: { materialSlot, gui: this.guiManager.describeCurrent?.() || null }
            });
        }

        let quantitySession;
        try {
            options.metrics?.increment('quantityOpenCount');
            quantitySession = await this.guiManager.clickAndWaitForTransition(withdrawSlot, {
                timeoutMs: this.#timeout(), cancellationToken: options.cancellationToken,
                expectedGeneration: options.expectedGeneration,
                label: `open withdraw quantities ${logicalId}`, requireNewWindow: true,
                settleMs: Number(this.config.openSettleMs || 0),
                source: this.#source(logicalId, ['material-detail', 'withdraw'])
            });
        } catch (error) {
            return this.#failure(error, 'KHO_WITHDRAW_QUANTITY_GUI_NOT_OPENED', 'open-withdraw-quantity', logicalId, { materialSlot, withdrawSlot });
        }
        this.#assertGeneration(options.expectedGeneration);
        const quantitySlots = Object.fromEntries(this.#quantitySlots(quantitySession?.window));
        return Result.ok({ overview: overview.data, materialSlot, withdrawSlot, quantitySlots });
    }

    async #clickAndReconcile(logicalId, quantity, slot, { cancellationToken, expectedGeneration, metrics = null }) {
        const before = this.#count(this.#inventorySnapshot(), logicalId);
        let clickError = null;
        try {
            metrics?.increment('clickCount');
            await this.guiManager.click(slot, { cancellationToken, expectedGeneration });
        } catch (error) {
            clickError = error;
        }
        const after = await this.#waitForCount(logicalId, before, { cancellationToken, expectedGeneration, metrics });
        const actualDelta = Math.max(0, after - before);
        if (actualDelta > 0) {
            return Result.ok({ quantity, slot, inventoryBefore: before, inventoryAfter: after, actualDelta, reconciledAfterClickError: Boolean(clickError) });
        }
        metrics?.increment('noDeltaCount');
        if (clickError) return this.#failure(clickError, 'KHO_WITHDRAW_CLICK_FAILED', 'click-withdraw', logicalId, { quantity, slot, before, after });
        return Result.fail(Status.NOT_READY, 'Withdrawal click was not reflected in inventory.', null, {
            code: 'KHO_WITHDRAW_NOT_VERIFIED', operation: 'KhoWithdrawOperation', step: 'verify-inventory', resource: logicalId,
            details: { quantity, slot, before, after, unchangedConfirmationReads: this.withdrawConfig.unchangedConfirmationReads }
        });
    }

    async #waitForCount(logicalId, before, { cancellationToken, expectedGeneration, metrics = null }) {
        const attempts = Math.max(1, Number(this.withdrawConfig.verifyAttempts || 12));
        const retryMs = Math.max(1, Number(this.withdrawConfig.verifyRetryMs || 100));
        const unchangedRequired = Math.max(1, Number(this.withdrawConfig.unchangedConfirmationReads || 2));
        let best = before;
        let unchanged = 0;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            metrics?.increment('reconcileReadCount');
            cancellationToken?.throwIfCancelled?.();
            this.#assertGeneration(expectedGeneration);
            const current = this.#count(this.#inventorySnapshot(), logicalId);
            best = Math.max(best, current);
            if (current > before) return current;
            unchanged += 1;
            if (attempt >= attempts && unchanged >= unchangedRequired) break;
            await Timeout.delay(retryMs, { cancellationToken });
        }
        return best;
    }

    #inventorySafety(snapshot, { logicalId, needed, requested, outputId, expectedOutputAmount, minimumFreeSlots }) {
        const input = this.#itemCapacity(snapshot, logicalId);
        const output = outputId ? this.#itemCapacity(snapshot, outputId) : { mergeCapacity: 0, stackSize: 64 };
        return this.capacityPlanner.compile({
            requestedAmount: needed,
            inventoryCount: 0,
            emptySlots: snapshot?.emptySlotCount || 0,
            inputMergeCapacity: input.mergeCapacity,
            outputAmount: Math.max(0, Number(expectedOutputAmount || 0)),
            outputMergeCapacity: output.mergeCapacity,
            inputStackSize: input.stackSize,
            outputStackSize: output.stackSize,
            minimumFreeSlots: minimumFreeSlots ?? this.withdrawConfig.minimumOutputSlots ?? 2,
            requestedTotal: requested
        });
    }

    #itemCapacity(snapshot, logicalId) {
        let mergeCapacity = 0;
        let stackSize = 64;
        for (const item of snapshot?.items || []) {
            const resolved = this.itemResolver?.resolve?.(item, 'inventory');
            if (resolved?.id !== logicalId) continue;
            const max = Math.max(1, Number(item.maxStackSize || 64));
            stackSize = max;
            mergeCapacity += Math.max(0, max - Math.max(0, Number(item.count || 0)));
        }
        return { mergeCapacity, stackSize };
    }

    #quantitySlots(window) {
        const found = new Map();
        const end = Number.isInteger(window?.inventoryStart) ? window.inventoryStart : (window?.slots?.length || 0);
        for (let slot = 0; slot < end; slot += 1) {
            const item = window?.slots?.[slot];
            if (!item) continue;
            const text = this.#itemText(item);
            if (this.#matches(text, this.withdrawConfig.stackPatterns)
                || this.#matches(text, this.withdrawConfig.fullInventoryPatterns)) continue;
            const lines = this.textParser.itemLines(item)
                .map(line => this.textParser.normalizeText(line));
            const primary = this.textParser.normalizeText(item.displayName || item.customName || '');
            const matched = this.quantityResolver.numericQuantities.filter(quantity => {
                const exact = new RegExp(`^(?:(?:rut|withdraw|amount|quantity|so luong)\\s*[:x-]?\\s*)?${quantity}$`, 'i');
                const action = new RegExp(`^(?:rut|withdraw)\\s+(?:x\\s*)?${quantity}(?:\\s+(?:item|items|vat\\s+pham))?$`, 'i');
                return exact.test(primary) || lines.some(line => exact.test(line) || action.test(line));
            });
            if (matched.length === 1 && !found.has(matched[0])) found.set(matched[0], slot);
        }
        return found;
    }

    #findPatternSlot(window, patterns) {
        const end = Number.isInteger(window?.inventoryStart) ? window.inventoryStart : (window?.slots?.length || 0);
        for (let slot = 0; slot < end; slot += 1) {
            const item = window?.slots?.[slot];
            if (item && this.#matches(this.#itemText(item), patterns)) return slot;
        }
        return -1;
    }

    #matches(text, patterns) {
        return (patterns || []).some(pattern => {
            try { return new RegExp(pattern, 'i').test(text); } catch { return false; }
        });
    }

    #itemText(item) {
        return this.textParser.normalizeText(this.textParser.itemLines(item).join('\n'));
    }

    #inventorySnapshot() {
        return typeof this.inventoryReader.readBotInventory === 'function'
            ? this.inventoryReader.readBotInventory()
            : this.inventoryReader.read();
    }

    #count(snapshot, logicalId) {
        return Math.max(0, Number(this.inventoryCounter.count(snapshot, logicalId) || 0));
    }

    #source(logicalId, actions) {
        return { commandKey: this.config.commandKey, command: '/kho', clicks: [], actions: [`material:${logicalId}`, ...actions], source: 'operation' };
    }

    #timeout() { return Math.max(250, Number(this.withdrawConfig.detailTimeoutMs || this.config.guiTimeoutMs || 5000)); }

    #assertGeneration(expectedGeneration) {
        if (expectedGeneration === null || expectedGeneration === undefined) return;
        const current = Number(this.context?.getGeneration?.());
        if (Number(expectedGeneration) !== current) {
            throw new FlowError('Connection generation changed during B1 withdrawal.', {
                code: 'KHO_WITHDRAW_STALE_GENERATION', subsystem: 'storage', operation: 'KhoWithdrawOperation',
                step: 'generation-guard', retryable: true,
                details: { expectedGeneration: Number(expectedGeneration), currentGeneration: current }
            });
        }
    }

    #failure(error, code, step, resource, details = {}) {
        const wrapped = FlowError.wrap(error, {
            code: error?.code || code, subsystem: 'storage', operation: 'KhoWithdrawOperation',
            step, action: 'withdraw B1 from /kho to inventory', resource, retryable: true, details
        });
        return Result.fail(code.includes('NOT_OPENED') ? Status.NOT_READY : Status.FAILED, wrapped.message, wrapped, wrapped.toDiagnostic());
    }
}

module.exports = KhoWithdrawOperation;
