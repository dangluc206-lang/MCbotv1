'use strict';

const Timeout = require('../../shared/time/Timeout');
const Result = require('../../shared/result/Result');
const Status = require('../../shared/result/Status');
const FlowError = require('../../shared/errors/FlowError');
const DailyRecoverySchedule = require('../../shared/time/DailyRecoverySchedule');
const FailureCircuitBreaker = require('../../shared/resilience/FailureCircuitBreaker');
const { classifyRuntimeResult } = require('../../shared/result/RuntimeResultClassifier');
const { createFailureEvent } = require('../../diagnostics/runtime/RuntimeFailureEvent');
const { normalizeConnectionGeneration } = require('../../core/events/EventEnvelope');
const TaskSupervisor = require('../../core/TaskSupervisor');
const ModeLeaseSession = require('../ModeLeaseSession');
const CollectorMovementFlow = require('./flows/CollectorMovementFlow');
const CollectorB5WorkPolicy = require('./CollectorB5WorkPolicy');
const CollectorB5StatusPresenter = require('./CollectorB5StatusPresenter');

const MODE_ID = 'collector-b5';

class CollectorB5ModeService {
    constructor({
        botId,
        context,
        eventBus,
        island,
        skyblock,
        skyblockReadiness,
        skyTarget,
        movementManager,
        positionService,
        b1Materials,
        b5Planning,
        b5Automation,
        modeCoordinator,
        failurePublisher = null,
        failurePolicy,
        config = {},
        dailyRecovery = {},
        logger = null,
        delay = Timeout.delay,
        movementFlow = null
    }) {
        if (!modeCoordinator) throw new TypeError('CollectorB5ModeService modeCoordinator is required.');
        Object.assign(this, {
            name: 'CollectorB5ModeService',
            botId,
            context,
            eventBus,
            island,
            skyblock,
            skyblockReadiness,
            skyTarget,
            movementManager,
            positionService,
            b1Materials,
            b5Planning,
            b5Automation,
            modeCoordinator,
            failurePublisher,
            logger,
            delay
        });
        this.failureBreaker = new FailureCircuitBreaker({ policy: failurePolicy });
        this.workPolicy = new CollectorB5WorkPolicy();
        this.statusPresenter = new CollectorB5StatusPresenter();
        this.config = this.#normalizeConfig(config);
        this.movementFlow = movementFlow || new CollectorMovementFlow({
            island,
            movementManager,
            positionService,
            config: this.config
        });
        this.dailyRecovery = new DailyRecoverySchedule(dailyRecovery);
        this.lastSkyDailyRecoveryDate = null;
        this.dailyHoldLogKey = null;
        this.enabled = false;
        this.paused = false;
        this.phase = 'OFF';
        this.preparedGeneration = null;
        this.lastError = null;
        this.startedAt = null;
        this.cycles = 0;
        this.b3Shortages = null;
        this.b5Progress = null;
        this.batchProtectionRequired = true;
        this.lastStorageProtection = null;
        this.source = null;
        this.loopPromise = null;
        this.restartTimer = null;
        this.taskSupervisor = new TaskSupervisor({ name: `${botId}:collector-b5:tasks`, logger, historyLimit: 8, delay });
        this.restartSupervisor = this.taskSupervisor; // Compatibility alias for diagnostics/tests.
        this.unsubscribers = [];
        this.unhandledRetryCount = 0;
        this.lastUnhandledPhase = null;
        this.lastActivityLogKey = null;
        this.lastRemainingStepsLog = null;
        this.leaseSession = new ModeLeaseSession({
            modeId: MODE_ID,
            modeCoordinator,
            requestedResources: ['primary-mode'],
            logger
        });
    }

