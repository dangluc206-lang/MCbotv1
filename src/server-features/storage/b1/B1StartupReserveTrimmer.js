'use strict';

const Result = require('../../../shared/result/Result');
const Status = require('../../../shared/result/Status');
const FlowError = require('../../../shared/errors/FlowError');
const Operation = require('../../../operations/Operation');
const B1StorageProtectionPlanner = require('../../../planning/storage/B1StorageProtectionPlanner');
const ReconciliationBarrier = require('../../../shared/reconciliation/ReconciliationBarrier');

const B5_SELL_QUANTITY = 64;
const B5_SELL_SLICE_MAX_CLICKS = 64;
const B5_SELL_SLICE_DEADLINE_GUARD_MS = 30000;
const B5_SELL_SLICE_CONTINUATION_DELAY_MS = 300;
const B5_SELL_EVIDENCE_HISTORY_LIMIT = 32;

/**
 * Bounded B5 reserve sell episode.
 *
 * The sell budget is derived once from an immutable full-/kho baseline. Fresh
 * reads after that baseline are verification only; they never increase the
 * current episode budget. New inflow may be deferred only after baseline sales
 * have been independently verified.
 */
class B1StartupReserveTrimmer {
    constructor({ storage, materialPolicy, logger = null, profileRef = null } = {}) {
        if (!storage || typeof storage !== 'object') throw new TypeError('B1 reserve trimmer storage service is required.');
        if (!materialPolicy?.coverageSnapshot) throw new TypeError('B1 reserve trimmer materialPolicy is required.');
        this.storage = storage;
        this.materialPolicy = materialPolicy;
        this.logger = logger;
        this.activeEpisodes = new Map();
        this.profileRef = profileRef && profileRef.id && profileRef.revision ? Object.freeze({ id: profileRef.id, revision: profileRef.revision }) : null;
        this.planner = new B1StorageProtectionPlanner({ materialPolicy, sellQuantity: B5_SELL_QUANTITY });
        this.reconciliationBarrier = new ReconciliationBarrier({ maxFreshReads: 2, logger });
    }

    hasEpisode(episodeId, { expectedGeneration = null, batchId = null } = {}) {
        const episode = this.activeEpisodes.get(String(episodeId || ''));
        if (!episode) return false;
        if (batchId != null && String(episode.batchId) !== String(batchId)) return false;
        if (expectedGeneration != null
            && Number(episode.connectionGeneration) !== Number(expectedGeneration)) return false;
        return episode.completeForEpisode !== true;
    }

    discardEpisode(episodeId) {
        return this.activeEpisodes.delete(String(episodeId || ''));
    }

