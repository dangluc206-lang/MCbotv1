'use strict';
// Generic reserve-chain core (Slice 6 Step 3).
// Mechanics own: initial state/headroom, reserve loop, output/intermediate
// craft attempts, owned-intermediate withdraw, deposit mechanics, recount,
// progress/stall detection, guard-512, partial pass, cancellation,
// settlement barrier, quantity-trace structure and generic error codes.
// Quantity/gate policy stays outside: intermediate ALL vs 64 vs 1 is supplied
// per chain (useAllForIntermediate; legacy flag mapped at normalize only),
// output ALL vs 64 vs 1 from inventoryState.allEnabled (generic key first,
// legacy fallback), headroom floors from config (generic keys first).
// Storage/input stay at boundary (flows + baseInventory).
const FlowError = require('../../../shared/errors/FlowError');
const { fromLegacyChain } = require('../support/CraftChainAdapter');
class CraftReserveChainCoordinator {
    constructor(o) {
        o = o || {};
        this.flows = o.flows;
        this.inventoryState = o.inventoryState;
        this.inventoryCounter = o.inventoryCounter;
        this.progressTracker = o.progressTracker;
        this.finalCraft = o.finalCraft;
        this.config = o.config;
        this.logger = o.logger || null;
        this.runStep = o.runStep;
        this.childOptions = o.childOptions;
        this.quantityTrace = o.quantityTrace || (() => {});
        this.baseInventory = o.baseInventory || o.b1Inventory || null;
        this.b1Inventory = this.baseInventory;
        this.spaceFreer = o.spaceFreer || o.intermediate || null;
        this.intermediate = this.spaceFreer;
    }
    reconfigure(c) { this.config = c || {}; return this; }
    async prepare(chain, context, opts) {
        opts = opts || {};
        chain = CraftReserveChainCoordinator.normalize(chain);
        const state = this.stateFor(chain, opts.deferIntermediateDeposit === true, opts.allChains || [], opts.targetId || null);
        while (state.outputRemaining > 0 || state.intermediateRemaining > 0) {
            context.cancellation.token.throwIfCancelled();
            this.guard(state, chain, context);
            const view = this.viewFor(chain, state);
            const craftedOutput = await this.tryCraftOutput(chain, state, view, context);
            if (craftedOutput && craftedOutput.done) continue;
            if (craftedOutput && craftedOutput.result) return craftedOutput.result;
            if (await this.tryWithdrawOwned(chain, state, view, context)) continue;
            const craftedIntermediate = await this.tryCraftIntermediate(chain, state, view, context);
            if (craftedIntermediate && craftedIntermediate.result) return craftedIntermediate.result;
            if (craftedIntermediate && craftedIntermediate.done) continue;
            const freed = await this.tryFreeSlot(chain, state, view, context);
            if (freed && freed.result) return freed.result;
            if (freed && freed.done) continue;
            if (chain.partialReservePass === true && state.intermediateRemaining <= 0 && state.vaultIntermediateRemaining <= 0) break;
            this.stalled(chain, state, view, context);
        }
        if (state.pendingStageSettlement) {
            const pendingStage = state.pendingStageSettlement.stage;
            const to = pendingStage === 'B2' ? 'B3' : 'B4';
            await this.settlePending(state, chain, context, to);
        }
        await this.depositIfRequired(chain, context, state.deferIntermediateDeposit);
        return { intermediateId: chain.intermediateId, outputId: chain.outputId, deferred: state.deferIntermediateDeposit };
    }
    stateFor(chain, deferIntermediateDeposit, allChains, targetId) {
        targetId = targetId === undefined ? null : targetId;
        const minFreeForOutputAll = Math.max(1, Number((this.config && (this.config.outputAllMinEmptySlots !== undefined ? this.config.outputAllMinEmptySlots : this.config.b3AllMinEmptySlots)) || 1));
        return {
            minFreeForOutputAll,
            accumulationSafetyFloor: Math.max(minFreeForOutputAll + 1, Math.max(0, Number((this.config && this.config.inventorySafetyEmptySlots) || 0))),
            intermediateRemaining: Number(chain.intermediateCrafts || 0),
            outputRemaining: Number(chain.outputCrafts || 0),
            vaultIntermediateRemaining: Number(chain.vaultIntermediate || 0),
            deferIntermediateDeposit,
            allChains,
            targetId,
            guard: 0,
            pendingStageSettlement: null
        };
    }
    guard(state, chain, context) {
        state.guard += 1;
        if (state.guard <= 512) return;
        throw new FlowError('B3 reserve chain exceeded safety iteration limit for ' + chain.baseId + '.', {
            code: 'CRAFT_RESERVE_LOOP_GUARD', subsystem: 'crafting', step: 'reserve-b3-chain', action: 'optimize B2/B3 ALL chain',
            resource: chain.baseId, details: { intermediateRemaining: state.intermediateRemaining, outputRemaining: state.outputRemaining, vaultIntermediateRemaining: state.vaultIntermediateRemaining, chain }, trace: context.trace
        });
    }
    viewFor(chain, state) {
        const inventory = this.inventoryState.snapshot();
        const intermediateCount = this.inventoryCounter.count(inventory, chain.intermediateId);
        const outputCraftableNow = Math.floor(intermediateCount / Math.max(1, chain.intermediatePerOutput));
        return {
            inventory, intermediateCount, outputCraftableNow,
            enoughIntermediateForRemainingOutput: state.outputRemaining > 0 && outputCraftableNow >= state.outputRemaining,
            atOutputSafetyFloor: Number(inventory.emptySlotCount || 0) <= state.accumulationSafetyFloor,
            noMoreIntermediateSupplyPlanned: state.intermediateRemaining <= 0 && state.vaultIntermediateRemaining <= 0
        };
    }
    async tryCraftOutput(chain, state, view, context) {
        if (!(state.outputRemaining > 0 && view.outputCraftableNow > 0 && (view.enoughIntermediateForRemainingOutput || view.atOutputSafetyFloor || view.noMoreIntermediateSupplyPlanned))) return { done: false };
        if (state.pendingStageSettlement && state.pendingStageSettlement.stage === 'B2') {
            await this.settlePending(state, chain, context, 'B3');
        }
        let inventory = view.inventory;
        let intermediateCount = view.intermediateCount;
        if (state.pendingStageSettlement) {
            inventory = this.inventoryState.snapshot();
            intermediateCount = this.inventoryCounter.count(inventory, chain.intermediateId);
        }
        if (intermediateCount < chain.intermediatePerOutput) return { done: true };
        const useAllForOutput = typeof this.inventoryState.allEnabled === 'function'
            ? (this.inventoryState.allEnabled('useAllForOutput') || this.inventoryState.allEnabled('useAllForB3'))
            : false;
        const quantity = useAllForOutput
            ? 'ALL'
            : (state.outputRemaining >= 64 && intermediateCount >= chain.intermediatePerOutput * 64 ? 64 : 1);
        this.quantityTrace('CRAFT QUANTITY DECISION', {
            step: 'reserve-b3-chain', resource: chain.intermediateId, recipeId: chain.outputRecipeId, quantity,
            reason: quantity === 'ALL' ? 'b2-accumulated-then-b3-all' : 'exact-fallback', intermediateCount,
            intermediateRemaining: state.intermediateRemaining, outputRemaining: state.outputRemaining,
            baseId: chain.baseId, intermediatePerOutput: chain.intermediatePerOutput,
            emptySlotCount: inventory.emptySlotCount, minFreeAfterCraft: state.minFreeForOutputAll
        });
        this.progressTracker.set({ running: true, state: 'CRAFTING_B3', currentStep: { kind: 'B3', id: chain.outputId, crafts: state.outputRemaining } });
        const crafted = await this.finalCraft.craft(chain.outputRecipeId, quantity, context, chain.outputId, { stage: 'B3', nextStage: 'B4' });
        const actualCrafts = this.inventoryState.actualCrafts(crafted, quantity);
        if (actualCrafts <= 0) this.zeroOutput(chain, state, quantity, crafted, intermediateCount, context);
        state.outputRemaining = Math.max(0, state.outputRemaining - actualCrafts);
        state.pendingStageSettlement = {
            stage: 'B3', logicalId: chain.outputId,
            minimumCount: Number.isFinite(Number(crafted && crafted.stageContract && crafted.stageContract.after)) ? Number(crafted.stageContract.after) : 0, expectedDelta: 1
        };
        return { done: true };
    }
    async tryWithdrawOwned(chain, state, view, context) {
        if (!(state.vaultIntermediateRemaining > 0 && Number(view.inventory.emptySlotCount || 0) >= state.minFreeForOutputAll)) return false;
        if (state.pendingStageSettlement && state.pendingStageSettlement.stage === 'B2') {
            await this.settlePending(state, chain, context, 'B3');
        }
        const before = this.inventoryCounter.count(view.inventory, chain.intermediateId);
        const maxStacks = Math.max(1, Math.ceil(state.vaultIntermediateRemaining / 64));
        await this.runStep(context, {
            subsystem: 'crafting', step: 'withdraw-existing-b2', action: 'withdraw B2 from /pv 2 while reserving one empty slot', resource: chain.intermediateId,
            details: { vaultIntermediateRemaining: state.vaultIntermediateRemaining, intermediateCount: view.intermediateCount, outputRemaining: state.outputRemaining, maxStacks,
                emptySlotCount: view.inventory.emptySlotCount, minFreeForOutputAll: state.minFreeForOutputAll }
        }, () => this.flows.withdraw.withdraw(chain.intermediateId, this.childOptions(context, { maxStacks })));
        const after = await this.inventoryState.waitForIncrease(chain.intermediateId, before, context.cancellation.token);
        const gained = Math.max(0, after - before);
        if (gained <= 0) return false;
        state.vaultIntermediateRemaining = Math.max(0, state.vaultIntermediateRemaining - gained);
        return true;
    }
    async tryCraftIntermediate(chain, state, view, context) {
        if (state.intermediateRemaining <= 0) return { done: false };
        const acquired = await this.baseInventory.acquire(chain, context, {
            intermediateRemaining: state.intermediateRemaining, minFreeForOutputAll: state.minFreeForOutputAll, allChains: state.allChains, targetId: state.targetId
        });
        if (!acquired.ready) return { result: {
            intermediateId: chain.intermediateId, outputId: chain.outputId, deferred: state.deferIntermediateDeposit, waitingForMaterial: true,
            reason: acquired.reason || 'b1-transfer-not-ready', acquisition: acquired, intermediateRemaining: state.intermediateRemaining, outputRemaining: state.outputRemaining
        } };
        const inventory = this.inventoryState.snapshot();
        const intermediateCount = this.inventoryCounter.count(inventory, chain.intermediateId);
        const baseCount = Math.max(this.inventoryCounter.count(inventory, chain.baseId), Number(acquired.available || 0));
        const basePerIntermediate = Math.max(1, Number(acquired.basePerIntermediate ?? acquired.basePerB2 ?? 0));
        const craftableByBase = Math.floor(baseCount / basePerIntermediate);
        if (craftableByBase <= 0) this.zeroCraftable(chain, state, acquired, baseCount, context);
        const decision = this.intermediateQuantity(chain, state, craftableByBase);
        this.quantityTrace('CRAFT QUANTITY DECISION', {
            step: 'reserve-b3-chain', resource: chain.intermediateId, recipeId: chain.intermediateRecipeId, quantity: decision.quantity, reason: decision.reason,
            intermediateCount, intermediateRemaining: state.intermediateRemaining, outputRemaining: state.outputRemaining, baseId: chain.baseId, baseCount,
            basePerIntermediate: acquired.basePerIntermediate, craftableByBase, emptySlotCount: inventory.emptySlotCount, minFreeAfterCraft: state.minFreeForOutputAll
        });
        this.progressTracker.set({ running: true, state: 'CRAFTING_B2', currentStep: { kind: 'B2', id: chain.intermediateId, crafts: state.intermediateRemaining } });
        const inputSource = acquired.source || (this.baseInventory && (this.baseInventory.inputAcquisition || this.baseInventory.b2Input) && (this.baseInventory.inputAcquisition || this.baseInventory.b2Input).source) || 'inventory';
        if (this.logger && this.logger.info) this.logger.info('B5 B1 SOURCE CONTRACT', { operation: 'CraftingAutomation', step: 'craft-b2-source-contract', phase: 'OK',
            resource: chain.baseId, intermediateId: chain.intermediateId, sourceMode: inputSource === 'inventory' ? 'INVENTORY_WITHDRAW' : 'STORAGE',
            quantity: decision.quantity, baseCount, emptySlotCount: inventory.emptySlotCount });
        const crafted = await this.finalCraft.craft(chain.intermediateRecipeId, decision.quantity, context, chain.intermediateId, {
            stage: 'B2',
            nextStage: 'B3',
            inputSourceOverrides: { [chain.baseId]: inputSource },
            reconciliationBaseline: { inputs: { [chain.baseId]: { source: inputSource, count: baseCount } } }
        });
        const actualCrafts = this.inventoryState.actualCrafts(crafted, decision.quantity);
        if (actualCrafts <= 0) this.zeroIntermediate(chain, state, decision.quantity, crafted, baseCount, craftableByBase, intermediateCount, context);
        state.intermediateRemaining = Math.max(0, state.intermediateRemaining - actualCrafts);
        state.pendingStageSettlement = {
            stage: 'B2', logicalId: chain.intermediateId,
            minimumCount: Number.isFinite(Number(crafted && crafted.stageContract && crafted.stageContract.after))
                ? Number(crafted.stageContract.after)
                : Math.max(0, intermediateCount + actualCrafts * Math.max(1, Number(chain.intermediateOutputAmount || 1))),
            expectedDelta: actualCrafts * Math.max(1, Number(chain.intermediateOutputAmount || 1))
        };
        return { done: true };
    }
    intermediateQuantity(chain, state, craftableByBase) {
        if (chain.useAllForIntermediate === true && craftableByBase <= state.intermediateRemaining) return { quantity: 'ALL', reason: 'inventory-b1-all-bounded-by-current-material-plan' };
        if (state.intermediateRemaining >= 64 && craftableByBase >= 64) return { quantity: 64, reason: 'exact-64-after-b1-withdraw' };
        return { quantity: 1, reason: 'exact-one-after-b1-withdraw' };
    }
    async tryFreeSlot(chain, state, view, context) {
        if (Number(view.inventory.emptySlotCount || 0) >= state.minFreeForOutputAll) return { done: false };
        const freed = await this.spaceFreer.ensureFreeIntermediateSlots(chain, context, state.minFreeForOutputAll, {
            reason: 'server requires a free slot before B2->B3 ALL', preserveAtLeastIntermediate: chain.intermediatePerOutput, allChains: state.allChains
        });
        state.vaultIntermediateRemaining += freed.depositedB2Count;
        if (freed.emergencyParkedCurrentB2 && this.inventoryCounter.count(freed.snapshot, chain.intermediateId) < chain.intermediatePerOutput) {
            return { result: this.spaceDeferred(chain, state, freed) };
        }
        return { done: true };
    }
    spaceDeferred(chain, state, freed) {
        return { intermediateId: chain.intermediateId, outputId: chain.outputId, deferred: state.deferIntermediateDeposit, deferredForSpace: true,
            parkedIntermediateCount: freed.depositedB2Count, parkedB2Count: freed.depositedB2Count, emptySlotCount: freed.snapshot.emptySlotCount };
    }
    async depositIfRequired(chain, context, defer) {
        if (defer) return;
        await this.runStep(context, { subsystem: 'crafting', step: 'deposit-b3-reserve', action: 'deposit completed B3 reserve to /pv 2 before next material', resource: chain.outputId },
            () => this.flows.deposit.deposit(chain.outputId, this.childOptions(context)));
        await this.runStep(context, { subsystem: 'crafting', step: 'deposit-b2-leftover', action: 'deposit B2 leftover to /pv 2 before next material', resource: chain.intermediateId },
            () => this.flows.deposit.deposit(chain.intermediateId, this.childOptions(context)));
    }
    stalled(chain, state, view, context) {
        throw new FlowError('Cannot continue B3 reserve chain for ' + chain.baseId + '; insufficient ' + chain.intermediateId + '.', {
            code: 'CRAFT_RESERVE_INPUT_STALLED', subsystem: 'crafting', step: 'reserve-b3-chain', action: 'choose next B2/B3 ALL action', resource: chain.intermediateId,
            details: { intermediateCount: view.intermediateCount, b2Count: view.intermediateCount, intermediateRemaining: state.intermediateRemaining, outputRemaining: state.outputRemaining, vaultIntermediateRemaining: state.vaultIntermediateRemaining,
                emptySlotCount: view.inventory.emptySlotCount, chain }, trace: context.trace
        });
    }
    zeroOutput(chain, state, quantity, crafted, intermediateCount, context) {
        throw new FlowError('Craft ' + chain.outputId + ' reported no completed crafts.', {
            code: 'CRAFT_ALL_CRAFT_ZERO', subsystem: 'crafting', step: 'reserve-b3-chain', action: 'craft quantity ' + quantity, resource: chain.outputId,
            details: { quantity, crafted, intermediateCount, intermediateRemaining: state.intermediateRemaining, outputRemaining: state.outputRemaining }, trace: context.trace
        });
    }
    zeroCraftable(chain, state, acquired, baseCount, context) {
        throw new FlowError('B1 transfer for ' + chain.baseId + ' produced no craftable B2 input.', {
            code: 'CRAFT_B1_TRANSFER_ZERO_CRAFTABLE', subsystem: 'crafting', step: 'acquire-b1-for-b2', action: 'verify withdrawn B1 before B2', resource: chain.baseId,
            retryable: true, details: { baseCount, basePerIntermediate: acquired.basePerIntermediate, intermediateRemaining: state.intermediateRemaining, acquisition: acquired }, trace: context.trace
        });
    }
    zeroIntermediate(chain, state, quantity, crafted, baseCount, craftableByBase, intermediateCount, context) {
        throw new FlowError('Craft ' + chain.intermediateId + ' reported no completed crafts.', {
            code: 'CRAFT_B2_CRAFT_ZERO', subsystem: 'crafting', step: 'reserve-b3-chain', action: 'craft quantity ' + quantity, resource: chain.intermediateId,
            details: { quantity, crafted, baseCount, craftableByBase, intermediateCount, intermediateRemaining: state.intermediateRemaining, outputRemaining: state.outputRemaining }, trace: context.trace
        });
    }
    async settlePending(state, chain, context, to) {
        const pending = state.pendingStageSettlement;
        await this.finalCraft.settleStage({
            stage: pending.stage,
            logicalId: pending.logicalId,
            minimumCount: pending.minimumCount,
            context
        });
        state.pendingStageSettlement = null;
        const from = pending.stage === 'B2' ? 'B2' : 'B3';
        await this.runStep(context, {
            subsystem: 'crafting', step: 'stage-handoff-after-settlement', action: 'settle ' + from + ' outputs before ' + to, resource: pending.logicalId,
            details: { from, to, minimumCount: pending.minimumCount, expectedDelta: pending.expectedDelta }
        }, () => Promise.resolve());
    }
    static normalize(chain) {
        const c = chain && typeof chain === 'object' ? chain : {};
        if (typeof c.intermediateId === 'string' && typeof c.outputId === 'string'
            && !('b2Id' in c) && !('b3Id' in c) && !('b2RecipeId' in c) && !('b3RecipeId' in c)) {
            if (c.useAllForIntermediate === undefined && c.useAllForB2 !== undefined) {
                return { ...c, useAllForIntermediate: c.useAllForB2 === true };
            }
            return c;
        }
        const generic = fromLegacyChain(c);
        return { ...generic, useAllForIntermediate: c.useAllForB2 === true };
    }
}
module.exports = CraftReserveChainCoordinator;
