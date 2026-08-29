'use strict';

const FlowError = require('../../../shared/errors/FlowError');

class B5ReserveChainCoordinator {
    constructor({ flows, b1Inventory, intermediate, inventoryState, inventoryCounter, progressTracker, finalCraft, config, logger = null, runStep, childOptions, quantityTrace = () => {} }) {
        Object.assign(this, { flows, b1Inventory, intermediate, inventoryState, inventoryCounter, progressTracker, finalCraft, config, logger, runStep, childOptions, quantityTrace });
    }

    reconfigure(config = {}) { this.config = config || {}; return this; }

    async prepare(chain, context, { deferIntermediateDeposit = false, allChains = [] } = {}) {
        const state = this.#initialState(chain, deferIntermediateDeposit, allChains);
        while (state.b3Remaining > 0 || state.b2Remaining > 0) {
            context.cancellation.token.throwIfCancelled();
            this.#guard(state, chain, context);
            const view = this.#view(chain, state);
            const craftedB3 = await this.#tryCraftB3(chain, state, view, context);
            if (craftedB3?.done) continue;
            if (craftedB3?.result) return craftedB3.result;
            if (await this.#tryWithdrawOwnedB2(chain, state, view, context)) continue;
            const craftedB2 = await this.#tryCraftB2(chain, state, view, context);
            if (craftedB2?.result) return craftedB2.result;
            if (craftedB2?.done) continue;
            const freed = await this.#tryFreeSlot(chain, state, view, context);
            if (freed?.result) return freed.result;
            if (freed?.done) continue;
            if (chain.partialReservePass === true && state.b2Remaining <= 0 && state.vaultB2Remaining <= 0) break;
            this.#throwStalled(chain, state, view, context);
        }
        if (state.pendingStageSettlement) {
            const pendingStage = state.pendingStageSettlement.stage;
            const to = pendingStage === 'B2' ? 'B3' : 'B4';
            await this.#settlePendingStage(state, chain, context, to);
        }
        await this.#depositIfRequired(chain, context, deferIntermediateDeposit);
        return { b2Id: chain.b2Id, b3Id: chain.b3Id, deferred: deferIntermediateDeposit };
    }

    #initialState(chain, deferIntermediateDeposit, allChains) {
        const minFreeForB3All = Math.max(1, Number(this.config?.b3AllMinEmptySlots || 1));
        return {
            minFreeForB3All,
            accumulationSafetyFloor: Math.max(minFreeForB3All + 1, Math.max(0, Number(this.config?.inventorySafetyEmptySlots || 0))),
            b2Remaining: Number(chain.b2Crafts || 0),
            b3Remaining: Number(chain.b3Crafts || 0),
            vaultB2Remaining: Number(chain.vaultB2 || 0),
            deferIntermediateDeposit,
            allChains,
            guard: 0,
            pendingStageSettlement: null
        };
    }