    async run({
        targetCoverage = null,
        cancellationToken = null,
        operationContext = null,
        expectedGeneration = null,
        initialSnapshot = null,
        batchId = null,
        trigger = null,
        episodeId: requestedEpisodeId = null
    } = {}) {
        const childOptions = { cancellationToken, operationContext, expectedGeneration };
        const episodeId = String(requestedEpisodeId || operationContext?.operationId || `b5-protect-${batchId || 'batch'}`);
        let episode = this.hasEpisode(episodeId, { expectedGeneration, batchId })
            ? this.activeEpisodes.get(episodeId)
            : null;
        try {
            if (typeof this.storage.read !== 'function' || typeof this.storage.sell !== 'function') {
                return Result.fail(Status.NOT_READY, 'B1 reserve trim requires storage read and sell capabilities.');
            }
            const sellConfig = this.storage?.config?.sell || {};
            const reserveCoverage = Math.max(0, Number(targetCoverage ?? sellConfig.reserveCoverage ?? 1.5));
            cancellationToken?.throwIfCancelled?.();

            if (!episode) {
                let baseline = this.#cloneSnapshot(initialSnapshot);
                if (!baseline) {
                    await this.storage.closeSellGui?.(childOptions);
                    cancellationToken?.throwIfCancelled?.();
                    const read = await this.storage.read({ ...childOptions, refresh: true, forceReopen: true });
                    if (!read.success) return read;
                    baseline = this.#cloneSnapshot(read.data);
                }

                const planned = this.planner.compile({
                    snapshot: baseline,
                    reserveCoverage,
                    freshness: { confirmed: true, expectedGeneration, currentGeneration: expectedGeneration },
                    profile: this.profileRef,
                    policy: { id: 'b5-storage-protection', revision: 'v1' }
                });
                if (planned.blockers.length) {
                    const error = new FlowError('B5 storage protection planner rejected the sell baseline.', {
                        code: 'B1_B5_PROTECTION_PLAN_BLOCKED', subsystem: 'b1', operation: 'B1ReserveTrimmer',
                        step: 'sell-baseline-plan', action: 'compile immutable 64-only sell plan', retryable: true,
                        details: { blockers: planned.blockers, expectedGeneration, batchId, episodeId }
                    });
                    return Result.fail(Status.NOT_READY, error.message, error, error.toDiagnostic());
                }
                const baselineDigest = planned.replayEnvelope?.digest || JSON.stringify(planned.snapshot);
                const baselineCoverage = planned.coverage;
                const budget = { byMaterial: planned.byMaterial, actions: planned.actions, totalSafeSurplusItems: planned.totalSafeSurplusItems, totalSellItems: planned.totalSellItems, retainedRemainderItems: planned.retainedRemainderItems };
                episode = {
                    botId: operationContext?.botId || null,
                    connectionGeneration: expectedGeneration ?? operationContext?.connectionGeneration ?? null,
                    batchId: batchId || null,
                    episodeId,
                    trigger: trigger || null,
                    operationId: operationContext?.operationId || null,
                    correlationId: operationContext?.correlationId || null,
                    baseline,
                    baselineCoverage,
                    budget,
                    decisionEnvelope: planned.replayEnvelope,
                    actions: budget.actions,
                    nextActionIndex: 0,
                    baselineDigest,
                    baselineCapturedAt: baseline?.capturedAt || null,
                    reserveCoverage,
                    passBudget: null,
                    clickBudget: budget.actions.length,
                    maxClicksPerSlice: B5_SELL_SLICE_MAX_CLICKS,
                    sellQuantity: B5_SELL_QUANTITY,
                    retainedRemainderItems: budget.retainedRemainderItems,
                    initialSellBudget: budget.byMaterial,
                    soldAmount: {},
                    soldClicks: 0,
                    sliceNumber: 0,
                    sliceClicks: 0,
                    remainingInitialBudget: Object.fromEntries(Object.entries(budget.byMaterial).map(([id, value]) => [id, value.items])),
                    deferredNewInput: {},
                    unavailableCandidates: [],
                    blockedInitialSurplus: {},
                    sellEvidence: [],
                    sellEvidenceCount: 0,
                    finalVerificationIssues: [],
                    reserveViolations: [],
                    completeForEpisode: false,
                    continuationRequired: false,
                    cancelled: false,
                    staleGeneration: false
                };
                for (const activeId of this.activeEpisodes.keys()) {
                    if (activeId !== episodeId) this.activeEpisodes.delete(activeId);
                }
                this.activeEpisodes.set(episodeId, episode);

                this.logger?.info?.('B5 STORAGE PROTECTION: immutable 64-only reserve sell episode started.', {
                    operation: 'B1ReserveTrimmer', step: 'sell-baseline',
                    episodeId, batchId: episode.batchId, trigger: episode.trigger,
                    baselineDigest, reserveCoverage, sellQuantity: B5_SELL_QUANTITY,
                    clickBudget: episode.clickBudget, retainedRemainderItems: episode.retainedRemainderItems,
                    initialSellBudget: budget.byMaterial
                });
            } else {
                episode.operationId = operationContext?.operationId || episode.operationId;
                episode.correlationId = operationContext?.correlationId || episode.correlationId;
            }

            const budget = episode.budget;
            const baseline = episode.baseline;
            const baselineCoverage = episode.baselineCoverage;
            episode.sliceNumber += 1;
            episode.sliceClicks = 0;
            episode.continuationRequired = false;
            episode.deadlineYielded = false;
            episode.blocker = null;

            if (sellConfig.enabled === false && budget.totalSellItems > 0) {
                episode.blocker = {
                    reason: 'selling-disabled-with-baseline-surplus',
                    safeSurplusItems: budget.totalSafeSurplusItems,
                    sellable64Items: budget.totalSellItems,
                    policy: 'b5-protection-selling-required'
                };
                episode.completionReason = 'selling-disabled';
                const error = new FlowError('B5 storage protection cannot skip selling while the immutable baseline has surplus.', {
                    code: 'B1_B5_PROTECTION_SELL_DISABLED', subsystem: 'b1', operation: 'B1ReserveTrimmer',
                    step: 'sell-baseline', action: 'enforce mandatory B5 baseline surplus sale', retryable: false,
                    details: this.#episodeDiagnostic(episode)
                });
                return Result.fail(Status.NOT_READY, error.message, error, this.#episodeDiagnostic(episode));
            }

            while (episode.nextActionIndex < episode.actions.length
                && episode.sliceClicks < episode.maxClicksPerSlice) {
                cancellationToken?.throwIfCancelled?.();
                const rawRemainingMs = typeof operationContext?.remainingMs === 'function'
                    ? operationContext.remainingMs()
                    : null;
                const remainingMs = rawRemainingMs == null ? Infinity : Number(rawRemainingMs);
                if (Number.isFinite(remainingMs) && remainingMs <= B5_SELL_SLICE_DEADLINE_GUARD_MS) {
                    episode.deadlineYielded = true;
                    break;
                }

                const action = episode.actions[episode.nextActionIndex];
                if (action.quantity !== B5_SELL_QUANTITY) {
                    throw new FlowError('B5 storage protection generated a non-64 sell action.', {
                        code: 'B1_B5_PROTECTION_SELL_QUANTITY_INVALID',
                        subsystem: 'b1', operation: 'B1ReserveTrimmer', step: 'sell-baseline',
                        action: 'enforce 64-only sell invariant', resource: action.logicalId,
                        retryable: false, details: { action, episodeId }
                    });
                }
                delete episode.blockedInitialSurplus[action.logicalId];

                const sold = await this.storage.sell(action.logicalId, {
                    quantity: B5_SELL_QUANTITY,
                    ...childOptions
                });
                if (!sold.success) {
                    episode.blockedInitialSurplus[action.logicalId] = Number(episode.remainingInitialBudget[action.logicalId] || 0);
                    episode.blocker = {
                        material: action.baseId,
                        sellId: action.logicalId,
                        quantity: action.quantity,
                        attempt: episode.soldClicks + 1,
                        clickBudget: episode.clickBudget,
                        reason: sold.error?.code || sold.status || sold.message || 'sell-failed',
                        retryable: sold.error?.retryable !== false
                    };
                    break;
                }
                if (sold.data?.skipped) {
                    episode.unavailableCandidates.push({
                        material: action.baseId,
                        sellId: action.logicalId,
                        reason: sold.data.reason || 'candidate-unavailable'
                    });
                    episode.blockedInitialSurplus[action.logicalId] = Number(episode.remainingInitialBudget[action.logicalId] || 0);
                    episode.blocker = {
                        material: action.baseId,
                        sellId: action.logicalId,
                        quantity: action.quantity,
                        attempt: episode.soldClicks + 1,
                        clickBudget: episode.clickBudget,
                        reason: sold.data.reason || 'candidate-unavailable',
                        retryable: true
                    };
                    break;
                }

                episode.soldClicks += 1;
                episode.sliceClicks += 1;
                const evidence = await this.#verifySaleAmount({
                    action,
                    sold: sold.data || {},
                    baseline,
                    episode,
                    childOptions,
                    cancellationToken
                });
                episode.sellEvidenceCount += 1;
                episode.sellEvidence.push(evidence);
                if (episode.sellEvidence.length > B5_SELL_EVIDENCE_HISTORY_LIMIT) {
                    episode.sellEvidence.shift();
                }

                const verifiedQuantity = Math.max(0, Number(evidence.verifiedSoldQuantity || 0));
                if (verifiedQuantity > 0) {
                    episode.soldAmount[action.logicalId] = Number(episode.soldAmount[action.logicalId] || 0) + verifiedQuantity;
                    episode.remainingInitialBudget[action.logicalId] = Math.max(0,
                        Number(episode.remainingInitialBudget[action.logicalId] || 0) - verifiedQuantity);
                }

                if (evidence.exactRequested === true
                    && verifiedQuantity === B5_SELL_QUANTITY) {
                    episode.nextActionIndex += 1;
                    delete episode.blockedInitialSurplus[action.logicalId];
                } else {
                    const reconciliation = this.reconciliationBarrier.evaluate({
                        expectedGeneration, currentGeneration: expectedGeneration,
                        applied: verifiedQuantity > 0, verifiedNoEffect: false, evidence
                    });
                    episode.blockedInitialSurplus[action.logicalId] = Number(episode.remainingInitialBudget[action.logicalId] || 0);
                    episode.blocker = {
                        reconciliationOutcome: reconciliation.outcome,
                        material: action.baseId,
                        sellId: action.logicalId,
                        quantity: action.quantity,
                        verifiedSoldQuantity: verifiedQuantity,
                        attempt: episode.soldClicks,
                        clickBudget: episode.clickBudget,
                        reason: evidence.reason || 'sale-amount-unverified',
                        retryable: verifiedQuantity <= 0
                    };
                    break;
                }
            }

            cancellationToken?.throwIfCancelled?.();
            const closed = await this.storage.closeSellGui?.(childOptions);
            if (closed?.success === false) return closed;
            cancellationToken?.throwIfCancelled?.();

            const finalRead = await this.storage.read({ ...childOptions, refresh: true, forceReopen: true });
            if (!finalRead.success) return finalRead;
            const finalSnapshot = finalRead.data;
            const finalCoverage = this.materialPolicy.coverageSnapshot(finalSnapshot);

            episode.finalVerificationIssues = [];
            episode.reserveViolations = [];
            episode.deferredNewInput = {};
            const baselineBudgetProven = Object.values(episode.remainingInitialBudget)
                .every(value => Math.max(0, Number(value || 0)) === 0)
                && episode.nextActionIndex >= episode.actions.length
                && Object.keys(episode.blockedInitialSurplus).length === 0;

            for (const [logicalId, entry] of Object.entries(budget.byMaterial)) {
                const baselineCount = Math.max(0, Number(baseline?.items?.[logicalId] || 0));
                const verifiedSoldCount = Math.max(0, Number(episode.soldAmount[logicalId] || 0));
                const expectedAfterVerifiedSales = Math.max(0, baselineCount - verifiedSoldCount);
                const finalCount = Math.max(0, Number(finalSnapshot?.items?.[logicalId] || 0));

                if (finalCount < expectedAfterVerifiedSales) {
                    episode.finalVerificationIssues.push({
                        material: entry.material,
                        sellId: logicalId,
                        reason: 'final-count-below-verified-sale-expectation',
                        baselineCount,
                        verifiedSoldCount,
                        expectedAfterVerifiedSales,
                        finalCount
                    });
                } else if (finalCount > expectedAfterVerifiedSales) {
                    // This positive delta arrived after the immutable baseline.
                    // It is observable for diagnostics but never expands the
                    // current episode budget, even across continuation slices.
                    episode.deferredNewInput[logicalId] = finalCount - expectedAfterVerifiedSales;
                }
            }

            episode.reserveViolations = Object.values(finalCoverage || {})
                .filter(family => Number(family?.coverage || 0) + 1e-9 < reserveCoverage)
                .map(family => ({
                    baseId: family.baseId,
                    coverage: family.coverage,
                    requiredCoverage: reserveCoverage,
                    effectiveB1: family.effectiveB1,
                    requiredPerB5: family.requiredPerB5
                }));

            const remaining = Object.values(episode.remainingInitialBudget)
                .reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
            const actionsRemaining = Math.max(0, episode.actions.length - episode.nextActionIndex);
            episode.completeForEpisode = baselineBudgetProven
                && Object.keys(episode.blockedInitialSurplus).length === 0
                && episode.finalVerificationIssues.length === 0
                && episode.reserveViolations.length === 0;
            episode.continuationRequired = !episode.completeForEpisode
                && !episode.blocker
                && episode.finalVerificationIssues.length === 0
                && episode.reserveViolations.length === 0
                && remaining > 0
                && actionsRemaining > 0;
            episode.finalCoverage = finalCoverage;
            episode.finalSnapshot = finalSnapshot;
            episode.completionReason = episode.completeForEpisode
                ? 'initial-baseline-budget-verified-and-reserve-held'
                : episode.continuationRequired
                    ? (episode.deadlineYielded ? 'yielded-before-operation-deadline' : 'bounded-64-click-slice-complete')
                : episode.reserveViolations.length > 0
                    ? 'final-reserve-verification-failed'
                    : episode.finalVerificationIssues.length > 0
                        ? 'final-sale-verification-ambiguous'
                        : 'initial-baseline-surplus-blocked';

            if (episode.continuationRequired) {
                const diagnostic = this.#episodeDiagnostic(episode);
                this.logger?.debug?.('B5 STORAGE PROTECTION: 64-only sell slice checkpointed for continuation.', {
                    operation: 'B1ReserveTrimmer', step: 'sell-slice-checkpoint',
                    episodeId, batchId: episode.batchId, sliceNumber: episode.sliceNumber,
                    sliceClicks: episode.sliceClicks, soldClicks: episode.soldClicks,
                    clickBudget: episode.clickBudget, actionsRemaining,
                    deferredNewInput: episode.deferredNewInput,
                    deadlineYielded: episode.deadlineYielded
                });
                return Result.ok({
                    ...diagnostic,
                    initialCoverage: baselineCoverage,
                    finalCoverage,
                    finalSnapshot,
                    continuationRequired: true,
                    nextDelayMs: B5_SELL_SLICE_CONTINUATION_DELAY_MS
                });
            }

            if (!episode.completeForEpisode) {
                const hasUnverifiedSaleEvidence = episode.sellEvidence.some(evidence =>
                    evidence?.exactRequested !== true
                    && evidence?.reason !== 'candidate-unavailable'
                    && evidence?.reason !== 'retained-sub-64-remainder');
                const code = episode.reserveViolations.length > 0
                    ? 'B1_B5_PROTECTION_RESERVE_UNDERRUN'
                    : episode.finalVerificationIssues.length > 0 || hasUnverifiedSaleEvidence
                        ? 'B1_B5_PROTECTION_SELL_UNVERIFIED'
                        : 'B1_B5_PROTECTION_SELL_BLOCKED';
                const error = new FlowError('B5 storage protection could not verify the immutable sell baseline and hard reserve.', {
                    code,
                    subsystem: 'b1', operation: 'B1ReserveTrimmer', step: 'sell-baseline',
                    action: 'verify immutable 64-only baseline sales and final 1.5 B5 reserve',
                    retryable: episode.blocker?.retryable !== false,
                    details: this.#episodeDiagnostic(episode)
                });
                const status = code === 'B1_B5_PROTECTION_SELL_UNVERIFIED' || code === 'B1_B5_PROTECTION_RESERVE_UNDERRUN'
                    ? Status.VERIFICATION_FAILED
                    : Status.NOT_READY;
                return Result.fail(status, error.message, error, this.#episodeDiagnostic(episode));
            }

            this.logger?.info?.('B5 STORAGE PROTECTION: bounded reserve sell episode complete.', {
                operation: 'B1ReserveTrimmer', step: 'sell-baseline',
                episodeId, batchId: episode.batchId, reserveCoverage,
                soldClicks: episode.soldClicks, clickBudget: episode.clickBudget,
                deferredNewInput: episode.deferredNewInput,
                unavailableCandidates: episode.unavailableCandidates
            });
            const completed = Result.ok({
                ...this.#episodeDiagnostic(episode),
                initialCoverage: baselineCoverage,
                finalCoverage,
                finalSnapshot,
                continuationRequired: false
            });
            this.activeEpisodes.delete(episodeId);
            return completed;
        } catch (error) {
            if (episode) {
                episode.cancelled = error?.code === 'CANCELLED';
                episode.staleGeneration = ['COMMAND_STALE_GENERATION', 'DISCONNECTED', 'GUI_CLICK_STALE_GENERATION', 'OPERATION_CHILD_STALE_GENERATION'].includes(error?.code);
                episode.completionReason = episode.cancelled ? 'cancelled' : episode.staleGeneration ? 'stale-generation' : 'error';
                if (episode.cancelled || episode.staleGeneration || error?.code === 'TIMEOUT') {
                    this.activeEpisodes.delete(episodeId);
                }
            }
            const wrapped = FlowError.wrap(error, {
                code: error?.code || 'B1_RESERVE_TRIM_FAILED', subsystem: 'b1', operation: 'B1ReserveTrimmer',
                step: 'sell-baseline', action: 'sell immutable B1 surplus above B5 reserve',
                details: episode ? this.#episodeDiagnostic(episode) : null
            });
            return Result.fail(Operation.statusForError(error), wrapped.message, wrapped, wrapped.toDiagnostic());
        }
    }

