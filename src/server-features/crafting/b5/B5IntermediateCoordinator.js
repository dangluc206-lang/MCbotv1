'use strict';

const FlowError = require('../../../shared/errors/FlowError');

class B5IntermediateCoordinator {
    constructor({ flows, inventoryState, inventoryCounter, recipeResolver, progressTracker, finalCraft, config, runStep, childOptions }) {
        Object.assign(this, { flows, inventoryState, inventoryCounter, recipeResolver, progressTracker, finalCraft, config, runStep, childOptions });
        this.reserveChain = null;
    }

    reconfigure(config = {}) {
        this.config = config || {};
        return this;
    }

    setReserveCoordinator(reserveChain) {
        this.reserveChain = reserveChain;
        return this;
    }

    async promoteOwned(initialInspection, inspect, context, { stopAtB5Ready = true } = {}) {
        let inspection = this.#requireInspection(initialInspection, 'B5 promotion inspection failed.');
        const actions = [];
        for (let guard = 0; guard < 8; guard += 1) {
            context.cancellation.token.throwIfCancelled();
            if (stopAtB5Ready && this.recipeResolver.isB5DirectlyReady(inspection.data, 1)) break;
            let changed = false;
            const b4Compacted = await this.compactReadyB4(inspection, inspect, context, { stopAtB5Ready });
            if (b4Compacted.length > 0) {
                changed = true;
                actions.push({ status: 'b3-promoted-to-b4', data: b4Compacted });
                inspection = this.#requireInspection(await inspect(), 'B5 promotion re-inspection failed.');
                if (stopAtB5Ready && this.recipeResolver.isB5DirectlyReady(inspection.data, 1)) break;
            }
            const b2Promotion = await this.#promoteB2Pass(inspection, inspect, context, { stopAtB5Ready });
            inspection = b2Promotion.inspection;
            actions.push(...b2Promotion.actions);
            changed = changed || b2Promotion.changed;
            if (stopAtB5Ready && this.recipeResolver.isB5DirectlyReady(inspection.data, 1)) break;
            if (!changed || !b2Promotion.promoted) break;
        }
        return { inspection, actions };
    }