    #guard(state, chain, context) {
        state.guard += 1;
        if (state.guard <= 512) return;
        throw new FlowError(`B3 reserve chain exceeded safety iteration limit for ${chain.baseId}.`, {
            code: 'B5_RESERVE_LOOP_GUARD', subsystem: 'b5', step: 'reserve-b3-chain', action: 'optimize B2/B3 ALL chain',
            resource: chain.baseId, details: { b2Remaining: state.b2Remaining, b3Remaining: state.b3Remaining, vaultB2Remaining: state.vaultB2Remaining, chain }, trace: context.trace
        });
    }

    #view(chain, state) {
        const inventory = this.inventoryState.snapshot();
        const b2Count = this.inventoryCounter.count(inventory, chain.b2Id);
        const b3CraftableNow = Math.floor(b2Count / Math.max(1, chain.b3InputPerCraft));
        return {
            inventory, b2Count, b3CraftableNow,
            enoughB2ForRemainingB3: state.b3Remaining > 0 && b3CraftableNow >= state.b3Remaining,
            atB3SafetyFloor: Number(inventory.emptySlotCount || 0) <= state.accumulationSafetyFloor,
            noMoreB2SupplyPlanned: state.b2Remaining <= 0 && state.vaultB2Remaining <= 0
        };
    }

    async #tryCraftB3(chain, state, view, context) {
        if (!(state.b3Remaining > 0 && view.b3CraftableNow > 0 && (view.enoughB2ForRemainingB3 || view.atB3SafetyFloor || view.noMoreB2SupplyPlanned))) return { done: false };
        if (state.pendingStageSettlement?.stage === 'B2') {
            await this.#settlePendingStage(state, chain, context, 'B3');
        }
        let inventory = view.inventory;
        let b2Count = view.b2Count;
        if (Number(inventory.emptySlotCount || 0) < state.minFreeForB3All) {
            const freed = await this.intermediate.ensureFreeIntermediateSlots(chain, context, state.minFreeForB3All, {
                reason: 'reserve one output slot before B2->B3 ALL', preserveAtLeastB2: chain.b3InputPerCraft,
                preferCurrentB2: chain.useAllForB2 === true, allChains: state.allChains
            });
            inventory = freed.snapshot;
            state.vaultB2Remaining += freed.depositedB2Count;
            b2Count = this.inventoryCounter.count(inventory, chain.b2Id);
            if (freed.emergencyParkedCurrentB2 && b2Count < chain.b3InputPerCraft) return { result: this.#spaceDeferred(chain, state, freed) };
        }
        if (b2Count < chain.b3InputPerCraft) return { done: true };
        const quantity = this.inventoryState.allEnabled('useAllForB3') ? 'ALL'
            : (state.b3Remaining >= 64 && b2Count >= chain.b3InputPerCraft * 64 ? 64 : 1);
        this.quantityTrace('B5 QUANTITY DECISION', {
            step: 'reserve-b3-chain', resource: chain.b3Id, recipeId: chain.b3RecipeId, quantity,
            reason: quantity === 'ALL' ? 'b2-accumulated-then-b3-all' : 'exact-fallback', b2Count,
            b2Remaining: state.b2Remaining, b3Remaining: state.b3Remaining,
            b3CraftableNow: Math.floor(b2Count / Math.max(1, chain.b3InputPerCraft)), emptySlotCount: inventory.emptySlotCount,
            minFreeForB3All: state.minFreeForB3All
        });
        this.progressTracker.set({ running: true, state: 'CRAFTING_B3', currentStep: { kind: 'B3', id: chain.b3Id, crafts: state.b3Remaining } });
        const crafted = await this.finalCraft.craft(chain.b3RecipeId, quantity, context, chain.b3Id, { stage: 'B3', nextStage: 'B4' });
        const actualCrafts = this.inventoryState.actualCrafts(crafted, quantity);
        if (actualCrafts <= 0) this.#throwZeroB3(chain, state, quantity, crafted, b2Count, context);
        state.b3Remaining = Math.max(0, state.b3Remaining - actualCrafts);
        if (state.b3Remaining === 0) {
            state.b2Remaining = 0;
            const minimumCount = Number.isFinite(Number(crafted?.stageContract?.after))
                ? Number(crafted.stageContract.after)
                : b3Count + actualCrafts * Math.max(1, Number(chain.b3OutputAmount || 1));
            const settlement = await this.finalCraft.settleStage({
                stage: 'B3', logicalId: chain.b3Id, minimumCount, context
            });
            this.logger?.info?.('B5 STAGE HANDOFF READY', {
                from: 'B3', to: 'B4', generation: context.connectionGeneration, logicalId: chain.b3Id,
                settledCount: settlement.count, elapsedMs: settlement.elapsedMs
            });
        }
        return { done: true };
    }

    async #settlePendingStage(state, chain, context, toStage, options = {}) {
        const pending = state.pendingStageSettlement;
        if (!pending) return null;
        const stage = String(options.forceStage || pending.stage);
        const logicalId = pending.logicalId;
        const minimumCount = Number.isFinite(Number(options.minimumCount))
            ? Number(options.minimumCount)
            : Number(pending.minimumCount || 0);
        const settlement = await this.finalCraft.settleStage({ stage, logicalId, minimumCount, context });
        this.logger?.info?.('B5 STAGE HANDOFF READY', {
            from: stage, to: toStage, generation: context.connectionGeneration, logicalId,
            settledCount: settlement.count, elapsedMs: settlement.elapsedMs
        });
        state.pendingStageSettlement = null;
        return settlement;
    }

    async #tryWithdrawOwnedB2(chain, state, view, context) {
        if (!(state.b3Remaining > 0 && state.vaultB2Remaining > 0 && Number(view.inventory.emptySlotCount || 0) > state.minFreeForB3All)) return false;
        const freeStackSlots = Math.max(0, Number(view.inventory.emptySlotCount || 0) - state.minFreeForB3All);
        const b2StillUseful = Math.max(0, state.b3Remaining * chain.b3InputPerCraft - view.b2Count);
        const wantedStacks = Math.max(1, Math.ceil(Math.min(state.vaultB2Remaining, b2StillUseful || state.vaultB2Remaining) / 64));
        const maxStacks = Math.max(1, Math.min(freeStackSlots, wantedStacks));
        const before = view.b2Count;
        const withdrawn = await this.runStep(context, {
            subsystem: 'b5', step: 'withdraw-existing-b2', action: 'withdraw B2 from /pv 2 while reserving one empty slot', resource: chain.b2Id,
            details: { vaultB2Remaining: state.vaultB2Remaining, b2Count: view.b2Count, b3Remaining: state.b3Remaining, maxStacks,
                emptySlotCount: view.inventory.emptySlotCount, minFreeForB3All: state.minFreeForB3All }
        }, () => this.flows.withdraw.withdraw(chain.b2Id, this.childOptions(context, { maxStacks })));
        const after = await this.inventoryState.waitForIncrease(chain.b2Id, before, context.cancellation.token);
        const gained = Math.max(0, after - before);
        if (gained <= 0) return false;
        state.vaultB2Remaining = Math.max(0, state.vaultB2Remaining - gained);
        return true;
    }

    async #tryCraftB2(chain, state, view, context) {
        if (state.b2Remaining <= 0) return { done: false };
        const acquired = await this.b1Inventory.acquire(chain, context, {
            b2Remaining: state.b2Remaining, minFreeForB3All: state.minFreeForB3All, allChains: state.allChains
        });
        if (!acquired.ready) return { result: {
            b2Id: chain.b2Id, b3Id: chain.b3Id, deferred: state.deferIntermediateDeposit, waitingForMaterial: true,
            reason: acquired.reason || 'b1-transfer-not-ready', acquisition: acquired, b2Remaining: state.b2Remaining, b3Remaining: state.b3Remaining
        } };
        const inventory = this.inventoryState.snapshot();
        const b2Count = this.inventoryCounter.count(inventory, chain.b2Id);
        const baseCount = Math.max(this.inventoryCounter.count(inventory, chain.baseId), Number(acquired.available || 0));
        const craftableByBase = Math.floor(baseCount / Math.max(1, acquired.basePerB2));
        if (craftableByBase <= 0) this.#throwZeroCraftable(chain, state, acquired, baseCount, context);
        const decision = this.#b2Quantity(chain, state, craftableByBase);
        this.quantityTrace('B5 QUANTITY DECISION', {
            step: 'reserve-b3-chain', resource: chain.b2Id, recipeId: chain.b2RecipeId, ...decision,
            b2Count, b2Remaining: state.b2Remaining, b3Remaining: state.b3Remaining, baseId: chain.baseId, baseCount,
            basePerB2: acquired.basePerB2, craftableByBase, emptySlotCount: inventory.emptySlotCount, minFreeAfterCraft: state.minFreeForB3All
        });
        this.progressTracker.set({ running: true, state: 'CRAFTING_B2', currentStep: { kind: 'B2', id: chain.b2Id, crafts: state.b2Remaining } });
        const inputSource = acquired.source || this.b1Inventory?.b2Input?.source || 'inventory';
        this.logger?.info?.('B5 B1 SOURCE CONTRACT', { operation: 'B5Automation', step: 'craft-b2-source-contract', phase: 'OK',
            resource: chain.baseId, b2Id: chain.b2Id, sourceMode: inputSource === 'inventory' ? 'INVENTORY_WITHDRAW' : 'STORAGE',
            quantity: decision.quantity, baseCount, emptySlotCount: inventory.emptySlotCount });
        const crafted = await this.finalCraft.craft(chain.b2RecipeId, decision.quantity, context, chain.b2Id, {
            stage: 'B2',
            nextStage: 'B3',
            inputSourceOverrides: { [chain.baseId]: inputSource },
            reconciliationBaseline: { inputs: { [chain.baseId]: { source: inputSource, count: baseCount } } }
        });
        const actualCrafts = this.inventoryState.actualCrafts(crafted, decision.quantity);
        if (actualCrafts <= 0) this.#throwZeroB2(chain, state, decision.quantity, crafted, baseCount, craftableByBase, b2Count, context);
        state.b2Remaining = Math.max(0, state.b2Remaining - actualCrafts);
        state.pendingStageSettlement = {
            stage: 'B2', logicalId: chain.b2Id,
            minimumCount: Number.isFinite(Number(crafted?.stageContract?.after))
                ? Number(crafted.stageContract.after)
                : Math.max(0, b2Count + actualCrafts * Math.max(1, Number(chain.b2OutputAmount || 1))),
            expectedDelta: actualCrafts * Math.max(1, Number(chain.b2OutputAmount || 1))
        };
        return { done: true };
    }

    #b2Quantity(chain, state, craftableByBase) {
        if (chain.useAllForB2 === true && craftableByBase <= state.b2Remaining) return { quantity: 'ALL', reason: 'inventory-b1-all-bounded-by-current-material-plan' };
        if (state.b2Remaining >= 64 && craftableByBase >= 64) return { quantity: 64, reason: 'exact-64-after-b1-withdraw' };
        return { quantity: 1, reason: 'exact-one-after-b1-withdraw' };
    }

    async #tryFreeSlot(chain, state, view, context) {
        if (Number(view.inventory.emptySlotCount || 0) >= state.minFreeForB3All) return { done: false };
        const freed = await this.intermediate.ensureFreeIntermediateSlots(chain, context, state.minFreeForB3All, {
            reason: 'server requires a free slot before B2->B3 ALL', preserveAtLeastB2: chain.b3InputPerCraft, allChains: state.allChains
        });
        state.vaultB2Remaining += freed.depositedB2Count;
        if (freed.emergencyParkedCurrentB2 && this.inventoryCounter.count(freed.snapshot, chain.b2Id) < chain.b3InputPerCraft) {
            return { result: this.#spaceDeferred(chain, state, freed) };
        }
        return { done: true };
    }

    #spaceDeferred(chain, state, freed) {
        return { b2Id: chain.b2Id, b3Id: chain.b3Id, deferred: state.deferIntermediateDeposit, deferredForSpace: true,
            parkedB2Count: freed.depositedB2Count, emptySlotCount: freed.snapshot.emptySlotCount };
    }

    async #depositIfRequired(chain, context, defer) {
        if (defer) return;
        await this.runStep(context, { subsystem: 'b5', step: 'deposit-b3-reserve', action: 'deposit completed B3 reserve to /pv 2 before next material', resource: chain.b3Id },
            () => this.flows.deposit.deposit(chain.b3Id, this.childOptions(context)));
        await this.runStep(context, { subsystem: 'b5', step: 'deposit-b2-leftover', action: 'deposit B2 leftover to /pv 2 before next material', resource: chain.b2Id },
            () => this.flows.deposit.deposit(chain.b2Id, this.childOptions(context)));
    }

    #throwStalled(chain, state, view, context) {
        throw new FlowError(`Cannot continue B3 reserve chain for ${chain.baseId}; insufficient ${chain.b2Id}.`, {
            code: 'B5_RESERVE_INPUT_STALLED', subsystem: 'b5', step: 'reserve-b3-chain', action: 'choose next B2/B3 ALL action', resource: chain.b2Id,
            details: { b2Count: view.b2Count, b2Remaining: state.b2Remaining, b3Remaining: state.b3Remaining, vaultB2Remaining: state.vaultB2Remaining,
                emptySlotCount: view.inventory.emptySlotCount, chain }, trace: context.trace
        });
    }

    #throwZeroB3(chain, state, quantity, crafted, b2Count, context) {
        throw new FlowError(`Craft ${chain.b3Id} reported no completed crafts.`, {
            code: 'B5_ALL_CRAFT_ZERO', subsystem: 'b5', step: 'reserve-b3-chain', action: `craft quantity ${quantity}`, resource: chain.b3Id,
            details: { quantity, crafted, b2Count, b2Remaining: state.b2Remaining, b3Remaining: state.b3Remaining }, trace: context.trace
        });
    }

    #throwZeroCraftable(chain, state, acquired, baseCount, context) {
        throw new FlowError(`B1 transfer for ${chain.baseId} produced no craftable B2 input.`, {
            code: 'B5_B1_TRANSFER_ZERO_CRAFTABLE', subsystem: 'b5', step: 'acquire-b1-for-b2', action: 'verify withdrawn B1 before B2', resource: chain.baseId,
            retryable: true, details: { baseCount, basePerB2: acquired.basePerB2, b2Remaining: state.b2Remaining, acquisition: acquired }, trace: context.trace
        });
    }

    #throwZeroB2(chain, state, quantity, crafted, baseCount, craftableByBase, b2Count, context) {
        throw new FlowError(`Craft ${chain.b2Id} reported no completed crafts.`, {
            code: 'B5_B2_CRAFT_ZERO', subsystem: 'b5', step: 'reserve-b3-chain', action: `craft quantity ${quantity}`, resource: chain.b2Id,
            details: { quantity, crafted, baseCount, craftableByBase, b2Count, b2Remaining: state.b2Remaining, b3Remaining: state.b3Remaining }, trace: context.trace
        });
    }
}

module.exports = B5ReserveChainCoordinator;
