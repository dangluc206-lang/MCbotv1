'use strict';

const FlowError = require('../../../shared/errors/FlowError');
const Status = require('../../../shared/result/Status');
const CraftActionDiagnostics = require('../support/CraftActionDiagnostics');
const { fromLegacyChain } = require('../support/CraftChainAdapter');

class CraftCycleCoordinator {
    constructor({ flows, inventoryState, recipeResolver, progressTracker, intermediate, reserveChain, baseInventory, b1Inventory, finalCraft, recipeRegistry = null, quantity, config, logger = null, runStep, childOptions, status }) {
        Object.assign(this, { flows, inventoryState, recipeResolver, progressTracker, intermediate, reserveChain, finalCraft, recipeRegistry, quantity, config, logger, runStep, childOptions, status });
        this.baseInventory = baseInventory || b1Inventory;
        this.b1Inventory = this.baseInventory;
    }

    reconfigure(config = {}) {
        this.config = config || {};
        return this;
    }

    async execute(amount, context, options) {
        const inspect = this.#inspector(amount, context, options);
        const state = await this.#initialize(amount, context, options, inspect);
        if (state.earlyResult) return state.earlyResult;
        await this.#promoteInitial(state, inspect, context, options);
        await this.#processMaterials(state, inspect, context, options, amount);
        await this.#finalPromotion(state, inspect, context);
        const afterReserve = await this.runStep(context, {
            subsystem: 'crafting', step: 'inspect-after-reserve', action: 'recalculate B5 feasibility', resource: state.targetId
        }, inspect);
        state.afterReserve = afterReserve;
        this.progressTracker.sync(afterReserve.data, state.targetId, {
            state: this.recipeResolver.isTargetDirectlyReady(afterReserve.data, amount) ? 'TARGET_READY' : (afterReserve.data.fullPlan.feasible ? 'FINAL_READY' : 'WAITING_MATERIALS')
        });
        await this.#finishCycle(state, inspect, context, options, amount);
        return this.#result(state, options, amount);
    }