    async initialize() {
        if (this.unsubscribers.length > 0) return;
        this.unsubscribers.push(
            this.modeCoordinator.onChange(change => this.#handleCoordinatorChange(change)),
            this.eventBus.on('connection:ended', event => {
                if (event.botId !== this.botId) return;
                const generation = normalizeConnectionGeneration(event);
                if (!this.#isCurrentGeneration(generation, false)) return;
                this.preparedGeneration = null;
                this.batchProtectionRequired = true;
                if (this.enabled && !this.paused) this.phase = 'WAITING_CONNECTION';
            })
        );
    }

    async start() {}

    async enable() {
        let acquiredLease = null;
        try {
            if (!this.config.enabled) {
                return Result.fail(Status.NOT_READY, 'Collector+B5 mode is disabled by config.');
            }
            this.#requirePickupLocation();
            if (this.enabled) {
                if (!this.#hasModeLease()) {
                    return Result.fail(Status.BUSY, 'Collector+B5 mode lease is no longer current.', null, {
                        owner: this.leaseSession.owner()
                    });
                }
                if (this.paused) return this.resume();
                return Result.ok(this.status(), { alreadyEnabled: true });
            }

            const acquired = this.leaseSession.acquire({ reason: 'Collector+B5 mode enabled.' });
            if (!acquired.success) return acquired;
            acquiredLease = acquired.data;

            this.enabled = true;
            this.paused = false;
            this.phase = 'STARTING';
            this.preparedGeneration = null;
            this.lastError = null;
            this.startedAt = new Date().toISOString();
            this.cycles = 0;
            this.b3Shortages = null;
            this.b5Progress = null;
            this.batchProtectionRequired = true;
            this.lastStorageProtection = null;
            this.unhandledRetryCount = 0;
            this.lastUnhandledPhase = null;
            this.lastActivityLogKey = null;
            this.lastRemainingStepsLog = null;
            this.failureBreaker.reset();
            const targetDemand = this.skyblockReadiness?.requireTarget?.(this.skyTarget, { owner: MODE_ID, trigger: 'collector-b5-enabled' });
            if (targetDemand?.success === false) throw targetDemand.error || new Error(targetDemand.message || 'Unable to request Sky target.');
            this.batchProtectionRequired = true;
            this.#startLoop();

            this.#logActivity('B5: Bắt đầu.');
            return Result.ok(this.status(), { leaseId: this.leaseSession.leaseId() });
        } catch (error) {
            if (acquiredLease) this.#releaseModeLease();
            this.enabled = false;
            this.paused = false;
            this.phase = 'OFF';
            return Result.fail(Status.INVALID_INPUT, error.message, error);
        }
    }

    async pause(reason = 'Collector+B5 mode paused.') {
        if (!this.enabled) {
            return Result.fail(Status.NOT_READY, 'Collector+B5 mode is not enabled.');
        }
        if (this.paused) return Result.ok(this.status(), { alreadyPaused: true });

        const leasePause = this.leaseSession.pause();
        if (!leasePause.success) return leasePause;

        this.paused = true;
        this.phase = 'PAUSING';
        await this.#clearRestartTimer(reason);
        const activeSource = this.source;
        activeSource?.cancel(reason);
        try { await this.movementManager.stop(); } catch (error) { this.logger?.debug?.('Collector movement stop cleanup failed.', { error }); }
        if (this.loopPromise) await this.loopPromise.catch(error => { this.logger?.debug?.('Collector loop cleanup observed a rejection.', { error }); });
        this.phase = 'PAUSED';
        this.#logActivity('B5: Tạm dừng.');
        this.eventBus?.emit('mode:collector-b5:paused', { botId: this.botId, reason });
        return Result.ok(this.status());
    }

    async resume() {
        try {
            if (!this.enabled) {
                return Result.fail(Status.NOT_READY, 'Collector+B5 mode is not enabled.');
            }
            if (!this.paused) return Result.ok(this.status(), { alreadyRunning: true });
            this.#requirePickupLocation();

            const leaseResume = this.leaseSession.resume();
            if (!leaseResume.success) return leaseResume;

            const pausedForError = ['PAUSED_ERROR', 'DEGRADED'].includes(this.phase);
            this.paused = false;
            this.lastError = null;
            if (pausedForError) this.failureBreaker.reset();
            this.phase = 'RESUMING';
            const targetDemand = this.skyblockReadiness?.requireTarget?.(this.skyTarget, { owner: MODE_ID, trigger: 'collector-b5-resumed' });
            if (targetDemand?.success === false) throw targetDemand.error || new Error(targetDemand.message || 'Unable to request Sky target.');
            this.#startLoop();
            this.#logActivity('B5: Chạy tiếp.');
            this.eventBus?.emit('mode:collector-b5:resumed', { botId: this.botId });
            return Result.ok(this.status());
        } catch (error) {
            this.leaseSession.pause();
            return Result.fail(Status.INVALID_INPUT, error.message, error);
        }
    }

    async disable(reason = 'Collector+B5 mode disabled.') {
        const alreadyDisabled = !this.enabled && !this.loopPromise;
        try {
            this.enabled = false;
            this.paused = false;
            this.phase = 'STOPPING';
            await this.#clearRestartTimer(reason);
            this.source?.cancel(reason);
            try { await this.movementManager.stop(); } catch (error) { this.logger?.debug?.('Collector movement stop cleanup failed.', { error }); }
            if (this.loopPromise) await this.loopPromise.catch(error => { this.logger?.debug?.('Collector loop cleanup observed a rejection.', { error }); });
            this.phase = 'OFF';
            this.skyblockReadiness?.releaseTarget?.(MODE_ID);
            this.preparedGeneration = null;
            this.b3Shortages = null;
            this.b5Progress = null;
            this.batchProtectionRequired = true;
            this.lastStorageProtection = null;
            this.failureBreaker.reset();
            this.#logActivity('B5: Đã dừng.');
        } finally {
            this.#releaseModeLease();
        }
        return Result.ok(this.status(), alreadyDisabled ? { alreadyDisabled: true } : null);
    }

    reconfigure(nextConfig) {
        const normalized = this.#normalizeConfig(nextConfig || {});
        if (this.enabled && normalized.enabled === false) {
            throw new Error('Không thể tắt collector+B5 bằng hot config khi mode đang chạy. Dùng nút Dừng/Tắt mode trước.');
        }
        this.config = normalized;
        if (this.enabled) this.#requirePickupLocation();
        this.logger?.info?.('Collector+B5 mode configuration reloaded.', {
            botId: this.botId,
            pickupLocation: this.config.pickupLocation,
            pollIntervalMs: this.config.pollIntervalMs,
            craftLoopDelayMs: this.config.craftLoopDelayMs
        });
        this.eventBus?.emit('mode:collector-b5:config-updated', {
            botId: this.botId,
            config: this.publicConfig()
        });
        return this.status();
    }

    publicConfig() {
        return Object.freeze({
            enabled: this.config.enabled,
            teleportHomeOnEnable: this.config.teleportHomeOnEnable,
            skyTarget: this.skyTarget,
            b1Decompression: this.config.b1Decompression,
            pickupLocation: this.#pickupLocationOrNull(),
            arrivalRadius: this.config.arrivalRadius,
            reanchorRadius: this.config.reanchorRadius,
            moveTimeoutMs: this.config.moveTimeoutMs,
            pollIntervalMs: this.config.pollIntervalMs,
            errorRetryMs: this.config.errorRetryMs,
            craftLoopDelayMs: this.config.craftLoopDelayMs
        });
    }

    status() {
        const position = this.context.has() ? this.positionService.current() : null;
        const automationProgress = this.b5Automation?.status?.() || null;
        const b5Progress = automationProgress?.running
            ? Object.freeze({ ...(this.b5Progress || {}), ...automationProgress })
            : this.b5Progress;
        return Object.freeze({
            mode: 'collector-b5',
            enabled: this.enabled,
            paused: this.paused,
            phase: this.phase,
            pickupLocation: this.#pickupLocationOrNull(),
            position,
            connectionGeneration: this.context.getGeneration(),
            preparedGeneration: this.preparedGeneration,
            craftedB5Cycles: this.cycles,
            craftLoopDelayMs: this.config.craftLoopDelayMs,
            b3Shortages: this.enabled ? this.b3Shortages : null,
            b5Progress: this.enabled ? b5Progress : null,
            skyTarget: this.skyTarget,
            batchProtectionRequired: this.enabled ? this.batchProtectionRequired : false,
            storageProtection: this.enabled ? this.lastStorageProtection : null,
            activity: this.statusPresenter.activity({
                enabled: this.enabled,
                paused: this.paused,
                phase: this.phase,
                automationProgress,
                b5Progress
            }),
            remainingSteps: Number.isFinite(Number(b5Progress?.remainingStages)) ? Math.max(0, Number(b5Progress.remainingStages)) : null,
            startedAt: this.startedAt,
            dailyRecovery: {
                timezoneOffsetMinutes: this.dailyRecovery.timezoneOffsetMinutes,
                sky: this.dailyRecovery.sky,
                server: this.dailyRecovery.server,
                lastSkyRecoveryDate: this.lastSkyDailyRecoveryDate
            },
            lastError: this.lastError ? this.lastError.message : null,
            lastErrorDetail: this.lastError ? this.#diagnostic(this.lastError) : null,
            unhandledRetryCount: this.unhandledRetryCount,
            lastUnhandledPhase: this.lastUnhandledPhase,
            failureBudget: this.failureBreaker.snapshot(),
            modeLease: this.leaseSession.status()
        });
    }

    async stop() {
        await this.disable('Runtime stopping.');
        for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    }

    async destroy() {
        await this.stop();
        await this.taskSupervisor.close('Collector+B5 destroyed.');
    }

    #startLoop() {
        if (this.loopPromise) return;
        if (!this.#hasModeLease()) {
            this.#handleLostLease('Collector+B5 cannot start without its current mode lease.');
            return;
        }
        void this.#clearRestartTimer('Collector loop started.');
        let restartAfterUnhandled = false;
        let restartExpectedWait = false;
        let retryDelayMs = this.config.errorRetryMs;
        let loopToken = null;
        const handle = this.taskSupervisor.start('loop', async ({ cancellationToken }) => {
            loopToken = cancellationToken;
            try {
                return await this.#run(cancellationToken);
            } catch (error) {
                const classification = classifyRuntimeResult({ error, token: cancellationToken });
                if (classification.kind === 'TOKEN_CANCELLED') throw error;
                if (classification.kind === 'EXPECTED_CANCEL' || classification.kind === 'WAIT') {
                    this.lastError = null;
                    this.phase = 'COLLECTING';
                    await this.delay(this.config.pollIntervalMs, { cancellationToken });
                    restartAfterUnhandled = this.enabled && !this.paused;
                    restartExpectedWait = true;
                    retryDelayMs = 0;
                    return;
                }

                if (classification.kind === 'STALE') {
                    await this.#handleStaleBoundary(cancellationToken);
                    restartAfterUnhandled = this.enabled && !this.paused;
                    restartExpectedWait = true;
                    retryDelayMs = 0;
                    return;
                }

                const failedPhase = this.phase;
                const diagnostic = this.#diagnostic(error);
                const errorMessage = diagnostic.message || error?.message || String(error);
                this.lastError = error;
                this.lastUnhandledPhase = failedPhase;
                this.unhandledRetryCount += 1;
                const failureState = this.failureBreaker.recordFailure({ retryable: diagnostic.retryable !== false });
                const openDelay = failureState.openUntil ? Math.max(0, failureState.openUntil - this.failureBreaker.clock()) : 0;
                retryDelayMs = Math.max(this.config.errorRetryMs, failureState.currentBackoffMs || 0, openDelay);
                this.phase = diagnostic.retryable === false ? 'PAUSED_ERROR' : failureState.state === 'OPEN' ? 'DEGRADED' : 'WAITING_RETRY';
                if (diagnostic.retryable === false) this.paused = true;
                restartAfterUnhandled = this.enabled && !this.paused;

                // Startup failures must be allowed to prepare the same connection
                // generation again. Runtime B5 failures stay at the pickup point.
                if (['WAITING_SKYBLOCK', 'HOMING', 'MOVING_TO_PICKUP'].includes(failedPhase)) {
                    this.preparedGeneration = null;
                }

                try { await this.movementManager.stop(); } catch (cleanupError) { this.logger?.debug?.('Collector movement stop cleanup failed.', { error: cleanupError }); }

                this.logger?.error?.(
                    `B5: Lỗi ${diagnostic.code || 'UNKNOWN'}${diagnostic.step ? ` tại ${diagnostic.step}` : ''} — ${errorMessage}`,
                    { code: diagnostic.code || 'UNKNOWN', step: diagnostic.step || null }
                );
                this.#emitFailure(errorMessage, error, diagnostic, failedPhase, retryDelayMs, { unhandled: true });
            }
        }, { metadata: { kind: 'main-loop' } });
        const source = Object.freeze({
            get token() { return loopToken; },
            cancel: reason => handle.cancel(reason)
        });
        this.source = source;

        this.loopPromise = handle.promise
            .catch(error => {
                if (source.token?.isCancelled || error?.code === 'CANCELLED') return;
                throw error;
            })
            .finally(() => {
                if (this.source === source) this.source = null;
                this.loopPromise = null;
                if (!this.enabled) this.phase = 'OFF';
                else if (this.paused && this.phase !== 'PAUSED_ERROR') this.phase = 'PAUSED';
                else if (restartAfterUnhandled) {
                    const breakerOpen = this.failureBreaker.snapshot().state === 'OPEN';
                    this.phase = breakerOpen ? 'DEGRADED' : restartExpectedWait ? 'COLLECTING' : 'WAITING_RETRY';
                    if (restartExpectedWait) {
                        queueMicrotask(() => {
                            if (this.enabled && !this.paused && !this.loopPromise) this.#startLoop();
                        });
                        return;
                    }
                    const restartDelayMs = Math.max(50, retryDelayMs);
                    const handle = this.taskSupervisor.start('restart', async ({ cancellationToken }) => {
                        await this.delay(restartDelayMs, { cancellationToken });
                        if (this.restartTimer === handle) this.restartTimer = null;
                        if (this.enabled && !this.paused && !this.loopPromise) this.#startLoop();
                    }, { metadata: { phase: this.phase, retryDelayMs: restartDelayMs } });
                    this.restartTimer = handle;
                    handle.promise.catch(error => {
                        if (error?.code !== 'CANCELLED') this.logger?.debug?.('Collector supervised restart ended with error.', { error });
                    });
                }
            });
    }

    async #run(token) {
        while (this.enabled && !this.paused && !token.isCancelled) {
            token.throwIfCancelled();
            if (!this.#hasModeLease()) {
                this.#handleLostLease('Collector+B5 mode lease was lost while running.');
                return;
            }

            const breakerPermit = this.failureBreaker.beforeAttempt();
            if (!breakerPermit.allowed) {
                this.phase = 'DEGRADED';
                try { await this.movementManager.stop(); } catch (error) { this.logger?.debug?.('Collector movement stop cleanup failed.', { error }); }
                await this.delay(Math.max(50, breakerPermit.retryInMs), { cancellationToken: token });
                continue;
            }

            const heldForDailyRecovery = await this.#handleDailyRecovery(token);
            if (heldForDailyRecovery) continue;

            if (!this.context.has()) {
                this.phase = 'WAITING_CONNECTION';
                await Timeout.delay(this.config.errorRetryMs, { cancellationToken: token });
                continue;
            }

            const generation = this.context.getGeneration();
            const cycleOptions = { cancellationToken: token, expectedGeneration: generation };
            if (this.preparedGeneration !== generation) {
                await this.#prepareGeneration(generation, token);
                this.#assertCycleGeneration(generation, 'prepare-generation-complete');
                this.preparedGeneration = generation;
            }

            // Storage Protection is a B5 batch boundary. It owns the only
            // smelting/selling pass: fresh /kho -> smelt iron/gold -> compact
            // all B1 -> trim surplus to the configured B5 reserve. Once the
            // batch begins, crafting may only expand/recompact B1; it must not
            // sell or invoke protection again until the next completed B5.
            if (this.batchProtectionRequired) {
                this.phase = 'STORAGE_PROTECTION';
                this.#logActivity('B5: Đang bảo vệ kho trước đợt chế.');
                const protectedStorage = await this.b1Materials.protectForB5Batch({
                    ...cycleOptions,
                });
                this.#assertCycleGeneration(generation, 'storage-protection-complete');
                if (!protectedStorage.success) {
                    await this.#handleResultFailure('B5 storage protection failed.', protectedStorage, token);
                    continue;
                }
                this.lastStorageProtection = protectedStorage.data || null;
                this.batchProtectionRequired = false;
                this.#logActivity('B5: Bảo vệ kho hoàn tất.');
            }

            // Re-anchor only at a transaction boundary. GUI/crafting operations
            // are never interrupted by movement.
            await this.#reanchorIfNeeded(token, generation);

            this.phase = 'CHECKING';
            this.#logActivity('B5: Đang tính các bước còn lại.');
            let inspection = await this.b5Planning.inspectAdditional(1, cycleOptions);
            this.#assertCycleGeneration(generation, 'planning-inspection-complete');
            if (!inspection.success) {
                await this.#handleResultFailure('B5 planning inspection failed.', inspection, token);
                continue;
            }

            this.#updateB3Shortages(inspection.data);
            this.#updateB5Progress(inspection.data);
            let actionable = this.workPolicy.hasActionableWork(inspection.data);
            this.#logRemainingSteps(inspection.data?.progress?.remainingStages);

            // B3 shortage is not a gate. If a cached plan looks idle while its
            // B3 target counts are already satisfied, refresh once so the new
            // B5>B4>B3>B2 priority logic can see any immediately craftable B4.
            if (!actionable && this.workPolicy.allB3Satisfied(inspection.data)) {
                const fresh = typeof this.b5Planning.inspectAdditionalFresh === 'function'
                    ? await this.b5Planning.inspectAdditionalFresh(1, cycleOptions)
                    : await this.b5Planning.inspectAdditional(1, { ...cycleOptions, fresh: true });
                this.#assertCycleGeneration(generation, 'fresh-planning-inspection-complete');
                if (fresh?.success) {
                    inspection = fresh;
                    this.#updateB3Shortages(inspection.data);
                    this.#updateB5Progress(inspection.data);
                    actionable = this.workPolicy.hasActionableWork(inspection.data);
                }
            }

            // Idle is not a selling/protection boundary. Maintenance is limited
            // to already-created intermediates; Collector headroom is enforced
            // only when B1 must be expanded for the active craft step.
            const maintenanceNeeded = this.workPolicy.hasMaintenanceWork(inspection.data);
            if (!actionable && maintenanceNeeded && typeof this.b5Automation?.runMaintenance === 'function') {
                this.phase = 'MAINTENANCE';
                const maintained = await this.b5Automation.runMaintenance({
                    ...cycleOptions,
                    allowNewB2: false,
                    decompressionPolicy: 'guarded',
                    decompressionMaxUsageRatio: this.config.b1Decompression.maxUsageRatio,
                    requireKnownCapacity: this.config.b1Decompression.requireKnownCapacity
                });
                this.#assertCycleGeneration(generation, 'maintenance-complete');
                if (!maintained.success) {
                    await this.#handleResultFailure('B5 storage maintenance failed.', maintained, token);
                    continue;
                }
                this.lastError = null;
                await this.#refreshB3ShortagesAfterAutomation(token, generation);
                await Timeout.delay(this.config.pollIntervalMs, { cancellationToken: token });
                continue;
            }

            if (!actionable) {
                this.phase = 'COLLECTING';
                this.#logActivity('B5: Đang nhặt / chờ nguyên liệu.');
                await Timeout.delay(this.config.pollIntervalMs, { cancellationToken: token });
                continue;
            }

            // B5 automation runs at the same pickup position.
            this.phase = 'CRAFTING';
            this.#logActivity('B5: Đang chế tạo.');
            const automated = await this.b5Automation.runNext({
                ...cycleOptions,
                decompressionPolicy: 'guarded',
                decompressionMaxUsageRatio: this.config.b1Decompression.maxUsageRatio,
                requireKnownCapacity: this.config.b1Decompression.requireKnownCapacity
            });
            this.#assertCycleGeneration(generation, 'automation-complete');
            if (!automated.success) {
                await this.#handleResultFailure('B5 automation failed.', automated, token);
                continue;
            }

            this.lastError = null;
            if (!automated.data?.waitingForMaterials) this.failureBreaker.recordSuccess({ verified: true });
            await this.#refreshB3ShortagesAfterAutomation(token, generation);
            if (automated.data?.completedNewB5) {
                this.cycles += 1;
                this.batchProtectionRequired = true;
                this.phase = 'CHECKING';
                this.#logActivity('B5: Đã thành công x1 • kiểm tra lượt kế tiếp ngay.');
                this.eventBus?.emit('mode:collector-b5:cycle-completed', {
                    botId: this.botId,
                    craftedB5Cycles: this.cycles
                });
            } else {
                this.phase = automated.data?.waitingForMaterials ? 'COLLECTING' : 'CHECKING';
                if (automated.data?.waitingForMaterials) {
                    this.#logActivity('B5: Đang nhặt / chờ nguyên liệu.');
                }
            }
            // A transient B1 shortage is normal with continuous NPC input. Do
            // not hammer /kho every 250 ms after a stale plan; wait on the normal
            // material poll interval. Productive partial passes still re-plan
            // immediately.
            const nextDelayMs = automated.data?.waitingForMaterials
                ? this.config.pollIntervalMs
                : this.config.craftLoopDelayMs;
            await Timeout.delay(nextDelayMs, { cancellationToken: token });
        }
    }

