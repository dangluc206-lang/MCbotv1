'use strict';

const FlowError = require('../../../shared/errors/FlowError');
const { fromLegacyChain } = require('../support/CraftChainAdapter');

class CraftBaseInventoryCoordinator {
    constructor({ storageFlow, inputAcquisition, b2Input, inventoryState, recipeRegistry, config, logger = null, runStep, childOptions, ensureFreeIntermediateSlots, verificationService }) {
        Object.assign(this, { storageFlow, inputAcquisition, inventoryState, recipeRegistry, config, logger, runStep, childOptions, ensureFreeIntermediateSlots, verificationService });
        this.stageContract = verificationService;
        this.inputAcquisition = inputAcquisition || b2Input || null;
    }

    reconfigure(config = {}) { this.config = config || {}; }

    async acquire(chain, context, options = {}) {
        chain = CraftBaseInventoryCoordinator.normalize(chain);
        context?.cancellation?.token?.throwIfCancelled?.();
        this.#assertContract(chain, context);
        const request = this.#request(chain, options);
        // G16.1: the source decision is per material, resolved through the
        // policy for THIS chain's baseId — never the flow-wide default.
        if (this.#sourceFor(chain) === 'storage') {
            return this.#acquireFromStorage(chain, context, request, options);
        }
        let state = this.#state(chain, request.reserveSlots);
        if (this.#needsStaleRebalance(state, request)) state = await this.#rebalanceStale(chain, context, request, state);
        if (state.available >= request.basePerIntermediate && state.emptySlots < request.reserveSlots) return this.#notReady(chain, request, state, 'b1-inventory-headroom-not-ready');
        if (state.available < request.basePerIntermediate && state.emptySlots <= request.reserveSlots) {
            const freed = await this.ensureFreeIntermediateSlots(chain, context, request.reserveSlots + 1, {
                reason: 'reserve one base transfer slot before intermediate craft', preserveAtLeastIntermediate: chain.intermediatePerOutput,
                preferCurrentIntermediate: false, allChains: options.allChains || [], targetId: options.targetId || null
            });
            state = this.#state(chain, request.reserveSlots, freed?.snapshot || null);
        }
        const acquisition = await this.#acquireMissing(chain, context, request, state);
        state = this.#state(chain, request.reserveSlots);
        const craftable = Math.floor(state.available / request.basePerIntermediate);
        if (craftable > 0) {
            this.stageContract.requireInputReady({ stage: 'B1', logicalId: chain.baseId, available: state.available, required: request.basePerIntermediate, context });
            this.stageContract.handoff({ from: 'B1', to: 'B2', generation: context.connectionGeneration, context });
        }
        return {
            ready: craftable > 0, reason: craftable > 0 ? null : 'b1-transfer-not-ready', source: 'inventory', baseId: chain.baseId, intermediateId: chain.intermediateId,
            basePerIntermediate: request.basePerIntermediate, plannedCrafts: request.plannedCrafts, available: state.available, craftable,
            transfer: acquisition.transfer, reserveSlots: request.reserveSlots, maxAmount: acquisition.maxAmount
        };
    }

    async returnToStorage(chain, context) {
        chain = CraftBaseInventoryCoordinator.normalize(chain);
        // G16.1: return behavior follows the resolved source of THIS material.
        if (this.#sourceFor(chain) === 'storage') return { baseId: chain.baseId, before: 0, returned: 0, remaining: 0, skipped: true, source: 'storage' };
        this.#assertReturnCapability(chain, context);
        const before = this.inventoryState.count(chain.baseId);
        if (before <= 0) return { baseId: chain.baseId, before: 0, returned: 0, remaining: 0, skipped: true };
        const returned = await this.#returnAll(chain, context, 'return-b1-after-reserve');
        const remaining = this.inventoryState.count(chain.baseId);
        if (remaining > 0) throw new FlowError(`B1 return to /kho left ${remaining} ${chain.baseId} in inventory.`, {
            code: 'CRAFT_B1_RETURN_INCOMPLETE', subsystem: 'crafting', step: 'return-b1-after-reserve', action: 'verify B1 player-inventory section after /kho deposit',
            resource: chain.baseId, retryable: true, details: { before, returned, remaining }, trace: context.trace
        });
        return { baseId: chain.baseId, before, returned, remaining, skipped: false };
    }

    #sourceFor(chain) {
        // Per-material policy decision. `.source` stays as the default/
        // compat surface; it must not stand in for a resolved material source.
        const flow = this.inputAcquisition;
        if (typeof flow?.sourceFor === 'function') return flow.sourceFor(chain?.baseId);
        return flow?.source === 'inventory' ? 'inventory' : 'storage';
    }

    async #acquireFromStorage(chain, context, request, options = {}) {
        // G16.1: readiness comes from the storage-readiness authority (fresh
        // /kho read + verified preparation), never from the requested amount.
        if (typeof this.storageFlow?.prepareBase !== 'function') {
            throw new FlowError('Storage input source requires the storage preparation flow.', {
                code: 'CRAFT_B1_STORAGE_PREP_UNAVAILABLE', subsystem: 'crafting', step: 'acquire-b1-for-b2',
                action: 'prepare base material in storage', resource: chain.baseId, retryable: false, trace: context.trace
            });
        }
        const prepared = await this.storageFlow.prepareBase(
            chain.baseId, request.usefulTotal, this.childOptions(context, options)
        );
        if (prepared?.success === false) {
            throw FlowError.fromResult(prepared, {
                code: 'CRAFT_B1_STORAGE_PREP_FAILED', subsystem: 'crafting', operation: 'CraftBaseInventoryCoordinator',
                step: 'acquire-b1-for-b2', action: 'prepare base material in storage',
                resource: chain.baseId, retryable: true
            });
        }
        const available = Math.max(0, Number(prepared?.data?.available ?? 0));
        if (prepared?.data?.ready === false || available < request.basePerIntermediate) {
            return {
                ready: false, reason: prepared?.data?.reason || 'storage-base-not-ready',
                source: 'storage', baseId: chain.baseId, intermediateId: chain.intermediateId,
                basePerIntermediate: request.basePerIntermediate, plannedCrafts: request.plannedCrafts,
                available, craftable: 0, transfer: null, reserveSlots: request.reserveSlots, maxAmount: 0
            };
        }
        this.stageContract.requireInputReady({ stage: 'B1', logicalId: chain.baseId, available, required: request.basePerIntermediate, context });
        this.stageContract.handoff({ from: 'B1', to: 'B2', generation: context.connectionGeneration, context });
        const craftable = Math.max(0, Math.floor(available / request.basePerIntermediate));
        return {
            ready: craftable > 0, reason: craftable > 0 ? null : 'storage-base-not-ready',
            source: 'storage', baseId: chain.baseId, intermediateId: chain.intermediateId,
            basePerIntermediate: request.basePerIntermediate, plannedCrafts: request.plannedCrafts,
            available, craftable, transfer: null, reserveSlots: request.reserveSlots, maxAmount: 0
        };
    }

