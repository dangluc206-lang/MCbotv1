'use strict';

const ManagedMode = require('../ManagedMode');
const Timeout = require('../../shared/time/Timeout');
const Status = require('../../shared/result/Status');
const Result = require('../../shared/result/Result');
const Operation = require('../../operations/Operation');
const ReconciliationBarrier = require('../../shared/reconciliation/ReconciliationBarrier');
const ModeFaultPolicy = require('../ModeFaultPolicy');
const B5CampaignSession = require('./campaign/B5CampaignSession');
const B5BatchCoordinator = require('./campaign/B5BatchCoordinator');
const StorageProtectionEpisode = require('./storage/StorageProtectionEpisode');
const B5FaultPolicyAdapter = require('./fault/B5FaultPolicyAdapter');
const B5StatusProjection = require('./status/B5StatusProjection');

const PROTECTION_SAME_BLOCKER_LIMIT = 3;
const PROTECTION_TOTAL_AUTO_ATTEMPT_LIMIT = 6;
const PROTECTION_RETRY_CACHE_TTL_MS = 5 * 60 * 1000;

class B5CraftModeService extends ManagedMode {
    constructor({
        botId,
        modeContext,
        modeCoordinator,
        catalog,
        island,
        skyblockReadiness = null,
        skyTarget = null,
        b1Materials,
        b5Planning,
        b5Automation,
        failurePublisher = null,
        failurePolicy = null,
        config = {},
        logger = null
    } = {}) {
        super({ modeId: 'b5-craft', botId, modeContext, modeCoordinator, catalog, logger });
        if (!island?.goHome) throw new TypeError('B5CraftModeService island service is required.');
        if (!b1Materials?.protectForB5Batch) throw new TypeError('B5CraftModeService B1 storage protection service is required.');
        if (!b5Planning?.inspectAdditionalFresh) throw new TypeError('B5CraftModeService B5 planning service is required.');
        if (!b5Automation?.runNext) throw new TypeError('B5CraftModeService B5 automation service is required.');
        Object.assign(this, { island, skyblockReadiness, skyTarget, b1Materials, b5Planning, b5Automation });
        this.config = this.#normalizeConfig(config);
        this.supervisor = null;
        this.preparedGeneration = null;
        this.lastCycleAt = null;
        this.lastResult = null;
        this.waitingReason = null;
        this.completedB5 = 0;
        this.cycles = 0;
        this.storageProtectionRuns = 0;
        this.manualResumeGeneration = null;
        this.lastAutomationBlockers = [];
        this.automationRuns = 0;
        this.productiveCycles = 0;
        this.lastAutomationAt = null;
        this.noProgressStreak = 0;
        this.lastBlockerKey = null;
        this.lastCycleDelayMs = 0;
        this.staleGenerationAborts = 0;
        this.pendingCraftReconciliation = null;
        this.pendingB5CompletionProvenance = null;
        this.lastAccountedB5ProvenanceId = null;
        this.reconciliationRuns = 0;
        this.unresolvedReconciliations = 0;
        this.nextB5CycleAt = null;
        this.campaignSession = new B5CampaignSession({ botId });
        this.batchCoordinator = new B5BatchCoordinator({ botId });
        this.batchSequence = 0;
        this.batchId = null;
        this.batchTrigger = null;
        this.batchProtectionRequired = false;
        this.batchProtectionCompleted = false;
        this.protectionInFlight = null;
        this.protectionEpisode = null;
        this.reconciliationBarrier = new ReconciliationBarrier({ maxFreshReads: this.config.reconciliation.maxFreshReads, logger: this.logger });
        this.faultPolicy = new B5FaultPolicyAdapter(new ModeFaultPolicy({ botId, modeId: 'b5-craft', policy: failurePolicy || undefined, publisher: failurePublisher, logger }));
        this.protectionRetryRequests = new Map();
    }

    publicConfig() {
        return JSON.parse(JSON.stringify(this.config));
    }

    async enable() {
        if (this.config.enabled === false) {
            return Result.fail(Status.NOT_READY, 'Chế B5 thuần đang bị tắt trong cấu hình.');
        }
        return super.enable();
    }

    reconfigure(config) {
        this.config = this.#normalizeConfig(config);
        this.faultPolicy.reset('reconfigure');
        this.#requestProtectionRetry('config-change');
        return this.publicConfig();
    }

    async onEnable() {
        this.faultPolicy.reset('enable');
        this.campaignSession.open({ generation: this.modeContext.generation(), trigger: 'explicit-enable' });
        this.skyblockReadiness?.requireTarget?.(this.skyTarget, { owner: this.modeId, trigger: 'b5-mode-enabled' });
        this.#armBatchProtection('explicit-enable');
        this.supervisor = this.createTaskSupervisor('loop', { historyLimit: 8 });
        this.#startLoop();
    }

    async onPause(reason) {
        await this.supervisor?.stop('main-loop', reason || 'B5 craft paused.');
        this.waitingReason = 'paused';
    }

    async onResume() {
        this.skyblockReadiness?.requireTarget?.(this.skyTarget, { owner: this.modeId, trigger: 'b5-mode-resumed' });
        this.waitingReason = null;
        this.#startLoop();
    }

    async onDisable(reason) {
        await this.supervisor?.stopAll(reason || 'B5 craft disabled.');
        this.b1Materials.discardProtectionEpisode?.(this.protectionEpisode?.episodeId);
        this.supervisor = null;
        this.preparedGeneration = null;
        this.waitingReason = null;
        this.manualResumeGeneration = null;
        this.pendingCraftReconciliation = null;
        this.pendingB5CompletionProvenance = null;
        this.batchId = null;
        this.batchTrigger = null;
        this.batchProtectionRequired = false;
        this.batchProtectionCompleted = false;
        this.protectionInFlight = null;
        this.protectionEpisode = null;
        this.protectionRetryRequests.clear();
        this.campaignSession.close();
        this.faultPolicy.close(reason || 'disabled');
        this.skyblockReadiness?.releaseTarget?.(this.modeId);
        this.#resetNoProgress();
    }

    async resume() {
        if (this.waitingReason === 'manual-resume-after-reconnect') {
            this.manualResumeGeneration = this.modeContext.generation();
            this.waitingReason = null;
            this.setPhase('RUNNING');
        }
        return super.resume();
    }

    statusDetails() {
        return B5StatusProjection.create({
            policy: {
                movement: false,
                smelting: true,
                teleportHome: this.config.teleportHomeOnEnable,
                skyTarget: this.skyTarget,
                storageProtection: true,
                blockBaseConversion: true,
                crafting: true
            },
            preparedGeneration: this.preparedGeneration,
            lastCycleAt: this.lastCycleAt,
            waitingReason: this.waitingReason,
            cycles: this.cycles,
            completedB5: this.completedB5,
            storageProtectionRuns: this.storageProtectionRuns,
            lastAutomationBlockers: this.lastAutomationBlockers,
            automationRuns: this.automationRuns,
            productiveCycles: this.productiveCycles,
            lastAutomationAt: this.lastAutomationAt,
            noProgressStreak: this.noProgressStreak,
            lastBlockerKey: this.lastBlockerKey,
            lastCycleDelayMs: this.lastCycleDelayMs,
            staleGenerationAborts: this.staleGenerationAborts,
            manualResumeGeneration: this.manualResumeGeneration,
            reconciliationRuns: this.reconciliationRuns,
            unresolvedReconciliations: this.unresolvedReconciliations,
            nextB5CycleAt: this.nextB5CycleAt,
            campaign: this.campaignSession.snapshot(),
            batchId: this.batchId,
            batchTrigger: this.batchTrigger,
            batchProtectionRequired: this.batchProtectionRequired,
            batchProtectionCompleted: this.batchProtectionCompleted,
            protectionInFlight: this.protectionInFlight ? { ...this.protectionInFlight } : null,
            protectionEpisode: this.#publicProtectionEpisode(),
            fault: this.faultPolicy.snapshot(),
            recovery: this.#recoverySurface(),
            pendingCraftReconciliation: this.#compactReconciliation(this.pendingCraftReconciliation),
            pendingB5CompletionProvenance: this.pendingB5CompletionProvenance ? { ...this.pendingB5CompletionProvenance } : null,
            reconciliationAction: this.#reconciliationAction(),
            lastResult: this.lastResult,
            b5Automation: this.b5Automation.status?.() || null,
            storage: this.b1Materials.status?.() || null,
            tasks: this.supervisor?.snapshot?.() || null
        });
    }