    async #handleDailyRecovery(token) {
        const serverState = this.dailyRecovery.state('server');
        if (serverState.active) {
            this.phase = 'DAILY_SERVER_RECOVERY_WAIT';
            this.#logDailyHoldOnce('server', serverState);
            await Timeout.delay(Math.max(50, serverState.waitMs), { cancellationToken: token });
            this.dailyHoldLogKey = null;
            return true;
        }

        const skyState = this.dailyRecovery.state('sky');
        if (!skyState.due || this.lastSkyDailyRecoveryDate === skyState.dateKey) return false;

        if (skyState.active) {
            this.phase = 'DAILY_SKY_RECOVERY_WAIT';
            this.#logDailyHoldOnce('sky', skyState);
            await Timeout.delay(Math.max(50, skyState.waitMs), { cancellationToken: token });
            this.dailyHoldLogKey = null;
            return true;
        }

        if (!skyState.ready || !this.context.has()) return false;

        this.phase = 'DAILY_SKY_REJOIN';
        this.logger?.warn?.('Daily 03:00 Sky recovery rejoin starting.', {
            botId: this.botId,
            operation: 'CollectorB5ModeService',
            step: 'daily-sky-rejoin',
            action: '/sky after 10-minute hold',
            dailyWindow: skyState.start,
            resumeAt: skyState.resumeAt,
            dateKey: skyState.dateKey
        });