    #assertContract(chain, context) {
        if (typeof this.inputAcquisition?.acquire !== 'function' || !['inventory', 'storage'].includes(this.inputAcquisition?.source)) throw new FlowError('Crafting requires a canonical intermediate input acquisition flow.', {
            code: 'CRAFT_B1_INPUT_FLOW_UNAVAILABLE', subsystem: 'crafting', step: 'acquire-b1-for-b2', action: 'require intermediate input acquisition flow', resource: chain.baseId, retryable: false, trace: context.trace
        });
        // G16.1: policy-aware flows resolve per material, so the global default
        // comparison below applies to legacy flows only. The return capability
        // is always asserted against the resolved material source.
        if (typeof this.inputAcquisition?.sourceFor !== 'function'
            && (this.config?.inputSource ?? this.config?.b2InputSource) === 'inventory' && this.inputAcquisition.source !== 'inventory') throw new FlowError('Inventory input source requires canonical base inventory withdrawal before intermediate craft.', {
            code: 'CRAFT_B1_INVENTORY_TRANSFER_UNAVAILABLE', subsystem: 'crafting', step: 'acquire-b1-for-b2', action: 'require intermediate input acquisition flow source=inventory', resource: chain.baseId, retryable: false, trace: context.trace
        });
        if (this.#sourceFor(chain) === 'inventory') this.#assertReturnCapability(chain, context);
    }

