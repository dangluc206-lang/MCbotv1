'use strict';

const FlowError = require('../../../shared/errors/FlowError');
const StageExecutionContract = require('../verification/StageExecutionContract');

class B1B3InputCoordinator {
    constructor({ storageFlow, b2Input, inventoryState, recipeRegistry, config, logger = null, runStep, childOptions, ensureFreeIntermediateSlots, verificationService }) {
        Object.assign(this, { storageFlow, b2Input, inventoryState, recipeRegistry, config, logger, runStep, childOptions, ensureFreeIntermediateSlots, verificationService });
        this.verification = verificationService;
    }

    reconfigure(config = {}) { this.config = config || {}; }

    async prepareBase(chain, context, { requiredRaw = 0, options = {} } = {}) {
        const required = Math.max(0, Number(requiredRaw || 0));
        if (required <= 0) return { success: true, data: { ready: true, available: 0, skipped: true } };
        if (typeof this.storageFlow?.prepareBase !== 'function') {
            throw new FlowError('B1-B3 storage preparation is unavailable.', {
                code: 'CRAFT_B1_B3_PREPARE_UNAVAILABLE', subsystem: 'crafting', step: 'prepare-b1',
                action: 'prepare B1 from /kho', resource: chain.baseId, retryable: false, trace: context?.trace
            });
        }
        return this.runStep(context, {
            subsystem: 'crafting', step: 'prepare-b1', action: 'prepare B1 from /kho before B2',
            resource: chain.baseId, details: { required }
        }, () => this.storageFlow.prepareBase(chain.baseId, required, this.childOptions(context, options)), { acceptFailedResult: true });
    }