    #reconciliationAction() {
        if (this.pendingCraftReconciliation) return 'fresh-reconcile-quarantined-craft';
        if (this.pendingB5CompletionProvenance) {
            if (Number(this.pendingB5CompletionProvenance.recoveryGeneration) === Number(this.modeContext.generation())) {
                return 'recover-proven-b5-only';
            }
            return 'fresh-reconcile-proven-b5-on-current-generation';
        }
        return null;
    }

    #startLoop() {
        if (!this.supervisor || this.supervisor.get('main-loop')) return;
        const restartPolicy = this.faultPolicy.restartPolicy();
        const handle = this.supervisor.start('main-loop', async task => {
            const attempt = this.faultPolicy.beforeAttempt();
            if (!attempt.allowed) {
                const error = Object.assign(new Error('B5 mode fault circuit is open.'), { code: 'MODE_CIRCUIT_OPEN', retryable: false });
                throw error;
            }
            try {
                return await this.#loop(task.cancellationToken);
            } catch (error) {
                this.faultPolicy.record(error, {
                    operation: 'B5CraftMode', step: 'main-loop', phase: this.phase,
                    cancelled: error?.code === 'CANCELLED'
                });
                throw error;
            }
        }, {
            restart: 'on-failure',
            maxRestarts: restartPolicy.maxRestarts,
            baseDelayMs: restartPolicy.baseDelayMs,
            maxDelayMs: restartPolicy.maxDelayMs,
            metadata: { modeId: this.modeId, policy: 'craft-storage-smelting-no-movement' }
        });
        handle.promise.catch(error => {
            if (error?.code === 'CANCELLED') return;
            this.lastError = { message: error?.message || String(error), code: error?.code || null };
            this.setPhase('ERROR');
        });
    }

    async #loop(cancellationToken) {
        while (!cancellationToken.isCancelled && this.enabled && !this.paused) {
            if (!this.modeContext.connected()) {
                this.setPhase('WAITING_CONNECTION');
                this.waitingReason = 'connection';
                await Timeout.delay(this.config.disconnectedPollMs, { cancellationToken });
                continue;
            }

            const generation = this.modeContext.generation();
            if (this.preparedGeneration !== null
                && this.preparedGeneration !== generation
                && this.config.autoResumeOnReconnect === false
                && this.manualResumeGeneration !== generation) {
                this.waitingReason = 'manual-resume-after-reconnect';
                this.setPhase('WAITING_MANUAL_RESUME');
                await Timeout.delay(this.config.pollIntervalMs, { cancellationToken });
                continue;
            }
            if (this.preparedGeneration !== generation) {
                await this.#prepareGeneration(generation, cancellationToken);
            }
            if (!this.#generationCurrent(generation)) {
                await this.#waitForFreshGeneration(cancellationToken, 'generation-changed-after-prepare');
                continue;
            }

            if (this.pendingCraftReconciliation) {
                const reconciled = await this.#reconcilePendingCraft(generation, cancellationToken);
                if (!reconciled) continue;
                if (!this.#generationCurrent(generation)) {
                    await this.#waitForFreshGeneration(cancellationToken, 'generation-changed-after-craft-reconciliation');
                    continue;
                }
            }

            if (this.pendingB5CompletionProvenance) {
                const completionReady = await this.#reconcilePendingB5CompletionProvenance(generation, cancellationToken);
                if (!completionReady) continue;
                if (!this.#generationCurrent(generation)) {
                    await this.#waitForFreshGeneration(cancellationToken, 'generation-changed-after-b5-completion-reconciliation');
                    continue;
                }
            }

            if (Number.isFinite(this.nextB5CycleAt) && Date.now() < this.nextB5CycleAt) {
                const remainingMs = Math.max(1, this.nextB5CycleAt - Date.now());
                this.waitingReason = 'b5-cooldown';
                this.setPhase('B5_COOLDOWN');
                this.lastCycleDelayMs = Math.min(this.config.pollIntervalMs, remainingMs);
                await Timeout.delay(this.lastCycleDelayMs, { cancellationToken });
                continue;
            }
            if (Number.isFinite(this.nextB5CycleAt) && Date.now() >= this.nextB5CycleAt) this.nextB5CycleAt = null;

            this.cycles += 1;
            this.lastCycleAt = new Date().toISOString();
            this.waitingReason = null;

            if (this.batchProtectionRequired) {
                const protectionBatchId = this.batchId;
                const protectionTrigger = this.batchTrigger;
                const eligibility = this.#protectionRetryEligibility(generation);
                if (!eligibility.eligible) {
                    this.waitingReason = eligibility.waitingReason;
                    this.setPhase(eligibility.waitingReason === 'storage-protection-blocked' ? 'WAITING_BLOCKED' : 'WAITING_RETRY');
                    this.lastCycleDelayMs = eligibility.delayMs;
                    await Timeout.delay(eligibility.delayMs, { cancellationToken });
                    continue;
                }

                const episode = this.protectionEpisode;
                this.setPhase('STORAGE_PROTECTION');
                this.storageProtectionRuns += 1;
                if (episode) {
                    episode.attemptsStarted += 1;
                    episode.totalAttempts = episode.attemptsStarted;
                    episode.lastAttemptGeneration = generation;
                    episode.state = 'RUNNING';
                    episode.lastAttemptAt = Date.now();
                    episode.operatorRetryRequested = false;
                    episode.generationRetryPending = false;
                }
                this.protectionInFlight = {
                    batchId: protectionBatchId,
                    episodeId: episode?.episodeId || null,
                    trigger: protectionTrigger,
                    generation,
                    attempt: episode?.totalAttempts || this.storageProtectionRuns,
                    startedAt: new Date().toISOString()
                };
                const protectionOperation = new Operation({
                    name: 'B5StorageProtectionBoundary',
                    lockKeys: [],
                    returnsResult: true,
                    execute: operationContext => this.b1Materials.protectForB5Batch({
                        cancellationToken: operationContext.cancellation.token,
                        operationContext,
                        expectedGeneration: operationContext.connectionGeneration,
                        batchId: protectionBatchId,
                        trigger: protectionTrigger,
                        episodeId: episode?.episodeId || null
                    })
                });
                const protectedResult = await this.modeContext.run(protectionOperation, {
                    // Storage protection is bounded by an immutable business plan and
                    // per-action timeouts. It must not inherit the generic 30s root
                    // execution deadline, otherwise a healthy multi-step protection
                    // episode can be cancelled mid-plan.
                    timeoutMs: null,
                    cancellationToken,
                    connectionGeneration: generation,
                    correlationId: episode?.correlationId || episode?.episodeId || protectionBatchId,
                    metadata: {
                        subsystem: 'b5-craft',
                        step: 'storage-protection-boundary',
                        batchId: protectionBatchId,
                        episodeId: episode?.episodeId || null,
                        trigger: protectionTrigger
                    }
                });

                // A protection result belongs to an exact generation, batch and
                // stable business episode. A stale callback may never complete
                // or release a newer pending gate.
                const staleProtection = !this.#generationCurrent(generation)
                    || protectionBatchId !== this.batchId
                    || (episode && this.protectionEpisode?.episodeId !== episode.episodeId);
                if (this.protectionInFlight?.batchId === protectionBatchId
                    && this.protectionInFlight?.generation === generation) {
                    this.protectionInFlight = null;
                }
                if (staleProtection) {
                    if (episode && this.protectionEpisode?.episodeId === episode.episodeId) {
                        episode.state = 'PENDING';
                        episode.staleAborts += 1;
                        episode.generationRetryPending = true;
                    }
                    if (!this.#generationCurrent(generation)) {
                        await this.#waitForFreshGeneration(cancellationToken, 'generation-changed-during-storage-protection');
                    }
                    continue;
                }
                if (protectedResult?.success === false) {
                    this.lastResult = this.#compactResult(protectedResult);
                    this.#recordProtectionFailure(protectedResult, generation);
                    const retry = this.#protectionRetryEligibility(generation);
                    this.waitingReason = retry.waitingReason;
                    this.setPhase(retry.waitingReason === 'storage-protection-blocked' ? 'WAITING_BLOCKED' : 'WAITING_RETRY');
                    this.lastCycleDelayMs = retry.delayMs;
                    await Timeout.delay(retry.delayMs, { cancellationToken });
                    continue;
                }

                const protectionData = protectedResult?.data || {};
                const continuation = protectionData.continuationRequired === true
                    || protectionData.trimmed?.continuationRequired === true;
                if (continuation) {
                    const progress = protectionData.trimmed || protectionData;
                    const delayMs = Math.max(1, Number(progress.nextDelayMs || 300));
                    const waitingForReserveInput = progress.waitingForReserveInput === true;
                    const verifiedCoverages = Object.values(progress.finalCoverage || {})
                        .map(family => Number(family?.coverage))
                        .filter(Number.isFinite);
                    if (episode) {
                        episode.state = 'WAITING_CONTINUE';
                        episode.blocker = null;
                        episode.nextEligibleAt = Date.now() + delayMs;
                        episode.continuationSlices += 1;
                        if (progress.baselineDigest) episode.baselineDigest = progress.baselineDigest;
                        episode.lastProgress = {
                            step: waitingForReserveInput ? 'reserve-input-checkpoint' : 'sell-slice-checkpoint',
                            sellBaselineDigest: progress.baselineDigest || episode.baselineDigest || null,
                            sliceNumber: progress.sliceNumber ?? null,
                            sliceClicks: progress.sliceClicks ?? null,
                            soldClicks: progress.soldClicks ?? null,
                            clickBudget: progress.clickBudget ?? null,
                            actionsRemaining: progress.actionsRemaining ?? null,
                            remainingSellStacks: progress.actionsRemaining ?? null,
                            retainedRemainderItems: progress.retainedRemainderItems && typeof progress.retainedRemainderItems === 'object'
                                ? Object.values(progress.retainedRemainderItems).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0)
                                : null,
                            deferredNewInput: progress.deferredNewInput || null,
                            waitingForReserveInput,
                            reserveShortages: progress.reserveShortages || [],
                            verifiedCoverage: verifiedCoverages.length > 0 ? Math.min(...verifiedCoverages) : null,
                            deadlineYielded: progress.deadlineYielded === true
                        };
                    }
                    this.waitingReason = waitingForReserveInput
                        ? 'storage-reserve-input'
                        : 'storage-protection-continuing';
                    this.setPhase('STORAGE_PROTECTION_CONTINUE');
                    this.lastCycleDelayMs = delayMs;
                    const shouldSummarize = episode?.continuationSlices === 1
                        || Number(episode?.continuationSlices || 0) % 10 === 0;
                    const log = shouldSummarize ? this.logger?.info : this.logger?.debug;
                    log?.call(this.logger, waitingForReserveInput
                        ? 'B5 PURE: immutable sell baseline is complete; waiting for reserve input without repeating protection.'
                        : 'B5 PURE: verified 64-only storage sale will continue from the same immutable baseline.', {
                        botId: this.botId,
                        operation: 'B5CraftMode',
                        step: 'storage-protection-continue',
                        batchId: protectionBatchId,
                        episodeId: episode?.episodeId || null,
                        state: episode?.state || 'WAITING_CONTINUE',
                        progress: episode?.lastProgress || null,
                        nextDelayMs: delayMs
                    });
                    await Timeout.delay(delayMs, { cancellationToken });
                    continue;
                }

                this.batchProtectionRequired = false;
                this.batchProtectionCompleted = true;
                if (episode) {
                    episode.state = 'COMPLETE';
                    episode.blocker = null;
                    episode.nextEligibleAt = null;
                    episode.completedGeneration = generation;
                    episode.completedAt = Date.now();
                    // A business blocker is outside the crash-loop budget. Its
                    // recovery must close only that incident, never erase
                    // unrelated transient failures already counted by the mode.
                    this.faultPolicy.resolveEpisode(episode.episodeId, {
                        reason: 'storage-protection-complete',
                        batchId: protectionBatchId,
                        connectionGeneration: generation,
                        completedAt: episode.completedAt
                    });
                }
                this.logger?.info?.('B5 PURE: storage protection completed before craft campaign.', {
                    botId: this.botId,
                    operation: 'B5CraftMode',
                    step: 'protect-before-batch',
                    batchId: protectionBatchId,
                    episodeId: episode?.episodeId || null,
                    trigger: protectionTrigger,
                    connectionGeneration: generation
                });
            }

            // Do not perform a second standalone planning read here. runNext()
            // owns a single fresh /kho + /pv2 + inventory snapshot inside the
            // same managed operation as the craft. The old extra pre-read could
            // fail or leave GUI state between protection and crafting, causing a
            // cycle to stop before B5Automation was ever called.
            if (!this.#generationCurrent(generation)) {
                await this.#waitForFreshGeneration(cancellationToken, 'generation-changed-before-craft');
                continue;
            }
            this.setPhase('CRAFTING');
            this.automationRuns += 1;
            this.lastAutomationAt = new Date().toISOString();
            const result = await this.b5Automation.runNext({
                cancellationToken,
                expectedGeneration: generation,
                freshInspection: true,
                recoveryOnly: Boolean(this.pendingB5CompletionProvenance),
                decompressionPolicy: 'unbounded'
            });
            if (!this.#generationCurrent(generation)) {
                await this.#waitForFreshGeneration(cancellationToken, 'generation-changed-during-craft');
                continue;
            }
            this.lastResult = this.#compactResult(result);
            this.lastAutomationBlockers = Array.isArray(result?.data?.blockingReasons)
                ? result.data.blockingReasons.slice(0, 12)
                : [];

            if (result?.success === false) {
                await this.#handleSoftFailure(result, cancellationToken, generation);
                continue;
            }

            const data = result?.data || {};
            if (data.productive === true) this.productiveCycles += 1;
            if (data.recoveredExistingB5 === true && this.pendingB5CompletionProvenance) {
                const provenance = this.pendingB5CompletionProvenance;
                const recoveredAmount = Math.max(0, Number(data.recoveredAmount || 0));
                const provenAmount = Math.max(1, Number(provenance.amount || 1));
                const provenanceMatches = provenance.batchId === this.batchId
                    && Number(provenance.recoveryGeneration) === Number(generation)
                    && String(data.targetId || '') === String(provenance.outputId || '')
                    && recoveredAmount >= provenAmount;
                if (!provenanceMatches) {
                    this.waitingReason = 'b5-recovery-provenance-mismatch';
                    this.setPhase('WAITING_RECONCILE');
                    await Timeout.delay(this.config.reconciliation.unresolvedPollMs, { cancellationToken });
                    continue;
                }
                this.#accountProvenB5Completion(provenance, provenAmount, 'verified-recovery-pv2', generation);
                if (recoveredAmount > provenAmount) {
                    this.logger?.info?.('B5 PURE: recovery also moved orphan/pre-existing B5; only proven provenance amount is accounted as production.', {
                        botId: this.botId,
                        operation: 'B5CraftMode',
                        step: 'account-recovered-b5',
                        markerId: provenance.markerId,
                        provenAmount,
                        orphanRecoveredAmount: recoveredAmount - provenAmount
                    });
                }
                this.pendingB5CompletionProvenance = null;
            }
            if (data.recoveryOnly === true && this.pendingB5CompletionProvenance) {
                this.pendingB5CompletionProvenance.recoveryGeneration = null;
                this.waitingReason = 'b5-completion-recovery-not-observed';
                this.setPhase('WAITING_RECONCILE');
                await Timeout.delay(this.config.reconciliation.unresolvedPollMs, { cancellationToken });
                continue;
            }
            if (data.completedNewB5 === true) {
                const completedAmount = Math.max(1, Number(data.completedAmount || 1));
                this.completedB5 += completedAmount;
                this.#armBatchProtection('post-b5-complete');
                this.nextB5CycleAt = Date.now() + this.config.postB5CooldownMs;
                this.logger?.info?.('B5 thuần: đã chế và cất B5.', {
                    botId: this.botId,
                    completedAmount,
                    completedB5Total: this.completedB5,
                    cycle: this.cycles
                });

                // Raw iron/gold received while crafting belongs to the next
                // batch. Smelt it immediately after the completed B5 is
                // verified and stored. Failure is non-destructive: the already
                // armed next-batch protection boundary will retry smelting
                // before any later craft.
                if (typeof this.b1Materials.preprocessForCraft === 'function'
                    && this.#generationCurrent(generation)) {
                    this.setPhase('POST_B5_SMELTING');
                    const postB5Smelting = new Operation({
                        name: 'B5PostCraftSmelting',
                        lockKeys: [],
                        returnsResult: true,
                        execute: operationContext => this.b1Materials.preprocessForCraft({
                            cancellationToken: operationContext.cancellation.token,
                            operationContext,
                            expectedGeneration: operationContext.connectionGeneration
                        })
                    });
                    const smeltResult = await this.modeContext.run(postB5Smelting, {
                        timeoutMs: null,
                        cancellationToken,
                        connectionGeneration: generation,
                        correlationId: this.batchId,
                        metadata: {
                            subsystem: 'b5-craft',
                            step: 'post-b5-smelting',
                            batchId: this.batchId
                        }
                    });
                    if (this.#generationCurrent(generation) && smeltResult?.success === false) {
                        this.logger?.warn?.('B5 PURE: post-craft iron/gold smelting did not complete; next batch protection will retry it.', {
                            botId: this.botId,
                            operation: 'B5CraftMode',
                            step: 'post-b5-smelting',
                            batchId: this.batchId,
                            errorCode: smeltResult?.error?.code || null,
                            reason: smeltResult?.message || null
                        });
                    }
                }
            }

            const blocker = this.#primaryBlocker(data);

            // A successful mutation means this campaign advanced. Ignore the
            // trailing prerequisite/blocker for scheduling purposes and perform
            // a fresh re-plan immediately. Treating productive partial B2/B3/B4
            // work as "no progress" caused the mode to back off and restart the
            // full B1 normalization loop before returning to crafting.
            if (data.completedNewB5 !== true && data.productive === true) {
                this.#resetNoProgress();
                this.waitingReason = null;
                        this.setPhase('RUNNING');
                this.lastCycleDelayMs = this.config.craftLoopDelayMs;
                await Timeout.delay(this.config.craftLoopDelayMs, { cancellationToken });
                continue;
            }

            if (data.completedNewB5 !== true && (data.waitingForMaterials === true || data.productive === false || blocker)) {
                this.waitingReason = blocker?.category || (data.pv2Backpressure?.hardBlocked ? 'pv2-backpressure' : 'materials');


                this.setPhase(this.waitingReason === 'pv2-backpressure' ? 'WAITING_PV2'
                    : this.waitingReason === 'decompression-headroom' ? 'WAITING_HEADROOM'
                        : 'WAITING_MATERIALS');
                const wait = this.#recordNoProgress(blocker, data);
                const log = wait.shouldAnnounce ? this.logger?.info : this.logger?.debug;
                log?.call(this.logger, 'B5 PURE: cycle is waiting for a concrete prerequisite.', {
                    botId: this.botId,
                    operation: 'B5CraftMode',
                    step: 'cycle-result',
                    waitingReason: this.waitingReason,
                    blocker: blocker || null,
                    noProgressStreak: this.noProgressStreak,
                    nextPollMs: wait.delayMs,
                    actionSummary: data.actionSummary || null,
                    progress: data.progress || null
                });
                await Timeout.delay(wait.delayMs, { cancellationToken });
            } else {
                this.#resetNoProgress();
                this.waitingReason = null;
                        this.setPhase(data.completedNewB5 === true ? 'B5_COMPLETED' : 'RUNNING');
                this.lastCycleDelayMs = this.config.craftLoopDelayMs;
                await Timeout.delay(this.config.craftLoopDelayMs, { cancellationToken });
            }
        }
    }

    #armBatchProtection(trigger) {
        const batch = this.batchCoordinator.next(trigger);
        this.batchSequence = batch.sequence;
        this.batchId = batch.batchId;
        this.batchTrigger = batch.trigger;
        this.batchProtectionRequired = true;
        this.batchProtectionCompleted = false;
        this.protectionInFlight = null;
        this.protectionEpisode = StorageProtectionEpisode.create({
            batchId: this.batchId,
            trigger: batch.trigger,
            evidenceKey: this.#protectionEvidenceKey(null)
        });
    }

    #requestProtectionRetry(reason) {
        if (!this.batchProtectionRequired || !this.protectionEpisode) return;
        this.protectionEpisode.operatorRetryRequested = true;
        this.protectionEpisode.operatorRetryReason = reason || 'operator';
    }

    requestStorageProtectionRetry({
        expectedBotId,
        expectedGeneration,
        episodeId,
        incidentId,
        idempotencyKey,
        reason = 'operator'
    } = {}) {
        const key = String(idempotencyKey || '').trim();
        if (!/^[a-z0-9][a-z0-9:._-]{0,127}$/i.test(key)) return this.#retryRejected(Status.INVALID_INPUT, 'B5_RETRY_IDEMPOTENCY_KEY_INVALID', 'Khóa idempotency không hợp lệ.');
        const fingerprint = JSON.stringify({
            expectedBotId: String(expectedBotId || ''),
            expectedGeneration: Number(expectedGeneration),
            episodeId: String(episodeId || ''),
            incidentId: String(incidentId || '')
        });
        this.#trimRetryCache();
        const cached = this.protectionRetryRequests.get(key);
        if (cached) {
            if (cached.fingerprint !== fingerprint) return this.#retryRejected(Status.INVALID_INPUT, 'B5_RETRY_IDEMPOTENCY_CONFLICT', 'Khóa idempotency đã được dùng cho một yêu cầu khác.');
            return cached.result;
        }
        const episode = this.protectionEpisode;
        if (String(expectedBotId || '') !== this.botId) return this.#cacheRetry(key, fingerprint, this.#retryRejected(Status.INVALID_INPUT, 'B5_RETRY_WRONG_BOT', 'Yêu cầu thử lại không thuộc bot hiện tại.'));
        if (!this.enabled || this.paused || this.phase !== 'WAITING_BLOCKED' || !this.batchProtectionRequired || !episode || episode.state !== 'WAITING_BLOCKED') {
            return this.#cacheRetry(key, fingerprint, this.#retryRejected(Status.NOT_READY, 'B5_RETRY_UNSAFE_PHASE', 'Bảo vệ kho hiện không ở trạng thái chờ bị chặn.'));
        }
        if (Number(expectedGeneration) !== Number(this.modeContext.generation())) return this.#cacheRetry(key, fingerprint, this.#retryRejected(Status.DISCONNECTED, 'B5_RETRY_STALE_GENERATION', 'Kết nối đã thay đổi; hãy tải trạng thái mới.'));
        if (String(episodeId || '') !== episode.episodeId || String(incidentId || '') !== episode.correlationId) {
            return this.#cacheRetry(key, fingerprint, this.#retryRejected(Status.INVALID_INPUT, 'B5_RETRY_STALE_EPISODE', 'Episode bảo vệ kho đã thay đổi; hãy tải trạng thái mới.'));
        }
        if (episode.operatorRetryRequested) return this.#cacheRetry(key, fingerprint, this.#retryRejected(Status.BUSY, 'B5_RETRY_ALREADY_REQUESTED', 'Một yêu cầu thử lại đang chờ xử lý.'));
        this.#requestProtectionRetry(reason);
        return this.#cacheRetry(key, fingerprint, Result.ok({
            accepted: true,
            botId: this.botId,
            connectionGeneration: this.modeContext.generation(),
            episodeId: episode.episodeId,
            incidentId: episode.correlationId
        }, { idempotencyKey: key }));
    }

    #retryRejected(status, code, message) {
        const error = Object.assign(new Error(message), { code, retryable: false });
        return Result.fail(status, message, error);
    }

    #cacheRetry(key, fingerprint, result) {
        this.protectionRetryRequests.set(key, { fingerprint, result, expiresAt: Date.now() + PROTECTION_RETRY_CACHE_TTL_MS });
        this.#trimRetryCache();
        return result;
    }

    #trimRetryCache() {
        const now = Date.now();
        for (const [key, entry] of this.protectionRetryRequests) {
            if (!entry || entry.expiresAt <= now) this.protectionRetryRequests.delete(key);
        }
        while (this.protectionRetryRequests.size > 64) this.protectionRetryRequests.delete(this.protectionRetryRequests.keys().next().value);
    }

    #recoverySurface() {
        const episode = this.protectionEpisode;
        const allowed = Boolean(this.enabled && !this.paused && this.phase === 'WAITING_BLOCKED'
            && this.batchProtectionRequired && episode?.state === 'WAITING_BLOCKED' && !episode.operatorRetryRequested);
        return {
            summary: allowed ? 'Bảo vệ kho đã dừng an toàn và cần người vận hành quyết định.' : null,
            safeState: this.batchProtectionCompleted ? 'PROTECTED' : this.batchProtectionRequired ? 'CRAFT_NOT_STARTED' : 'UNKNOWN',
            allowedActions: allowed ? ['retry-storage-protection', 'inspect-diagnostic', 'export-support'] : ['inspect-diagnostic', 'export-support']
        };
    }

    #protectionRetryEligibility(generation) {
        const episode = this.protectionEpisode;
        const baseDelay = Math.max(1, Number(this.config.errorRetryMs || 1));
        if (!episode || !episode.blocker) {
            return { eligible: true, waitingReason: null, delayMs: baseDelay, trigger: 'pending' };
        }

        const now = Date.now();
        const currentEvidenceKey = this.#protectionEvidenceKey(episode.blocker);
        const evidenceChanged = currentEvidenceKey !== null
            && episode.evidenceKey !== null
            && currentEvidenceKey !== episode.evidenceKey;
        const generationChanged = episode.lastAttemptGeneration !== null
            && Number(episode.lastAttemptGeneration) !== Number(generation);
        const operatorRequested = episode.operatorRetryRequested === true;
        const staleGenerationRetry = episode.generationRetryPending === true && generationChanged;

        if (operatorRequested) {
            // A meaningful external trigger grants one controlled retry. If the
            // blocker is unchanged again, return to WAITING_BLOCKED instead of
            // opening a fresh automatic retry window.
            episode.sameBlockerAttempts = Math.max(0, PROTECTION_SAME_BLOCKER_LIMIT - 1);
            episode.nextEligibleAt = 0;
            episode.evidenceKey = currentEvidenceKey;
            episode.state = 'PENDING';
            return { eligible: true, waitingReason: null, delayMs: baseDelay, trigger: 'operator' };
        }
        if (staleGenerationRetry) {
            episode.nextEligibleAt = 0;
            episode.state = 'PENDING';
            return { eligible: true, waitingReason: null, delayMs: baseDelay, trigger: 'stale-generation-retry' };
        }
        if (episode.blocker?.retryable === false) {
            episode.state = 'WAITING_BLOCKED';
            return {
                eligible: false,
                waitingReason: 'storage-protection-blocked',
                delayMs: Math.max(baseDelay, Math.min(this.config.errorRetryMaxMs, this.config.pollIntervalMs)),
                trigger: 'non-retryable-blocker'
            };
        }
        if (evidenceChanged) {
            episode.sameBlockerAttempts = Math.max(0, PROTECTION_SAME_BLOCKER_LIMIT - 1);
            episode.nextEligibleAt = 0;
            episode.evidenceKey = currentEvidenceKey;
            episode.state = 'PENDING';
            return { eligible: true, waitingReason: null, delayMs: baseDelay, trigger: 'evidence-changed' };
        }
        if (episode.sameBlockerAttempts < PROTECTION_SAME_BLOCKER_LIMIT
            && episode.businessFailureAttempts < PROTECTION_TOTAL_AUTO_ATTEMPT_LIMIT) {
            if (now >= Number(episode.nextEligibleAt || 0)) {
                episode.state = 'PENDING';
                return { eligible: true, waitingReason: null, delayMs: baseDelay, trigger: 'bounded-backoff-retry' };
            }
            episode.state = 'WAITING_RETRY';
            return {
                eligible: false,
                waitingReason: 'storage-protection-backoff',
                delayMs: Math.max(1, Number(episode.nextEligibleAt || now) - now),
                trigger: 'bounded-backoff-wait'
            };
        }

        episode.state = 'WAITING_BLOCKED';
        return {
            eligible: false,
            waitingReason: 'storage-protection-blocked',
            delayMs: Math.max(baseDelay, Math.min(this.config.errorRetryMaxMs, this.config.pollIntervalMs)),
            trigger: 'blocked'
        };
    }

    #recordProtectionFailure(result, generation) {
        const episode = this.protectionEpisode;
        if (!episode) return;
        const blocker = this.#protectionBlocker(result);
        const diagnostic = result?.error?.details || result?.meta?.details || {};
        const retainedRemainders = diagnostic?.retainedRemainderItems;
        const retainedRemainderItems = retainedRemainders && typeof retainedRemainders === 'object'
            ? Object.values(retainedRemainders).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0)
            : null;
        const remainingSellStacks = Number.isFinite(Number(diagnostic?.actionsRemaining))
            ? Math.max(0, Number(diagnostic.actionsRemaining))
            : null;
        if (diagnostic?.baselineDigest) episode.baselineDigest = diagnostic.baselineDigest;
        episode.lastProgress = {
            step: blocker.step || 'storage-protection-boundary',
            sellBaselineDigest: diagnostic?.baselineDigest || episode.baselineDigest || null,
            sliceNumber: diagnostic?.sliceNumber ?? null,
            sliceClicks: diagnostic?.sliceClicks ?? null,
            soldClicks: diagnostic?.soldClicks ?? null,
            clickBudget: diagnostic?.clickBudget ?? null,
            actionsRemaining: remainingSellStacks,
            remainingSellStacks,
            retainedRemainderItems,
            deferredNewInput: diagnostic?.deferredNewInput || null,
            reserveViolations: diagnostic?.reserveViolations || null,
            secondaryCauses: diagnostic?.secondaryCauses || null
        };
        const same = blocker.signature === episode.lastBlockerSignature;
        episode.businessFailureAttempts += 1;
        episode.sameBlockerAttempts = same ? episode.sameBlockerAttempts + 1 : 1;
        episode.lastBlockerSignature = blocker.signature;
        episode.lastAttemptGeneration = generation;
        episode.evidenceKey = this.#protectionEvidenceKey(blocker);
        const exponent = Math.max(0, episode.sameBlockerAttempts - 1);
        const backoffMs = Math.min(this.config.errorRetryMaxMs, this.config.errorRetryMs * (2 ** exponent));
        episode.nextEligibleAt = Date.now() + backoffMs;
        episode.blocker = {
            ...blocker,
            sameBlockerAttempts: episode.sameBlockerAttempts,
            totalAttempts: episode.attemptsStarted,
            attemptsStarted: episode.attemptsStarted,
            businessFailureAttempts: episode.businessFailureAttempts,
            staleAborts: episode.staleAborts,
            lastAttemptGeneration: generation,
            backoffMs,
            nextEligibleAt: episode.nextEligibleAt
        };
        const exhausted = blocker.retryable === false
            || episode.sameBlockerAttempts >= PROTECTION_SAME_BLOCKER_LIMIT
            || episode.businessFailureAttempts >= PROTECTION_TOTAL_AUTO_ATTEMPT_LIMIT;
        episode.state = exhausted ? 'WAITING_BLOCKED' : 'WAITING_RETRY';

        if (exhausted) {
            const error = Object.assign(new Error(blocker.reason), { code: blocker.code, retryable: false });
            this.faultPolicy.recordBlocker(error, {
                episodeId: episode.episodeId,
                correlationId: episode.correlationId,
                operation: 'B5CraftMode',
                step: blocker.step || 'storage-protection-boundary',
                phase: 'WAITING_BLOCKED',
                resource: blocker.resource,
                operatorSummary: 'Bảo vệ kho đã dừng an toàn sau số lần thử giới hạn.',
                details: { batchId: this.batchId, blocker: episode.blocker }
            });
        }

        const log = !same || exhausted ? this.logger?.warn : this.logger?.debug;
        log?.call(this.logger, 'B5 PURE: storage protection is blocked; retry is bounded across loop cycles.', {
            botId: this.botId, operation: 'B5CraftMode', step: 'storage-protection-blocked',
            batchId: this.batchId, episodeId: episode.episodeId,
            blocker: episode.blocker, state: episode.state
        });
    }

    #protectionBlocker(result) {
        const details = result?.error?.details || result?.meta?.details || {};
        const nested = details?.blocker && typeof details.blocker === 'object' ? details.blocker : {};
        const code = result?.error?.code || result?.meta?.code || result?.status || 'STORAGE_PROTECTION_FAILED';
        const reason = nested.reason || details.reason || result?.message || code;
        const resource = nested.material || nested.sellId || result?.error?.resource
            || details.resource || details.recipeId || details.baseId
            || details.reserveViolations?.[0]?.baseId || null;
        const rawStep = result?.error?.step || details.step || null;
        const step = code === 'TIMEOUT' && !rawStep ? 'storage-protection-boundary' : rawStep;
        const retryable = result?.error?.retryable !== false
            && result?.meta?.retryable !== false
            && details?.retryable !== false;
        // TIMEOUT messages contain the root operation id (bot-01:N), which is
        // unique per attempt and must never fragment one stable blocker into a
        // stream of fake one-off blockers.
        const signatureReason = code === 'TIMEOUT' ? 'operation-timeout' : reason;
        const signature = [code, step || '', signatureReason || '', resource || ''].join(':');
        return { code, step, reason, resource, signature, retryable };
    }

    #protectionEvidenceKey(blocker) {
        try {
            return this.b1Materials.protectionEvidenceKey?.(blocker) ?? null;
        } catch (_) {
            return null;
        }
    }

    #publicProtectionEpisode() {
        const episode = this.protectionEpisode;
        if (!episode) return null;
        return {
            batchId: episode.batchId,
            episodeId: episode.episodeId,
            correlationId: episode.correlationId,
            trigger: episode.trigger,
            state: episode.state,
            totalAttempts: episode.attemptsStarted,
            attemptsStarted: episode.attemptsStarted,
            businessFailureAttempts: episode.businessFailureAttempts,
            staleAborts: episode.staleAborts,
            sameBlockerAttempts: episode.sameBlockerAttempts,
            continuationSlices: episode.continuationSlices,
            baselineDigest: episode.baselineDigest || null,
            lastProgress: episode.lastProgress ? { ...episode.lastProgress } : null,
            blocker: episode.blocker ? { ...episode.blocker } : null,
            lastAttemptGeneration: episode.lastAttemptGeneration,
            nextEligibleAt: Number.isFinite(episode.nextEligibleAt) ? episode.nextEligibleAt : null,
            completedGeneration: episode.completedGeneration,
            completedAt: episode.completedAt
        };
    }

    async #prepareGeneration(generation, cancellationToken) {
        this.setPhase('WAITING_SKYBLOCK');
        this.waitingReason = 'skyblock';
        this.skyblockReadiness?.requireTarget?.(this.skyTarget, { owner: this.modeId, trigger: 'b5-prepare-generation' });

        if (this.skyblockReadiness?.isGenerationReady) {
            while (!this.skyblockReadiness.isGenerationReady(generation, this.skyTarget)) {
                cancellationToken.throwIfCancelled();
                if (!this.modeContext.connected() || this.modeContext.generation() !== generation) return;
                await Timeout.delay(250, { cancellationToken });
            }
        }

        if (this.config.teleportHomeOnEnable) {
            this.setPhase('GOING_HOME');
            const home = await this.island.goHome({ cancellationToken, expectedGeneration: generation });
            if (home?.success === false) {
                const error = home.error || new Error(home.message || 'Không thể /is trước khi chế B5.');
                error.code ||= 'B5_CRAFT_HOME_FAILED';
                throw error;
            }
        }

        this.preparedGeneration = generation;
        this.waitingReason = null;
        this.setPhase('RUNNING');
    }

    async #handleSoftFailure(result, cancellationToken, generation) {
        this.lastResult = this.#compactResult(result);
        const status = String(result?.status || '').toUpperCase();
        const capturedReconciliation = this.#captureCraftReconciliation(result, generation);
        if (capturedReconciliation) {
            this.waitingReason = 'craft-reconciliation';
            this.setPhase('WAITING_RECONCILE');
            await Timeout.delay(this.config.reconciliation.retryMs, { cancellationToken });
            return;
        }
        if ([Status.DISCONNECTED, Status.NOT_READY, Status.TIMEOUT, Status.VERIFICATION_FAILED].includes(status)) {
            this.waitingReason = status.toLowerCase();
            this.setPhase(status === Status.DISCONNECTED ? 'WAITING_CONNECTION' : 'WAITING_RETRY');
            await Timeout.delay(this.config.errorRetryMs, { cancellationToken });
            return;
        }
        const error = result?.error || new Error(result?.message || 'B5 craft cycle failed.');
        throw error;
    }

    #captureCraftReconciliation(result, generation) {
        const details = result?.error?.details || result?.meta?.details || null;
        const outcome = details?.outcome || null;
        if (outcome?.requiresReconciliation !== true) return false;
        const baseline = details?.reconciliationBaseline || {};
        const inputExpected = Object.fromEntries((details?.inputEvidence || [])
            .filter(entry => entry?.inputId)
            .map(entry => [entry.inputId, Math.max(0, Number(entry.expected || 0))]));
        const inputBaselines = {};
        for (const [inputId, expected] of Object.entries(inputExpected)) {
            const evidence = (details?.inputEvidence || []).find(entry => entry?.inputId === inputId) || null;
            const explicit = baseline?.inputs?.[inputId] || null;
            let source = String(explicit?.source || evidence?.source || '').trim().toLowerCase();
            if (!source && String(evidence?.reason || '').startsWith('input-source:')) {
                source = String(evidence.reason).slice('input-source:'.length).trim().toLowerCase();
            }
            if (!source) source = 'inventory';
            let count = Number(explicit?.count);
            if (!Number.isFinite(count) && source === 'inventory') {
                const legacy = Number(baseline?.inputCountsBefore?.[inputId]);
                if (Number.isFinite(legacy)) count = legacy;
            }
            inputBaselines[inputId] = {
                source,
                count: Number.isFinite(count) ? Math.max(0, count) : null,
                expected: Math.max(0, Number(expected || 0))
            };
        }
        const outputSource = String(baseline?.output?.source || 'inventory').trim().toLowerCase() || 'inventory';
        const explicitOutputCount = Number(baseline?.output?.count);
        const legacyOutputCount = Number(baseline?.outputCountBefore ?? details?.before ?? 0);
        const outputId = details?.outputId || outcome?.outputId || null;
        const completionContext = this.#b5CompletionContext(details);
        const targetId = completionContext?.targetId || result?.data?.targetId || null;
        const targetVaultBeforeRaw = Number(completionContext?.targetVaultBefore);
        const operationId = details?.operationId || result?.meta?.operationId || null;
        const correlationId = details?.correlationId || result?.meta?.correlationId || operationId || null;
        const markerId = [
            this.batchId || '',
            generation ?? '',
            operationId || correlationId || result?.error?.code || 'uncertain',
            details?.recipeId || outcome?.recipeId || '',
            outputId || '',
            Number.isFinite(explicitOutputCount) ? explicitOutputCount : legacyOutputCount
        ].join(':');
        this.pendingCraftReconciliation = {
            createdAt: new Date().toISOString(),
            operationCode: result?.error?.code || result?.meta?.code || 'CRAFTING_OUTCOME_UNCERTAIN',
            recipeId: details?.recipeId || outcome?.recipeId || null,
            outputId,
            quantity: details?.amount ?? outcome?.quantity ?? null,
            expectedDelta: Math.max(1, Number(details?.expectedDelta || 1)),
            outputSource,
            outputCountBefore: Math.max(0, Number.isFinite(explicitOutputCount) ? explicitOutputCount : legacyOutputCount),
            batchId: this.batchId,
            connectionGeneration: generation,
            operationId,
            correlationId,
            targetId,
            targetVaultBefore: Number.isFinite(targetVaultBeforeRaw) ? Math.max(0, targetVaultBeforeRaw) : null,
            isFinalTarget: Boolean(outputId && targetId && outputId === targetId),
            completionMarkerId: markerId,
            inputBaselines,
            inputExpected,
            // Evidence captured directly around the quantity click is strong
            // and remains fail-closed. Fresh /kho observations are treated
            // separately: one transient lower read must not poison the
            // transaction forever.
            initialObservedSideEffect: outcome?.observedSideEffect === true,
            observedSideEffect: outcome?.observedSideEffect === true,
            confirmedFreshSideEffect: false,
            historicalFreshSideEffectObserved: false,
            freshMutationProofPasses: 0,
            generationProofReads: 0,
            evidenceGeneration: null,
            unexpectedIdentityDeltas: Array.isArray(outcome?.unexpectedIdentityDeltas)
                ? outcome.unexpectedIdentityDeltas.slice(0, 12)
                : [],
            attempts: 0,
            noEffectProofPasses: 0,
            unresolvedSince: null,
            unresolvedPolls: 0,
            lastObserved: null
        };
        this.logger?.warn?.('B5 PURE: craft outcome is uncertain; identical mutation is quarantined until fresh reconciliation.', {
            botId: this.botId,
            operation: 'B5CraftMode',
            step: 'capture-craft-reconciliation',
            reconciliation: this.#compactReconciliation(this.pendingCraftReconciliation)
        });
        return true;
    }


    #b5CompletionContext(details) {
        if (!details || typeof details !== 'object') return null;
        const direct = details.b5CompletionContext;
        if (direct?.finalChain === true && direct.targetId) {
            return {
                finalChain: true,
                targetId: direct.targetId,
                targetVaultBefore: direct.targetVaultBefore ?? null
            };
        }
        const parent = Array.isArray(details.parentFlow)
            ? details.parentFlow.find(entry => entry?.step === 'craft-final-chain' && entry?.details?.targetId)
            : null;
        if (!parent) return null;
        return {
            finalChain: true,
            targetId: parent.details.targetId,
            targetVaultBefore: parent.details.targetVaultBefore ?? null
        };
    }

    async #reconcilePendingCraft(generation, cancellationToken) {
        const pending = this.pendingCraftReconciliation;
        if (!pending) return true;
        if (pending.batchId !== this.batchId) {
            this.waitingReason = 'craft-reconciliation-batch-mismatch';
            this.setPhase('WAITING_RECONCILE');
            await Timeout.delay(this.config.reconciliation.unresolvedPollMs, { cancellationToken });
            return false;
        }
        this.reconciliationRuns += 1;
        this.setPhase('RECONCILING_CRAFT');
        this.waitingReason = 'craft-reconciliation';

        const fresh = await this.b5Planning.inspectAdditionalFresh(1, {
            cancellationToken,
            expectedGeneration: generation
        });
        if (fresh?.success === false) {
            this.lastResult = this.#compactResult(fresh);
            this.setPhase('WAITING_RECONCILE');
            this.waitingReason = 'craft-reconcile-read-failed';
            await Timeout.delay(this.config.errorRetryMs, { cancellationToken });
            return false;
        }
        if (!this.#generationCurrent(generation)) {
            await this.#waitForFreshGeneration(cancellationToken, 'generation-changed-during-craft-reconciliation-read');
            return false;
        }

        pending.attempts += 1;
        const previousEvidenceGeneration = pending.evidenceGeneration ?? pending.lastReconciliationGeneration ?? null;
        if (previousEvidenceGeneration !== null && previousEvidenceGeneration !== generation) {
            // Consecutive fresh-read proof is generation-local. Historical reads
            // stay diagnostic-only; a replacement connection must prove its own
            // threshold without inheriting passes from the previous generation.
            pending.freshMutationProofPasses = 0;
            pending.noEffectProofPasses = 0;
            pending.confirmedFreshSideEffect = false;
            pending.generationProofReads = 0;
        }
        pending.evidenceGeneration = generation;
        pending.lastReconciliationGeneration = generation;
        pending.generationProofReads = Number(pending.generationProofReads || 0) + 1;
        const outputObserved = this.#freshLogicalCount(fresh?.data, pending.outputId, pending.outputSource || 'inventory');
        const outputNow = Number.isFinite(outputObserved) ? Math.max(0, outputObserved) : 0;
        const outputDelta = Math.max(0, outputNow - Number(pending.outputCountBefore || 0));
        const inputDeltas = {};
        let observedInputConsumption = false;
        for (const [inputId, baseline] of Object.entries(pending.inputBaselines || {})) {
            const source = String(baseline?.source || 'inventory');
            const beforeRaw = Number(baseline?.count);
            const nowRaw = this.#freshLogicalCount(fresh?.data, inputId, source);
            const observable = Number.isFinite(beforeRaw) && Number.isFinite(nowRaw);
            const before = observable ? Math.max(0, beforeRaw) : null;
            const now = Number.isFinite(nowRaw) ? Math.max(0, nowRaw) : null;
            const consumed = observable ? Math.max(0, before - now) : 0;
            inputDeltas[inputId] = {
                source,
                observable,
                before,
                now,
                consumed,
                expected: Number(pending.inputExpected?.[inputId] || baseline?.expected || 0)
            };
            if (observable && consumed > 0) observedInputConsumption = true;
        }
        pending.lastObserved = {
            at: new Date().toISOString(),
            outputNow,
            outputDelta,
            inputDeltas
        };

        if (pending.isFinalTarget === true && Number.isFinite(pending.targetVaultBefore)) {
            const vaultNow = this.#freshLogicalCount(fresh?.data, pending.outputId, 'pv2');
            const vaultDelta = Number.isFinite(vaultNow)
                ? Math.max(0, Number(vaultNow) - Number(pending.targetVaultBefore))
                : 0;
            pending.lastObserved.vaultNow = vaultNow;
            pending.lastObserved.vaultDelta = vaultDelta;
            if (vaultDelta >= pending.expectedDelta) {
                const provenance = this.#completionProvenanceFromPending(pending, pending.expectedDelta, 'fresh-pv2', generation);
                this.#accountProvenB5Completion(provenance, pending.expectedDelta, 'fresh-pv2', generation);
                this.pendingCraftReconciliation = null;
                this.pendingB5CompletionProvenance = null;
                this.waitingReason = null;
                this.setPhase('RUNNING');
                return true;
            }
        }

        if (outputDelta >= pending.expectedDelta) {
            this.logger?.info?.('B5 PURE: uncertain craft reconciled by fresh expected-output state.', {
                botId: this.botId,
                operation: 'B5CraftMode',
                step: 'reconcile-craft-outcome',
                recipeId: pending.recipeId,
                outputId: pending.outputId,
                outputDelta,
                expectedDelta: pending.expectedDelta,
                attempts: pending.attempts
            });
            if (pending.isFinalTarget === true) {
                this.pendingB5CompletionProvenance = this.#completionProvenanceFromPending(
                    pending,
                    pending.expectedDelta,
                    'fresh-inventory',
                    generation
                );
            }
            this.pendingCraftReconciliation = null;
            this.waitingReason = null;
            this.setPhase('RUNNING');
            return true;
        }

        const proofTarget = Math.max(1, Number(this.config.reconciliation.maxFreshReads || 1));
        const initialMutationObserved = pending.initialObservedSideEffect === true;
        if (observedInputConsumption) pending.historicalFreshSideEffectObserved = true;
        pending.freshMutationProofPasses = observedInputConsumption
            ? Number(pending.freshMutationProofPasses || 0) + 1
            : 0;
        if (pending.freshMutationProofPasses >= proofTarget) pending.confirmedFreshSideEffect = true;

        const mutationObserved = initialMutationObserved || pending.confirmedFreshSideEffect === true;
        pending.observedSideEffect = mutationObserved;
        const expectedInputs = Object.entries(pending.inputExpected || {})
            .filter(([, expected]) => Number(expected || 0) > 0);
        const allExpectedInputsObservable = expectedInputs.length > 0
            && expectedInputs.every(([inputId, expected]) => {
                const observed = inputDeltas[inputId];
                return observed?.observable === true
                    && Number(observed.before) >= Number(expected || 0);
            });
        const allObservableInputsAtOrAboveBaseline = allExpectedInputsObservable
            && expectedInputs.every(([inputId]) => Number(inputDeltas[inputId]?.now) >= Number(inputDeltas[inputId]?.before));
        const baselineSuperseded = allExpectedInputsObservable
            && expectedInputs.some(([inputId]) => Number(inputDeltas[inputId]?.now) > Number(inputDeltas[inputId]?.before));

        // If the click itself had no strong side-effect evidence, repeated fresh
        // state that keeps every observable input at or above its baseline and
        // the expected output unchanged supersedes the stale transaction. This
        // handles externally replenished /kho inputs without turning one noisy
        // lower read into an infinite quarantine. The planner still re-plans
        // from fresh state; it does not replay the stale click blindly.
        pending.noEffectProofPasses = (!initialMutationObserved
            && pending.confirmedFreshSideEffect !== true
            && outputDelta === 0
            && allObservableInputsAtOrAboveBaseline)
            ? Number(pending.noEffectProofPasses || 0) + 1
            : 0;

        const verifiedNoEffect = pending.noEffectProofPasses >= proofTarget;
        const barrierDecision = this.reconciliationBarrier.evaluate({
            expectedGeneration: generation,
            currentGeneration: this.modeContext.generation(),
            cancelled: cancellationToken?.isCancelled === true,
            applied: mutationObserved,
            verifiedNoEffect,
            evidence: pending.lastObserved
        });
        if (barrierDecision.outcome === ReconciliationBarrier.Outcome.STALE
            || barrierDecision.outcome === ReconciliationBarrier.Outcome.CANCELLED) {
            return false;
        }
        if (barrierDecision.mayReplan && this.config.reconciliation.allowRetryAfterVerifiedNoEffect) {
            this.logger?.info?.(baselineSuperseded
                ? 'B5 PURE: fresh material state superseded the uncertain baseline; planner may safely re-plan.'
                : 'B5 PURE: repeated fresh reads proved observable inputs and output unchanged; planner may safely re-plan.', {
                botId: this.botId,
                operation: 'B5CraftMode',
                step: 'reconcile-craft-outcome',
                recipeId: pending.recipeId,
                outputId: pending.outputId,
                attempts: pending.attempts,
                baselineSuperseded,
                noEffectProofPasses: pending.noEffectProofPasses
            });
            this.pendingCraftReconciliation = null;
            this.waitingReason = null;
            this.setPhase('RUNNING');
            return true;
        }

        if (Number(pending.generationProofReads || 0) >= this.config.reconciliation.maxFreshReads) {
            if (!pending.unresolvedSince) {
                pending.unresolvedSince = new Date().toISOString();
                this.unresolvedReconciliations += 1;
            }
            pending.unresolvedPolls = Number(pending.unresolvedPolls || 0) + 1;
            this.waitingReason = mutationObserved
                ? 'craft-outcome-uncertain'
                : (allExpectedInputsObservable ? 'craft-no-effect-not-proven' : 'craft-inputs-not-observable');
            this.setPhase('WAITING_RECONCILE');
            if (pending.unresolvedPolls === 1 || pending.unresolvedPolls % 20 === 0) {
                this.logger?.warn?.('B5 PURE: craft outcome remains unresolved; automatic re-click stays blocked.', {
                    botId: this.botId,
                    operation: 'B5CraftMode',
                    step: 'reconcile-craft-outcome',
                    mutationObserved,
                    allExpectedInputsObservable,
                    noEffectProofPasses: pending.noEffectProofPasses || 0,
                    reconciliation: this.#compactReconciliation(pending)
                });
            }
            await Timeout.delay(this.config.reconciliation.unresolvedPollMs, { cancellationToken });
            return false;
        }

        this.setPhase('WAITING_RECONCILE');
        await Timeout.delay(this.config.reconciliation.retryMs, { cancellationToken });
        return false;
    }

    #compactReconciliation(value) {
        if (!value) return null;
        return {
            createdAt: value.createdAt || null,
            operationCode: value.operationCode || null,
            recipeId: value.recipeId || null,
            outputId: value.outputId || null,
            quantity: value.quantity ?? null,
            expectedDelta: value.expectedDelta ?? null,
            outputSource: value.outputSource || null,
            outputCountBefore: value.outputCountBefore ?? null,
            batchId: value.batchId || null,
            connectionGeneration: value.connectionGeneration ?? null,
            lastReconciliationGeneration: value.lastReconciliationGeneration ?? null,
            evidenceGeneration: value.evidenceGeneration ?? null,
            generationProofReads: Number(value.generationProofReads || 0),
            operationId: value.operationId || null,
            correlationId: value.correlationId || null,
            targetId: value.targetId || null,
            targetVaultBefore: value.targetVaultBefore ?? null,
            isFinalTarget: value.isFinalTarget === true,
            completionMarkerId: value.completionMarkerId || null,
            inputBaselines: value.inputBaselines || null,
            observedSideEffect: value.observedSideEffect === true,
            initialObservedSideEffect: value.initialObservedSideEffect === true,
            confirmedFreshSideEffect: value.confirmedFreshSideEffect === true,
            historicalFreshSideEffectObserved: value.historicalFreshSideEffectObserved === true,
            freshMutationProofPasses: Number(value.freshMutationProofPasses || 0),
            unexpectedIdentityDeltas: Array.isArray(value.unexpectedIdentityDeltas) ? value.unexpectedIdentityDeltas.slice(0, 8) : [],
            attempts: Number(value.attempts || 0),
            noEffectProofPasses: Number(value.noEffectProofPasses || 0),
            unresolvedSince: value.unresolvedSince || null,
            unresolvedPolls: Number(value.unresolvedPolls || 0),
            lastObserved: value.lastObserved || null
        };
    }

    async #reconcilePendingB5CompletionProvenance(generation, cancellationToken) {
        const provenance = this.pendingB5CompletionProvenance;
        if (!provenance) return true;
        if (provenance.batchId !== this.batchId) {
            this.waitingReason = 'b5-completion-provenance-batch-mismatch';
            this.setPhase('WAITING_RECONCILE');
            await Timeout.delay(this.config.reconciliation.unresolvedPollMs, { cancellationToken });
            return false;
        }
        if (Number(provenance.recoveryGeneration) === Number(generation)) return true;

        this.waitingReason = 'b5-completion-reconcile';
        this.setPhase('RECONCILING_B5_COMPLETION');
        const fresh = await this.b5Planning.inspectAdditionalFresh(1, {
            cancellationToken,
            expectedGeneration: generation
        });
        if (fresh?.success === false) {
            this.lastResult = this.#compactResult(fresh);
            this.waitingReason = 'b5-completion-reconcile-read-failed';
            this.setPhase('WAITING_RECONCILE');
            await Timeout.delay(this.config.errorRetryMs, { cancellationToken });
            return false;
        }
        if (!this.#generationCurrent(generation)) {
            await this.#waitForFreshGeneration(cancellationToken, 'generation-changed-during-b5-completion-reconciliation-read');
            return false;
        }

        provenance.reconciliationAttempts = Number(provenance.reconciliationAttempts || 0) + 1;
        provenance.reconciliationGeneration = generation;
        const provenAmount = Math.max(1, Number(provenance.amount || 1));
        const vaultNow = this.#freshLogicalCount(fresh?.data, provenance.outputId, 'pv2');
        const vaultDelta = Number.isFinite(vaultNow) && Number.isFinite(Number(provenance.targetVaultBefore))
            ? Math.max(0, Number(vaultNow) - Number(provenance.targetVaultBefore))
            : 0;
        const inventoryNow = this.#freshLogicalCount(fresh?.data, provenance.outputId, 'inventory');
        provenance.lastObserved = {
            at: new Date().toISOString(),
            generation,
            vaultNow,
            vaultDelta,
            inventoryNow
        };

        if (vaultDelta >= provenAmount) {
            this.#accountProvenB5Completion(provenance, provenAmount, 'fresh-pv2-reconnect', generation);
            this.pendingB5CompletionProvenance = null;
            this.waitingReason = null;
            this.setPhase('RUNNING');
            return true;
        }
        if (Number.isFinite(inventoryNow) && Number(inventoryNow) >= provenAmount) {
            provenance.recoveryGeneration = generation;
            provenance.source = 'fresh-inventory-reconciled';
            this.waitingReason = null;
            this.setPhase('RUNNING');
            return true;
        }

        provenance.recoveryGeneration = null;
        provenance.unresolvedPolls = Number(provenance.unresolvedPolls || 0) + 1;
        this.waitingReason = 'b5-completion-reconcile-ambiguous';
        this.setPhase('WAITING_RECONCILE');
        if (provenance.unresolvedPolls === 1 || provenance.unresolvedPolls % 20 === 0) {
            this.logger?.warn?.('B5 PURE: proven uncertain B5 is not yet physically resolvable on the current generation.', {
                botId: this.botId,
                operation: 'B5CraftMode',
                step: 'reconcile-b5-completion-provenance',
                markerId: provenance.markerId,
                originConnectionGeneration: provenance.originConnectionGeneration,
                reconciliationGeneration: generation,
                observed: provenance.lastObserved
            });
        }
        await Timeout.delay(this.config.reconciliation.unresolvedPollMs, { cancellationToken });
        return false;
    }

    #completionProvenanceFromPending(pending, amount, source, reconciliationGeneration = this.modeContext.generation()) {
        const provenAmount = Math.max(1, Number(amount || pending.expectedDelta || 1));
        return {
            markerId: pending.completionMarkerId,
            batchId: pending.batchId,
            connectionGeneration: pending.connectionGeneration,
            originConnectionGeneration: pending.connectionGeneration,
            reconciliationGeneration,
            recoveryGeneration: source === 'fresh-inventory' ? reconciliationGeneration : null,
            operationId: pending.operationId || null,
            correlationId: pending.correlationId || null,
            outputId: pending.outputId,
            targetVaultBefore: pending.targetVaultBefore ?? null,
            outputCountBefore: pending.outputCountBefore ?? null,
            amount: provenAmount,
            source,
            provenAt: new Date().toISOString(),
            reconciliationAttempts: 0,
            unresolvedPolls: 0,
            lastObserved: pending.lastObserved || null
        };
    }

    #accountProvenB5Completion(provenance, amount, source, verificationGeneration = this.modeContext.generation()) {
        if (!provenance?.markerId || provenance.markerId === this.lastAccountedB5ProvenanceId) return false;
        if (provenance.batchId !== this.batchId
            || Number(verificationGeneration) !== Number(this.modeContext.generation())) return false;
        const provenAmount = Math.max(1, Number(provenance.amount || 1));
        const requestedAmount = Math.max(1, Number(amount || provenAmount));
        const completedAmount = Math.min(provenAmount, requestedAmount);
        this.lastAccountedB5ProvenanceId = provenance.markerId;
        this.completedB5 += completedAmount;
        this.#armBatchProtection('post-b5-complete');
        this.nextB5CycleAt = Date.now() + this.config.postB5CooldownMs;
        this.logger?.info?.('B5 PURE: reconciled B5 was verified and stored; next batch protection armed.', {
            botId: this.botId,
            operation: 'B5CraftMode',
            step: 'account-reconciled-b5',
            source,
            completedAmount,
            completedB5Total: this.completedB5,
            verificationGeneration,
            provenance
        });
        return true;
    }

    #freshLogicalCount(data, logicalId, source) {
        if (!data || !logicalId) return null;
        const normalized = String(source || 'inventory').trim().toLowerCase();
        if (normalized === 'inventory' || normalized === 'bot-inventory') {
            const value = Number(data?.inventoryTotals?.[logicalId]);
            return Number.isFinite(value) ? value : 0;
        }
        if (normalized === 'personal-vault' || normalized === 'pv2' || normalized === 'vault') {
            const value = Number(data?.personalVault?.totals?.[logicalId]);
            return Number.isFinite(value) ? value : 0;
        }
        if (normalized === 'storage' || normalized === 'kho') {
            const value = Number(data?.storage?.items?.[logicalId]);
            return Number.isFinite(value) ? value : 0;
        }
        return null;
    }

    #compactResult(result) {
        if (!result) return null;
        return {
            success: result.success !== false,
            status: result.status || null,
            message: result.message || null,
            errorCode: result.error?.code || result.meta?.code || null,
            requiresReconciliation: Boolean(result.error?.details?.outcome?.requiresReconciliation || result.meta?.details?.outcome?.requiresReconciliation),
            data: result.data ? {
                complete: result.data.complete ?? null,
                completedNewB5: result.data.completedNewB5 ?? null,
                completedAmount: result.data.completedAmount ?? null,
                waitingForMaterials: result.data.waitingForMaterials ?? null,
                recoveredExistingB5: result.data.recoveredExistingB5 ?? null,
                targetId: result.data.targetId ?? null,
                pv2Backpressure: result.data.pv2Backpressure ?? null,
                productive: result.data.productive ?? null,
                blockingReasons: result.data.blockingReasons ?? null,
                actionSummary: result.data.actionSummary ?? null,
                progress: result.data.progress ?? null
            } : null
        };
    }

    #compactPressure(pressure) {
        if (!pressure || typeof pressure !== 'object') return null;
        return {
            known: pressure.known === true,
            level: pressure.level || null,
            protectionRequired: pressure.protectionRequired === true,
            critical: pressure.critical === true,
            shouldConsumeB1: pressure.shouldConsumeB1 === true,
            usageRatio: pressure.usageRatio ?? null,
            highWaterRatio: pressure.highWaterRatio ?? null,
            lowWaterRatio: pressure.lowWaterRatio ?? null,
            used: pressure.used ?? null,
            free: pressure.free ?? null,
            limit: pressure.limit ?? null
        };
    }

    #primaryBlocker(data = {}) {
        const reasons = Array.isArray(data.blockingReasons) ? data.blockingReasons : [];
        const raw = reasons[0] || null;
        if (!raw) return null;
        const reason = String(raw.reason || raw.status || '').toLowerCase();
        let category = 'materials';
        if (reason.includes('pv2') || reason.includes('vault') || reason.includes('new-b2-suppressed')) category = 'pv2-backpressure';
        else if (reason.includes('decompression') || reason.includes('headroom') || reason.includes('unsafe-block-expansion')) category = 'decompression-headroom';
        else if (reason.includes('storage')) category = 'storage-pressure';
        return { ...raw, category };
    }

    #generationCurrent(generation) {
        return this.modeContext.connected() && Number(this.modeContext.generation()) === Number(generation);
    }

    async #waitForFreshGeneration(cancellationToken, reason) {
        this.staleGenerationAborts += 1;
        this.waitingReason = 'connection-generation-changed';
        this.setPhase('WAITING_CONNECTION');
        this.lastResult = {
            success: false,
            status: 'STALE_GENERATION',
            message: reason,
            data: null
        };
        this.#resetNoProgress();
        await Timeout.delay(this.config.disconnectedPollMs, { cancellationToken });
    }

    #blockerKey(blocker, data = {}) {
        if (blocker) {
            return [
                blocker.category || 'materials',
                blocker.reason || blocker.status || '',
                blocker.baseId || blocker.resource || blocker.targetId || ''
            ].join(':');
        }
        if (data?.pv2Backpressure?.hardBlocked) return 'pv2-backpressure:hard-blocked';
        if (data?.waitingForMaterials) return 'materials:waiting';
        return 'no-progress:unknown';
    }

    #recordNoProgress(blocker, data) {
        const key = this.#blockerKey(blocker, data);
        const same = key === this.lastBlockerKey;
        this.noProgressStreak = same ? this.noProgressStreak + 1 : 1;
        this.lastBlockerKey = key;
        const stability = this.config.stability;
        let delayMs = this.config.pollIntervalMs;
        if (stability.noProgressBackoffEnabled && this.noProgressStreak >= stability.sameBlockerThreshold) {
            const exponent = Math.max(0, this.noProgressStreak - stability.sameBlockerThreshold);
            delayMs = Math.min(
                stability.noProgressMaxDelayMs,
                stability.noProgressBaseDelayMs * (2 ** exponent)
            );
        }
        this.lastCycleDelayMs = delayMs;
        const shouldAnnounce = !same
            || this.noProgressStreak === stability.sameBlockerThreshold
            || this.noProgressStreak % stability.logEveryNthRepeat === 0;
        return { key, delayMs, shouldAnnounce };
    }

    #resetNoProgress() {
        this.noProgressStreak = 0;
        this.lastBlockerKey = null;
        this.lastCycleDelayMs = 0;
    }

    #normalizeConfig(config) {
        const positive = (key, fallback) => {
            const value = Number(config?.[key] ?? fallback);
            if (!Number.isFinite(value) || value <= 0) throw new TypeError(`b5CraftMode.${key} phải lớn hơn 0.`);
            return value;
        };
        const stabilityConfig = config?.stability || {};
        const positiveStability = (key, fallback) => {
            const value = Number(stabilityConfig?.[key] ?? fallback);
            if (!Number.isFinite(value) || value <= 0) throw new TypeError(`b5CraftMode.stability.${key} phải lớn hơn 0.`);
            return value;
        };
        const reconciliationConfig = config?.reconciliation || {};
        const positiveReconciliation = (key, fallback) => {
            const value = Number(reconciliationConfig?.[key] ?? fallback);
            if (!Number.isFinite(value) || value <= 0) throw new TypeError(`b5CraftMode.reconciliation.${key} phải lớn hơn 0.`);
            return value;
        };
        return Object.freeze({
            enabled: config?.enabled !== false,
            teleportHomeOnEnable: config?.teleportHomeOnEnable !== false,
            autoResumeOnReconnect: config?.autoResumeOnReconnect !== false,
            pollIntervalMs: positive('pollIntervalMs', 10000),
            disconnectedPollMs: positive('disconnectedPollMs', 1500),
            errorRetryMs: positive('errorRetryMs', 5000),
            errorRetryMaxMs: positive('errorRetryMaxMs', 30000),
            craftLoopDelayMs: positive('craftLoopDelayMs', 300),
            postB5CooldownMs: positive('postB5CooldownMs', 1800000),
            stability: Object.freeze({
                noProgressBackoffEnabled: stabilityConfig.noProgressBackoffEnabled !== false,
                noProgressBaseDelayMs: positiveStability('noProgressBaseDelayMs', 10000),
                noProgressMaxDelayMs: positiveStability('noProgressMaxDelayMs', 60000),
                sameBlockerThreshold: Math.max(1, Math.floor(positiveStability('sameBlockerThreshold', 2))),
                logEveryNthRepeat: Math.max(1, Math.floor(positiveStability('logEveryNthRepeat', 5)))
            }),
            reconciliation: Object.freeze({
                maxFreshReads: Math.max(1, Math.floor(positiveReconciliation('maxFreshReads', 3))),
                retryMs: positiveReconciliation('retryMs', 1000),
                unresolvedPollMs: positiveReconciliation('unresolvedPollMs', 15000),
                allowRetryAfterVerifiedNoEffect: reconciliationConfig.allowRetryAfterVerifiedNoEffect !== false
            })
        });
    }

}

module.exports = B5CraftModeService;