    async #verifySaleAmount({ action, sold, baseline, episode, childOptions, cancellationToken }) {
        const verificationQuantity = sold?.verification?.verifiedSoldQuantity;
        const directQuantity = sold?.verifiedSoldQuantity;
        const guiVerified = sold?.verification?.verified === true
            && typeof verificationQuantity === 'number'
            && Number.isFinite(verificationQuantity);
        const directVerified = sold?.verification?.verified !== false
            && sold?.verification?.requiresFreshStorage !== true
            && typeof directQuantity === 'number'
            && Number.isFinite(directQuantity);
        const guiQuantity = guiVerified
            ? verificationQuantity
            : directVerified ? directQuantity : null;

        if (Number.isFinite(guiQuantity)) {
            return {
                sellId: action.logicalId,
                requestedQuantity: action.quantity,
                verifiedSoldQuantity: Math.max(0, guiQuantity),
                exactRequested: Math.abs(guiQuantity - action.quantity) < 1e-9,
                source: sold?.verification?.source || 'sell-gui-amount',
                reason: Math.abs(guiQuantity - action.quantity) < 1e-9
                    ? null
                    : guiQuantity < action.quantity ? 'partial-sale' : 'oversold-or-ambiguous-sale',
                transitioned: sold?.transitioned === true,
                amountReliable: sold?.amountReliable === true
            };
        }

