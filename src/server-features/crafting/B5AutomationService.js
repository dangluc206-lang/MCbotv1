'use strict';

const Operation = require('../../operations/Operation');
const FlowError = require('../../shared/errors/FlowError');
const Status = require('../../shared/result/Status');
const Timeout = require('../../shared/time/Timeout');

class B5AutomationService {
    constructor({
        planningService,
        crafting,
        personalVault,
        storage,
        b1Materials,
        inventoryReader,
        inventoryCounter,
        recipeRegistry,
        operationManager,
        config,
        logger = null
    }) {
        Object.assign(this, {
            planningService,
            crafting,
            personalVault,
            storage,
            b1Materials,
            inventoryReader,
            inventoryCounter,
            recipeRegistry,
            operationManager,
            config,
            logger
        });
        this.liveProgress = Object.freeze({
            running: false,
            state: 'IDLE',
            currentStep: null,
            remainingStages: null,
            remainingCrafts: null,
            updatedAt: null
        });
        this.lastActivityLogKey = null;
    }

    status() {
        return this.liveProgress;
    }

    run(amount = 1, { cancellationToken = null } = {}) {
        return this.#runOperation(amount, { additional: false, cancellationToken, mode: 'production', allowFinalB5: true, allowNewB2: true });
    }

    runNext({ cancellationToken = null } = {}) {
        return this.#runOperation(1, { additional: true, cancellationToken, mode: 'production', allowFinalB5: true, allowNewB2: true });
    }

