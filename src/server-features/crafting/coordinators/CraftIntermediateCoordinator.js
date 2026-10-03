'use strict';

// Generic intermediate coordinator (Slice 6 Step 4). Mechanics own promotion
// loop, compact-ready, deposit/recount, space handling, cancellation, progress
// and error codes. Ratio-biased surplus sharing (fill the target shortage, then
// top up the least-covered output until the shared input runs out) is generic
// mechanics driven by the target recipe; ordering/ratio policy is injected
// (finalStepOrder / spaceCandidateOrder / surplusOrder), so no B5 table lives in
// the core. Legacy chains are normalized once at the boundary; core never reads
// legacy keys.
const FlowError = require('../../../shared/errors/FlowError');
const { fromLegacyChain } = require('../support/CraftChainAdapter');

class CraftIntermediateCoordinator {
    constructor(o) {
        o = o || {};
        this.flows = o.flows;
        this.inventoryState = o.inventoryState;
        this.inventoryCounter = o.inventoryCounter || null;
        this.recipeResolver = o.recipeResolver;
        this.progressTracker = o.progressTracker;
        this.finalCraft = o.finalCraft;
        this.config = o.config;
        this.runStep = o.runStep;
        this.childOptions = o.childOptions;
        this.finalStepOrder = o.finalStepOrder || null;
        this.spaceCandidateOrder = o.spaceCandidateOrder || null;
        this.surplusOrder = o.surplusOrder || null;
        this.reserveChain = null;
    }

    reconfigure(c) { this.config = c || {}; return this; }