        // GUI transition alone is not amount evidence. Close the Sell GUI and
        // reconcile against the authoritative full /kho snapshot. This read is
        // verification only and cannot expand the immutable episode budget.
        await this.storage.closeSellGui?.(childOptions);
        cancellationToken?.throwIfCancelled?.();
        const checkpoint = await this.storage.read({ ...childOptions, refresh: true, forceReopen: true });
        if (!checkpoint.success) {
            return {
                sellId: action.logicalId,
                requestedQuantity: action.quantity,
                verifiedSoldQuantity: 0,
                exactRequested: false,
                source: 'fresh-kho',
                reason: checkpoint.error?.code || checkpoint.status || 'fresh-kho-sale-verification-failed'
            };
        }

        const baselineCount = Math.max(0, Number(baseline?.items?.[action.logicalId] || 0));
        const previouslyVerified = Math.max(0, Number(episode.soldAmount[action.logicalId] || 0));
        const expectedBefore = Math.max(0, baselineCount - previouslyVerified);
        const observedAfter = Math.max(0, Number(checkpoint.data?.items?.[action.logicalId] || 0));
        const delta = expectedBefore - observedAfter;
        const exactRequested = Math.abs(delta - action.quantity) < 1e-9;
        let reason = null;
        if (!exactRequested) {
            if (delta === 0) reason = 'sale-noop-unverified';
            else if (delta > 0 && delta < action.quantity) reason = 'partial-sale';
            else if (delta > action.quantity) reason = 'oversold-or-external-depletion';
            else reason = 'sale-vs-inflow-ambiguous';
        }
        return {
            sellId: action.logicalId,
            requestedQuantity: action.quantity,
            verifiedSoldQuantity: Math.max(0, delta),
            exactRequested,
            source: 'fresh-kho',
            reason,
            expectedBefore,
            observedAfter,
            checkpointCapturedAt: checkpoint.data?.capturedAt || null,
            transitioned: sold?.transitioned === true,
            amountReliable: sold?.amountReliable === true
        };
    }

    #episodeDiagnostic(episode) {
        return {
            botId: episode.botId,
            connectionGeneration: episode.connectionGeneration,
            batchId: episode.batchId,
            episodeId: episode.episodeId,
            trigger: episode.trigger,
            operationId: episode.operationId,
            correlationId: episode.correlationId,
            baselineDigest: episode.baselineDigest,
            baselineCapturedAt: episode.baselineCapturedAt,
            decisionEnvelope: episode.decisionEnvelope || null,
            reserveCoverage: episode.reserveCoverage,
            passBudget: episode.passBudget,
            sellQuantity: episode.sellQuantity,
            clickBudget: episode.clickBudget,
            maxClicksPerSlice: episode.maxClicksPerSlice,
            sliceNumber: episode.sliceNumber,
            sliceClicks: episode.sliceClicks,
            nextActionIndex: episode.nextActionIndex,
            actionsRemaining: Math.max(0, Number(episode.clickBudget || 0) - Number(episode.nextActionIndex || 0)),
            retainedRemainderItems: episode.retainedRemainderItems,
            initialSellBudget: episode.initialSellBudget,
            soldAmount: episode.soldAmount,
            soldClicks: episode.soldClicks,
            remainingInitialBudget: episode.remainingInitialBudget,
            deferredNewInput: episode.deferredNewInput,
            unavailableCandidates: episode.unavailableCandidates,
            blockedInitialSurplus: episode.blockedInitialSurplus,
            sellEvidence: episode.sellEvidence,
            sellEvidenceCount: episode.sellEvidenceCount,
            sellEvidenceHistoryLimit: B5_SELL_EVIDENCE_HISTORY_LIMIT,
            finalVerificationIssues: episode.finalVerificationIssues,
            reserveViolations: episode.reserveViolations,
            completeForEpisode: episode.completeForEpisode,
            continuationRequired: episode.continuationRequired,
            deadlineYielded: episode.deadlineYielded === true,
            cancelled: episode.cancelled,
            staleGeneration: episode.staleGeneration,
            completionReason: episode.completionReason || null,
            blocker: episode.blocker || null
        };
    }

    #cloneSnapshot(snapshot) {
        if (!snapshot || typeof snapshot !== 'object' || !snapshot.items || typeof snapshot.items !== 'object') return null;
        return JSON.parse(JSON.stringify(snapshot));
    }

}

module.exports = B1StartupReserveTrimmer;