        const expectedGeneration = this.context.getGeneration();
        const demand = this.skyblockReadiness?.requireTarget?.(this.skyTarget, { owner: MODE_ID, trigger: 'daily-sky-rejoin' });
        if (demand?.success === false) {
            await this.#handleResultFailure('Daily Sky recovery demand failed.', demand, token);
            return true;
        }
        this.#assertCycleGeneration(expectedGeneration, 'daily-sky-rejoin-demanded');
        this.preparedGeneration = null;
        this.batchProtectionRequired = true;
        const generation = this.context.getGeneration();
        this.lastSkyDailyRecoveryDate = skyState.dateKey;
        this.lastError = null;
        this.logger?.info?.('Daily 03:00 Sky recovery rejoin succeeded; mode will resume from fresh server state.', {
            botId: this.botId,
            operation: 'CollectorB5ModeService',
            step: 'daily-sky-rejoin',
            phase: 'OK',
            connectionGeneration: generation,
            dateKey: skyState.dateKey
        });
        return true;
    }

    #logDailyHoldOnce(kind, state) {
        const key = `${kind}:${state.dateKey}`;
        if (this.dailyHoldLogKey === key) return;
        this.dailyHoldLogKey = key;
        this.logger?.warn?.(kind === 'sky'
            ? 'Daily 03:00 Sky recovery hold active; Collector+B5 will wait 5 minutes.'
            : 'Daily 05:00 server recovery hold active; Collector+B5 will wait for reconnect after 10 minutes.', {
            botId: this.botId,
            operation: 'CollectorB5ModeService',
            step: kind === 'sky' ? 'daily-sky-hold' : 'daily-server-hold',
            phase: 'WAIT',
            dailyWindow: state.start,
            resumeAt: state.resumeAt,
            waitMs: state.waitMs,
            dateKey: state.dateKey
        });
    }

    async #prepareGeneration(generation, token) {
        this.phase = 'WAITING_SKYBLOCK';
        const demand = this.skyblockReadiness?.requireTarget?.(this.skyTarget, { owner: MODE_ID, trigger: 'collector-b5-generation' });
        if (demand?.success === false) throw demand.error || new Error(demand.message || 'Unable to request Sky target.');
        while (!this.skyblockReadiness?.isGenerationReady?.(generation, this.skyTarget)) {
            token.throwIfCancelled();
            if (!this.context.has() || this.context.getGeneration() !== generation) return;
            await Timeout.delay(100, { cancellationToken: token });
        }

        if (this.config.teleportHomeOnEnable) {
            this.phase = 'HOMING';
            const home = await this.movementFlow.returnHome({ cancellationToken: token, expectedGeneration: generation });
            this.#assertCycleGeneration(generation, 'island-home-complete');
            if (!home.success) throw home.error || new Error(home.message || '/is failed.');
        }

        this.phase = 'MOVING_TO_PICKUP';
        await this.movementFlow.moveToPickup(this.#requirePickupLocation(), { cancellationToken: token });
        this.#assertCycleGeneration(generation, 'initial-pickup-movement-complete');
        this.phase = 'COLLECTING';
        this.#logActivity('B5: Đã tới điểm nhặt.');
    }

    async #reanchorIfNeeded(token, generation) {
        token?.throwIfCancelled?.();
        this.#assertCycleGeneration(generation, 'reanchor-check');
        const target = this.#requirePickupLocation();
        if (!this.movementFlow.needsReanchor(target)) return false;

        this.phase = 'REANCHORING';
        this.#logActivity('B5: Bị lệch điểm nhặt, đang quay lại.');
        await this.movementFlow.moveToPickup(target, { cancellationToken: token });
        this.#assertCycleGeneration(generation, 'reanchor-movement-complete');
        this.phase = 'COLLECTING';
        this.#logActivity('B5: Đã quay lại điểm nhặt.');
        return true;
    }

    async #handleRecoverableFailure(message, error, token) {
        const classification = classifyRuntimeResult({ error, token });
        if (classification.kind === 'TOKEN_CANCELLED') {
            token?.throwIfCancelled?.();
            return;
        }
        if (classification.kind === 'EXPECTED_CANCEL' || classification.kind === 'WAIT') {
            this.lastError = null;
            this.phase = 'COLLECTING';
            this.#logActivity('B5: Đang nhặt / chờ nguyên liệu.');
            await this.delay(this.config.pollIntervalMs, { cancellationToken: token });
            return;
        }
        if (classification.kind === 'STALE') {
            await this.#handleStaleBoundary(token);
            return;
        }
        const failedPhase = this.phase;
        const diagnostic = this.#diagnostic(error);
        if (['NOT_READY', 'WAITING_MATERIALS', 'NOT_ENOUGH_MATERIALS'].includes(diagnostic.code)) {
            this.lastError = null;
            this.phase = 'COLLECTING';
            this.#logActivity('B5: Đang nhặt / chờ nguyên liệu.');
            await this.delay(this.config.pollIntervalMs, { cancellationToken: token });
            return;
        }

        this.lastError = error;
        const postBoundary = classifyRuntimeResult({ error, token });
        if (postBoundary.kind === 'TOKEN_CANCELLED') {
            token?.throwIfCancelled?.();
            return;
        }
        if (postBoundary.kind === 'EXPECTED_CANCEL' || postBoundary.kind === 'WAIT') {
            this.lastError = null;
            this.phase = 'COLLECTING';
            await this.delay(this.config.pollIntervalMs, { cancellationToken: token });
            return;
        }
        if (postBoundary.kind === 'STALE') {
            await this.#handleStaleBoundary(token);
            return;
        }
        const failureState = this.failureBreaker.recordFailure({ retryable: diagnostic.retryable !== false });
        const openDelay = failureState.openUntil ? Math.max(0, failureState.openUntil - this.failureBreaker.clock()) : 0;
        const retryInMs = Math.max(this.config.errorRetryMs, failureState.currentBackoffMs || 0, openDelay);
        this.phase = diagnostic.retryable === false ? 'PAUSED_ERROR' : failureState.state === 'OPEN' ? 'DEGRADED' : 'WAITING_RETRY';
        const visibleMessage = `B5: Lỗi ${diagnostic.code || 'UNKNOWN'}${diagnostic.step ? ` tại ${diagnostic.step}` : ''} — ${diagnostic.message || message || 'Unknown error'}`;
        this.logger?.warn?.(visibleMessage, {
            code: diagnostic.code || 'UNKNOWN',
            step: diagnostic.step || null
        });
        this.#emitFailure(message, error, diagnostic, failedPhase, retryInMs);
        if (diagnostic.retryable === false) {
            this.paused = true;
            try { await this.movementManager.stop(); } catch (error) { this.logger?.debug?.('Collector movement stop cleanup failed.', { error }); }
            return;
        }
        if (failureState.state === 'OPEN') try { await this.movementManager.stop(); } catch (error) { this.logger?.debug?.('Collector movement stop cleanup failed.', { error }); }
        await this.delay(Math.max(50, retryInMs), { cancellationToken: token });
    }

    async #handleStaleBoundary(token) {
        this.lastError = null;
        this.preparedGeneration = null;
        this.batchProtectionRequired = true;
        this.phase = 'WAITING_CONNECTION';
        this.#logActivity('B5: Kết nối đã đổi, đang đồng bộ lại.');
        await this.delay(this.config.pollIntervalMs, { cancellationToken: token });
    }

    #emitFailure(message, error, diagnostic, phase, retryInMs, extra = {}) {
        const input = {
            botId: this.botId,
            connectionGeneration: this.context.getGeneration?.() ?? null,
            source: 'collector-b5',
            subsystem: diagnostic.subsystem || 'collector-b5',
            severity: diagnostic.retryable === false ? 'error' : 'warn',
            code: diagnostic.code,
            operation: diagnostic.operation || 'CollectorB5ModeService',
            step: diagnostic.step,
            action: diagnostic.action,
            resource: diagnostic.resource,
            message: diagnostic.message || message,
            retryable: diagnostic.retryable !== false,
            diagnostic,
            error,
            phase,
            retryInMs,
            ...extra
        };
        const failure = this.failurePublisher?.publish
            ? this.failurePublisher.publish(input)
            : createFailureEvent(input, { botId: this.botId });
        if (!this.failurePublisher?.publish) this.eventBus?.emit('runtime:failure', failure);
        this.eventBus?.emit('mode:collector-b5:error', { ...failure, error, diagnostic, ...extra });
        return failure;
    }

    #isCancellation(error, token = null) {
        return token?.isCancelled === true
            || error?.code === 'CANCELLED'
            || error?.name === 'OperationCancelledError';
    }

    async #handleResultFailure(message, result, token) {
        const classification = classifyRuntimeResult({ result, token });
        if (classification.kind === 'TOKEN_CANCELLED') {
            token?.throwIfCancelled?.();
            return;
        }
        if (classification.kind === 'EXPECTED_CANCEL' || classification.kind === 'WAIT') {
            this.lastError = null;
            this.phase = 'COLLECTING';
            this.#logActivity('B5: Đang nhặt / chờ nguyên liệu.');
            await this.delay(this.config.pollIntervalMs, { cancellationToken: token });
            return;
        }
        if (classification.kind === 'STALE') {
            await this.#handleStaleBoundary(token);
            return;
        }
        await this.#handleRecoverableFailure(
            message,
            result?.error || new Error(result?.message || message),
            token
        );
    }

    async #clearRestartTimer(reason = 'Collector restart cancelled.') {
        const handle = this.restartTimer;
        if (!handle) return;
        this.restartTimer = null;
        handle.cancel(reason);
        try {
            await handle.promise;
        } catch (error) {
            if (error?.code !== 'CANCELLED') {
                this.logger?.debug?.('Collector restart cleanup observed an unexpected rejection.', { reason, error });
            }
        }
    }

    #diagnostic(error) {
        const diagnostic = error?.toDiagnostic?.() || FlowError.errorDiagnostic(error) || {};
        return Object.freeze({
            code: diagnostic.code || error?.code || 'UNKNOWN',
            message: diagnostic.message || error?.message || String(error || 'Unknown error'),
            subsystem: diagnostic.subsystem || null,
            operation: diagnostic.operation || null,
            step: diagnostic.step || null,
            action: diagnostic.action || null,
            resource: diagnostic.resource || null,
            retryable: diagnostic.retryable !== false,
            attempt: diagnostic.attempt || null,
            details: diagnostic.details || null,
            trace: diagnostic.trace || null
        });
    }

    #updateB5Progress(data) {
        this.b5Progress = this.statusPresenter.b5Progress(data, this.phase);
    }

    #updateB3Shortages(data) {
        this.b3Shortages = this.statusPresenter.b3Shortages(data);
    }

    async #refreshB3ShortagesAfterAutomation(token, expectedGeneration) {
        try {
            token?.throwIfCancelled?.();
            const refreshed = await this.b5Planning.inspectAdditional(1, {
                cancellationToken: token,
                expectedGeneration
            });
            this.#assertCycleGeneration(expectedGeneration, 'post-automation-refresh-complete');
            if (refreshed?.success) {
                this.#updateB3Shortages(refreshed.data);
                this.#updateB5Progress(refreshed.data);
            }
            else this.logger?.debug?.('Could not refresh B3 shortage status after automation.', {
                botId: this.botId,
                message: refreshed?.message || null
            });
        } catch (error) {
            if (token?.isCancelled) throw error;
            this.#assertCycleGeneration(expectedGeneration, 'post-automation-refresh-error');
            this.logger?.debug?.('Could not refresh B3 shortage status after automation.', { botId: this.botId, error });
        }
    }

    #logActivity(message) {
        const text = String(message || '').trim();
        if (!text || text === this.lastActivityLogKey) return;
        this.lastActivityLogKey = text;
        this.logger?.info?.(text);
    }

    #logRemainingSteps(value) {
        const remaining = Number(value);
        if (!Number.isFinite(remaining)) return;
        const normalized = Math.max(0, Math.floor(remaining));
        if (normalized === this.lastRemainingStepsLog) return;
        this.lastRemainingStepsLog = normalized;
        this.#logActivity(`B5: Còn ${normalized} bước.`);
    }

    #isCurrentGeneration(generation, requireConnected = false) {
        if (!Number.isInteger(generation) || generation <= 0) return false;
        if (Number(this.context?.getGeneration?.()) !== generation) return false;
        if (requireConnected && !this.context?.has?.()) return false;
        return true;
    }

    #assertCycleGeneration(expectedGeneration, step) {
        const expected = Number(expectedGeneration);
        const current = Number(this.context?.getGeneration?.());
        if (Number.isInteger(expected) && expected > 0 && this.context?.has?.() && current === expected) return;
        throw new FlowError(`Collector+B5 connection generation changed during ${step}.`, {
            code: 'COLLECTOR_STALE_GENERATION',
            subsystem: 'collector-b5',
            operation: 'CollectorB5ModeService',
            step,
            retryable: true,
            details: { expectedGeneration: expected, currentGeneration: Number.isFinite(current) ? current : null }
        });
    }

    #hasModeLease() {
        return this.leaseSession.isHeld();
    }

    #releaseModeLease() {
        const leaseId = this.leaseSession.leaseId();
        if (!leaseId) return;
        const released = this.leaseSession.release();
        if (!released.success) this.logger?.warn?.('Collector+B5 mode lease release failed.', {
            botId: this.botId,
            leaseId,
            message: released.message
        });
    }

    #handleCoordinatorChange(change) {
        if (!this.leaseSession.matchesRelease(change) || !this.enabled) return;
        this.#handleLostLease('Collector+B5 mode lease was revoked.');
    }

    #handleLostLease(message) {
        if (!this.enabled) return;
        this.lastError = new FlowError(message, {
            code: 'MODE_LEASE_LOST',
            subsystem: 'mode-coordinator',
            operation: 'CollectorB5ModeService',
            step: 'lease-ownership',
            retryable: false,
            details: { botId: this.botId, modeId: MODE_ID, leaseId: this.leaseSession.leaseId() }
        });
        this.paused = true;
        this.phase = 'PAUSED_ERROR';
        this.source?.cancel(message);
    }

    #requirePickupLocation() {
        const location = this.#pickupLocationOrNull();
        if (!location) {
            throw new Error('Collector+B5 pickupLocation is not configured. Set x/y/z in config/modes/collector-b5.json.');
        }
        return location;
    }

    #pickupLocationOrNull() {
        const p = this.config.pickupLocation;
        if (!p || ![p.x, p.y, p.z].every(Number.isFinite)) return null;
        return Object.freeze({ x: p.x, y: p.y, z: p.z });
    }

    #normalizeConfig(config) {
        const positive = (key, fallback) => {
            const value = config[key] === undefined ? fallback : Number(config[key]);
            if (!Number.isFinite(value) || value <= 0) throw new Error(`collectorB5.${key} must be positive`);
            return value;
        };
        const maxUsageRatio = Number(config.b1Decompression?.maxUsageRatio ?? 0.8);
        if (!Number.isFinite(maxUsageRatio) || maxUsageRatio <= 0 || maxUsageRatio > 1) {
            throw new Error('collectorB5.b1Decompression.maxUsageRatio must be in (0, 1].');
        }
        return Object.freeze({
            enabled: config.enabled !== false,
            teleportHomeOnEnable: config.teleportHomeOnEnable !== false,
            pickupLocation: Object.freeze({ ...(config.pickupLocation || {}) }),
            arrivalRadius: positive('arrivalRadius', 1.2),
            reanchorRadius: positive('reanchorRadius', 2.5),
            moveTimeoutMs: positive('moveTimeoutMs', 30000),
            pollIntervalMs: positive('pollIntervalMs', 15000),
            errorRetryMs: positive('errorRetryMs', 5000),
            craftLoopDelayMs: positive('craftLoopDelayMs', 250),
            b1Decompression: Object.freeze({
                maxUsageRatio,
                requireKnownCapacity: config.b1Decompression?.requireKnownCapacity !== false
            })
        });
    }
}

module.exports = CollectorB5ModeService;