    #assertReturnCapability(chain, context) {
        if (typeof this.storageFlow?.returnBaseInventory === 'function') return;
        throw new FlowError('Inventory input source requires verified base return through the storage flow.', {
            code: 'CRAFT_B1_RETURN_UNAVAILABLE', subsystem: 'crafting', step: 'return-b1-after-reserve', action: 'return base remainder to /kho', resource: chain.baseId, retryable: false, trace: context.trace
        });
    }

    #request(chain, { intermediateRemaining, b2Remaining, minFreeForOutputAll, minFreeForB3All = 1 } = {}) {
        intermediateRemaining = intermediateRemaining ?? b2Remaining;
        minFreeForOutputAll = minFreeForOutputAll ?? minFreeForB3All;
        const recipe = this.recipeRegistry.require(chain.intermediateRecipeId);
        const basePerIntermediate = Math.max(1, Number(recipe?.inputs?.[chain.baseId] || 0));
        const plannedCrafts = Math.max(1, Math.floor(Number(intermediateRemaining || 1)));
        const reserveSlots = Math.max(1, Math.floor(Number(minFreeForOutputAll || 1)), Math.max(0, Math.floor(Number(this.config?.inventorySafetyEmptySlots || 0))));
        return { basePerIntermediate, plannedCrafts, reserveSlots, usefulTotal: plannedCrafts * basePerIntermediate };
    }

    #state(chain, reserveSlots, snapshot = null) {
        const space = snapshot || this.inventoryState.spaceSnapshot();
        return { available: this.inventoryState.count(chain.baseId), emptySlots: Number(space?.emptySlotCount || 0), reserveSlots, space };
    }

    #needsStaleRebalance(state, request) { return state.available >= request.basePerIntermediate && state.emptySlots < request.reserveSlots; }

    async #rebalanceStale(chain, context, request, state) {
        const before = state.available;
        await this.#returnAll(chain, context, 'rebalance-stale-b1-before-b2');
        const after = this.#state(chain, request.reserveSlots);
        this.logger?.info?.('BASE STALE INVENTORY REBALANCED', {
            operation: 'CraftingAutomation', step: 'rebalance-stale-b1-before-b2', phase: 'OK', resource: chain.baseId,
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
            details: { intermediateId: chain.intermediateId, intermediateRecipeId: chain.intermediateRecipeId, intermediateRemaining: request.plannedCrafts, basePerIntermediate: request.basePerIntermediate, before: state.available, targetAmount, maxAmount, reserveSlots: request.reserveSlots }
        }, () => this.inputAcquisition.acquire(chain.baseId, targetAmount, this.childOptions(context, {
            outputId: chain.intermediateId, expectedOutputAmount: Math.max(1, Math.min(request.plannedCrafts, 64)), minimumFreeSlots: request.reserveSlots
        })));
        // G16: a failed withdrawal is never mistaken for prepared input.
        // Crafting must not continue when acquisition reports failure.
        if (result?.success === false) {
            throw FlowError.fromResult(result, {
                code: 'CRAFT_B1_WITHDRAW_FAILED', subsystem: 'crafting', operation: 'CraftBaseInventoryCoordinator',
                step: 'acquire-b1-for-b2', action: 'withdraw prepared B1 into inventory before B2',
                resource: chain.baseId, retryable: true
            });
        }
        // G16: reconcile inventory after the state-changing withdrawal before
        // computing craftability — the withdraw GUI just closed and stack
        // delivery may still be settling.
        const token = context?.cancellation?.token || null;
        await this.inventoryState.waitForIncrease?.(chain.baseId, state.available, token).catch(() => null);
        token?.throwIfCancelled?.();
        return { transfer: result?.data || null, maxAmount };
    }

    async #returnAll(chain, context, step) {
        const result = await this.runStep(context, {
            subsystem: 'crafting', step, action: 'return B1 inventory to /kho through storage transaction', resource: chain.baseId
        }, () => this.storageFlow.returnBaseInventory(chain.baseId, this.childOptions(context)));
        const data = result?.data || {};
        if (data.ready === false) throw new FlowError(`B1 return is not ready for ${chain.baseId}.`, {
            code: 'CRAFT_B1_RETURN_NOT_READY', subsystem: 'crafting', step, action: 'return B1 inventory to /kho', resource: chain.baseId, retryable: true, details: data, trace: context.trace
        });
        return Math.max(0, Number(data.moved ?? data.transfer?.moved ?? 0));
    }

    #notReady(chain, request, state, reason) {
        return { ready: false, reason, baseId: chain.baseId, intermediateId: chain.intermediateId, basePerIntermediate: request.basePerIntermediate, plannedCrafts: request.plannedCrafts,
            available: state.available, craftable: Math.floor(state.available / request.basePerIntermediate), reserveSlots: request.reserveSlots, emptySlotCount: state.emptySlots };
    }
}

// Exposed for Step 2 boundary tests only; no runtime cycle wires this leaf yet.
CraftBaseInventoryCoordinator.normalize = function (chain) {
    const c = chain && typeof chain === 'object' ? chain : {};
    // Leaf-local generic identity: intermediateId present, no legacy chain keys.
    // The B1 leaf never observes outputId, so it must not require it here:
    // strict isGenericChain() would double-adapt a valid leaf chain through
    // fromLegacyChain() and wipe intermediateId to null.
    if (typeof c.intermediateId === 'string' && !('b2Id' in c) && !('b3Id' in c)
        && !('b2RecipeId' in c) && !('b3RecipeId' in c)) return c;
    return fromLegacyChain(c);
};
module.exports = CraftBaseInventoryCoordinator;