    #inspector(amount, context, { additional, freshInspection = false, targetId = null }) {
        return () => {
            const child = { additional, ...(targetId ? { targetId } : {}), ...this.childOptions(context) };
            return freshInspection && typeof this.flows.read.inspectFresh === 'function'
                ? this.flows.read.inspectFresh(amount, child)
                : this.flows.read.inspect(amount, child);
        };
    }

    async #initialize(amount, context, options, inspect) {
        const first = await this.runStep(context, {
            subsystem: 'crafting', step: 'inspect-initial', action: 'read /kho + /pv 2 + inventory', resource: options?.targetId || 'target'
        }, inspect);
        const targetId = first.data.fullPlan.targetId;
        const state = {
            first, workingInspection: first, afterReserve: null, actions: [], targetId,
            targetVaultBefore: Number(first.data.personalVault?.totals?.[targetId] || 0),
            chainCatalog: Array.isArray(first.data?.chains) ? first.data.chains : [],
            createNewB2: options.allowNewB2 === true && this.inventoryState.allowsNewIntermediates(first.data),
            completedTarget: false, targetCapacityBlocked: false, earlyResult: null
        };
        this.progressTracker.sync(first.data, targetId);
        const orphaned = Math.max(0, Number(first.data?.inventoryTotals?.[targetId] || 0));
        if (orphaned > 0) state.earlyResult = await this.#recoverExistingTarget(state, orphaned, amount, context, options);
        else if (options.recoveryOnly) state.earlyResult = this.#recoveryOnlyResult(state, amount, options);
        return state;
    }

    async #recoverExistingTarget(state, orphaned, amount, context, options) {
        const { targetId, targetVaultBefore, first, actions } = state;
        if (!this.inventoryState.vaultCanAccept(first.data?.personalVault, targetId, orphaned)) {
            actions.push({ status: 'waiting', reason: 'pv2-target-capacity', targetId, amount: orphaned });
            this.progressTracker.set({ running: false, state: 'WAITING_PV2_TARGET_CAPACITY', currentStep: { kind: 'DEPOSIT', id: targetId }, completedAmount: 0, stored: null });
            return this.#earlyResult(state, amount, options, { waitingForMaterials: true, recoveredExistingB5: false });
        }
        this.progressTracker.set({ running: true, state: 'RECOVERING_TARGET', currentStep: { kind: 'DEPOSIT', id: targetId } });
        await this.runStep(context, {
            subsystem: 'crafting', step: 'recover-existing-b5', action: 'deposit existing B5 before any new craft', resource: targetId,
            details: { orphanedTargetCount: orphaned, targetVaultBefore }
        }, () => this.flows.deposit.deposit(targetId, this.childOptions(context)));
        const inventoryAfter = await this.inventoryState.waitForAtMost(targetId, 0, context.cancellation.token);
        const vault = await this.runStep(context, {
            subsystem: 'crafting', step: 'verify-recovered-b5', action: 'verify recovered B5 in /pv 2', resource: targetId
        }, () => this.flows.read.readPv2(this.childOptions(context)));
        const targetVaultAfter = Number(vault.data?.totals?.[targetId] || 0);
        if (targetVaultAfter < targetVaultBefore + orphaned || inventoryAfter > 0) this.#throwRecovery(state, orphaned, targetVaultAfter, inventoryAfter, context);
        actions.push({ status: 'existing-b5-recovered', targetId, amount: orphaned, targetVaultBefore, targetVaultAfter });
        this.progressTracker.set({ running: false, state: 'RECOVERED_TARGET', currentStep: { kind: 'DONE', id: targetId }, completedAmount: 0, stored: 'PV2' });
        return this.#earlyResult(state, amount, options, { waitingForMaterials: false, recoveredExistingB5: true, recoveredAmount: orphaned });
    }

    #throwRecovery(state, orphaned, targetVaultAfter, inventoryAfter, context) {
        throw new FlowError('Existing B5 recovery could not be verified.', {
            code: 'CRAFT_RECOVERY_VERIFICATION_FAILED', subsystem: 'crafting', operation: 'CraftingAutomation', step: 'verify-recovered-b5',
            action: 'verify inventory and /pv 2 deltas', resource: state.targetId, retryable: true, trace: context.trace,
            details: { orphanedTargetCount: orphaned, targetVaultBefore: state.targetVaultBefore, targetVaultAfter, targetInventoryAfter: inventoryAfter }
        });
    }

    #earlyResult(state, amount, options, extra) {
        return { amount, additional: options.additional, mode: options.mode, craftFinalTarget: options.craftFinalTarget, allowNewB2: false, actions: state.actions,
            complete: false, completedTarget: false, completedAmount: 0, targetId: state.targetId, plan: null,
            pv2Backpressure: state.first.data?.personalVaultPressure || null, progress: this.status(), ...extra };
    }

    #recoveryOnlyResult(state, amount, options) {
        return this.#earlyResult(state, amount, { ...options, craftFinalTarget: false }, {
            recoveredExistingB5: false, recoveryOnly: true, waitingForMaterials: true, productive: false
        });
    }

    async #promoteInitial(state, inspect, context, options) {
        const promotion = await this.runStep(context, {
            subsystem: 'crafting', step: 'promote-owned-intermediates', action: 'prioritize B5/B4 and compress owned B2/B3 before creating more B2', resource: state.targetId
        }, () => this.intermediate.promoteOwned(state.first, inspect, context));
        if (promotion?.actions?.length) state.actions.push(...promotion.actions);
        if (promotion?.inspection?.success) state.workingInspection = promotion.inspection;
        state.createNewB2 = options.allowNewB2 === true && this.inventoryState.allowsNewIntermediates(state.workingInspection.data);
        this.progressTracker.sync(state.workingInspection.data, state.targetId);
    }

    async #processMaterials(state, inspect, context, options, amount) {
        const chainOrder = [...(state.workingInspection.data?.chains || [])].map(chain => CraftCycleCoordinator.normalize(chain).outputId);
        for (const chainId of chainOrder) {
            context.cancellation.token.throwIfCancelled();
            if (this.recipeResolver.isTargetDirectlyReady(state.workingInspection.data, amount)) break;
            const outcome = await this.#processMaterial(chainId, state, inspect, context, options, amount);
            if (outcome === 'break') break;
        }
    }

    async #processMaterial(chainId, state, inspect, context, options, amount) {
        const chain = (state.workingInspection.data?.chains || []).map(candidate => CraftCycleCoordinator.normalize(candidate)).find(candidate => candidate.outputId === chainId);
        if (!chain) return 'continue';
        state.createNewB2 = options.allowNewB2 === true && this.inventoryState.allowsNewIntermediates(state.workingInspection.data);
        const plan = this.planChain(chain);
        let reserveChain = chain;
        if (plan.plannedIntermediateExact > 0) {
            const preparation = await this.#prepareB1(chain, plan, state, context, options);
            if (preparation.outcome) return preparation.outcome;
            reserveChain = preparation.reserveChain;
        }
        if (plan.plannedIntermediate <= 0 && plan.plannedOutput <= 0) return 'continue';
        const reserveResult = await this.#executeReserve(chain, reserveChain, plan, state, context);
        await this.#finalizeMaterial(chain, reserveResult, state, inspect, context, options);
        if (reserveResult?.waitingForMaterial || this.recipeResolver.isTargetDirectlyReady(state.workingInspection.data, amount)) return 'break';
        return 'continue';
    }

    async #prepareB1(chain, plan, state, context, options) {
        const { plannedIntermediateExact, plannedIntermediate, intermediateBatchSize, useAllForIntermediate, basePerIntermediate, requiredRawForStart, totalEffective, totalIntermediateCrafts } = plan;
        const storageKnown = Number.isFinite(totalEffective) && totalEffective >= 0 && basePerIntermediate > 0;
        if (plannedIntermediate <= 0) {
            state.actions.push({ baseId: chain.baseId, status: 'waiting', reason: useAllForIntermediate ? 'waiting-for-any-b2-input' : 'waiting-for-complete-b2-batch',
                plannedIntermediateExact, intermediateBatchSize, basePerIntermediate, storedEffective: storageKnown ? totalEffective : null, availableIntermediateCrafts: totalIntermediateCrafts });
            return { outcome: 'continue' };
        }
        const reserveChain = { ...chain, intermediateCrafts: plannedIntermediate, baseNeededFromStorage: requiredRawForStart,
            partialReservePass: useAllForIntermediate || plannedIntermediate < plannedIntermediateExact, useAllForIntermediate };
        if (!state.createNewB2) {
            state.actions.push({ baseId: chain.baseId, status: 'new-b2-suppressed', reason: options.allowNewB2 === true ? 'pv2-backpressure' : 'maintenance-policy',
                plannedIntermediate, pv2: state.workingInspection.data?.personalVaultPressure || null });
            return { outcome: 'continue' };
        }
        this.progressTracker.set({ running: true, state: 'PREPARING_B1', currentStep: { kind: 'PREPARE_B1', id: chain.baseId, intermediateId: chain.intermediateId, required: requiredRawForStart, blocked: plan.decompressionBlocked } });
        const prepared = await this.runStep(context, {
            subsystem: 'crafting', step: 'prepare-b1', action: useAllForIntermediate ? 'ensure B1 is ready for guarded B2 ALL' : 'ensure enough B1 for complete B2 batches', resource: chain.baseId,
            details: { required: requiredRawForStart, plannedIntermediateExact, plannedIntermediate, intermediateBatchSize, basePerIntermediate, useAllForIntermediate, storedEffective: storageKnown ? totalEffective : null, availableIntermediateCrafts: totalIntermediateCrafts, intermediateRecipeId: chain.intermediateRecipeId }
        }, () => this.flows.storage.prepareBase(chain.baseId, requiredRawForStart, this.childOptions(context, {
            decompressionPolicy: options.decompressionPolicy, decompressionMaxRatioOverride: options.decompressionMaxUsageRatio,
            requireKnownCapacityOverride: options.requireKnownCapacity
        })), { acceptFailedResult: true });
        const decision = this.#preparedDecision(chain, plan, state, prepared, reserveChain);
        return decision;
    }

    #preparedDecision(chain, plan, state, prepared, reserveChain) {
        if (prepared?.success === false) {
            if (prepared.status === Status.NOT_READY) {
                state.actions.push({ baseId: chain.baseId, status: 'waiting', reason: 'b1-not-ready', message: prepared.message, data: prepared.meta || null });
                return { outcome: 'continue' };
            }
            throw FlowError.fromResult(prepared, { subsystem: 'crafting', operation: 'CraftingAutomation', step: 'prepare-b1',
                action: plan.useAllForIntermediate ? 'ensure B1 is ready for guarded B2 ALL' : 'ensure enough B1 for complete B2 batches', resource: chain.baseId,
                details: { required: plan.requiredRawForStart, plannedIntermediateExact: plan.plannedIntermediateExact, plannedIntermediate: plan.plannedIntermediate, intermediateBatchSize: plan.intermediateBatchSize, basePerIntermediate: plan.basePerIntermediate, useAllForIntermediate: plan.useAllForIntermediate } });
        }
        if (prepared.data?.ready === false) {
            const reason = prepared.data.reason || 'base-form-unavailable';
            state.actions.push({ baseId: chain.baseId, status: 'waiting', reason, data: prepared.data });
            this.logger?.info?.('B5 B1 PREP WAIT.', { operation: 'CraftingAutomation', step: 'prepare-b1', resource: chain.baseId, reason,
                required: plan.requiredRawForStart, available: prepared.data.available ?? null, blocks: prepared.data.blocks ?? null, expansion: prepared.data.expansion || null });
            return { outcome: 'continue' };
        }
        const preparedLoose = Number(prepared.data?.available);
        const next = Number.isFinite(preparedLoose) && preparedLoose >= 0 ? { ...reserveChain,
            reconciliationBaseline: { inputs: { [chain.baseId]: { source: 'storage', count: preparedLoose } } } } : reserveChain;
        state.actions.push({ baseId: chain.baseId, status: 'base-ready', data: prepared.data });
        return { reserveChain: next };
    }

    async #executeReserve(chain, reserveChain, plan, state, context) {
        const stages = (plan.plannedIntermediate > 0 ? 1 : 0) + (plan.plannedOutput > 0 ? 1 : 0);
        this.progressTracker.set({ running: true, state: 'CRAFTING_INTERMEDIATE', currentStep: {
            kind: plan.plannedIntermediate > 0 ? 'B2/B3' : 'B3', id: chain.outputId, intermediateCrafts: plan.plannedIntermediate, outputCrafts: plan.plannedOutput
        } });
        const result = await this.runStep(context, {
            subsystem: 'crafting', step: 'reserve-b3-chain', action: 'craft B2/B3 then immediately promote upward', resource: chain.baseId,
            details: { intermediateId: chain.intermediateId, outputId: chain.outputId, intermediateCrafts: plan.plannedIntermediate, outputCrafts: plan.plannedOutput }
        }, () => this.reserveChain.prepare(reserveChain, context, { deferIntermediateDeposit: true, allChains: state.workingInspection.data?.chains || state.chainCatalog, targetId: state.targetId }));
        state.actions.push({ baseId: chain.baseId, status: result?.waitingForMaterial ? 'waiting-current-material'
            : (result?.deferredForSpace ? 'deferred-for-space' : (result?.deferredForFreshReplan ? 'deferred-for-fresh-replan' : 'reserved')),
            outputId: chain.outputId, outputCrafts: plan.plannedOutput, data: result || null });
        this.progressTracker.advance(stages);
        return result;
    }

    async #finalizeMaterial(chain, reserveResult, state, inspect, context, options) {
        const returned = await this.runStep(context, {
            subsystem: 'crafting', step: 'return-b1-after-reserve', action: 'deposit B1 remainder to /kho before block compaction', resource: chain.baseId
        }, () => this.b1Inventory.returnToStorage(chain, context));
        state.actions.push({ baseId: chain.baseId, status: 'b1-returned-before-compaction', data: returned });
        this.progressTracker.set({ running: true, state: 'COMPACTING', currentStep: { kind: 'CONVERT_BLOCKS', id: chain.baseId } });
        const compacted = await this.runStep(context, {
            subsystem: 'crafting', step: 'compact-b1-after-reserve', action: 'finalize current B1 transaction and convert loose B1 back to block', resource: chain.baseId
        }, () => typeof this.flows.storage.finalizeBase === 'function' ? this.flows.storage.finalizeBase(chain.baseId, this.childOptions(context)) : this.flows.storage.compact(chain.baseId, this.childOptions(context)));
        state.actions.push({ baseId: chain.baseId, status: 'compacted-after-b3', data: compacted.data });
        const refreshed = await this.runStep(context, { subsystem: 'crafting', step: 'inspect-after-reserve-chain', action: 'refresh after B2/B3 mutation', resource: chain.outputId }, inspect);
        const higher = await this.runStep(context, { subsystem: 'crafting', step: 'promote-after-reserve-chain', action: 'compress all possible B2->B3->B4 after this material', resource: chain.outputId },
            () => this.intermediate.promoteOwned(refreshed, inspect, context));
        if (higher?.actions?.length) state.actions.push(...higher.actions);
        state.workingInspection = higher?.inspection?.success ? higher.inspection : refreshed;
        state.createNewB2 = options.allowNewB2 === true && this.inventoryState.allowsNewIntermediates(state.workingInspection.data);
        this.progressTracker.sync(state.workingInspection.data, state.targetId);
    }

    async #finalPromotion(state, inspect, context) {
        const promotion = await this.runStep(context, { subsystem: 'crafting', step: 'final-intermediate-promotion', action: 'final B5>B4>B3>B2 compaction sweep', resource: state.targetId },
            () => this.intermediate.promoteOwned(state.workingInspection, inspect, context));
        if (promotion?.actions?.length) state.actions.push(...promotion.actions);
        if (promotion?.inspection?.success) state.workingInspection = promotion.inspection;
    }

    async #finishCycle(state, inspect, context, options, amount) {
        const data = state.afterReserve.data;
        const capacity = this.inventoryState.vaultCanAccept(data?.personalVault, state.targetId, amount);
        const feasible = data.fullPlan.feasible || this.recipeResolver.isTargetDirectlyReady(data, amount);
        state.targetCapacityBlocked = options.craftFinalTarget && !capacity && feasible;
        if (state.targetCapacityBlocked) {
            state.actions.push({ status: 'waiting', reason: 'pv2-target-capacity', targetId: state.targetId, amount });
            this.progressTracker.set({ running: false, state: 'WAITING_PV2_TARGET_CAPACITY', currentStep: { kind: 'DEPOSIT', id: state.targetId } });
        }
        if (options.craftFinalTarget && capacity && feasible) {
            await this.#craftAndStoreTarget(state, inspect, context, amount);
        } else {
            await this.#finishWithoutTarget(state, context, options);
        }
    }

    async #craftAndStoreTarget(state, inspect, context, amount) {
        const { targetId, targetVaultBefore } = state;
        let finalSteps = state.afterReserve.data.finalSteps || [];
        if (this.recipeResolver.isTargetDirectlyReady(state.afterReserve.data, amount)) {
            const targetRecipe = this.recipeResolver.recipeForOutput(targetId, finalSteps);
            if (!targetRecipe) throw new FlowError(`B5 recipe not found for ${targetId}.`, {
                code: 'CRAFT_TARGET_RECIPE_NOT_FOUND', subsystem: 'crafting', step: 'craft-final-chain', action: 'resolve B5 recipe', resource: targetId, trace: context.trace
            });
            finalSteps = [{ recipeId: targetRecipe.recipeId, outputId: targetId, crafts: amount }];
        }
        try {
            await this.runStep(context, { subsystem: 'crafting', step: 'craft-final-chain', action: 'craft highest-priority B4/B5 final steps', resource: targetId,
                details: { steps: finalSteps, targetId, targetVaultBefore } }, () => this.finalCraft.execute(finalSteps, context, { targetId }));
        } catch (error) {
            throw FlowError.wrap(error, { details: { completionContext: { finalChain: true, targetId, targetVaultBefore } } });
        }
        const targetVaultAfter = await this.#depositAndVerifyTarget(state, context, amount);
        state.completedTarget = true;
        state.actions.push({ status: 'final-crafted-and-deposited', targetId, amount, targetVaultBefore, targetVaultAfter });
        await this.#postB5(state, inspect, context, amount);
    }

    async #depositAndVerifyTarget(state, context, amount) {
        const { targetId, targetVaultBefore } = state;
        this.progressTracker.set({ running: true, state: 'DEPOSITING', currentStep: { kind: 'DEPOSIT', id: targetId } });
        await this.runStep(context, { subsystem: 'crafting', step: 'deposit-b5', action: 'deposit final B5 to /pv 2', resource: targetId },
            () => this.flows.deposit.deposit(targetId, this.childOptions(context)));
        this.progressTracker.advance(1);
        this.progressTracker.set({ running: true, state: 'VERIFYING', currentStep: { kind: 'VERIFY', id: targetId } });
        const vault = await this.runStep(context, { subsystem: 'crafting', step: 'verify-b5-deposit', action: 'read /pv 2 after deposit', resource: targetId },
            () => this.flows.read.readPv2(this.childOptions(context)));
        const after = Number(vault.data?.totals?.[targetId] || 0);
        if (after < targetVaultBefore + amount) throw new FlowError(`B5 deposit verification failed: expected at least ${targetVaultBefore + amount}, got ${after}.`, {
            code: 'CRAFT_DEPOSIT_VERIFICATION_FAILED', subsystem: 'crafting', operation: 'CraftingAutomation', step: 'verify-b5-deposit', action: 'compare /pv 2 total', resource: targetId,
            retryable: true, details: { targetVaultBefore, targetVaultAfter: after, amount }, trace: context.trace
        });
        this.progressTracker.advance(1);
        this.progressTracker.set({ running: true, state: 'POST_PROCESSING', currentStep: { kind: 'STORE', id: targetId }, remainingStages: 0, remainingCrafts: 0, completedAmount: amount, stored: 'PV2' });
        return after;
    }

    async #postB5(state, inspect, context, amount) {
        let data = state.afterReserve.data;
        if (state.chainCatalog.length > 0) {
            const post = await this.runStep(context, { subsystem: 'crafting', step: 'inspect-post-b5', action: 'refresh lower tiers after B5 consumption', resource: 'B2-B4' }, inspect);
            this.progressTracker.set({ running: true, state: 'COMPACTING', currentStep: { kind: 'CONVERT_BLOCKS', id: 'B2-B4' } });
            const promotion = await this.runStep(context, { subsystem: 'crafting', step: 'post-b5-compaction', action: 'compress leftover B2/B3 into B3/B4 for next cycle', resource: 'B2-B4' },
                () => this.intermediate.promoteOwned(post, inspect, context, { stopAtTargetReady: false }));
            if (promotion?.actions?.length) state.actions.push(...promotion.actions);
            data = promotion?.inspection?.data || post.data;
        }
        await this.intermediate.depositRemainders({ ...data, chains: state.chainCatalog.length > 0 ? state.chainCatalog : (data?.chains || []) }, context, state.actions);
        this.progressTracker.set({ running: true, state: 'COMPACTING', currentStep: { kind: 'CONVERT_BLOCKS', id: 'B1' } });
        const compacted = await this.runStep(context, { subsystem: 'crafting', step: 'compact-all-b1', action: 'convert remaining B1 to blocks', resource: 'B1' },
            () => this.flows.storage.compactAll(this.childOptions(context)));
        state.actions.push({ status: 'all-b1-compacted', data: compacted.data });
        this.progressTracker.set({ running: false, state: 'SUCCESS', currentStep: { kind: 'DONE', id: state.targetId }, remainingStages: 0, remainingCrafts: 0, completedAmount: amount, stored: 'PV2' });
    }

    async #finishWithoutTarget(state, context, options) {
        const data = state.afterReserve.data;
        if (!state.targetCapacityBlocked) await this.intermediate.depositRemainders({ ...data, chains: state.chainCatalog.length > 0 ? state.chainCatalog : (data?.chains || []) }, context, state.actions);
        if (options.mode === 'maintenance') {
            this.progressTracker.set({ running: true, state: 'COMPACTING', currentStep: { kind: 'CONVERT_BLOCKS', id: 'B1' } });
            const compacted = await this.runStep(context, { subsystem: 'crafting', step: 'maintenance-compact-b1', action: 'compact B1 during storage maintenance', resource: 'B1' },
                () => this.flows.storage.compactAll(this.childOptions(context)));
            state.actions.push({ status: 'maintenance-b1-compacted', data: compacted.data });
            this.progressTracker.set({ running: false, state: 'MAINTENANCE_COMPLETE', currentStep: { kind: 'DONE', id: 'STORAGE' },
                remainingStages: Number(data?.progress?.remainingStages || 0), remainingCrafts: Number(data?.progress?.remainingCrafts || 0) });
        } else if (!state.targetCapacityBlocked) {
            this.progressTracker.set({ running: false, state: 'WAITING_MATERIALS', currentStep: data?.progress?.nextStep || null,
                remainingStages: Number(data?.progress?.remainingStages || 0), remainingCrafts: Number(data?.progress?.remainingCrafts || 0) });
        }
    }

    #result(state, options, amount) {
        const blockingReasons = CraftActionDiagnostics.blockingReasons(state.actions);
        const productive = state.completedTarget || state.actions.some(action => CraftActionDiagnostics.isProductiveAction(action));
        return {
            amount, additional: options.additional, mode: options.mode, craftFinalTarget: options.craftFinalTarget, allowNewB2: state.createNewB2, actions: state.actions,
            complete: state.completedTarget, completedTarget: state.completedTarget, completedAmount: state.completedTarget ? amount : 0, targetId: state.targetId,
            plan: null,
            targetReady: this.recipeResolver.isTargetDirectlyReady(state.afterReserve.data, amount),
            pv2Backpressure: state.afterReserve.data?.personalVaultPressure || state.first.data?.personalVaultPressure || null,
            waitingForMaterials: !state.completedTarget && blockingReasons.length > 0, productive, blockingReasons,
            actionSummary: CraftActionDiagnostics.summarizeActions(state.actions), progress: this.status()
        };
    }

    planChain(chain) {
        chain = CraftCycleCoordinator.normalize(chain);
        const recipe = typeof this.recipeRegistry?.require === 'function' ? this.recipeRegistry.require(chain.intermediateRecipeId) : null;
        const basePerIntermediate = Math.max(0, Number((recipe && recipe.inputs && recipe.inputs[chain.baseId]) || 0));
        return this.quantity.planChain({
            plannedIntermediateExact: chain.intermediateCrafts,
            plannedOutput: chain.outputCrafts,
            basePerIntermediate,
            immediatelyCraftable: chain.storedEffective,
            totalEffective: chain.storedTotalEffective,
            baseNeededFromStorage: chain.baseNeededFromStorage
        });
    }

    static normalize(chain) {
        const c = chain && typeof chain === 'object' ? chain : {};
        if (typeof c.intermediateId === 'string' && typeof c.outputId === 'string'
            && !('b2Id' in c) && !('b3Id' in c) && !('b2RecipeId' in c) && !('b3RecipeId' in c)) return c;
        return fromLegacyChain(c);
    }
}

module.exports = CraftCycleCoordinator;