    async acquire(chain, context, options = {}) {
        this.#assertContract(chain, context);
        const request = this.#request(chain, options);
        if (this.b2Input.source === 'storage') {
            this.verificationService.requireInputReady({ stage: 'B1', logicalId: chain.baseId, available: request.usefulTotal, required: request.basePerB2, context });
            this.verificationService.handoff({ from: 'B1', to: 'B2', generation: context.connectionGeneration, context });
            return {
                ready: request.plannedCrafts > 0, reason: null, source: 'storage', baseId: chain.baseId, b2Id: chain.b2Id,
                basePerB2: request.basePerB2, plannedCrafts: request.plannedCrafts, available: request.usefulTotal,
                craftable: request.plannedCrafts, transfer: null, reserveSlots: request.reserveSlots, maxAmount: 0
            };
        }
        let state = this.#state(chain, request.reserveSlots);
        if (this.#needsStaleRebalance(state, request)) state = await this.#rebalanceStale(chain, context, request, state);
        if (state.available >= request.basePerB2 && state.emptySlots < request.reserveSlots) return this.#notReady(chain, request, state, 'b1-inventory-headroom-not-ready');
        if (state.available < request.basePerB2 && state.emptySlots <= request.reserveSlots) {
            const freed = await this.ensureFreeIntermediateSlots(chain, context, request.reserveSlots + 1, {
                reason: 'reserve one B1 transfer slot before B2', preserveAtLeastB2: chain.b3InputPerCraft,
                preferCurrentB2: false, allChains: options.allChains || []
            });
            state = this.#state(chain, request.reserveSlots, freed?.snapshot || null);
        }
        const acquisition = await this.#acquireMissing(chain, context, request, state);
        state = this.#state(chain, request.reserveSlots);
        const craftable = Math.floor(state.available / request.basePerB2);
        if (craftable > 0) {
            this.verificationService.requireInputReady({ stage: 'B1', logicalId: chain.baseId, available: state.available, required: request.basePerB2, context });
            this.verificationService.handoff({ from: 'B1', to: 'B2', generation: context.connectionGeneration, context });
        }
        return {
            ready: craftable > 0, reason: craftable > 0 ? null : 'b1-transfer-not-ready', baseId: chain.baseId, b2Id: chain.b2Id,
            basePerB2: request.basePerB2, plannedCrafts: request.plannedCrafts, available: state.available, craftable,
            transfer: acquisition.transfer, reserveSlots: request.reserveSlots, maxAmount: acquisition.maxAmount
        };
    }

    async finalizeBase(chain, context) {
        if (typeof this.storageFlow?.finalizeBase === 'function') {
            return this.runStep(context, {
                subsystem: 'crafting', step: 'compact-b1-after-b3',
                action: 'finalize B1 storage transaction after B1-B3 execution', resource: chain.baseId
            }, () => this.storageFlow.finalizeBase(chain.baseId, this.childOptions(context)));
        }
        if (typeof this.storageFlow?.compact === 'function') {
            return this.runStep(context, {
                subsystem: 'crafting', step: 'compact-b1-after-b3',
                action: 'compact B1 after B1-B3 execution', resource: chain.baseId
            }, () => this.storageFlow.compact(chain.baseId, this.childOptions(context)));
        }
        throw new FlowError('B1-B3 B1 finalization is unavailable.', {
            code: 'CRAFT_B1_B3_FINALIZE_UNAVAILABLE', subsystem: 'crafting',
            step: 'compact-b1-after-b3', action: 'finalize B1 storage transaction',
            resource: chain.baseId, retryable: false, trace: context?.trace
        });
    }

    async returnToStorage(chain, context) {
        if (this.b2Input?.source === 'storage') return { baseId: chain.baseId, before: 0, returned: 0, remaining: 0, skipped: true, source: 'storage' };
        this.#assertReturnCapability(chain, context);
        const before = this.inventoryState.count(chain.baseId);
        if (before <= 0) return { baseId: chain.baseId, before: 0, returned: 0, remaining: 0, skipped: true };
        const returned = await this.#returnAll(chain, context, 'return-b1-after-reserve');
        const remaining = this.inventoryState.count(chain.baseId);
        if (remaining > 0) throw new FlowError(`B1 return to /kho left ${remaining} ${chain.baseId} in inventory.`, {
            code: 'CRAFT_B1_B3_RETURN_INCOMPLETE', subsystem: 'crafting', step: 'return-b1-after-reserve', action: 'verify B1 player-inventory section after /kho deposit',
            resource: chain.baseId, retryable: true, details: { before, returned, remaining }, trace: context.trace
        });
        return { baseId: chain.baseId, before, returned, remaining, skipped: false };
    }

    #assertContract(chain, context) {
        if (typeof this.b2Input?.acquire !== 'function' || !['inventory', 'storage'].includes(this.b2Input?.source)) throw new FlowError('Crafting B1-B3 requires a canonical B2 input acquisition flow.', {
            code: 'CRAFT_B1_B3_INPUT_FLOW_UNAVAILABLE', subsystem: 'crafting', step: 'acquire-b1-for-b2', action: 'require B2InputAcquisitionFlow', resource: chain.baseId, retryable: false, trace: context.trace
        });
        if (this.config?.b2InputSource === 'inventory' && this.b2Input.source !== 'inventory') throw new FlowError('Crafting B1-B3 requires canonical B1 inventory withdrawal before B2.', {
            code: 'CRAFT_B1_B3_INVENTORY_TRANSFER_UNAVAILABLE', subsystem: 'crafting', step: 'acquire-b1-for-b2', action: 'require B2InputAcquisitionFlow source=inventory', resource: chain.baseId, retryable: false, trace: context.trace
        });
        if (this.b2Input.source === 'inventory') this.#assertReturnCapability(chain, context);
    }