    runMaintenance({ cancellationToken = null, allowNewB2 = false } = {}) {
        return this.#runOperation(1, {
            additional: true, cancellationToken, mode: 'maintenance', allowFinalB5: false, allowNewB2: allowNewB2 === true
        });
    }

    async #runOperation(amount, { additional, cancellationToken, mode = 'production', allowFinalB5 = true, allowNewB2 = true }) {
        const operationName = mode === 'maintenance' ? 'B5StorageMaintenance' : (additional ? 'B5AutomationNext' : 'B5Automation');
        const operation = new Operation({
            name: operationName,
            lockKeys: ['gui', 'server-command', 'inventory', 'crafting', 'storage'],
            execute: context => this.#execute(amount, context, { additional, mode, allowFinalB5, allowNewB2 })
        });
        const result = await this.operationManager.run(operation, {
            timeoutMs: this.config.timeoutMs,
            metadata: { operation: operationName, target: 'super_alloy', amount, additional, mode, allowFinalB5, allowNewB2 },
            cancellationToken
        });
        if (result?.success === false) {
            this.#setLiveProgress({
                running: false,
                state: result?.status === 'CANCELLED' ? 'CANCELLED' : 'ERROR',
                currentStep: result?.meta?.step || this.liveProgress.currentStep,
                lastError: result?.message || result?.error?.message || 'B5 automation failed'
            });
        }
        return result;
    }

    async #execute(amount, context, { additional, mode = 'production', allowFinalB5 = true, allowNewB2 = true }) {
        const inspect = () => additional
            ? this.planningService.inspectAdditional(amount)
            : this.planningService.inspect(amount);

        const first = await this.#runStep(context, {
            subsystem: 'b5', step: 'inspect-initial', action: 'read /kho + /pv 2 + inventory', resource: 'super_alloy'
        }, inspect);
        const actions = [];
        const targetId = first.data.fullPlan.targetId;
        const targetVaultBefore = Number(first.data.personalVault?.totals?.[targetId] || 0);
        const vaultAllowsNewIntermediates = first.data?.personalVaultPressure?.allowNewIntermediates !== false;
        const createNewB2 = allowNewB2 === true && vaultAllowsNewIntermediates;
        const chainCatalog = Array.isArray(first.data?.chains) ? first.data.chains : [];
        let workingInspection = first;
        this.#syncLiveProgress(first.data, targetId);

        // Global priority policy:
        //   B5 > B4 > B3 > B2.
        // Existing B2/B3 are storage pressure, not a checkpoint. Before making
        // any new B2 from /kho, promote everything already owned as high as the
        // current recipes allow. Any B4 type that can be made is made immediately.
        const initialPromotion = await this.#runStep(context, {
            subsystem: 'b5',
            step: 'promote-owned-intermediates',
            action: 'prioritize B5/B4 and compress owned B2/B3 before creating more B2',
            resource: targetId
        }, () => this.#promoteOwnedIntermediates(first, inspect, context));
        if (initialPromotion?.actions?.length) actions.push(...initialPromotion.actions);
        if (initialPromotion?.inspection?.success) workingInspection = initialPromotion.inspection;
        this.#syncLiveProgress(workingInspection.data, targetId);

        // Only create more B2 from B1 when the higher-tier inventory cannot
        // advance further. Re-inspect before every material because an earlier
        // B4 craft may have consumed shared B3 and changed the optimal plan.
        const chainOrder = (workingInspection.data?.chains || []).map(chain => chain.b3Id);
        for (const chainId of chainOrder) {
            context.cancellation.token.throwIfCancelled();
            if (this.#isB5DirectlyReady(workingInspection.data, amount)) break;

            const currentChain = (workingInspection.data?.chains || []).find(candidate => candidate.b3Id === chainId);
            if (!currentChain) continue;

            const plannedB2Exact = Math.max(0, Number(currentChain.b2Crafts || 0));
            const plannedB3 = Math.max(0, Number(currentChain.b3Crafts || 0));
            const b2BatchSize = Math.max(1, Number(this.config?.quantityOptimization?.b2BatchSize || 64));
            const useAllForB2 = this.#allEnabled('useAllForB2');

            // B1 -> B2 quantity is a transport strategy, not a planner target.
            // With storage safety enabled, ALL is allowed for the material the
            // planner selected. It may intentionally create B2 beyond the exact
            // current shortage; B2 -> B3 ALL immediately compresses that stock
            // and any irreducible higher-tier surplus is kept in PV2.
            let plannedB2 = 0;
            let reserveChain = currentChain;
            if (plannedB2Exact > 0) {
                const b2Recipe = this.recipeRegistry.require(currentChain.b2RecipeId);
                const basePerB2 = Math.max(0, Number(b2Recipe?.inputs?.[currentChain.baseId] || 0));
                const storedEffective = Number(currentChain.storedEffective);
                const storageKnown = Number.isFinite(storedEffective) && storedEffective >= 0 && basePerB2 > 0;
                const availableB2Crafts = storageKnown ? Math.floor(storedEffective / basePerB2) : null;

                if (useAllForB2) {
                    // We only need proof that one B2 craft can start. The server's
                    // ALL quantity determines how many B2 are actually produced
                    // from the currently available B1 and inventory capacity.
                    plannedB2 = storageKnown && availableB2Crafts < 1 ? 0 : plannedB2Exact;
                } else {
                    const roundedNeed = Math.ceil(plannedB2Exact / b2BatchSize) * b2BatchSize;
                    const availableFullBatches = storageKnown
                        ? Math.floor(availableB2Crafts / b2BatchSize) * b2BatchSize
                        : roundedNeed;
                    plannedB2 = Math.max(0, Math.min(roundedNeed, availableFullBatches));
                }

                if (plannedB2 > 0) {
                    const requiredRawForStart = basePerB2 > 0
                        ? (useAllForB2 ? basePerB2 : plannedB2 * basePerB2)
                        : Math.max(0, Number(currentChain.rawNeededFromStorage || 0));
                    reserveChain = {
                        ...currentChain,
                        b2Crafts: plannedB2,
                        rawNeededFromStorage: requiredRawForStart,
                        partialReservePass: useAllForB2 || plannedB2 < plannedB2Exact,
                        useAllForB2
                    };

                    if (!createNewB2) {
                        actions.push({
                            baseId: currentChain.baseId,
                            status: 'new-b2-suppressed',
                            reason: vaultAllowsNewIntermediates ? 'maintenance-policy' : 'pv2-backpressure',
                            plannedB2,
                            pv2: first.data?.personalVaultPressure || null
                        });
                        continue;
                    }

                    if (useAllForB2 && typeof this.b1Materials?.inspectStoragePressure === 'function') {
                        const safety = await this.#runStep(context, {
                            subsystem: 'b5', step: 'guard-b1-b2-all',
                            action: 'verify /kho safety before B1->B2 ALL', resource: currentChain.baseId
                        }, () => this.b1Materials.inspectStoragePressure({ cancellationToken: context.cancellation.token }));
                        if (safety.data?.known !== true || safety.data?.protectionRequired === true) {
                            actions.push({ baseId: currentChain.baseId, status: 'waiting', reason: 'storage-not-safe-for-b1-all', pressure: safety.data || null });
                            continue;
                        }
                    }

                    const prepared = await this.#runStep(context, {
                        subsystem: 'b5', step: 'prepare-b1',
                        action: useAllForB2 ? 'ensure B1 is ready for guarded B2 ALL' : 'ensure enough B1 for complete B2 batches',
                        resource: currentChain.baseId,
                        details: { required: requiredRawForStart, plannedB2Exact, plannedB2, b2BatchSize, basePerB2, useAllForB2, storedEffective: storageKnown ? storedEffective : null, availableB2Crafts, b2RecipeId: currentChain.b2RecipeId }
                    }, () => this.b1Materials.ensureBaseAvailable(
                        currentChain.baseId,
                        requiredRawForStart,
                        { cancellationToken: context.cancellation.token }
                    ), { acceptFailedResult: true });
                    if (prepared?.success === false) {
                        // /kho is fed continuously and may change between the plan
                        // snapshot and execution. A transient material shortage is
                        // a normal WAIT state, not an automation error/recovery
                        // event. Re-plan on the normal material polling cadence.
                        if (prepared.status === Status.NOT_READY) {
                            actions.push({
                                baseId: currentChain.baseId,
                                status: 'waiting',
                                reason: 'b1-not-ready',
                                message: prepared.message,
                                data: prepared.meta || null
                            });
                            continue;
                        }
                        throw FlowError.fromResult(prepared, {
                            subsystem: 'b5', operation: 'B5Automation', step: 'prepare-b1',
                            action: useAllForB2 ? 'ensure B1 is ready for guarded B2 ALL' : 'ensure enough B1 for complete B2 batches',
                            resource: currentChain.baseId,
                            details: { required: requiredRawForStart, plannedB2Exact, plannedB2, b2BatchSize, basePerB2, useAllForB2 }
                        });
                    }
                    if (prepared.data?.ready === false) {
                        actions.push({ baseId: currentChain.baseId, status: 'waiting', reason: prepared.data.reason || 'base-form-unavailable', data: prepared.data });
                        continue;
                    }
                    actions.push({ baseId: currentChain.baseId, status: 'base-ready', data: prepared.data });
                } else {
                    actions.push({
                        baseId: currentChain.baseId,
                        status: 'waiting',
                        reason: useAllForB2 ? 'waiting-for-any-b2-input' : 'waiting-for-complete-b2-batch',
                        plannedB2Exact,
                        b2BatchSize,
                        basePerB2,
                        storedEffective: storageKnown ? storedEffective : null,
                        availableB2Crafts
                    });
                    continue;
                }
            }

            if (plannedB2 <= 0 && plannedB3 <= 0) continue;

            const reserveStageCount = (plannedB2 > 0 ? 1 : 0) + (plannedB3 > 0 ? 1 : 0);
            this.#setLiveProgress({
                running: true,
                state: 'CRAFTING_INTERMEDIATE',
                currentStep: {
                    kind: plannedB2 > 0 ? 'B2/B3' : 'B3',
                    id: currentChain.b3Id,
                    b2Crafts: plannedB2,
                    b3Crafts: plannedB3
                }
            });
            const reserveResult = await this.#runStep(context, {
                subsystem: 'b5',
                step: 'reserve-b3-chain',
                action: 'craft B2/B3 then immediately promote upward',
                resource: currentChain.baseId,
                details: { b2Id: currentChain.b2Id, b3Id: currentChain.b3Id, b2Crafts: plannedB2, b3Crafts: plannedB3 }
            }, () => this.#prepareB3Chain(reserveChain, context, {
                deferIntermediateDeposit: true,
                allChains: workingInspection.data?.chains || chainCatalog
            }));
            actions.push({
                baseId: currentChain.baseId,
                status: reserveResult?.deferredForSpace ? 'deferred-for-space' : 'reserved',
                b3Id: currentChain.b3Id,
                b3Crafts: plannedB3,
                data: reserveResult || null
            });
            this.#advanceLiveProgress(reserveStageCount);

            // Once one B3 material chain is finished, immediately put the
            // remaining loose B1 of that same resource back into block form.
            // This is storage maintenance, not an end-of-cycle cleanup.
            this.#setLiveProgress({
                running: true,
                state: 'COMPACTING',
                currentStep: { kind: 'CONVERT_BLOCKS', id: currentChain.baseId }
            });
            const compactedB1 = await this.#runStep(context, {
                subsystem: 'b5',
                step: 'compact-b1-after-reserve',
                action: 'convert loose B1 back to block after this B3 material',
                resource: currentChain.baseId
            }, () => this.b1Materials.compact(currentChain.baseId, { cancellationToken: context.cancellation.token }));
            actions.push({ baseId: currentChain.baseId, status: 'compacted-after-b3', data: compactedB1.data });

            // Selling is capacity protection only. If /kho is near full, sell
            // the currently-largest compacted B1 type, then re-check capacity.
            // Never wait for B5 completion before protecting storage.
            await this.#relieveStoragePressureIfNeeded(context, actions, currentChain.baseId);

            // Mutation happened: refresh once, then immediately run the same
            // top-down promotion policy. This is the only re-read needed here.
            const refreshed = await this.#runStep(context, {
                subsystem: 'b5', step: 'inspect-after-reserve-chain', action: 'refresh after B2/B3 mutation', resource: currentChain.b3Id
            }, inspect);
            const higher = await this.#runStep(context, {
                subsystem: 'b5',
                step: 'promote-after-reserve-chain',
                action: 'compress all possible B2->B3->B4 after this material',
                resource: currentChain.b3Id
            }, () => this.#promoteOwnedIntermediates(refreshed, inspect, context));
            if (higher?.actions?.length) actions.push(...higher.actions);
            if (higher?.inspection?.success) workingInspection = higher.inspection;
            else workingInspection = refreshed;

            this.#syncLiveProgress(workingInspection.data, targetId);
            if (this.#isB5DirectlyReady(workingInspection.data, amount)) break;
        }

        // One final top-down sweep. This catches B4 made possible by B3 types
        // produced in different chains and consumes any remaining full B2 groups.
        const finalPromotion = await this.#runStep(context, {
            subsystem: 'b5', step: 'final-intermediate-promotion', action: 'final B5>B4>B3>B2 compaction sweep', resource: targetId
        }, () => this.#promoteOwnedIntermediates(workingInspection, inspect, context));
        if (finalPromotion?.actions?.length) actions.push(...finalPromotion.actions);
        if (finalPromotion?.inspection?.success) workingInspection = finalPromotion.inspection;

        const afterReserve = await this.#runStep(context, {
            subsystem: 'b5', step: 'inspect-after-reserve', action: 'recalculate B5 feasibility', resource: targetId
        }, inspect);

        let completedNewB5 = false;
        this.#syncLiveProgress(afterReserve.data, targetId, {
            state: this.#isB5DirectlyReady(afterReserve.data, amount) ? 'B5_READY' : (afterReserve.data.fullPlan.feasible ? 'FINAL_READY' : 'WAITING_MATERIALS')
        });

        if (allowFinalB5 && (afterReserve.data.fullPlan.feasible || this.#isB5DirectlyReady(afterReserve.data, amount))) {
            let finalSteps = afterReserve.data.finalSteps || [];
            if (this.#isB5DirectlyReady(afterReserve.data, amount)) {
                const targetRecipe = this.#recipeForOutput(targetId, finalSteps);
                if (!targetRecipe) {
                    throw new FlowError(`B5 recipe not found for ${targetId}.`, {
                        code: 'B5_TARGET_RECIPE_NOT_FOUND', subsystem: 'b5', step: 'craft-final-chain',
                        action: 'resolve B5 recipe', resource: targetId, trace: context.trace
                    });
                }
                // Highest priority means do not spend time compacting surplus
                // lower tiers once the B5 itself is directly craftable.
                finalSteps = [{ recipeId: targetRecipe.recipeId, outputId: targetId, crafts: amount }];
            }

            await this.#runStep(context, {
                subsystem: 'b5',
                step: 'craft-final-chain',
                action: 'craft highest-priority B4/B5 final steps',
                resource: targetId,
                details: { steps: finalSteps }
            }, () => this.#executeFinalSteps(finalSteps, context));

            this.#setLiveProgress({ running: true, state: 'DEPOSITING', currentStep: { kind: 'DEPOSIT', id: targetId } });
            await this.#runStep(context, {
                subsystem: 'b5', step: 'deposit-b5', action: 'deposit final B5 to /pv 2', resource: targetId
            }, () => this.personalVault.deposit(targetId, { cancellationToken: context.cancellation.token }));
            this.#advanceLiveProgress(1);

            this.#setLiveProgress({ running: true, state: 'VERIFYING', currentStep: { kind: 'VERIFY', id: targetId } });
            const vaultAfterResult = await this.#runStep(context, {
                subsystem: 'b5', step: 'verify-b5-deposit', action: 'read /pv 2 after deposit', resource: targetId
            }, () => this.personalVault.read({ cancellationToken: context.cancellation.token }));
            const targetVaultAfter = Number(vaultAfterResult.data?.totals?.[targetId] || 0);
            if (targetVaultAfter < targetVaultBefore + amount) {
                throw new FlowError(
                    `B5 deposit verification failed: expected at least ${targetVaultBefore + amount}, got ${targetVaultAfter}.`,
                    {
                        code: 'B5_DEPOSIT_VERIFICATION_FAILED', subsystem: 'b5', operation: 'B5Automation',
                        step: 'verify-b5-deposit', action: 'compare /pv 2 total', resource: targetId,
                        retryable: true, details: { targetVaultBefore, targetVaultAfter, amount }, trace: context.trace
                    }
                );
            }
            this.#advanceLiveProgress(1);
            completedNewB5 = true;
            this.#setLiveProgress({
                running: true,
                state: 'POST_PROCESSING',
                currentStep: { kind: 'STORE', id: targetId },
                remainingStages: 0,
                remainingCrafts: 0,
                completedAmount: amount,
                stored: 'PV2'
            });
            actions.push({ status: 'final-crafted-and-deposited', targetId, amount, targetVaultBefore, targetVaultAfter });

            // After B5 is safe in PV2, compact leftover B2/B3 for the next
            // cycle as far upward as possible. Skip the extra read entirely when
            // there are no intermediate chains to maintain.
            let postB5Data = afterReserve.data;
            if (chainCatalog.length > 0) {
                const postB5Inspection = await this.#runStep(context, {
                    subsystem: 'b5', step: 'inspect-post-b5', action: 'refresh lower tiers after B5 consumption', resource: 'B2-B4'
                }, inspect);
                this.#setLiveProgress({ running: true, state: 'COMPACTING', currentStep: { kind: 'CONVERT_BLOCKS', id: 'B2-B4' } });
                const postB5Promotion = await this.#runStep(context, {
                    subsystem: 'b5', step: 'post-b5-compaction', action: 'compress leftover B2/B3 into B3/B4 for next cycle', resource: 'B2-B4'
                }, () => this.#promoteOwnedIntermediates(postB5Inspection, inspect, context, { stopAtB5Ready: false }));
                if (postB5Promotion?.actions?.length) actions.push(...postB5Promotion.actions);
                postB5Data = postB5Promotion?.inspection?.data || postB5Inspection.data;
            }

            await this.#depositIntermediateRemainders(
                { ...postB5Data, chains: chainCatalog.length > 0 ? chainCatalog : (postB5Data?.chains || []) },
                context,
                actions
            );

            this.#setLiveProgress({ running: true, state: 'COMPACTING', currentStep: { kind: 'CONVERT_BLOCKS', id: 'B1' } });
            const compacted = await this.#runStep(context, {
                subsystem: 'b5', step: 'compact-all-b1', action: 'convert remaining B1 to blocks', resource: 'B1'
            }, () => this.b1Materials.compactAll({ cancellationToken: context.cancellation.token }));
            actions.push({ status: 'all-b1-compacted', data: compacted.data });

            // Do not sell just because B5 succeeded. Sell only when /kho
            // capacity is actually near full, always choosing the largest
            // compacted B1 stock first.
            await this.#relieveStoragePressureIfNeeded(context, actions, 'B1', { legacyFallback: true });
            this.#setLiveProgress({
                running: false,
                state: 'SUCCESS',
                currentStep: { kind: 'DONE', id: targetId },
                remainingStages: 0,
                remainingCrafts: 0,
                completedAmount: amount,
                stored: 'PV2'
            });
        }

        if (!completedNewB5) {
            // No B5 yet: still store only irreducible lower-tier remainder after
            // every possible B2->B3 and B3->B4 promotion has been attempted.
            await this.#depositIntermediateRemainders(
                { ...afterReserve.data, chains: chainCatalog.length > 0 ? chainCatalog : (afterReserve.data?.chains || []) },
                context,
                actions
            );

            if (mode === 'maintenance') {
                this.#setLiveProgress({ running: true, state: 'COMPACTING', currentStep: { kind: 'CONVERT_BLOCKS', id: 'B1' } });
                const compacted = await this.#runStep(context, {
                    subsystem: 'b5', step: 'maintenance-compact-b1', action: 'compact B1 during storage maintenance', resource: 'B1'
                }, () => this.b1Materials.compactAll({ cancellationToken: context.cancellation.token }));
                actions.push({ status: 'maintenance-b1-compacted', data: compacted.data });
                await this.#relieveStoragePressureIfNeeded(context, actions, 'B1', { legacyFallback: true });
                this.#setLiveProgress({
                    running: false,
                    state: 'MAINTENANCE_COMPLETE',
                    currentStep: { kind: 'DONE', id: 'STORAGE' },
                    remainingStages: Number(afterReserve.data?.progress?.remainingStages || 0),
                    remainingCrafts: Number(afterReserve.data?.progress?.remainingCrafts || 0)
                });
            } else {
                // A production pass may have crafted only B2/B3/B4. That is
                // still a crafting boundary: immediately put every loose B1
                // back into block form before Collector loops again. Otherwise
                // continuously-fed B1 can accumulate while the next plan is
                // being inspected and eventually overflow /kho into inventory.
                this.#setLiveProgress({ running: true, state: 'COMPACTING', currentStep: { kind: 'CONVERT_BLOCKS', id: 'B1' } });
                const compacted = await this.#runStep(context, {
                    subsystem: 'b5', step: 'post-production-compact-b1', action: 'compact all loose B1 after partial production pass', resource: 'B1'
                }, () => this.b1Materials.compactAll({ cancellationToken: context.cancellation.token }));
                actions.push({ status: 'post-production-b1-compacted', data: compacted.data });
                await this.#relieveStoragePressureIfNeeded(context, actions, 'B1');

                this.#setLiveProgress({
                    running: false,
                    state: 'WAITING_MATERIALS',
                    currentStep: afterReserve.data?.progress?.nextStep || null,
                    remainingStages: Number(afterReserve.data?.progress?.remainingStages || 0),
                    remainingCrafts: Number(afterReserve.data?.progress?.remainingCrafts || 0)
                });
            }
        }
        return {
            amount, additional, mode, allowFinalB5, allowNewB2: createNewB2, actions,
            complete: completedNewB5, completedNewB5, targetId,
            b5Ready: this.#isB5DirectlyReady(afterReserve.data, amount),
            pv2Backpressure: first.data?.personalVaultPressure || null,
            waitingForMaterials: !completedNewB5 && actions.some(action => action?.status === 'waiting'),
            progress: this.status()
        };
    }

    #syncLiveProgress(data, targetId, override = {}) {
        const progress = data?.progress || {};
        return this.#setLiveProgress({
            running: true,
            state: progress.state || (progress.feasible ? 'READY' : 'PREPARING'),
            currentStep: progress.nextStep || { kind: 'PLAN', id: targetId },
            remainingStages: Number(progress.remainingStages || 0),
            remainingCrafts: Number(progress.remainingCrafts || 0),
            targetId,
            priority: 'B5>B4>B3>B2',
            ...override
        });
    }

    #recipeForOutput(outputId, fallbackSteps = []) {
        const directStep = (fallbackSteps || []).find(step => step?.outputId === outputId && step?.recipeId);
        if (directStep) {
            try {
                return { recipeId: directStep.recipeId, recipe: this.recipeRegistry.require(directStep.recipeId) };
            } catch {}
        }
        if (typeof this.recipeRegistry?.ids === 'function') {
            for (const recipeId of this.recipeRegistry.ids()) {
                try {
                    const recipe = this.recipeRegistry.require(recipeId);
                    if (recipe?.output === outputId) return { recipeId, recipe };
                } catch {}
            }
        }
        try {
            const recipe = this.recipeRegistry.require(outputId);
            if (recipe && (!recipe.output || recipe.output === outputId)) return { recipeId: outputId, recipe };
        } catch {}
        return null;
    }

    #isB5DirectlyReady(data, amount = 1) {
        const targetId = data?.fullPlan?.targetId || this.config?.targetId || 'super_alloy';
        const targetRecipe = this.#recipeForOutput(targetId, data?.finalSteps || []);
        if (!targetRecipe?.recipe) return false;
        const available = data?.nonStorageAvailable || {};
        const targetAmount = Math.max(1, Number(amount || 1));
        const entries = Object.entries(targetRecipe.recipe.inputs || {}).filter(([, count]) => Number(count) > 0);
        if (entries.length === 0) return false;
        return entries.every(([id, perCraft]) =>
            Number(available[id] || 0) >= Number(perCraft) * targetAmount
        );
    }

    async #promoteOwnedIntermediates(initialInspection, inspect, context, { stopAtB5Ready = true } = {}) {
        let inspection = initialInspection;
        if (inspection?.success === false) throw inspection.error || new Error(inspection.message || 'B5 promotion inspection failed.');
        const actions = [];

        for (let guard = 0; guard < 8; guard += 1) {
            context.cancellation.token.throwIfCancelled();
            let changed = false;

            // B5 has absolute priority. Once all B4 inputs exist, stop compacting
            // lower tiers and let the main flow craft the B5 immediately.
            if (stopAtB5Ready && this.#isB5DirectlyReady(inspection.data, 1)) break;

            const b4Compacted = await this.#compactReadyB4(inspection, inspect, context, { stopAtB5Ready });
            if (b4Compacted.length > 0) {
                changed = true;
                actions.push({ status: 'b3-promoted-to-b4', data: b4Compacted });
                inspection = await inspect();
                if (inspection?.success === false) throw inspection.error || new Error(inspection.message || 'B5 promotion re-inspection failed.');
                if (stopAtB5Ready && this.#isB5DirectlyReady(inspection.data, 1)) break;
            }

            // B4 cannot advance further right now. Compress every complete B2
            // group into B3, regardless of whether that B3 is already sufficient
            // for the current B5 plan. Lower tiers are storage pressure.
            let promotedB2 = false;
            for (const chain of inspection.data?.chains || []) {
                context.cancellation.token.throwIfCancelled();
                const inputPerCraft = Math.max(1, Number(chain.b3InputPerCraft || 1));
                const inventoryB2 = Math.max(Number(chain.inventoryB2 || 0), this.#inventoryCount(chain.b2Id));
                const ownedB2 = Math.max(0, Number(chain.vaultB2 || 0) + inventoryB2);
                const crafts = Math.floor(ownedB2 / inputPerCraft);
                if (crafts <= 0) continue;

                const promoted = await this.#prepareB3Chain({
                    ...chain,
                    b2Crafts: 0,
                    b3Crafts: crafts,
                    readyToReserve: true
                }, context, {
                    deferIntermediateDeposit: true,
                    allChains: inspection.data?.chains || []
                });
                if (promoted?.deferredForSpace) {
                    actions.push({
                        status: 'b2-pv2-parked-for-space',
                        b2Id: chain.b2Id,
                        b3Id: chain.b3Id,
                        data: promoted
                    });
                    inspection = await inspect();
                    if (inspection?.success === false) throw inspection.error || new Error(inspection.message || 'B5 promotion re-inspection failed.');
                    break;
                }
                promotedB2 = true;
                changed = true;
                actions.push({ status: 'b2-promoted-to-b3', b2Id: chain.b2Id, b3Id: chain.b3Id, crafts });

                // A single B3 conversion may unlock Carbon/Titanium/Tungsten;
                // check B4 immediately instead of waiting for every B3 type.
                const immediateB4 = await this.#compactReadyB4(inspection, inspect, context, { stopAtB5Ready });
                if (immediateB4.length > 0) {
                    actions.push({ status: 'b4-compacted-immediately', data: immediateB4 });
                }
                inspection = await inspect();
                if (inspection?.success === false) throw inspection.error || new Error(inspection.message || 'B5 promotion re-inspection failed.');
                if (stopAtB5Ready && this.#isB5DirectlyReady(inspection.data, 1)) break;
            }

            if (stopAtB5Ready && this.#isB5DirectlyReady(inspection.data, 1)) break;
            if (!changed || !promotedB2) {
                // If only B4 changed, one more inspection has already been done;
                // another pass cannot create new B3 by itself.
                break;
            }
        }

        return { inspection, actions };
    }

    async #depositIntermediateRemainders(data, context, actions = []) {
        this.#setLiveProgress({ running: true, state: 'STORING', currentStep: { kind: 'STORE', id: 'B2-B4' } });
        for (const chain of data?.chains || []) {
            context.cancellation.token.throwIfCancelled();
            const b3Count = this.#inventoryCount(chain.b3Id);
            if (b3Count > 0) {
                const result = await this.#runStep(context, {
                    subsystem: 'b5', step: 'store-irreducible-b3', action: 'deposit B3 only after all possible B4 compaction', resource: chain.b3Id,
                    details: { count: b3Count }
                }, () => this.personalVault.deposit(chain.b3Id, { cancellationToken: context.cancellation.token }));
                actions.push({ status: 'b3-remainder-stored', id: chain.b3Id, data: result?.data });
            }
            const b2Count = this.#inventoryCount(chain.b2Id);
            if (b2Count > 0) {
                const result = await this.#runStep(context, {
                    subsystem: 'b5', step: 'store-irreducible-b2', action: 'deposit B2 remainder smaller than one B3 craft', resource: chain.b2Id,
                    details: { count: b2Count, b3InputPerCraft: chain.b3InputPerCraft }
                }, () => this.personalVault.deposit(chain.b2Id, { cancellationToken: context.cancellation.token }));
                actions.push({ status: 'b2-remainder-stored', id: chain.b2Id, data: result?.data });
            }
        }
    }

    async #prepareB3Chain(chain, context, { deferIntermediateDeposit = false, allChains = [] } = {}) {
        // One material at a time. B1 stays in /kho. B2 is accumulated in the
        // player inventory with quantity 64, but the inventory must never be
        // allowed to become completely full: the server requires at least one
        // empty slot before B2 -> B3 ALL is accepted.
        //
        // We therefore fill B2 in 64-click batches until either:
        //   1) current B2 is enough for every B3 still missing, or
        //   2) only the reserved empty slot remains.
        // Then B2 -> B3 uses ALL once, which compresses the inventory heavily.
        const minFreeForB3All = Math.max(1, Number(this.config?.b3AllMinEmptySlots || 1));
        let b2Remaining = Number(chain.b2Crafts || 0);
        let b3Remaining = Number(chain.b3Crafts || 0);
        let vaultB2Remaining = Number(chain.vaultB2 || 0);
        let guard = 0;

        while (b3Remaining > 0 || b2Remaining > 0) {
            context.cancellation.token.throwIfCancelled();
            guard += 1;
            if (guard > 512) {
                throw new FlowError(`B3 reserve chain exceeded safety iteration limit for ${chain.baseId}.`, {
                    code: 'B5_RESERVE_LOOP_GUARD', subsystem: 'b5', step: 'reserve-b3-chain', action: 'optimize B2/B3 ALL chain',
                    resource: chain.baseId, details: { b2Remaining, b3Remaining, vaultB2Remaining, chain }, trace: context.trace
                });
            }

            let inventory = this.#inventorySnapshot();
            let b2Count = this.inventoryCounter.count(inventory, chain.b2Id);
            const b3CraftableNow = Math.floor(b2Count / Math.max(1, chain.b3InputPerCraft));
            const enoughB2ForRemainingB3 = b3Remaining > 0 && b3CraftableNow >= b3Remaining;
            // Keep one extra buffer slot while Collector is standing on the pickup point.
            // A server pickup can consume a slot between the B2 check and the B3 ALL click.
            // Compress one step earlier so the required B3 output slot is not lost to that race.
            const atB3SafetyFloor = Number(inventory.emptySlotCount || 0) <= (minFreeForB3All + 1);
            const noMoreB2SupplyPlanned = b2Remaining <= 0 && vaultB2Remaining <= 0;

            // Compress only when it is useful to do so in one large ALL click:
            // target reached, inventory is at the safety floor, or there is no
            // more B2 supply to accumulate.
            if (b3Remaining > 0 && b3CraftableNow > 0
                && (enoughB2ForRemainingB3 || atB3SafetyFloor || noMoreB2SupplyPlanned)) {
                if (Number(inventory.emptySlotCount || 0) < minFreeForB3All) {
                    const freed = await this.#ensureFreeIntermediateSlots(chain, context, minFreeForB3All, {
                        reason: 'reserve one output slot before B2->B3 ALL',
                        preserveAtLeastB2: chain.b3InputPerCraft,
                        preferCurrentB2: chain.useAllForB2 === true,
                        allChains
                    });
                    inventory = freed.snapshot;
                    vaultB2Remaining += freed.depositedB2Count;
                    b2Count = this.inventoryCounter.count(inventory, chain.b2Id);
                    if (freed.emergencyParkedCurrentB2 && b2Count < chain.b3InputPerCraft) {
                        return {
                            b2Id: chain.b2Id,
                            b3Id: chain.b3Id,
                            deferred: deferIntermediateDeposit,
                            deferredForSpace: true,
                            parkedB2Count: freed.depositedB2Count,
                            emptySlotCount: inventory.emptySlotCount
                        };
                    }
                }
                if (b2Count < chain.b3InputPerCraft) continue;

                const quantity = this.#allEnabled('useAllForB3')
                    ? 'ALL'
                    : (b3Remaining >= 64 && b2Count >= chain.b3InputPerCraft * 64 ? 64 : 1);
                this.#quantityTrace('B5 QUANTITY DECISION', {
                    step: 'reserve-b3-chain', resource: chain.b3Id, recipeId: chain.b3RecipeId,
                    quantity,
                    reason: quantity === 'ALL' ? 'b2-accumulated-then-b3-all' : 'exact-fallback',
                    b2Count, b2Remaining, b3Remaining,
                    b3CraftableNow: Math.floor(b2Count / Math.max(1, chain.b3InputPerCraft)),
                    emptySlotCount: inventory.emptySlotCount,
                    minFreeForB3All
                });
                this.#setLiveProgress({
                    running: true,
                    state: 'CRAFTING_B3',
                    currentStep: { kind: 'B3', id: chain.b3Id, crafts: b3Remaining }
                });
                const crafted = await this.#craftOrThrow(chain.b3RecipeId, quantity, context, chain.b3Id);
                const actualCrafts = this.#actualCrafts(crafted, quantity);
                if (actualCrafts <= 0) {
                    throw new FlowError(`Craft ${chain.b3Id} reported no completed crafts.`, {
                        code: 'B5_ALL_CRAFT_ZERO', subsystem: 'b5', step: 'reserve-b3-chain', action: `craft quantity ${quantity}`,
                        resource: chain.b3Id, details: { quantity, crafted, b2Count, b2Remaining, b3Remaining }, trace: context.trace
                    });
                }
                b3Remaining = Math.max(0, b3Remaining - actualCrafts);
                if (b3Remaining === 0) b2Remaining = 0;
                continue;
            }

            if (b3Remaining <= 0) break;

            // Prefer already-owned B2 from /pv 2. Withdraw only as many stacks as
            // fit while preserving the one empty slot required by B3 ALL.
            if (vaultB2Remaining > 0 && Number(inventory.emptySlotCount || 0) > minFreeForB3All) {
                const freeStackSlots = Math.max(0, Number(inventory.emptySlotCount || 0) - minFreeForB3All);
                const b2StillUseful = Math.max(0, b3Remaining * chain.b3InputPerCraft - b2Count);
                const wantedStacks = Math.max(1, Math.ceil(Math.min(vaultB2Remaining, b2StillUseful || vaultB2Remaining) / 64));
                const maxStacks = Math.max(1, Math.min(freeStackSlots, wantedStacks));
                const before = b2Count;
                const withdrawn = await this.#runStep(context, {
                    subsystem: 'b5', step: 'withdraw-existing-b2', action: 'withdraw B2 from /pv 2 while reserving one empty slot', resource: chain.b2Id,
                    details: { vaultB2Remaining, b2Count, b3Remaining, maxStacks, emptySlotCount: inventory.emptySlotCount, minFreeForB3All }
                }, () => this.personalVault.withdraw(chain.b2Id, {
                    maxStacks,
                    cancellationToken: context.cancellation.token
                }));
                inventory = this.#inventorySnapshot();
                b2Count = this.inventoryCounter.count(inventory, chain.b2Id);
                const gained = Math.max(0, b2Count - before);
                if (gained > 0) vaultB2Remaining = Math.max(0, vaultB2Remaining - gained);
                else if (withdrawn?.data?.movedStacks > 0) vaultB2Remaining = Math.max(0, vaultB2Remaining - withdrawn.data.movedStacks * 64);
                continue;
            }

            // Produce B2 from the selected B1. When storage safety has enabled
            // B1->B2 ALL, the server may fill the inventory completely; that is
            // expected. The next loop iteration parks exactly one stack of this
            // B2 in PV2 if needed, creating the slot required for B2->B3 ALL.
            if (b2Remaining > 0 && (chain.useAllForB2 === true || Number(inventory.emptySlotCount || 0) > minFreeForB3All)) {
                const quantity = chain.useAllForB2 === true
                    ? 'ALL'
                    : Math.max(1, Number(this.config?.quantityOptimization?.b2BatchSize || 64));
                this.#quantityTrace('B5 QUANTITY DECISION', {
                    step: 'reserve-b3-chain', resource: chain.b2Id, recipeId: chain.b2RecipeId,
                    quantity,
                    reason: quantity === 'ALL' ? 'guarded-b1-to-b2-all' : 'accumulate-b2-fixed-batch-while-preserving-one-slot',
                    b2Count, b2Remaining, b3Remaining,
                    emptySlotCount: inventory.emptySlotCount,
                    minFreeAfterCraft: minFreeForB3All,
                    storageSafetyGuarded: quantity === 'ALL'
                });
                this.#setLiveProgress({
                    running: true,
                    state: 'CRAFTING_B2',
                    currentStep: { kind: 'B2', id: chain.b2Id, crafts: b2Remaining }
                });
                const crafted = await this.#craftOrThrow(chain.b2RecipeId, quantity, context, chain.b2Id);
                const actualCrafts = this.#actualCrafts(crafted, quantity);
                if (actualCrafts <= 0) {
                    throw new FlowError(`Craft ${chain.b2Id} reported no completed crafts.`, {
                        code: 'B5_B2_CRAFT_ZERO', subsystem: 'b5', step: 'reserve-b3-chain', action: `craft quantity ${quantity}`,
                        resource: chain.b2Id, details: { quantity, crafted, b2Count, b2Remaining, b3Remaining }, trace: context.trace
                    });
                }
                b2Remaining = Math.max(0, b2Remaining - actualCrafts);
                continue;
            }

            // If the inventory somehow has zero free slots, free exactly enough
            // space without discarding the whole chain. Prefer B3 output; only
            // move one B2 stack when enough B2 remains for at least one B3 craft.
            if (Number(inventory.emptySlotCount || 0) < minFreeForB3All) {
                const freed = await this.#ensureFreeIntermediateSlots(chain, context, minFreeForB3All, {
                    reason: 'server requires a free slot before B2->B3 ALL',
                    preserveAtLeastB2: chain.b3InputPerCraft,
                    allChains
                });
                inventory = freed.snapshot;
                vaultB2Remaining += freed.depositedB2Count;
                if (freed.emergencyParkedCurrentB2) {
                    const remainingB2Now = this.inventoryCounter.count(inventory, chain.b2Id);
                    if (remainingB2Now < chain.b3InputPerCraft) {
                        return {
                            b2Id: chain.b2Id,
                            b3Id: chain.b3Id,
                            deferred: deferIntermediateDeposit,
                            deferredForSpace: true,
                            parkedB2Count: freed.depositedB2Count,
                            emptySlotCount: inventory.emptySlotCount
                        };
                    }
                }
                continue;
            }

            // A continuous-supply pass may intentionally consume only the B2-64
            // batches currently fundable by /kho, then re-plan after B3 ALL. If
            // that partial pass has exhausted its local B2 budget, return cleanly
            // instead of treating the still-missing future B3 as an error. Any
            // sub-B3 B2 remainder is deposited to PV2 at the production boundary.
            if (chain.partialReservePass === true && b2Remaining <= 0 && vaultB2Remaining <= 0) break;

            // We have the reserved slot but cannot add more B2 and cannot make a
            // single B3. The plan is no longer satisfiable with current state.
            throw new FlowError(`Cannot continue B3 reserve chain for ${chain.baseId}; insufficient ${chain.b2Id}.`, {
                code: 'B5_RESERVE_INPUT_STALLED', subsystem: 'b5', step: 'reserve-b3-chain', action: 'choose next B2/B3 ALL action',
                resource: chain.b2Id,
                details: { b2Count, b2Remaining, b3Remaining, vaultB2Remaining, emptySlotCount: inventory.emptySlotCount, chain },
                trace: context.trace
            });
        }

        // The caller may defer these deposits so it can immediately compress
        // newly-created B3 into any B4 recipe that is already craftable. This is
        // the preferred path for Collector+B5 because B4 is much denser in /pv 2.
        if (!deferIntermediateDeposit) {
            await this.#runStep(context, {
                subsystem: 'b5', step: 'deposit-b3-reserve', action: 'deposit completed B3 reserve to /pv 2 before next material', resource: chain.b3Id
            }, () => this.personalVault.deposit(chain.b3Id, { cancellationToken: context.cancellation.token }));
            await this.#runStep(context, {
                subsystem: 'b5', step: 'deposit-b2-leftover', action: 'deposit B2 leftover to /pv 2 before next material', resource: chain.b2Id
            }, () => this.personalVault.deposit(chain.b2Id, { cancellationToken: context.cancellation.token }));
        }
        return { b2Id: chain.b2Id, b3Id: chain.b3Id, deferred: deferIntermediateDeposit };
    }

    async #compactReadyB4(initialInspection, inspect, context, { stopAtB5Ready = true } = {}) {
        let inspection = initialInspection;
        if (inspection?.success === false) throw inspection.error || new Error(inspection.message || 'B5 inspection failed during B4 compaction.');
        const compacted = [];
        const targetId = inspection.data?.fullPlan?.targetId || this.config?.targetId || 'super_alloy';
        const targetRecipe = this.#recipeForOutput(targetId, inspection.data?.finalSteps || []);
        if (!targetRecipe?.recipe) return compacted;
        const b4Ids = Object.keys(targetRecipe.recipe.inputs || {});

        // TARGET pass fills the exact B4 shortage for the next B5 first.
        // SURPLUS pass keeps compressing any remaining B3 into any B4 that can
        // be made. Batches are capped at 32 B4 so all recipe inputs fit safely
        // in a normal player inventory; the loop repeats until no more progress.
        for (const phase of ['TARGET', 'SURPLUS']) {
            for (const outputId of b4Ids) {
                let batchGuard = 0;
                while (batchGuard < 128) {
                    batchGuard += 1;
                    context.cancellation.token.throwIfCancelled();
                    if (stopAtB5Ready && this.#isB5DirectlyReady(inspection.data, 1)) return compacted;

                    const recipeEntry = this.#recipeForOutput(outputId, inspection.data?.finalSteps || []);
                    if (!recipeEntry?.recipe) break;
                    const recipe = recipeEntry.recipe;
                    const entries = Object.entries(recipe.inputs || {}).filter(([, amount]) => Number(amount) > 0);
                    if (entries.length === 0) break;

                    const available = inspection.data?.nonStorageAvailable || {};
                    let craftableNow = Number.MAX_SAFE_INTEGER;
                    for (const [logicalId, perCraft] of entries) {
                        craftableNow = Math.min(craftableNow,
                            Math.floor(Math.max(0, Number(available[logicalId] || 0)) / Number(perCraft))
                        );
                    }
                    craftableNow = Math.max(0, Number.isFinite(craftableNow) ? Math.floor(craftableNow) : 0);
                    if (craftableNow <= 0) break;

                    const perTarget = Number(targetRecipe.recipe.inputs?.[outputId] || 0);
                    const requiredForNextB5 = Math.max(0, perTarget);
                    const existingB4 = Math.max(0, Number(available[outputId] || 0));
                    const missingForNextB5 = Math.max(0, requiredForNextB5 - existingB4);
                    let crafts = 0;
                    if (phase === 'TARGET') {
                        crafts = Math.min(craftableNow, missingForNextB5);
                    } else {
                        crafts = Math.min(craftableNow, 32);
                    }
                    crafts = Math.max(0, Math.floor(crafts));
                    if (crafts <= 0) break;

                    await this.#executeFinalSteps([{
                        recipeId: recipeEntry.recipeId,
                        outputId,
                        crafts
                    }], context);
                    await this.personalVault.deposit(outputId, { cancellationToken: context.cancellation.token });
                    compacted.push({
                        outputId,
                        recipeId: recipeEntry.recipeId,
                        crafts,
                        phase: phase === 'TARGET' ? 'b5-priority' : 'storage-compaction'
                    });

                    inspection = await inspect();
                    if (inspection?.success === false) throw inspection.error || new Error(inspection.message || 'B5 inspection failed after B4 compaction.');
                    if (phase === 'TARGET') {
                        const nextAvailable = Number(inspection.data?.nonStorageAvailable?.[outputId] || 0);
                        if (nextAvailable >= requiredForNextB5) break;
                    }
                }
            }
        }
        return compacted;
    }

    async #ensureFreeIntermediateSlots(chain, context, minFreeSlots, {
        reason,
        preserveAtLeastB2 = 0,
        preferCurrentB2 = false,
        allChains = []
    } = {}) {
        this.#setLiveProgress({
            running: true,
            state: 'FREEING_SPACE',
            currentStep: { kind: 'SPACE', id: chain.b3Id }
        });

        let snapshot = this.#inventorySpaceSnapshot();
        let depositedB2Count = 0;
        let attempts = 0;
        let emergencyParkedCurrentB2 = false;
        const attemptedIds = new Set();

        // A guarded B1->B2 ALL is allowed to fill the inventory. In that exact
        // case the server contract is deterministic: park one stack of the
        // current material's B2 in PV2, verify the free slot, then run B3 ALL.
        // Do this before considering unrelated intermediates so the carry stack
        // is explicit and can be recovered by the next plan from PV2.
        if (preferCurrentB2 && Number(snapshot.emptySlotCount || 0) < minFreeSlots) {
            const beforeCount = this.#inventoryCount(chain.b2Id);
            if (beforeCount >= 64) {
                attempts += 1;
                attemptedIds.add(chain.b2Id);
                const parked = await this.personalVault.deposit(chain.b2Id, {
                    maxStacks: 1,
                    cancellationToken: context.cancellation.token
                });
                if (parked?.success !== false) {
                    const afterCount = this.#inventoryCount(chain.b2Id);
                    const moved = Math.max(0, beforeCount - afterCount);
                    depositedB2Count += moved > 0 ? moved : Math.max(0, Number(parked?.data?.movedStacks || 0)) * 64;
                    snapshot = await this.#waitForFreeInventorySlots(minFreeSlots, context.cancellation.token);
                    if (Number(snapshot.emptySlotCount || 0) >= minFreeSlots) {
                        return { snapshot, depositedB2Count, emergencyParkedCurrentB2: true };
                    }
                }
            }
        }

        // Prefer moving the most-compressed intermediates first. The old logic
        // only considered the current chain, which could deadlock when another
        // B2/B3/B4 stack occupied the last slot. Moving one safe intermediate
        // stack to PV2 is enough; the planner can withdraw it later if needed.
        const candidateIds = this.#spaceReleaseCandidates(chain, allChains, {
            preserveAtLeastB2,
            snapshot
        });

        for (const logicalId of candidateIds) {
            context.cancellation.token.throwIfCancelled();
            if (Number(snapshot.emptySlotCount || 0) >= minFreeSlots) break;
            if (!logicalId || attemptedIds.has(logicalId)) continue;
            attemptedIds.add(logicalId);

            const beforeCount = this.#inventoryCount(logicalId);
            if (beforeCount <= 0) continue;
            if (logicalId === chain.b2Id && beforeCount - 64 < preserveAtLeastB2) continue;

            attempts += 1;
            const result = await this.personalVault.deposit(logicalId, {
                maxStacks: 1,
                cancellationToken: context.cancellation.token
            });
            if (result?.success === false) continue;

            const afterCount = this.#inventoryCount(logicalId);
            if (logicalId === chain.b2Id) {
                depositedB2Count += Math.max(0, beforeCount - afterCount);
            }

            snapshot = await this.#waitForFreeInventorySlots(minFreeSlots, context.cancellation.token);
            if (Number(snapshot.emptySlotCount || 0) >= minFreeSlots) break;
        }

        // Emergency recovery: if the inventory is still completely blocked,
        // park one stack of the *current* B2 in PV2 even when that temporarily
        // leaves fewer than one B3 input group in inventory. Keeping the last
        // B2 stack in a full inventory is worse: B3 ALL cannot start at all and
        // Collector can deadlock. The caller will stop this reserve pass and
        // re-plan from the now-safe PV2 state instead of immediately withdrawing
        // the parked stack back into the only free slot.
        if (Number(snapshot.emptySlotCount || 0) < minFreeSlots) {
            const currentB2Before = this.#inventoryCount(chain.b2Id);
            if (currentB2Before > 0) {
                attempts += 1;
                const parked = await this.personalVault.deposit(chain.b2Id, {
                    maxStacks: 1,
                    cancellationToken: context.cancellation.token
                });
                if (parked?.success !== false) {
                    const currentB2After = this.#inventoryCount(chain.b2Id);
                    const moved = Math.max(0, currentB2Before - currentB2After);
                    if (moved > 0 || Number(parked?.data?.movedStacks || 0) > 0) {
                        depositedB2Count += moved > 0 ? moved : Number(parked?.data?.movedStacks || 0) * 64;
                        emergencyParkedCurrentB2 = true;
                        snapshot = await this.#waitForFreeInventorySlots(minFreeSlots, context.cancellation.token);
                    }
                }
            }
        }

        if (Number(snapshot.emptySlotCount || 0) < minFreeSlots) {
            throw new FlowError(`Cannot reserve ${minFreeSlots} empty inventory slot(s) for ${chain.b3Id}.`, {
                code: 'B5_INTERMEDIATE_NO_SPACE', subsystem: 'b5', step: 'free-intermediate-slot',
                action: reason || 'reserve inventory output slot', resource: chain.b3Id, retryable: true,
                details: {
                    minFreeSlots,
                    emptySlotCount: snapshot.emptySlotCount,
                    b2Count: this.#inventoryCount(chain.b2Id),
                    b3Count: this.#inventoryCount(chain.b3Id),
                    preserveAtLeastB2,
                    attemptedIds: [...attemptedIds],
                    attempts,
                    emergencyParkedCurrentB2
                },
                trace: context.trace
            });
        }
        return { snapshot, depositedB2Count, emergencyParkedCurrentB2 };
    }

    #spaceReleaseCandidates(chain, allChains, { preserveAtLeastB2 = 0 } = {}) {
        const candidates = [];
        const push = id => {
            const value = String(id || '').trim();
            if (value && !candidates.includes(value)) candidates.push(value);
        };

        // B4 is already maximally compact for the final recipe, so moving one
        // B4 stack to PV2 frees a slot without creating more intermediate load.
        const targetId = this.config?.targetId || 'super_alloy';
        const targetRecipe = this.#recipeForOutput(targetId);
        for (const b4Id of Object.keys(targetRecipe?.recipe?.inputs || {})) push(b4Id);

        // Then offload B3 from the current/other chains, followed by other B2.
        // Current B2 is deliberately last and only used when at least one full
        // B3 input group remains in inventory after moving a stack.
        push(chain.b3Id);
        for (const candidate of allChains || []) {
            if (candidate?.b3Id !== chain.b3Id) push(candidate?.b3Id);
        }
        for (const candidate of allChains || []) {
            if (candidate?.b2Id !== chain.b2Id) push(candidate?.b2Id);
        }
        const currentB2 = this.#inventoryCount(chain.b2Id);
        if (currentB2 - 64 >= preserveAtLeastB2) push(chain.b2Id);
        return candidates;
    }

    #inventorySpaceSnapshot() {
        const views = typeof this.inventoryReader.readViews === 'function'
            ? this.inventoryReader.readViews()
            : [this.#inventorySnapshot()];
        let best = null;
        for (const view of views || []) {
            if (!view) continue;
            if (!best || Number(view.emptySlotCount || 0) > Number(best.emptySlotCount || 0)) best = view;
        }
        return best || this.#inventorySnapshot();
    }

    async #waitForFreeInventorySlots(minFreeSlots, cancellationToken, timeoutMs = 1400) {
        const deadline = Date.now() + Math.max(100, Number(timeoutMs) || 1400);
        let best = this.#inventorySpaceSnapshot();
        while (Date.now() < deadline && Number(best.emptySlotCount || 0) < minFreeSlots) {
            cancellationToken?.throwIfCancelled?.();
            await Timeout.delay(Math.min(75, Math.max(1, deadline - Date.now())), { cancellationToken });
            const current = this.#inventorySpaceSnapshot();
            if (Number(current.emptySlotCount || 0) > Number(best.emptySlotCount || 0)) best = current;
        }
        return best;
    }

    async #executeFinalSteps(steps, context) {
        const targetId = this.config?.targetId || 'super_alloy';
        for (const step of steps) {
            const recipe = this.recipeRegistry.require(step.recipeId);
            const outputId = step.outputId || recipe.output;
            const plannedCrafts = Number(step.crafts || 0);
            this.#setLiveProgress({
                running: true,
                state: outputId === targetId ? 'CRAFTING_B5' : 'CRAFTING_B4',
                currentStep: { kind: outputId === targetId ? 'B5' : 'B4', id: outputId, crafts: plannedCrafts }
            });
            let remaining = plannedCrafts;
            while (remaining > 0) {
                context.cancellation.token.throwIfCancelled();

                // Load enough inputs for the remaining exact plan once. ALL is
                // used for B4 only when the inventory itself proves that the
                // recipe can make exactly `remaining` crafts; otherwise use the
                // deterministic 64/1 buttons. This prevents ALL from consuming
                // B3 reserved for a different B4 recipe.
                await this.#ensureInputs(recipe.inputs || {}, remaining, context, step.recipeId);
                const maxCraftable = this.#maxCraftableFromInventory(recipe.inputs || {});
                let quantity = 1;
                let reason = 'exact-one';
                if ((step.outputId || recipe.output) !== targetId
                    && this.#allEnabled('useAllForB4WhenExact')
                    && remaining > 1
                    && maxCraftable === remaining) {
                    quantity = 'ALL';
                    reason = 'all-is-exact-for-current-b4-inputs';
                } else if (remaining >= 64 && maxCraftable >= 64) {
                    quantity = 64;
                    reason = 'exact-64-batch';
                }

                // Preserve the current one-B5-per-cycle contract. ALL is only
                // allowed for the final target if explicitly enabled later.
                if ((step.outputId || recipe.output) === targetId && !this.#allEnabled('useAllForB5')) {
                    quantity = remaining >= 64 ? 64 : 1;
                    reason = 'final-target-exact-cycle';
                }

                this.#quantityTrace('B5 QUANTITY DECISION', {
                    step: 'craft-final-chain', resource: step.outputId || recipe.output, recipeId: step.recipeId,
                    quantity, reason, remaining, maxCraftable
                });
                const crafted = await this.#craftOrThrow(step.recipeId, quantity, context, step.outputId || recipe.output);
                const actualCrafts = this.#actualCrafts(crafted, quantity);
                if (actualCrafts <= 0) {
                    throw new FlowError(`Craft ${step.outputId || recipe.output} reported no completed crafts.`, {
                        code: 'B5_FINAL_CRAFT_ZERO', subsystem: 'b5', step: 'craft-final-chain', action: `craft quantity ${quantity}`,
                        resource: step.outputId || recipe.output, details: { quantity, remaining, maxCraftable, crafted }, trace: context.trace
                    });
                }
                remaining = Math.max(0, remaining - actualCrafts);
            }
            this.#advanceLiveProgress(1, plannedCrafts);
        }
    }

    async #ensureInputs(inputs, craftAmount, context, recipeId) {
        for (const [logicalId, perCraft] of Object.entries(inputs)) {
            const needed = Number(perCraft) * craftAmount;
            let inInventory = this.#inventoryCount(logicalId);
            let shortage = Math.max(0, needed - inInventory);
            let attempts = 0;
            let lastWithdrawal = null;

            while (shortage > 0 && attempts < 8) {
                attempts += 1;
                const maxStacks = Math.max(1, Math.ceil(shortage / 64));
                const withdrawn = await this.#runStep(context, {
                    subsystem: 'b5', step: 'withdraw-final-input', action: 'withdraw from /pv 2', resource: logicalId,
                    details: { recipeId, needed, inInventory, shortage, maxStacks, attempt: attempts }
                }, () => this.personalVault.withdraw(logicalId, { maxStacks, cancellationToken: context.cancellation.token }));
                lastWithdrawal = withdrawn?.data || null;

                // PersonalVaultService can verify a shift-click from the vault-side
                // delta before Mineflayer's bot.inventory mirror catches up. Final-chain
                // crafting needs the item in the player inventory, so wait briefly for
                // either inventory representation to reflect the moved custom item.
                const after = await this.#waitForInventoryIncrease(
                    logicalId,
                    inInventory,
                    context.cancellation.token
                );
                if (after <= inInventory) break;
                inInventory = after;
                shortage = Math.max(0, needed - inInventory);
            }

            if (inInventory < needed) {
                const verification = lastWithdrawal?.verification || null;
                const vaultMoved = Number(verification?.afterVault) < Number(verification?.beforeVault);
                const code = vaultMoved
                    ? 'PV_WITHDRAW_INVENTORY_SYNC_TIMEOUT'
                    : 'PV_WITHDRAW_VERIFICATION_FAILED';
                const message = vaultMoved
                    ? `/pv 2 moved ${logicalId}, but the player inventory did not expose the item in time (${inInventory}/${needed}).`
                    : `Not enough ${logicalId} in inventory after /pv 2 withdrawal (${inInventory}/${needed}).`;
                throw new FlowError(message, {
                    code, subsystem: 'b5', step: 'withdraw-final-input',
                    action: 'verify inventory after withdrawal', resource: logicalId, retryable: true,
                    details: {
                        recipeId, needed, after: inInventory, attempts,
                        withdrawalVerification: verification,
                        movedStacks: lastWithdrawal?.movedStacks ?? null
                    },
                    trace: context.trace
                });
            }

        }
    }

    async #waitForInventoryIncrease(logicalId, beforeCount, cancellationToken) {
        const settleTimeoutMs = Math.max(0, Number(this.config?.pvInventorySettleTimeoutMs ?? 1600));
        const settlePollMs = Math.max(10, Number(this.config?.pvInventorySettlePollMs ?? 50));
        let best = this.#inventoryCount(logicalId);
        if (best > beforeCount || settleTimeoutMs <= 0) return best;

        const deadline = Date.now() + settleTimeoutMs;
        while (Date.now() < deadline) {
            cancellationToken?.throwIfCancelled?.();
            await Timeout.delay(Math.min(settlePollMs, Math.max(1, deadline - Date.now())), { cancellationToken });
            best = Math.max(best, this.#inventoryCount(logicalId));
            if (best > beforeCount) break;
        }
        return best;
    }

    #maxCraftableFromInventory(inputs) {
        const entries = Object.entries(inputs || {}).filter(([, amount]) => Number(amount) > 0);
        if (entries.length === 0) return Number.MAX_SAFE_INTEGER;
        let max = Number.MAX_SAFE_INTEGER;
        for (const [logicalId, perCraft] of entries) {
            const count = this.#inventoryCount(logicalId);
            max = Math.min(max, Math.floor(count / Number(perCraft)));
        }
        return Math.max(0, max);
    }

    #allEnabled(key) {
        const policy = this.config?.quantityOptimization || {};
        return policy.enabled !== false && policy[key] === true;
    }

    #actualCrafts(crafted, requestedQuantity) {
        const actual = Number(crafted?.actualCrafts || 0);
        if (Number.isInteger(actual) && actual > 0) return actual;
        if (requestedQuantity === 1 || requestedQuantity === 64) return requestedQuantity;
        return 0;
    }

    #inventorySnapshot() {
        if (typeof this.inventoryReader.readBotInventory === 'function') return this.inventoryReader.readBotInventory();
        const views = typeof this.inventoryReader.readViews === 'function'
            ? this.inventoryReader.readViews()
            : [this.inventoryReader.read()];
        return views.find(view => view?.source === 'bot-inventory') || views[0] || { items: [], emptySlotCount: 0 };
    }

    #quantityTrace() {}

    async #craftOrThrow(recipeId, amount, context, outputId = null) {
        const result = await this.#runStep(context, {
            subsystem: 'crafting', step: 'craft-recipe', action: `craft quantity ${amount}`, resource: outputId || recipeId,
            details: { recipeId, amount }
        }, () => this.crafting.craft(recipeId, amount));
        return result.data;
    }

    async #relieveStoragePressureIfNeeded(context, actions, resource = 'B1', { legacyFallback = false } = {}) {
        // Older test doubles and extensions may only implement the original
        // sellLargestStoredBlock API. Keep that compatibility at the old end-of-
        // B5 call site, while production uses capacity-aware protection.
        if (typeof this.b1Materials?.inspectStoragePressure !== 'function') {
            if (!legacyFallback || typeof this.b1Materials?.sellLargestStoredBlock !== 'function') return null;
            this.#setLiveProgress({ running: true, state: 'SELLING', currentStep: { kind: 'SELL', id: resource } });
            const sold = await this.#runStep(context, {
                subsystem: 'b5', step: 'sell-largest-b1-legacy', action: 'legacy sell largest compacted /kho stock', resource
            }, () => this.b1Materials.sellLargestStoredBlock({ cancellationToken: context.cancellation.token }));
            actions?.push?.({ status: 'legacy-largest-b1-stock-evaluated', data: sold.data });
            return sold.data;
        }

        const pressure = await this.#runStep(context, {
            subsystem: 'b5',
            step: 'check-kho-pressure',
            action: 'check whether /kho is near full before selling',
            resource
        }, () => this.b1Materials.inspectStoragePressure({ cancellationToken: context.cancellation.token }));

        if (!pressure.data?.known || pressure.data?.nearFull !== true) return pressure.data || null;

        this.#setLiveProgress({ running: true, state: 'SELLING', currentStep: { kind: 'SELL', id: resource } });
        const relieved = await this.#runStep(context, {
            subsystem: 'b5',
            step: 'relieve-kho-pressure',
            action: 'sell largest compacted B1 stock until /kho is below pressure threshold',
            resource
        }, () => this.b1Materials.relieveStoragePressure({ cancellationToken: context.cancellation.token }));
        actions?.push?.({ status: 'storage-pressure-relieved', data: relieved.data });
        return relieved.data;
    }

    #runStep(context, meta, action, options = {}) {
        if (typeof context?.step === 'function') return context.step(meta, action, options);
        return Promise.resolve().then(action).then(result => {
            if (result?.success === false && options?.acceptFailedResult === true) return result;
            if (result?.success === false) {
                throw FlowError.fromResult(result, {
                    subsystem: meta?.subsystem || 'b5',
                    operation: 'B5Automation',
                    step: meta?.step || null,
                    action: meta?.action || null,
                    resource: meta?.resource || null,
                    details: meta?.details || null
                });
            }
            return result;
        });
    }

    #setLiveProgress(patch = {}) {
        const current = this.liveProgress || {};
        this.liveProgress = Object.freeze({
            ...current,
            ...patch,
            updatedAt: new Date().toISOString()
        });
        const activity = this.#activityLabel(this.liveProgress);
        if (activity && activity !== this.lastActivityLogKey) {
            this.lastActivityLogKey = activity;
            this.logger?.info?.(activity);
        }
        return this.liveProgress;
    }

    #activityLabel(progress) {
        const kind = String(progress?.currentStep?.kind || '').toUpperCase();
        const state = String(progress?.state || '').toUpperCase();
        if (kind === 'SPACE' || state === 'FREEING_SPACE') return 'B5: Đang giải phóng chỗ trống.';
        if (kind === 'B2' || state === 'CRAFTING_B2') return 'B5: Đang chế B2.';
        if (kind === 'B3' || kind === 'B2/B3' || state === 'CRAFTING_B3' || state === 'CRAFTING_INTERMEDIATE') return 'B5: Đang chế B3.';
        if (kind === 'B4' || state === 'CRAFTING_B4') return 'B5: Đang chế B4.';
        if (kind === 'B5' || state === 'CRAFTING_B5') return 'B5: Đang chế B5.';
        if (kind === 'DEPOSIT' || state === 'DEPOSITING') return 'B5: Đang cất B5.';
        if (kind === 'VERIFY' || state === 'VERIFYING') return 'B5: Đang xác nhận B5.';
        if (kind === 'CONVERT_BLOCKS' || state === 'COMPACTING') return 'B5: Đang đổi khối.';
        if (kind === 'SELL' || state === 'SELLING') return 'B5: Đang bán.';
        if (kind === 'STORE' || state === 'STORING') return 'B5: Đang cất nguyên liệu.';
        if (kind === 'PLAN') return 'B5: Đang tính các bước còn lại.';
        return null;
    }

    #advanceLiveProgress(stages = 1, crafts = 0) {
        const currentStages = Number(this.liveProgress?.remainingStages);
        const currentCrafts = Number(this.liveProgress?.remainingCrafts);
        return this.#setLiveProgress({
            remainingStages: Number.isFinite(currentStages) ? Math.max(0, currentStages - Math.max(0, Number(stages || 0))) : currentStages,
            remainingCrafts: Number.isFinite(currentCrafts) ? Math.max(0, currentCrafts - Math.max(0, Number(crafts || 0))) : currentCrafts
        });
    }

    #inventoryCount(logicalId) {
        // During a custom GUI shift-click some servers update the player section
        // of currentWindow before Mineflayer refreshes bot.inventory. Always compare
        // every inventory view and use the freshest/highest logical count.
        const views = typeof this.inventoryReader.readViews === 'function'
            ? this.inventoryReader.readViews()
            : (typeof this.inventoryReader.readBotInventory === 'function'
                ? [this.inventoryReader.readBotInventory()]
                : [this.inventoryReader.read()]);
        let best = 0;
        for (const snapshot of views || []) {
            if (!snapshot) continue;
            best = Math.max(best, this.inventoryCounter.count(snapshot, logicalId));
        }
        return best;
    }
}

module.exports = B5AutomationService;
