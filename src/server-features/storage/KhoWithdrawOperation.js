'use strict';

const Timeout = require('../../shared/time/Timeout');
const FlowError = require('../../shared/errors/FlowError');
const Result = require('../../shared/result/Result');
const Status = require('../../shared/result/Status');
const StorageTextParser = require('./StorageTextParser');
const B1WithdrawQuantityResolver = require('../../planning/storage/B1WithdrawQuantityResolver');
const B1InventoryWithdrawalPlanner = require('../../planning/storage/B1InventoryWithdrawalPlanner');
const KhoWithdrawGuiSession = require('./KhoWithdrawGuiSession');

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
        guiSession = null,
        logger = null,
        workloadMetrics = null
    } = {}) {
        if (!storage?.read) throw new TypeError('KhoWithdrawOperation storage is required.');
        if (!guiManager?.clickAndWaitForTransition || !guiManager?.click) throw new TypeError('KhoWithdrawOperation GuiManager is required.');
        if (!inventoryReader || !inventoryCounter) throw new TypeError('KhoWithdrawOperation inventory capability is required.');
        Object.assign(this, {
            storage, guiManager, context, itemResolver, inventoryReader, inventoryCounter,
            textParser, capacityPlanner, logger, workloadMetrics
        });
        this.config = config || {};
        this.withdrawConfig = this.config.withdraw || {};
        this.quantityResolver = quantityResolver || this.#newResolver();
        this.guiSession = guiSession || new KhoWithdrawGuiSession({
            storage, guiManager, textParser, config: this.config,
            quantityResolver: this.quantityResolver, logger
        });
    }

    reconfigure(config) {
        this.config = config || {};
        this.withdrawConfig = this.config.withdraw || {};
        this.quantityResolver = this.#newResolver();
        this.guiSession.quantityResolver = this.quantityResolver;
        this.guiSession.reconfigure(this.config);
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
        const options = {
            requiredAmount, outputId, expectedOutputAmount, minimumFreeSlots,
            cancellationToken, expectedGeneration, operationContext
        };
        if (!this.workloadMetrics) return this.#execute(logicalId, options, null);
        return this.workloadMetrics.measure('storage.withdraw', tracker => this.#execute(logicalId, options, tracker));
    }

    async #execute(logicalId, options, metrics) {
        const requested = Number(options.requiredAmount);
        const invalid = this.#validateRequest(logicalId, requested);
        if (invalid) return invalid;

        const generation = options.expectedGeneration
            ?? options.operationContext?.connectionGeneration
            ?? this.context?.getGeneration?.()
            ?? null;
        const cancellationToken = options.operationContext?.cancellation?.token || options.cancellationToken;
        cancellationToken?.throwIfCancelled?.();
        this.#assertGeneration(generation);

        const inventoryBefore = this.#count(this.#inventorySnapshot(), logicalId);
        if (inventoryBefore >= requested) return this.#alreadySatisfied(logicalId, requested, inventoryBefore);

        const state = {
            executed: [],
            prepared: null,
            actionCount: 0,
            maxActions: this.#positiveInteger(this.withdrawConfig.maxWithdrawalActions, 64),
            maxBatchClicks: this.#positiveInteger(this.withdrawConfig.maxBatchClicks, 16)
        };
        while (this.#count(this.#inventorySnapshot(), logicalId) < requested) {
            const next = await this.#prepareNextBatch(logicalId, requested, options, state, {
                cancellationToken, generation, metrics
            });
            if (next.result) return next.result;
            const result = await this.#executeBatch(logicalId, requested, options, state, next, {
                cancellationToken, generation, metrics
            });
            if (result) return result;
        }
        return this.#withdrawSuccess(logicalId, requested, inventoryBefore, state);
    }

    #validateRequest(logicalId, requested) {
        if (!Number.isInteger(requested) || requested < 0) {
            return Result.fail(Status.INVALID_INPUT, 'B1 withdrawal requires a non-negative integer amount.');
        }
        if (this.withdrawConfig.enabled !== false) return null;
        return Result.fail(Status.NOT_READY, 'B1 inventory withdrawal is disabled.', null, {
            code: 'KHO_WITHDRAW_DISABLED', step: 'b1-withdraw', resource: logicalId
        });
    }

    #alreadySatisfied(logicalId, requested, inventoryBefore) {
        return Result.ok({
            source: 'inventory', resource: logicalId, requestedAmount: requested,
            inventoryBefore, inventoryAfter: inventoryBefore, actualDelta: 0,
            actions: [], selectedActions: [], actionBatches: [], withdrawalRequired: false
        });
    }

    async #prepareNextBatch(logicalId, requested, options, state, runtime) {
        runtime.cancellationToken?.throwIfCancelled?.();
        this.#assertGeneration(runtime.generation);
        const snapshot = this.#inventorySnapshot();
        const current = this.#count(snapshot, logicalId);
        const remaining = Math.max(0, requested - current);
        const safety = this.#inventorySafety(snapshot, {
            logicalId,
            needed: remaining,
            outputId: options.outputId,
            expectedOutputAmount: options.expectedOutputAmount,
            minimumFreeSlots: options.minimumFreeSlots
        });
        if (!safety.safe) {
            return { result: this.#capacityFailure(logicalId, safety, state.executed.length ? 'recheck-inventory-capacity' : 'plan-inventory-capacity') };
        }

        const fillInventoryAmount = this.withdrawConfig.allowFillInventory === false ? 0 : safety.fillInventoryAmount;
        const preparedResult = await this.guiSession.prepare(logicalId, {
            cancellationToken: runtime.cancellationToken,
            expectedGeneration: runtime.generation,
            operationContext: options.operationContext,
            requiredRemaining: remaining,
            metrics: runtime.metrics,
            previous: state.prepared,
            actionAmounts: { stackSize: safety.stackSize, fillInventoryAmount }
        });
        this.#assertGeneration(runtime.generation);
        if (!preparedResult.success) return { result: preparedResult };
        state.prepared = preparedResult.data;

        const available = this.#availableActions(state.prepared.actionSlots, {
            stackSize: safety.stackSize,
            fillInventoryAmount
        });
        const plan = this.quantityResolver.resolvePlan(remaining, available, {
            stackSize: safety.stackSize,
            fillInventoryAmount,
            maxWithdrawalActions: Math.max(1, state.maxActions - state.actionCount)
        });
        if (!plan || plan.actionCount === 0) {
            return { result: this.#quantityUnavailable(logicalId, requested, remaining, available, fillInventoryAmount, state.maxActions) };
        }
        return { batch: plan.batches[0], remaining };
    }

    async #executeBatch(logicalId, requested, options, state, next, runtime) {
        const batch = next.batch;
        const clicks = Math.min(batch.count, state.maxBatchClicks, state.maxActions - state.actionCount);
        if (clicks <= 0) return this.#actionLimitFailure(logicalId, requested, next.remaining, state.maxActions, state.executed);
        runtime.metrics?.increment('batchCount');

        for (let index = 0; index < clicks; index += 1) {
            runtime.cancellationToken?.throwIfCancelled?.();
            this.#assertGeneration(runtime.generation);
            const now = this.#count(this.#inventorySnapshot(), logicalId);
            if (now >= requested) break;
            const ready = await this.#refreshBatchSession(logicalId, requested, options, state, index, runtime);
            if (ready.result) return ready.result;
            const slot = this.#slotFor(batch, state.prepared.actionSlots);
            if (!Number.isInteger(slot) || slot < 0) break;

            const attempt = await this.#clickAndReconcile(logicalId, batch, slot, {
                cancellationToken: runtime.cancellationToken,
                expectedGeneration: runtime.generation,
                metrics: runtime.metrics
            });
            if (!attempt.success) return attempt;
            state.executed.push(attempt.data);
            state.actionCount += 1;
            if (attempt.data.actualDelta <= 0) return this.#noEffect(logicalId, requested, batch, state.executed);
            if (attempt.data.actualDelta !== batch.amount) break;
            if (state.actionCount >= state.maxActions && this.#count(this.#inventorySnapshot(), logicalId) < requested) {
                const remaining = requested - this.#count(this.#inventorySnapshot(), logicalId);
                return this.#actionLimitFailure(logicalId, requested, remaining, state.maxActions, state.executed);
            }
        }
        return null;
    }

    async #refreshBatchSession(logicalId, requested, options, state, index, runtime) {
        const snapshot = this.#inventorySnapshot();
        const now = this.#count(snapshot, logicalId);
        const safety = this.#inventorySafety(snapshot, {
            logicalId,
            needed: requested - now,
            outputId: options.outputId,
            expectedOutputAmount: options.expectedOutputAmount,
            minimumFreeSlots: options.minimumFreeSlots
        });
        if (!safety.safe) return { result: this.#capacityFailure(logicalId, safety, 'recheck-inventory-capacity') };
        if (index <= 0) return { result: null };

        const fillInventoryAmount = this.withdrawConfig.allowFillInventory === false ? 0 : safety.fillInventoryAmount;
        const session = await this.guiSession.prepare(logicalId, {
            cancellationToken: runtime.cancellationToken,
            expectedGeneration: runtime.generation,
            operationContext: options.operationContext,
            requiredRemaining: requested - now,
            metrics: runtime.metrics,
            previous: state.prepared,
            actionAmounts: { stackSize: safety.stackSize, fillInventoryAmount }
        });
        this.#assertGeneration(runtime.generation);
        if (!session.success) return { result: session };
        state.prepared = session.data;
        return { result: null };
    }

    #quantityUnavailable(logicalId, requested, remaining, available, fillInventoryAmount, maxActions) {
        return Result.fail(Status.NOT_READY, 'No exact withdrawal quantity combination is available.', null, {
            code: 'KHO_WITHDRAW_QUANTITY_UNAVAILABLE', operation: 'KhoWithdrawOperation',
            step: 'resolve-withdraw-action', resource: logicalId,
            details: {
                requestedAmount: requested,
                remaining,
                availableQuantities: Object.keys(available.numericSlots || {}).map(Number),
                stackAvailable: available.stackSlot !== null,
                fillInventoryAvailable: available.fillInventorySlot !== null,
                fillInventoryAmount,
                maxWithdrawalActions: maxActions
            }
        });
    }

    #noEffect(logicalId, requested, batch, actions) {
        return Result.fail(Status.NOT_READY, 'Withdrawal produced no inventory delta.', null, {
            code: 'KHO_WITHDRAW_NO_EFFECT', operation: 'KhoWithdrawOperation',
            step: 'verify-inventory', resource: logicalId,
            details: { requestedAmount: requested, batch, actions }
        });
    }

    #withdrawSuccess(logicalId, requested, inventoryBefore, state) {
        const inventoryAfter = this.#count(this.#inventorySnapshot(), logicalId);
        const actualDelta = Math.max(0, inventoryAfter - inventoryBefore);
        const selectedActions = state.executed.map(action => action.displayAction);
        const actionBatches = this.#aggregateBatches(state.executed);
        this.logger?.info?.('B5 B1 withdrawal complete.', {
            operation: 'KhoWithdrawOperation', step: 'b1-withdraw', resource: logicalId,
            requested, selectedActions, inventoryBefore, inventoryAfter, actualDelta,
            actionCount: state.actionCount, actionBatches,
            result: inventoryAfter >= requested ? 'success' : 'partial'
        });
        return Result.ok({
            source: 'inventory', resource: logicalId, requestedAmount: requested,
            selectedActions, actions: state.executed, actionBatches,
            inventoryBefore, inventoryAfter, actualDelta,
            withdrawalRequired: true,
            maxWithdrawalActions: state.maxActions
        });
    }

    #availableActions(actionSlots, { stackSize, fillInventoryAmount }) {
        return {
            numericSlots: actionSlots?.numericSlots || {},
            stackSlot: this.withdrawConfig.allowStack === false ? null : actionSlots?.stackSlot ?? null,
            stackSize,
            fillInventorySlot: fillInventoryAmount > 0 ? actionSlots?.fillInventorySlot ?? null : null,
            fillInventoryAmount
        };
    }

    #slotFor(batch, actionSlots) {
        const action = B1WithdrawQuantityResolver.ACTION;
        if (batch.kind === action.NUMERIC) {
            const numericSlots = actionSlots?.numericSlots || {};
            return numericSlots instanceof Map
                ? numericSlots.get(Number(batch.amount)) ?? null
                : numericSlots[Number(batch.amount)] ?? numericSlots[String(batch.amount)] ?? null;
        }
        if (batch.kind === action.STACK) return actionSlots?.stackSlot ?? null;
        if (batch.kind === action.FILL_INVENTORY) return actionSlots?.fillInventorySlot ?? null;
        return null;
    }

    async #clickAndReconcile(logicalId, batch, slot, { cancellationToken, expectedGeneration, metrics }) {
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
            return Result.ok({
                kind: batch.kind,
                quantity: batch.kind === B1WithdrawQuantityResolver.ACTION.NUMERIC ? Number(batch.amount) : null,
                requestedDelta: Number(batch.amount),
                displayAction: B1WithdrawQuantityResolver.displayAction(batch),
                slot,
                inventoryBefore: before,
                inventoryAfter: after,
                actualDelta,
                reconciledAfterClickError: Boolean(clickError)
            });
        }
        metrics?.increment('noDeltaCount');
        if (clickError) return this.#failure(clickError, 'KHO_WITHDRAW_CLICK_FAILED', 'click-withdraw', logicalId, { batch, slot, before, after });
        return Result.fail(Status.NOT_READY, 'Withdrawal click was not reflected in inventory.', null, {
            code: 'KHO_WITHDRAW_NOT_VERIFIED', operation: 'KhoWithdrawOperation',
            step: 'verify-inventory', resource: logicalId,
            details: { batch, slot, before, after, unchangedConfirmationReads: this.withdrawConfig.unchangedConfirmationReads }
        });
    }

    async #waitForCount(logicalId, before, { cancellationToken, expectedGeneration, metrics }) {
        const attempts = this.#positiveInteger(this.withdrawConfig.verifyAttempts, 12);
        const retryMs = Math.max(1, Number(this.withdrawConfig.verifyRetryMs || 100));
        const unchangedRequired = this.#positiveInteger(this.withdrawConfig.unchangedConfirmationReads, 2);
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

    #inventorySafety(snapshot, { logicalId, needed, outputId, expectedOutputAmount, minimumFreeSlots }) {
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
            minimumFreeSlots: minimumFreeSlots ?? this.withdrawConfig.minimumOutputSlots ?? 2
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

    #aggregateBatches(actions) {
        const output = [];
        for (const action of actions) {
            const previous = output[output.length - 1];
            if (previous && previous.kind === action.kind && previous.requestedDelta === action.requestedDelta) {
                previous.count += 1;
                previous.actualDelta += action.actualDelta;
                continue;
            }
            output.push({
                kind: action.kind,
                requestedDelta: action.requestedDelta,
                displayAction: action.displayAction,
                count: 1,
                actualDelta: action.actualDelta
            });
        }
        return output;
    }

    #capacityFailure(resource, safety, step) {
        return Result.fail(Status.NOT_READY, 'Inventory capacity is reserved for B2 output.', null, {
            code: 'KHO_WITHDRAW_INVENTORY_CAPACITY', operation: 'KhoWithdrawOperation',
            step, resource, details: safety
        });
    }

    #actionLimitFailure(resource, requested, remaining, maxWithdrawalActions, actions) {
        return Result.fail(Status.NOT_READY, 'B1 withdrawal exceeded the configured action budget.', null, {
            code: 'KHO_WITHDRAW_ACTION_LIMIT', operation: 'KhoWithdrawOperation',
            step: 'resolve-withdraw-action', resource,
            details: { requestedAmount: requested, remaining, maxWithdrawalActions, executedActions: actions.length }
        });
    }

    #inventorySnapshot() {
        return typeof this.inventoryReader.readBotInventory === 'function'
            ? this.inventoryReader.readBotInventory()
            : this.inventoryReader.read();
    }

    #count(snapshot, logicalId) {
        return Math.max(0, Number(this.inventoryCounter.count(snapshot, logicalId) || 0));
    }

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

    #newResolver() {
        return new B1WithdrawQuantityResolver({
            numericQuantities: this.withdrawConfig.numericQuantities,
            maxWithdrawalActions: this.withdrawConfig.maxWithdrawalActions
        });
    }

    #positiveInteger(value, fallback) {
        const number = Number(value);
        return Number.isInteger(number) && number > 0 ? number : fallback;
    }
}

module.exports = KhoWithdrawOperation;