    setReserveCoordinator(r) { this.reserveChain = r; return this; }
    async promoteOwned(first, inspect, context, opts) {
        opts = opts || {};
        const stop = opts.stopAtTargetReady !== false;
        let inspection = this.requireInspection(first, 'B5 promotion inspection failed.');
        const actions = [];
        for (let guard = 0; guard < 8; guard += 1) {
            context.cancellation.token.throwIfCancelled();
            if (stop && this.recipeResolver.isTargetDirectlyReady(inspection.data, 1)) break;
            let changed = false;
            const targetId = (inspection.data && inspection.data.fullPlan && inspection.data.fullPlan.targetId) || null;
            const compacted = await this.compactReadyOutputs(inspection, context, { stopAtTargetReady: stop, targetId, inspect });
            if (compacted.length > 0) {
                changed = true;
                actions.push({ status: 'b3-promoted-to-b4', data: compacted });
                inspection = this.requireInspection(await inspect(), 'B5 promotion re-inspection failed.');
                if (stop && this.recipeResolver.isTargetDirectlyReady(inspection.data, 1)) break;
            }
            const promotion = await this.promoteIntermediatePass(inspection, inspect, context, { stopAtTargetReady: stop });
            inspection = promotion.inspection;
            actions.push(...promotion.actions);
            changed = changed || promotion.changed;
            if (stop && this.recipeResolver.isTargetDirectlyReady(inspection.data, 1)) break;
            if (!changed || !promotion.promoted) break;
        }
        return { inspection, actions };
    }
    async promoteIntermediatePass(first, inspect, context, opts) {
        opts = opts || {};
        const stop = opts.stopAtTargetReady !== false;
        let inspection = first;
        const actions = [];
        let promoted = false;
        const chains = (inspection.data && inspection.data.chains ? inspection.data.chains : []).map((c) => CraftIntermediateCoordinator.normalize(c));
        for (const chain of chains) {
            context.cancellation.token.throwIfCancelled();
            const per = Math.max(1, Number(chain.intermediatePerOutput || 1));
            const ownedInv = Math.max(Number(chain.inventoryIntermediate || 0), Number(this.inventoryState.count(chain.intermediateId) || 0));
            const owned = Math.max(0, Number(chain.vaultIntermediate || 0) + ownedInv);
            const crafts = Math.floor(owned / per);
            if (crafts <= 0) continue;
            if (!this.reserveChain || !this.reserveChain.prepare) throw new Error('B5 reserve coordinator is unavailable.');
            this.progressTracker.set({ running: true, state: 'PROMOTING_B2', currentStep: { kind: 'B2/B3', id: chain.outputId, crafts } });
            const targetId = (inspection.data && inspection.data.fullPlan && inspection.data.fullPlan.targetId) || null;
            const result = await this.reserveChain.prepare({ ...chain, intermediateCrafts: 0, outputCrafts: crafts, readyToReserve: true }, context, { deferIntermediateDeposit: true, allChains: chains, targetId });
            if (result && result.deferredForSpace) {
                actions.push({ status: 'b2-pv2-parked-for-space', intermediateId: chain.intermediateId, outputId: chain.outputId, data: result });
                inspection = this.requireInspection(await inspect(), 'B5 promotion re-inspection failed.');
                break;
            }
            if (result && result.waitingForMaterial) {
                actions.push({ status: 'b2-waiting-material', intermediateId: chain.intermediateId, outputId: chain.outputId, data: result });
                inspection = this.requireInspection(await inspect(), 'B5 promotion re-inspection failed.');
                break;
            }
            promoted = true;
            actions.push({ status: 'b2-promoted-to-b3', intermediateId: chain.intermediateId, outputId: chain.outputId, crafts, data: result });
            inspection = this.requireInspection(await inspect(), 'B5 promotion re-inspection failed.');
            if (stop && this.recipeResolver.isTargetDirectlyReady(inspection.data, 1)) break;
        }
        return { inspection, actions, changed: actions.length > 0, promoted };
    }
    async depositRemainders(data, context, actions = []) {
        this.progressTracker.set({ running: true, state: 'STORING', currentStep: { kind: 'STORE', id: 'intermediate-output' } });
        for (const raw of (data && data.chains) || []) {
            const chain = CraftIntermediateCoordinator.normalize(raw);
            context.cancellation.token.throwIfCancelled();
            await this.#depositRemainder(chain.outputId, 'store-irreducible-output', 'deposit output only after all possible direct-input compaction', context, actions, { count: this.inventoryState.count(chain.outputId) });
            await this.#depositRemainder(chain.intermediateId, 'store-irreducible-intermediate', 'deposit intermediate remainder smaller than one output craft', context, actions, {
                count: this.inventoryState.count(chain.intermediateId), intermediateId: chain.intermediateId, intermediatePerOutput: chain.intermediatePerOutput
            });
        }
    }

    async #depositRemainder(id, step, action, context, actions, details) {
        if (Number(details.count || 0) <= 0) return;
        const result = await this.runStep(context, { subsystem: 'crafting', step, action, resource: id, details },
            () => this.flows.deposit.deposit(id, this.childOptions(context)));
        const status = details.intermediateId ? 'intermediate-remainder-stored' : 'output-remainder-stored';
        actions.push({ status, id, data: result && result.data });
    }

    async compactReadyOutputs(inspection, context, opts) {
        opts = opts || {};
        const done = [];
        const data = inspection.data || {};
        const targetId = opts.targetId || null;
        const finalSteps = data.finalSteps || [];
        const targetRecipe = targetId ? this.recipeResolver.recipeForOutput(targetId, finalSteps) : null;
        if (targetRecipe && targetRecipe.recipe) {
            const b4Ids = this.surplusIds(targetRecipe, finalSteps);
            if (b4Ids.length > 0) {
                const compacted = await this.compactBalancedSurplus(b4Ids, inspection, context, targetRecipe, { stopAtTargetReady: opts.stopAtTargetReady !== false, inspect: opts.inspect || null });
                if (compacted.length > 0) {
                    for (const entry of compacted) {
                        await this.runStep(context, { subsystem: 'crafting', step: 'deposit-b4-after-promotion', action: 'deposit fresh B4 intermediates to /pv 2 to keep one free slot', resource: entry.outputId },
                            () => this.flows.deposit.depositRemainders(this.childOptions(context)));
                        done.push({ status: 'b4-compact-ready', outputId: entry.outputId, recipeId: entry.recipeId, ready: entry.crafts, phase: entry.phase });
                    }
                    return done;
                }
            }
        }
        const steps = this.finalStepsInPolicyOrder(inspection, targetId);
        for (const step of steps) {
            context.cancellation.token.throwIfCancelled();
            const recipe = this.recipeResolver.recipeForOutput(step.outputId, finalSteps);
            if (!recipe || !recipe.recipe) continue;
            const perInput = Object.entries(recipe.recipe.inputs || {}).filter((entry) => Number(entry[1]) > 0);
            if (perInput.length === 0) continue;
            const maxCraftable = Math.min(...perInput.map(([id, per]) => Math.floor(this.availableCount(inspection, id) / Number(per))));
            const ready = Math.max(0, Math.min(Number(step.crafts || 0), maxCraftable));
            if (ready <= 0) continue;
            this.progressTracker.set({ running: true, state: 'PROMOTING_B3', currentStep: { kind: 'B3/B4', id: step.outputId, crafts: ready } });
            const crafted = await this.finalCraft.craft(recipe.recipeId, ready, context, step.outputId, { stage: 'B4', nextStage: 'B5' });
            if (Number(this.inventoryState.actualCrafts(crafted, ready) || 0) <= 0) continue;
            await this.runStep(context, { subsystem: 'crafting', step: 'deposit-b4-after-promotion', action: 'deposit fresh B4 intermediates to /pv 2 to keep one free slot', resource: step.outputId },
                () => this.flows.deposit.depositRemainders(this.childOptions(context)));
            done.push({ status: 'b4-compact-ready', outputId: step.outputId, recipeId: recipe.recipeId, ready, data: crafted });
        }
        return done;
    }

    surplusIds(targetRecipe, finalSteps) {
        const ids = Object.keys((targetRecipe && targetRecipe.recipe && targetRecipe.recipe.inputs) || {})
            .filter((id) => Number(targetRecipe.recipe.inputs[id]) > 0 && this.recipeResolver.recipeForOutput(id, finalSteps));
        if (typeof this.surplusOrder === 'function') {
            const order = this.surplusOrder(ids.slice(), targetRecipe, finalSteps);
            if (Array.isArray(order)) {
                const ranked = [...order, ...ids].filter((id, index, all) => ids.includes(id) && all.indexOf(id) === index);
                if (ranked.length === ids.length) return ranked;
            }
        }
        return ids;
    }

    availableCount(inspection, id) {
        // Availability source mirrors the owner of the observation: the planner's
        // nonStorageAvailable when present, otherwise the live inventory. Both are
        // the same physical view; the fallback keeps no-planner fixtures working.
        const nonStorage = inspection && inspection.data && inspection.data.nonStorageAvailable;
        if (nonStorage && typeof nonStorage === 'object' && Object.keys(nonStorage).length > 0) {
            return Math.max(0, Number(nonStorage[id] || 0));
        }
        return Math.max(0, Number(this.inventoryState.count(id) || 0));
    }

    surplusCandidate(outputId, inspection, targetRecipe) {
        const recipeEntry = this.recipeResolver.recipeForOutput(outputId, (inspection.data && inspection.data.finalSteps) || []);
        if (!recipeEntry || !recipeEntry.recipe) return null;
        const entries = Object.entries(recipeEntry.recipe.inputs || {}).filter((entry) => Number(entry[1]) > 0);
        if (entries.length === 0) return null;
        let craftableNow = Number.MAX_SAFE_INTEGER;
        for (const [id, perCraft] of entries) craftableNow = Math.min(craftableNow, Math.floor(this.availableCount(inspection, id) / Number(perCraft)));
        const perTarget = Math.max(0, Number(targetRecipe.recipe.inputs[outputId] || 0));
        const existing = this.availableCount(inspection, outputId);
        return {
            outputId, recipeId: recipeEntry.recipeId, perTarget, existing, craftableNow: Math.max(0, Number.isFinite(craftableNow) ? Math.floor(craftableNow) : 0),
            coverage: perTarget > 0 ? existing / perTarget : Number.POSITIVE_INFINITY
        };
    }

    async craftSurplus(candidate, crafts, phase, inspection, inspect, context, compacted) {
        this.progressTracker.set({ running: true, state: 'PROMOTING_B3', currentStep: { kind: 'B3/B4', id: candidate.outputId, crafts } });
        const crafted = await this.finalCraft.craft(candidate.recipeId, crafts, context, candidate.outputId, { stage: 'B4', nextStage: 'B5' });
        const actual = Number(this.inventoryState.actualCrafts(crafted, crafts) || 0);
        if (actual <= 0) return inspection;
        compacted.push({ outputId: candidate.outputId, recipeId: candidate.recipeId, crafts: actual, phase });
        return typeof inspect === 'function'
            ? this.requireInspection(await inspect(), 'B5 inspection failed after B4 compaction.')
            : inspection;
    }

    async fillSurplusShortage(outputId, inspection, inspect, context, targetRecipe, compacted, opts) {
        for (let guard = 0; guard < 128; guard += 1) {
            context.cancellation.token.throwIfCancelled();
            if (opts.stopAtTargetReady && this.recipeResolver.isTargetDirectlyReady(inspection.data, 1)) return inspection;
            const candidate = this.surplusCandidate(outputId, inspection, targetRecipe);
            if (!candidate || candidate.craftableNow <= 0) return inspection;
            const crafts = Math.floor(Math.min(candidate.craftableNow, Math.max(0, candidate.perTarget - candidate.existing)));
            if (crafts <= 0) return inspection;
            inspection = await this.craftSurplus(candidate, crafts, 'b5-priority', inspection, inspect, context, compacted);
        }
        return inspection;
    }

    async compactBalancedSurplus(b4Ids, initialInspection, context, targetRecipe, opts) {
        opts = opts || {};
        const inspect = typeof opts.inspect === 'function' ? opts.inspect : null;
        const compacted = [];
        let inspection = initialInspection;
        for (const outputId of b4Ids) {
            inspection = await this.fillSurplusShortage(outputId, inspection, inspect, context, targetRecipe, compacted, opts);
            if (opts.stopAtTargetReady && this.recipeResolver.isTargetDirectlyReady(inspection.data, 1)) return compacted;
        }
        for (let guard = 0; guard < 512; guard += 1) {
            context.cancellation.token.throwIfCancelled();
            if (opts.stopAtTargetReady && this.recipeResolver.isTargetDirectlyReady(inspection.data, 1)) break;
            const candidates = b4Ids
                .map((id) => this.surplusCandidate(id, inspection, targetRecipe))
                .filter((candidate) => candidate && candidate.craftableNow > 0 && candidate.perTarget > 0)
                .sort((a, b) => a.coverage - b.coverage || b.perTarget - a.perTarget || a.outputId.localeCompare(b.outputId));
            const candidate = candidates[0];
            if (!candidate) break;
            const crafts = Math.floor(Math.min(candidate.craftableNow, Math.max(1, Math.min(32, candidate.perTarget))));
            if (crafts <= 0) break;
            inspection = await this.craftSurplus(candidate, crafts, 'storage-compaction-balanced', inspection, inspect, context, compacted);
        }
        return compacted;
    }

    finalStepsInPolicyOrder(inspection, targetId) {
        const steps = [...(((inspection.data && inspection.data.finalSteps) || []))];
        if (typeof this.finalStepOrder === 'function') return this.finalStepOrder(steps, inspection, targetId) || steps;
        return steps;
    }

    async ensureFreeIntermediateSlots(chain, context, minFreeSlots, opts) {
        chain = CraftIntermediateCoordinator.normalize(chain);
        opts = opts || {};
        this.progressTracker.set({ running: true, state: 'FREEING_SPACE', currentStep: { kind: 'SPACE', id: chain.outputId } });
        let snapshot = this.inventoryState.spaceSnapshot();
        const state = { depositedB2Count: 0, emergencyParkedCurrentB2: false, attempts: 0, attemptedIds: new Set(), preserveAtLeastIntermediate: 0 };
        if (Number(snapshot.emptySlotCount || 0) >= Number(minFreeSlots || 0)) return this.spaceResult(snapshot, state);
        const preserve = opts.preserveAtLeastIntermediate !== undefined ? opts.preserveAtLeastIntermediate : (opts.preserveAtLeastB2 !== undefined ? opts.preserveAtLeastB2 : 0);
        state.preserveAtLeastIntermediate = Math.max(0, Number(preserve || 0));
        const prefer = opts.preferCurrentIntermediate !== undefined ? opts.preferCurrentIntermediate !== false
            : (opts.preferCurrentB2 !== undefined ? opts.preferCurrentB2 !== false : true);
        if (prefer) {
            snapshot = await this.emergencyParkOwned(chain, context, minFreeSlots, state.preserveAtLeastIntermediate, snapshot, state);
            if (Number(snapshot.emptySlotCount || 0) >= Number(minFreeSlots || 0)) return this.spaceResult(snapshot, state);
        }
        const targetId = opts.targetId || null;
        const candidates = this.spaceReleaseCandidates(chain, opts.allChains || [], { preserveAtLeastIntermediate: state.preserveAtLeastIntermediate, targetId });
        for (const id of candidates) {
            if (Number(snapshot.emptySlotCount || 0) >= Number(minFreeSlots || 0)) break;
            snapshot = await this.offloadCandidate(id, chain, context, minFreeSlots, state, state.preserveAtLeastIntermediate || 0);
            if (Number(snapshot.emptySlotCount || 0) >= Number(minFreeSlots || 0)) return this.spaceResult(snapshot, state);
        }
        if (Number(snapshot.emptySlotCount || 0) < Number(minFreeSlots || 0)) snapshot = await this.emergencyParkOwned(chain, context, minFreeSlots, state.preserveAtLeastIntermediate, snapshot, state, false);
        if (Number(snapshot.emptySlotCount || 0) < Number(minFreeSlots || 0)) this.throwNoSpace(chain, context, minFreeSlots, opts.reason || null, state.preserveAtLeastIntermediate, snapshot, state);
        return this.spaceResult(snapshot, state);
    }


    async emergencyParkOwned(chain, context, minFreeSlots, preserve, snapshot, state, requireStack = true) {
        const before = this.inventoryState.count(chain.intermediateId);
        if (before <= 0 || (requireStack && before < 64)) return snapshot;
        const parked = await this.runStep(context, { subsystem: 'crafting', step: 'deposit-current-b2', action: 'park one stack of current B2 in /pv 2 to free a slot', resource: chain.intermediateId,
            details: { before, preserveAtLeastIntermediate: preserve, preserveAtLeastB2: preserve, minFreeSlots, emptySlotCount: snapshot.emptySlotCount } },
            () => this.flows.deposit.deposit(chain.intermediateId, this.childOptions(context, { maxStacks: 1 })));
        if (parked && parked.success === false) return snapshot;
        const afterCount = this.inventoryState.count(chain.intermediateId);
        const movedFromDelta = Math.max(0, before - afterCount);
        const movedFromStacks = Math.max(0, Number((parked && parked.data && parked.data.movedStacks) || 0)) * 64;
        const moved = movedFromDelta || movedFromStacks;
        if (moved <= 0) return snapshot;
        state.depositedB2Count += moved;
        state.emergencyParkedCurrentB2 = true;
        return this.inventoryState.waitForFreeSlots(minFreeSlots, context.cancellation.token);
    }

    async offloadCandidate(logicalId, chain, context, minFreeSlots, state, preserveAtLeastIntermediate = 0) {
        context.cancellation.token.throwIfCancelled();
        if (!logicalId || state.attemptedIds.has(logicalId)) return this.inventoryState.spaceSnapshot();
        state.attemptedIds.add(logicalId);
        const before = this.inventoryState.count(logicalId);
        if (before <= 0 || (logicalId === chain.intermediateId && before - 64 < preserveAtLeastIntermediate)) return this.inventoryState.spaceSnapshot();
        state.attempts += 1;
        const result = await this.flows.deposit.deposit(logicalId, this.childOptions(context, { maxStacks: 1 }));
        if (result && result.success === false) return this.inventoryState.spaceSnapshot();
        const after = this.inventoryState.count(logicalId);
        if (logicalId === chain.intermediateId) state.depositedB2Count += Math.max(0, before - after);
        return this.inventoryState.waitForFreeSlots(minFreeSlots, context.cancellation.token);
    }
    spaceReleaseCandidates(chain, allChains, opts) {
        opts = opts || {};
        if (typeof this.spaceCandidateOrder === 'function') {
            const custom = this.spaceCandidateOrder(chain, allChains, opts);
            if (Array.isArray(custom)) return custom.filter((id) => String(id || '').trim());
        }
        const candidates = [];
        const push = (id) => { const v = String(id || '').trim(); if (v && !candidates.includes(v)) candidates.push(v); };
        const activeTarget = String(opts.targetId || '').trim() || null;
        const targetRecipe = activeTarget ? this.recipeResolver.recipeForOutput(activeTarget) : null;
        const inputs = (targetRecipe && targetRecipe.recipe && targetRecipe.recipe.inputs) || {};
        for (const id of Object.keys(inputs)) push(id);
        push(chain.outputId);
        for (const c of allChains || []) { const g = CraftIntermediateCoordinator.normalize(c); if (g.outputId !== chain.outputId) push(g.outputId); }
        for (const c of allChains || []) { const g = CraftIntermediateCoordinator.normalize(c); if (g.intermediateId !== chain.intermediateId) push(g.intermediateId); }
        if (this.inventoryState.count(chain.intermediateId) - 64 >= (opts.preserveAtLeastIntermediate || 0)) push(chain.intermediateId);
        return candidates;
    }

    throwNoSpace(chain, context, minFreeSlots, reason, preserve, snapshot, state) {
        throw new FlowError('Cannot reserve ' + minFreeSlots + ' empty inventory slot(s) for ' + chain.outputId + '.', {
            code: 'CRAFT_INTERMEDIATE_NO_SPACE', subsystem: 'crafting', step: 'free-intermediate-slot', action: reason || 'reserve inventory output slot',
            resource: chain.outputId, retryable: true, trace: context.trace,
            details: { minFreeSlots, emptySlotCount: snapshot.emptySlotCount, intermediateCount: this.inventoryState.count(chain.intermediateId), outputCount: this.inventoryState.count(chain.outputId),
                preserveAtLeastIntermediate: preserve, preserveAtLeastB2: preserve, attemptedIds: [...state.attemptedIds], attempts: state.attempts, emergencyParkedCurrentB2: state.emergencyParkedCurrentB2 }
        });
    }

    spaceResult(snapshot, state) {
        return { snapshot, depositedB2Count: state.depositedB2Count, emergencyParkedCurrentB2: state.emergencyParkedCurrentB2 };
    }

    requireInspection(result, message) {
        if (result && result.success === false) throw result.error || new Error(result.message || message);
        return result;
    }

    static normalize(chain) {
        const c = chain && typeof chain === 'object' ? chain : {};
        if (typeof c.intermediateId === 'string' && typeof c.outputId === 'string'
            && !('b2Id' in c) && !('b3Id' in c) && !('b2RecipeId' in c) && !('b3RecipeId' in c)) return c;
        return fromLegacyChain(c);
    }

}
// Legacy alias kept for Step 4 boundary parity only: same-shape compact entry
// point used by the legacy coordinator name.
CraftIntermediateCoordinator.prototype.compactReadyB4 = function (inspection, inspect, context, opts) {
    opts = opts || {};
    return this.compactReadyOutputs(inspection, context, { stopAtTargetReady: opts.stopAtTargetReady, targetId: opts.targetId || null, inspect });
};
module.exports = CraftIntermediateCoordinator;