    #assertReturnCapability(chain, context) {
        if (typeof this.storageFlow?.returnBaseInventory === 'function') return;
        throw new FlowError('Crafting B1-B3 requires verified B1 return through the storage flow.', {
            code: 'CRAFT_B1_B3_RETURN_UNAVAILABLE', subsystem: 'crafting', step: 'return-b1-after-reserve', action: 'return B1 remainder to /kho', resource: chain.baseId, retryable: false, trace: context.trace
        });
    }

    #request(chain, { b2Remaining, minFreeForB3All = 1 } = {}) {
        const recipe = this.recipeRegistry.require(chain.b2RecipeId);
        const basePerB2 = Math.max(1, Number(recipe?.inputs?.[chain.baseId] || 0));
        const plannedCrafts = Math.max(1, Math.floor(Number(b2Remaining || 1)));
        const reserveSlots = Math.max(1, Math.floor(Number(minFreeForB3All || 1)), Math.max(0, Math.floor(Number(this.config?.inventorySafetyEmptySlots || 0))));
        return { basePerB2, plannedCrafts, reserveSlots, usefulTotal: plannedCrafts * basePerB2 };
    }

    #state(chain, reserveSlots, snapshot = null) {
        const space = snapshot || this.inventoryState.spaceSnapshot();
        return { available: this.inventoryState.count(chain.baseId), emptySlots: Number(space?.emptySlotCount || 0), reserveSlots, space };
    }

    #needsStaleRebalance(state, request) { return state.available >= request.basePerB2 && state.emptySlots < request.reserveSlots; }

    async #rebalanceStale(chain, context, request, state) {
        const before = state.available;
        await this.#returnAll(chain, context, 'rebalance-stale-b1-before-b2');
        const after = this.#state(chain, request.reserveSlots);
        this.logger?.info?.('CRAFT B1-B3 STALE INVENTORY REBALANCED', {
            operation: 'CraftingB1B3', step: 'rebalance-stale-b1-before-b2', phase: 'OK', resource: chain.baseId,
            before, after: after.available, returned: Math.max(0, before - after.available), emptySlotCount: after.emptySlots, reserveSlots: request.reserveSlots
        });
        return after;
    }

    async #acquireMissing(chain, context, request, state) {
        const freeStackSlots = Math.max(0, state.emptySlots - request.reserveSlots);
        const conservativeAddCapacity = freeStackSlots * 64;
        const maxAmount = Math.max(0, Math.min(Math.max(0, request.usefulTotal - state.available), conservativeAddCapacity));
        if (maxAmount <= 0) return { transfer: null, maxAmount };
        const targetAmount = state.available + maxAmount;
        const result = await this.runStep(context, {
            subsystem: 'crafting', step: 'acquire-b1-for-b2', action: 'withdraw prepared B1 into inventory before B2', resource: chain.baseId,
            details: { b2Id: chain.b2Id, b2RecipeId: chain.b2RecipeId, b2Remaining: request.plannedCrafts, basePerB2: request.basePerB2, before: state.available, targetAmount, maxAmount, reserveSlots: request.reserveSlots }
        }, () => this.b2Input.acquire(chain.baseId, targetAmount, this.childOptions(context, {
            outputId: chain.b2Id, expectedOutputAmount: Math.max(1, Math.min(request.plannedCrafts, 64)), minimumFreeSlots: request.reserveSlots
        })));
        return { transfer: result?.data || null, maxAmount };
    }

    async #returnAll(chain, context, step) {
        const result = await this.runStep(context, {
            subsystem: 'crafting', step, action: 'return B1 inventory to /kho through storage transaction', resource: chain.baseId
        }, () => this.storageFlow.returnBaseInventory(chain.baseId, this.childOptions(context)));
        const data = result?.data || {};
        if (data.ready === false) throw new FlowError(`B1 return is not ready for ${chain.baseId}.`, {
            code: 'CRAFT_B1_B3_RETURN_NOT_READY', subsystem: 'crafting', step, action: 'return B1 inventory to /kho', resource: chain.baseId, retryable: true, details: data, trace: context.trace
        });
        return Math.max(0, Number(data.moved ?? data.transfer?.moved ?? 0));
    }

    #notReady(chain, request, state, reason) {
        return { ready: false, reason, baseId: chain.baseId, b2Id: chain.b2Id, basePerB2: request.basePerB2, plannedCrafts: request.plannedCrafts,
            available: state.available, craftable: Math.floor(state.available / request.basePerB2), reserveSlots: request.reserveSlots, emptySlotCount: state.emptySlots };
    }
}

module.exports = B1B3InputCoordinator;