    async #promoteB2Pass(initialInspection, inspect, context, { stopAtB5Ready }) {
        let inspection = initialInspection;
        const actions = [];
        let promoted = false;
        for (const chain of inspection.data?.chains || []) {
            context.cancellation.token.throwIfCancelled();
            const inputPerCraft = Math.max(1, Number(chain.b3InputPerCraft || 1));
            const inventoryB2 = Math.max(Number(chain.inventoryB2 || 0), this.inventoryState.count(chain.b2Id));
            const ownedB2 = Math.max(0, Number(chain.vaultB2 || 0) + inventoryB2);
            const crafts = Math.floor(ownedB2 / inputPerCraft);
            if (crafts <= 0) continue;
            if (!this.reserveChain?.prepare) throw new Error('B5 reserve coordinator is unavailable.');
            const result = await this.reserveChain.prepare({ ...chain, b2Crafts: 0, b3Crafts: crafts, readyToReserve: true }, context, {
                deferIntermediateDeposit: true,
                allChains: inspection.data?.chains || []
            });
            if (result?.deferredForSpace) {
                actions.push({ status: 'b2-pv2-parked-for-space', b2Id: chain.b2Id, b3Id: chain.b3Id, data: result });
                inspection = this.#requireInspection(await inspect(), 'B5 promotion re-inspection failed.');
                break;
            }
            promoted = true;
            actions.push({ status: 'b2-promoted-to-b3', b2Id: chain.b2Id, b3Id: chain.b3Id, crafts });
            const immediateB4 = await this.compactReadyB4(inspection, inspect, context, { stopAtB5Ready });
            if (immediateB4.length > 0) actions.push({ status: 'b4-compacted-immediately', data: immediateB4 });
            inspection = this.#requireInspection(await inspect(), 'B5 promotion re-inspection failed.');
            if (stopAtB5Ready && this.recipeResolver.isB5DirectlyReady(inspection.data, 1)) break;
        }
        return { inspection, actions, promoted, changed: promoted || actions.some(action => action.status === 'b2-pv2-parked-for-space') };
    }

    async depositRemainders(data, context, actions = []) {
        this.progressTracker.set({ running: true, state: 'STORING', currentStep: { kind: 'STORE', id: 'B2-B4' } });
        for (const chain of data?.chains || []) {
            context.cancellation.token.throwIfCancelled();
            await this.#depositRemainder(chain.b3Id, 'store-irreducible-b3', 'deposit B3 only after all possible B4 compaction', context, actions, { count: this.inventoryState.count(chain.b3Id) });
            await this.#depositRemainder(chain.b2Id, 'store-irreducible-b2', 'deposit B2 remainder smaller than one B3 craft', context, actions, {
                count: this.inventoryState.count(chain.b2Id), b3InputPerCraft: chain.b3InputPerCraft
            });
        }
    }

    async #depositRemainder(id, step, action, context, actions, details) {
        if (Number(details.count || 0) <= 0) return;
        const result = await this.runStep(context, { subsystem: 'b5', step, action, resource: id, details },
            () => this.flows.deposit.deposit(id, this.childOptions(context)));
        actions.push({ status: id === details?.b2Id ? 'b2-remainder-stored' : (step.includes('b2') ? 'b2-remainder-stored' : 'b3-remainder-stored'), id, data: result?.data });
    }

    async compactReadyB4(initialInspection, inspect, context, { stopAtB5Ready = true } = {}) {
        let inspection = this.#requireInspection(initialInspection, 'B5 inspection failed during B4 compaction.');
        const compacted = [];
        const targetId = inspection.data?.fullPlan?.targetId || this.config?.targetId || 'super_alloy';
        const targetRecipe = this.recipeResolver.recipeForOutput(targetId, inspection.data?.finalSteps || []);
        if (!targetRecipe?.recipe) return compacted;
        const b4Ids = Object.keys(targetRecipe.recipe.inputs || {});
        for (const outputId of b4Ids) {
            inspection = await this.#fillPriorityShortage(outputId, inspection, inspect, context, targetRecipe, compacted, stopAtB5Ready);
            if (stopAtB5Ready && this.recipeResolver.isB5DirectlyReady(inspection.data, 1)) return compacted;
        }
        await this.#compactBalancedSurplus(b4Ids, inspection, inspect, context, targetRecipe, compacted, stopAtB5Ready);
        return compacted;
    }

    async #fillPriorityShortage(outputId, inspection, inspect, context, targetRecipe, compacted, stopAtB5Ready) {
        for (let guard = 0; guard < 128; guard += 1) {
            context.cancellation.token.throwIfCancelled();
            if (stopAtB5Ready && this.recipeResolver.isB5DirectlyReady(inspection.data, 1)) return inspection;
            const candidate = this.#b4Candidate(outputId, inspection, targetRecipe);
            if (!candidate || candidate.craftableNow <= 0) return inspection;
            const crafts = Math.floor(Math.min(candidate.craftableNow, Math.max(0, candidate.perTarget - candidate.existingB4)));
            if (crafts <= 0) return inspection;
            inspection = await this.#craftB4(candidate, crafts, 'b5-priority', inspect, context, compacted);
        }
        return inspection;
    }

    async #compactBalancedSurplus(b4Ids, initialInspection, inspect, context, targetRecipe, compacted, stopAtB5Ready) {
        let inspection = initialInspection;
        for (let guard = 0; guard < 512; guard += 1) {
            context.cancellation.token.throwIfCancelled();
            if (stopAtB5Ready && this.recipeResolver.isB5DirectlyReady(inspection.data, 1)) break;
            const candidates = b4Ids.map(id => this.#b4Candidate(id, inspection, targetRecipe))
                .filter(candidate => candidate && candidate.craftableNow > 0 && candidate.perTarget > 0)
                .sort((a, b) => a.normalizedCoverage - b.normalizedCoverage || b.perTarget - a.perTarget || a.outputId.localeCompare(b.outputId));
            const candidate = candidates[0];
            if (!candidate) break;
            const crafts = Math.floor(Math.min(candidate.craftableNow, Math.max(1, Math.min(32, candidate.perTarget))));
            if (crafts <= 0) break;
            inspection = await this.#craftB4(candidate, crafts, 'storage-compaction-balanced', inspect, context, compacted);
        }
        return inspection;
    }

    #b4Candidate(outputId, inspection, targetRecipe) {
        const recipeEntry = this.recipeResolver.recipeForOutput(outputId, inspection.data?.finalSteps || []);
        if (!recipeEntry?.recipe) return null;
        const entries = Object.entries(recipeEntry.recipe.inputs || {}).filter(([, amount]) => Number(amount) > 0);
        if (entries.length === 0) return null;
        const available = inspection.data?.nonStorageAvailable || {};
        let craftableNow = Number.MAX_SAFE_INTEGER;
        for (const [logicalId, perCraft] of entries) craftableNow = Math.min(craftableNow, Math.floor(Math.max(0, Number(available[logicalId] || 0)) / Number(perCraft)));
        const perTarget = Math.max(0, Number(targetRecipe.recipe.inputs?.[outputId] || 0));
        const existingB4 = Math.max(0, Number(available[outputId] || 0));
        return { outputId, recipeEntry, craftableNow: Math.max(0, Number.isFinite(craftableNow) ? Math.floor(craftableNow) : 0), perTarget, existingB4,
            normalizedCoverage: perTarget > 0 ? existingB4 / perTarget : Number.POSITIVE_INFINITY };
    }

    async #craftB4(candidate, crafts, phase, inspect, context, compacted) {
        await this.finalCraft.execute([{ recipeId: candidate.recipeEntry.recipeId, outputId: candidate.outputId, crafts }], context);
        await this.flows.deposit.deposit(candidate.outputId, this.childOptions(context));
        compacted.push({ outputId: candidate.outputId, recipeId: candidate.recipeEntry.recipeId, crafts, phase });
        return this.#requireInspection(await inspect(), 'B5 inspection failed after B4 compaction.');
    }

    async ensureFreeIntermediateSlots(chain, context, minFreeSlots, { reason = null, preserveAtLeastB2 = 0, preferCurrentB2 = false, allChains = [] } = {}) {
        this.progressTracker.set({ running: true, state: 'FREEING_SPACE', currentStep: { kind: 'SPACE', id: chain.b3Id } });
        let snapshot = this.inventoryState.spaceSnapshot();
        const state = { depositedB2Count: 0, attempts: 0, emergencyParkedCurrentB2: false, attemptedIds: new Set() };
        if (preferCurrentB2 && Number(snapshot.emptySlotCount || 0) < minFreeSlots) {
            snapshot = await this.#parkCurrentB2(chain, context, minFreeSlots, snapshot, state, true);
            if (Number(snapshot.emptySlotCount || 0) >= minFreeSlots) return this.#spaceResult(snapshot, state);
        }
        const candidateIds = this.#spaceReleaseCandidates(chain, allChains, { preserveAtLeastB2 });
        for (const logicalId of candidateIds) {
            if (Number(snapshot.emptySlotCount || 0) >= minFreeSlots) break;
            snapshot = await this.#offloadCandidate(logicalId, chain, context, minFreeSlots, preserveAtLeastB2, snapshot, state);
        }
        if (Number(snapshot.emptySlotCount || 0) < minFreeSlots) snapshot = await this.#parkCurrentB2(chain, context, minFreeSlots, snapshot, state, false);
        if (Number(snapshot.emptySlotCount || 0) < minFreeSlots) this.#throwNoSpace(chain, context, minFreeSlots, reason, preserveAtLeastB2, snapshot, state);
        return this.#spaceResult(snapshot, state);
    }

    async #parkCurrentB2(chain, context, minFreeSlots, snapshot, state, requireStack) {
        const before = this.inventoryState.count(chain.b2Id);
        if (before <= 0 || (requireStack && before < 64)) return snapshot;
        state.attempts += 1;
        state.attemptedIds.add(chain.b2Id);
        const parked = await this.flows.deposit.deposit(chain.b2Id, this.childOptions(context, { maxStacks: 1 }));
        if (parked?.success === false) return snapshot;
        const after = this.inventoryState.count(chain.b2Id);
        const moved = Math.max(0, before - after) || Math.max(0, Number(parked?.data?.movedStacks || 0)) * 64;
        if (moved <= 0) return snapshot;
        state.depositedB2Count += moved;
        state.emergencyParkedCurrentB2 = true;
        return this.inventoryState.waitForFreeSlots(minFreeSlots, context.cancellation.token);
    }

    async #offloadCandidate(logicalId, chain, context, minFreeSlots, preserveAtLeastB2, snapshot, state) {
        context.cancellation.token.throwIfCancelled();
        if (!logicalId || state.attemptedIds.has(logicalId)) return snapshot;
        state.attemptedIds.add(logicalId);
        const before = this.inventoryState.count(logicalId);
        if (before <= 0 || (logicalId === chain.b2Id && before - 64 < preserveAtLeastB2)) return snapshot;
        state.attempts += 1;
        const result = await this.flows.deposit.deposit(logicalId, this.childOptions(context, { maxStacks: 1 }));
        if (result?.success === false) return snapshot;
        const after = this.inventoryState.count(logicalId);
        if (logicalId === chain.b2Id) state.depositedB2Count += Math.max(0, before - after);
        return this.inventoryState.waitForFreeSlots(minFreeSlots, context.cancellation.token);
    }

    #spaceReleaseCandidates(chain, allChains, { preserveAtLeastB2 = 0 } = {}) {
        const candidates = [];
        const push = id => { const value = String(id || '').trim(); if (value && !candidates.includes(value)) candidates.push(value); };
        const targetRecipe = this.recipeResolver.recipeForOutput(this.config?.targetId || 'super_alloy');
        for (const b4Id of Object.keys(targetRecipe?.recipe?.inputs || {})) push(b4Id);
        push(chain.b3Id);
        for (const candidate of allChains || []) if (candidate?.b3Id !== chain.b3Id) push(candidate?.b3Id);
        for (const candidate of allChains || []) if (candidate?.b2Id !== chain.b2Id) push(candidate?.b2Id);
        if (this.inventoryState.count(chain.b2Id) - 64 >= preserveAtLeastB2) push(chain.b2Id);
        return candidates;
    }

    #throwNoSpace(chain, context, minFreeSlots, reason, preserveAtLeastB2, snapshot, state) {
        throw new FlowError(`Cannot reserve ${minFreeSlots} empty inventory slot(s) for ${chain.b3Id}.`, {
            code: 'B5_INTERMEDIATE_NO_SPACE', subsystem: 'b5', step: 'free-intermediate-slot', action: reason || 'reserve inventory output slot',
            resource: chain.b3Id, retryable: true, trace: context.trace,
            details: { minFreeSlots, emptySlotCount: snapshot.emptySlotCount, b2Count: this.inventoryState.count(chain.b2Id), b3Count: this.inventoryState.count(chain.b3Id),
                preserveAtLeastB2, attemptedIds: [...state.attemptedIds], attempts: state.attempts, emergencyParkedCurrentB2: state.emergencyParkedCurrentB2 }
        });
    }

    #spaceResult(snapshot, state) {
        return { snapshot, depositedB2Count: state.depositedB2Count, emergencyParkedCurrentB2: state.emergencyParkedCurrentB2 };
    }

    #requireInspection(result, message) {
        if (result?.success === false) throw result.error || new Error(result.message || message);
        return result;
    }
}

module.exports = B5IntermediateCoordinator;
