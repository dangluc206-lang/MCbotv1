'use strict';

const CancellationSource = require('../../shared/cancellation/CancellationSource');
const Timeout = require('../../shared/time/Timeout');
const Result = require('../../shared/result/Result');
const Status = require('../../shared/result/Status');
const FlowError = require('../../shared/errors/FlowError');
const DailyRecoverySchedule = require('../../shared/time/DailyRecoverySchedule');
const FailureCircuitBreaker = require('../../shared/resilience/FailureCircuitBreaker');
const { classifyRuntimeResult } = require('../../shared/result/RuntimeResultClassifier');
const { createFailureEvent } = require('../../diagnostics/runtime/RuntimeFailureEvent');

class CollectorB5ModeService {
    constructor({
        botId,
        context,
        eventBus,
        island,
        skyblock,
        movementManager,
        positionService,
        b1Materials,
        b5Planning,
        b5Automation,
        failurePublisher = null,
        failurePolicy,
        config = {},
        dailyRecovery = {},
        logger = null,
        delay = Timeout.delay
    }) {
        Object.assign(this, {
            name: 'CollectorB5ModeService',
            botId,
            context,
            eventBus,
            island,
            skyblock,
            movementManager,
            positionService,
            b1Materials,
            b5Planning,
            b5Automation,
            failurePublisher,
            logger,
            delay
        });
        this.failureBreaker = new FailureCircuitBreaker({ policy: failurePolicy });
        this.config = this.#normalizeConfig(config);
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
        this.storagePressure = null;
        this.startupStorageSafetyDone = false;
        this.startupStorageSafety = null;
        this.source = null;
        this.loopPromise = null;
        this.restartTimer = null;
        this.unsubscribers = [];
        this.skyReadyGenerations = new Set();
        this.unhandledRetryCount = 0;
        this.lastUnhandledPhase = null;
        this.lastActivityLogKey = null;
        this.lastRemainingStepsLog = null;
    }

    async initialize() {
        this.unsubscribers.push(
            this.eventBus.on('skyblock:auto-join:succeeded', event => {
                if (event.botId !== this.botId) return;
                this.skyReadyGenerations.add(event.connectionGeneration);
                const dailySky = this.dailyRecovery.state('sky');
                if (dailySky.ready && dailySky.due) {
                    this.lastSkyDailyRecoveryDate = dailySky.dateKey;
                }
            }),
            this.eventBus.on('connection:ended', event => {
                if (event.botId !== this.botId) return;
                this.skyReadyGenerations.delete(event.connectionGeneration);
                if (this.enabled && !this.paused) this.phase = 'WAITING_CONNECTION';
            })
        );
    }

    async start() {}

    async enable() {
        try {
            if (!this.config.enabled) {
                return Result.fail(Status.NOT_READY, 'Collector+B5 mode is disabled by config.');
            }
            this.#requirePickupLocation();
            if (this.enabled) {
                if (this.paused) return this.resume();
                return Result.ok(this.status(), { alreadyEnabled: true });
            }

            this.enabled = true;
            this.paused = false;
            this.phase = 'STARTING';
            this.preparedGeneration = null;
            this.lastError = null;
            this.startedAt = new Date().toISOString();
            this.cycles = 0;
            this.b3Shortages = null;
            this.b5Progress = null;
            this.storagePressure = null;
            this.startupStorageSafetyDone = false;
            this.startupStorageSafety = null;
            this.unhandledRetryCount = 0;
            this.lastUnhandledPhase = null;
            this.lastActivityLogKey = null;
            this.lastRemainingStepsLog = null;
            this.failureBreaker.reset();
            this.#startLoop();

            this.#logActivity('B5: Bắt đầu.');
            return Result.ok(this.status());
        } catch (error) {
            return Result.fail(Status.INVALID_INPUT, error.message, error);
        }
    }

    async pause(reason = 'Collector+B5 mode paused.') {
        if (!this.enabled) {
            return Result.fail(Status.NOT_READY, 'Collector+B5 mode is not enabled.');
        }
        if (this.paused) return Result.ok(this.status(), { alreadyPaused: true });

        this.paused = true;
        this.phase = 'PAUSING';
        this.#clearRestartTimer();
        const activeSource = this.source;
        activeSource?.cancel(reason);
        try { await this.movementManager.stop(); } catch {}
        if (this.loopPromise) await this.loopPromise.catch(() => {});
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

            const pausedForError = ['PAUSED_ERROR', 'DEGRADED'].includes(this.phase);
            this.paused = false;
            this.lastError = null;
            if (pausedForError) this.failureBreaker.reset();
            this.phase = 'RESUMING';
            this.#startLoop();
            this.#logActivity('B5: Chạy tiếp.');
            this.eventBus?.emit('mode:collector-b5:resumed', { botId: this.botId });
            return Result.ok(this.status());
        } catch (error) {
            return Result.fail(Status.INVALID_INPUT, error.message, error);
        }
    }

    async disable(reason = 'Collector+B5 mode disabled.') {
        if (!this.enabled && !this.loopPromise) return Result.ok(this.status(), { alreadyDisabled: true });
        this.enabled = false;
        this.paused = false;
        this.phase = 'STOPPING';
        this.#clearRestartTimer();
        this.source?.cancel(reason);
        try { await this.movementManager.stop(); } catch {}
        if (this.loopPromise) await this.loopPromise.catch(() => {});
        this.phase = 'OFF';
        this.preparedGeneration = null;
        this.b3Shortages = null;
        this.b5Progress = null;
        this.storagePressure = null;
        this.startupStorageSafetyDone = false;
        this.startupStorageSafety = null;
        this.failureBreaker.reset();
        this.#logActivity('B5: Đã dừng.');
        return Result.ok(this.status());
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
            waitForSkyblockReady: this.config.waitForSkyblockReady,
            skyblockReadyTimeoutMs: this.config.skyblockReadyTimeoutMs,
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
            storagePressure: this.enabled ? this.storagePressure : null,
            startupStorageSafetyDone: this.enabled ? this.startupStorageSafetyDone : false,
            startupStorageSafety: this.enabled ? this.startupStorageSafety : null,
            activity: this.#activityText(automationProgress, b5Progress),
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
            failureBudget: this.failureBreaker.snapshot()
        });
    }

    async stop() {
        await this.disable('Runtime stopping.');
        for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
        this.skyReadyGenerations.clear();
    }

    async destroy() {
        await this.stop();
    }

    #startLoop() {
        if (this.loopPromise) return;
        this.#clearRestartTimer();
        const source = new CancellationSource();
        this.source = source;
        let restartAfterUnhandled = false;
        let restartExpectedWait = false;
        let retryDelayMs = this.config.errorRetryMs;

        this.loopPromise = this.#run(source.token)
            .catch(async error => {
                const classification = classifyRuntimeResult({ error, token: source.token });
                if (classification.kind === 'TOKEN_CANCELLED') return;
                if (classification.kind === 'EXPECTED_CANCEL' || classification.kind === 'WAIT') {
                    this.lastError = null;
                    this.phase = 'COLLECTING';
                    await this.delay(this.config.pollIntervalMs, { cancellationToken: source.token });
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

                try { await this.movementManager.stop(); } catch {}
                if (this.#isStorageBoundaryPhase(failedPhase)) {
                    await this.#stabilizeStorageBoundary(source.token, `unhandled-${failedPhase.toLowerCase()}`, { bestEffort: true });
                }

                this.logger?.error?.(
                    `B5: Lỗi ${diagnostic.code || 'UNKNOWN'}${diagnostic.step ? ` tại ${diagnostic.step}` : ''} — ${errorMessage}`,
                    { code: diagnostic.code || 'UNKNOWN', step: diagnostic.step || null }
                );
                this.#emitFailure(errorMessage, error, diagnostic, failedPhase, retryDelayMs, { unhandled: true });
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
                    this.restartTimer = setTimeout(() => {
                        this.restartTimer = null;
                        if (this.enabled && !this.paused && !this.loopPromise) this.#startLoop();
                    }, Math.max(50, retryDelayMs));
                    this.restartTimer.unref?.();
                }
            });
    }

    async #run(token) {
        while (this.enabled && !this.paused && !token.isCancelled) {
            token.throwIfCancelled();

            const breakerPermit = this.failureBreaker.beforeAttempt();
            if (!breakerPermit.allowed) {
                this.phase = 'DEGRADED';
                try { await this.movementManager.stop(); } catch {}
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
            if (this.preparedGeneration !== generation) {
                await this.#prepareGeneration(generation, token);
                this.preparedGeneration = generation;
            }

            // One-time safety gate for each explicit mode enable. It is not tied
            // to connection generation, so reconnect/resume does not repeatedly
            // sell the reserve. Before any normal conversion/crafting, trim only
            // B1 families whose /kho coverage is above the configured ~3 B5
            // reserve. Full coverage comes from /kho because `/kho sell` does not
            // expose raw materials.
            if (!this.startupStorageSafetyDone && typeof this.b1Materials?.startupTrimToReserve === 'function') {
                this.phase = 'STARTUP_STORAGE_SAFETY';
                this.#logActivity('B5: Kiểm tra an toàn B1 đầu phiên (reserve 3 B5).');
                const startupSafety = await this.b1Materials.startupTrimToReserve({ cancellationToken: token });
                if (!startupSafety.success) {
                    await this.#handleResultFailure('Startup B1 reserve trim failed.', startupSafety, token);
                    continue;
                }
                this.startupStorageSafety = startupSafety.data || null;
                this.startupStorageSafetyDone = true;
                this.#logActivity('B5: An toàn B1 đầu phiên hoàn tất.');
            }

            // After the initial arrival, Collector+B5 stays on the pickup point.
            // Crafting/checking happens in place; do not navigate away and back.

            // /kho is continuously fed by NPCs. Capacity protection is a hard
            // gate in front of crafting: if high-water is reached, stop all B5
            // work and drain the buffer to low-water before touching /nung or
            // starting a potentially long crafting chain.
            if (typeof this.b1Materials?.inspectStoragePressure === 'function') {
                const preflightPressure = await this.b1Materials.inspectStoragePressure({ cancellationToken: token });
                if (preflightPressure?.success) this.storagePressure = preflightPressure.data || null;
                if (preflightPressure?.success && preflightPressure.data?.protectionRequired === true) {
                    // High-water can be caused by raw iron/gold too. Smelting is
                    // capacity-neutral but makes that stock compactable, so it
                    // is part of protection rather than ordinary crafting.
                    this.phase = 'PREPROCESSING';
                    this.#logActivity('B5: /kho cao, đang nung và bảo vệ kho.');
                    const protectionPreprocess = await this.b1Materials.preprocessForCraft({ cancellationToken: token });
                    if (!protectionPreprocess.success) {
                        await this.#handleResultFailure('High-water B1 preprocessing failed.', protectionPreprocess, token);
                        continue;
                    }
                    this.phase = 'MAINTENANCE';
                    const protectedStorage = await this.#stabilizeStorageBoundary(token, 'preprocess-high-water');
                    if (!protectedStorage.success) {
                        await this.#handleResultFailure('Preprocess /kho protection failed.', protectedStorage, token);
                        continue;
                    }
                    const pressure = protectedStorage.data?.pressure || this.storagePressure;
                    if (pressure?.known && pressure?.protectionRequired === true) {
                        // NPC input is still outrunning the drain. Never start a
                        // craft pass while the buffer remains above high-water.
                        await Timeout.delay(this.config.errorRetryMs, { cancellationToken: token });
                        continue;
                    }
                }
            }

            // Continuous production: there is no B5 cooldown. Process raw B1,
            // then always compact loose B1 to blocks and re-apply capacity
            // protection before planning. This handles NPC input arriving as
            // raw, loose material, or blocks.
            this.phase = 'PREPROCESSING';
            this.#logActivity('B5: Đang nung / đổi khối.');
            const preprocessed = await this.b1Materials.preprocessForCraft({ cancellationToken: token });
            if (!preprocessed.success) {
                await this.#handleResultFailure('B1 preprocessing failed.', preprocessed, token);
                continue;
            }

            this.phase = 'MAINTENANCE';
            const stabilizedAfterPreprocess = await this.#stabilizeStorageBoundary(token, 'after-preprocess');
            if (!stabilizedAfterPreprocess.success) {
                await this.#handleResultFailure('Post-preprocess /kho stabilization failed.', stabilizedAfterPreprocess, token);
                continue;
            }
            if (stabilizedAfterPreprocess.data?.pressure) {
                this.storagePressure = stabilizedAfterPreprocess.data.pressure;
            }
            if (this.storagePressure?.known && this.storagePressure?.protectionRequired === true) {
                // Protection could not outrun the continuous source this pass.
                // Keep craft locked and retry storage protection first.
                await Timeout.delay(this.config.errorRetryMs, { cancellationToken: token });
                continue;
            }

            this.phase = 'CHECKING';
            this.#logActivity('B5: Đang tính các bước còn lại.');
            let inspection = await this.b5Planning.inspectAdditional(1);
            if (!inspection.success) {
                await this.#handleResultFailure('B5 planning inspection failed.', inspection, token);
                continue;
            }

            this.#updateB3Shortages(inspection.data);
            this.#updateB5Progress(inspection.data);
            let actionable = this.#hasActionableWork(inspection.data);
            this.#logRemainingSteps(inspection.data?.progress?.remainingStages);

            // B3 shortage is not a gate. If a cached plan looks idle while its
            // B3 target counts are already satisfied, refresh once so the new
            // B5>B4>B3>B2 priority logic can see any immediately craftable B4.
            if (!actionable && this.#allB3Satisfied(inspection.data)) {
                const fresh = typeof this.b5Planning.inspectAdditionalFresh === 'function'
                    ? await this.b5Planning.inspectAdditionalFresh(1)
                    : await this.b5Planning.inspectAdditional(1, { fresh: true });
                if (fresh?.success) {
                    inspection = fresh;
                    this.#updateB3Shortages(inspection.data);
                    this.#updateB5Progress(inspection.data);
                    actionable = this.#hasActionableWork(inspection.data);
                }
            }

            const pv2AllowsNewB2 = inspection.data?.personalVaultPressure?.allowNewIntermediates !== false;
            const allowMaintenanceB2 = Boolean(this.storagePressure?.shouldConsumeB1) && pv2AllowsNewB2;

            // Idle is always a storage boundary. Even at NORMAL pressure, never
            // enter the material wait with loose ingots/dust/gems left in /kho.
            // runMaintenance promotes any owned intermediate first, then compacts
            // all B1 and only sells if the refreshed capacity actually requires it.
            if (!actionable && typeof this.b5Automation?.runMaintenance === 'function') {
                this.phase = 'MAINTENANCE';
                const maintained = await this.b5Automation.runMaintenance({
                    cancellationToken: token,
                    allowNewB2: allowMaintenanceB2
                });
                if (!maintained.success) {
                    await this.#handleResultFailure('B5 storage maintenance failed.', maintained, token);
                    continue;
                }
                this.lastError = null;
                await this.#refreshB3ShortagesAfterAutomation(token);
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
            const automated = await this.b5Automation.runNext({ cancellationToken: token });
            if (!automated.success) {
                await this.#handleResultFailure('B5 automation failed.', automated, token);
                continue;
            }

            this.lastError = null;
            if (!automated.data?.waitingForMaterials) this.failureBreaker.recordSuccess({ verified: true });
            await this.#refreshB3ShortagesAfterAutomation(token);
            if (automated.data?.completedNewB5) {
                this.cycles += 1;
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

        const joined = await this.skyblock.join(null, { cancellationToken: token });
        if (!joined.success) {
            await this.#handleResultFailure('Daily Sky recovery rejoin failed.', joined, token);
            return true;
        }

        const generation = this.context.getGeneration();
        this.skyReadyGenerations.add(generation);
        this.preparedGeneration = null;
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
            ? 'Daily 03:00 Sky recovery hold active; Collector+B5 will wait 10 minutes.'
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
        if (this.config.waitForSkyblockReady) {
            const deadline = Date.now() + this.config.skyblockReadyTimeoutMs;
            while (!this.skyReadyGenerations.has(generation)) {
                token.throwIfCancelled();
                if (!this.context.has() || this.context.getGeneration() !== generation) return;
                if (Date.now() >= deadline) {
                    throw new Error(`Skyblock readiness was not observed for connection generation ${generation}.`);
                }
                await Timeout.delay(100, { cancellationToken: token });
            }
        }

        if (this.config.teleportHomeOnEnable) {
            this.phase = 'HOMING';
            const home = await this.island.goHome();
            if (!home.success) throw home.error || new Error(home.message || '/is failed.');
        }

        this.phase = 'MOVING_TO_PICKUP';
        await this.movementManager.goTo(this.#requirePickupLocation(), {
            timeoutMs: this.config.moveTimeoutMs,
            radius: this.config.arrivalRadius,
            cancellationToken: token
        });
        await this.movementManager.stop();
        this.phase = 'COLLECTING';
        this.#logActivity('B5: Đã tới điểm nhặt.');
    }

    async #reanchorIfNeeded() {
        // Intentionally disabled for normal Collector+B5 operation. The bot moves
        // to pickupLocation once per connection generation, then remains there
        // while collecting, checking and crafting B5.
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
        if (this.#isStorageBoundaryPhase(failedPhase)) {
            await this.#stabilizeStorageBoundary(token, `recover-${failedPhase.toLowerCase()}`, { bestEffort: true });
        }
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
            try { await this.movementManager.stop(); } catch {}
            return;
        }
        if (failureState.state === 'OPEN') try { await this.movementManager.stop(); } catch {}
        await this.delay(Math.max(50, retryInMs), { cancellationToken: token });
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
        await this.#handleRecoverableFailure(
            message,
            result?.error || new Error(result?.message || message),
            token
        );
    }

    #clearRestartTimer() {
        if (!this.restartTimer) return;
        clearTimeout(this.restartTimer);
        this.restartTimer = null;
    }

    #isStorageBoundaryPhase(phase) {
        return ['PREPROCESSING', 'CHECKING', 'CRAFTING', 'MAINTENANCE'].includes(String(phase || ''));
    }

    async #stabilizeStorageBoundary(token, reason, { bestEffort = false } = {}) {
        try {
            token?.throwIfCancelled?.();
            if (typeof this.b1Materials?.stabilizeStorage === 'function') {
                const result = await this.b1Materials.stabilizeStorage({ cancellationToken: token });
                if (result?.success && result.data?.pressure) this.storagePressure = result.data.pressure;
                if (result?.success === false && !bestEffort) return result;
                return result?.success === false
                    ? { success: true, data: { skippedFailure: true, reason, original: result } }
                    : (result || { success: true, data: { reason } });
            }

            if (typeof this.b1Materials?.compactAll === 'function') {
                const compacted = await this.b1Materials.compactAll({ cancellationToken: token });
                if (compacted?.success === false && !bestEffort) return compacted;
            }
            if (typeof this.b1Materials?.inspectStoragePressure === 'function') {
                const pressure = await this.b1Materials.inspectStoragePressure({ cancellationToken: token });
                if (pressure?.success) this.storagePressure = pressure.data || null;
                if (pressure?.success && pressure.data?.nearFull === true && typeof this.b1Materials?.relieveStoragePressure === 'function') {
                    const relieved = await this.b1Materials.relieveStoragePressure({ cancellationToken: token });
                    if (relieved?.success === false && !bestEffort) return relieved;
                    if (relieved?.success && relieved.data?.pressure) this.storagePressure = relieved.data.pressure;
                }
            }
            return { success: true, data: { reason } };
        } catch (error) {
            if (this.#isCancellation(error, token)) throw error;
            this.logger?.warn?.('B5 storage boundary cleanup failed.', {
                botId: this.botId,
                reason,
                message: error?.message || String(error)
            });
            if (bestEffort) return { success: true, data: { skippedFailure: true, reason, message: error?.message || String(error) } };
            return { success: false, message: error?.message || String(error), error };
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

    #hasActionableWork(data) {
        const progress = data?.progress || {};
        if (progress.b5DirectReady) return true;
        if (Number(progress.b4CraftableTotal || 0) > 0) return true;
        if (Number(progress.b3PromotableTotal || 0) > 0) return true;
        if (data?.fullPlan?.feasible && Array.isArray(data.finalSteps) && data.finalSteps.length > 0) return true;

        return (data?.chains || []).some(chain => {
            const b2Crafts = Number(chain?.b2Crafts || 0);
            const b3Crafts = Number(chain?.b3Crafts || 0);
            const planned = b2Crafts > 0 || b3Crafts > 0;
            if (chain?.readyToReserve && planned) return true;

            // Owned B2 is always worth compressing when a complete B3 group can
            // be formed, even if the B5 planner says this B3 type is not missing.
            const existingB2 = Number(chain?.vaultB2 || 0) + Number(chain?.inventoryB2 || 0);
            if (Number(chain?.b3InputPerCraft || 0) > 0
                && existingB2 >= Number(chain.b3InputPerCraft)) return true;

            // Irreducible lower-tier inventory is still maintenance work: it is
            // stored only after every possible higher-tier promotion has run.
            return Boolean(chain?.compactableB1)
                || Number(chain?.inventoryB2 || 0) > 0
                || Number(chain?.inventoryB3 || 0) > 0;
        });
    }

    #pressureNeedsMaintenance(pressure) {
        return Boolean(pressure?.known && (pressure.shouldConsumeB1 || pressure.sellRequired || pressure.critical));
    }

    #hasMaintenanceWork(data) {
        const progress = data?.progress || {};
        if (Number(progress.b4CraftableTotal || 0) > 0) return true;
        if (Number(progress.b3PromotableTotal || 0) > 0) return true;
        return (data?.chains || []).some(chain => {
            const existingB2 = Number(chain?.vaultB2 || 0) + Number(chain?.inventoryB2 || 0);
            const b3InputPerCraft = Number(chain?.b3InputPerCraft || 0);
            return (b3InputPerCraft > 0 && existingB2 >= b3InputPerCraft)
                || Number(chain?.inventoryB2 || 0) > 0
                || Number(chain?.inventoryB3 || 0) > 0;
        });
    }

    #allB3Satisfied(data) {
        const chains = Array.isArray(data?.chains) ? data.chains : [];
        return chains.length > 0 && chains.every(chain =>
            Number(chain?.b2Crafts || 0) <= 0 && Number(chain?.b3Crafts || 0) <= 0
        );
    }

    #updateB5Progress(data) {
        const progress = data?.progress || null;
        if (!progress) {
            this.b5Progress = null;
            return;
        }
        this.b5Progress = Object.freeze({
            ...progress,
            phase: this.phase,
            updatedAt: new Date().toISOString()
        });
    }

    #updateB3Shortages(data) {
        const chains = Array.isArray(data?.chains) ? data.chains : [];
        const progressB3 = new Map((data?.progress?.b3 || []).map(entry => [entry.id, entry]));
        this.b3Shortages = Object.freeze(chains.map(chain => {
            const progress = progressB3.get(chain.b3Id) || {};
            return Object.freeze({
                b3Id: chain.b3Id,
                b2Id: chain.b2Id,
                missing: Math.max(0, Number(chain.b3Crafts || 0)),
                vault: Math.max(0, Number(chain.vaultB3 || 0)),
                inventory: Math.max(0, Number(chain.inventoryB3 || 0)),
                ownedB2: Math.max(0, Number(progress.ownedB2 || 0)),
                promotableFromOwnedB2: Math.max(0, Number(progress.promotableFromOwnedB2 || 0))
            });
        }));
    }

    async #refreshB3ShortagesAfterAutomation(token) {
        try {
            token?.throwIfCancelled?.();
            const refreshed = await this.b5Planning.inspectAdditional(1);
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

    #activityText(automationProgress, b5Progress) {
        if (!this.enabled) return 'Đã tắt';
        if (this.paused) return 'Tạm dừng';
        const step = automationProgress?.currentStep || null;
        const kind = String(step?.kind || '').toUpperCase();
        const state = String(automationProgress?.state || '').toUpperCase();
        if (this.phase === 'CRAFTING' || automationProgress?.running) {
            if (kind === 'B2' || state === 'CRAFTING_B2') return 'Đang chế B2';
            if (kind === 'B3' || kind === 'B2/B3' || state === 'CRAFTING_B3' || state === 'CRAFTING_INTERMEDIATE') return 'Đang chế B3';
            if (kind === 'B4' || state === 'CRAFTING_B4') return 'Đang chế B4';
            if (kind === 'B5' || state === 'CRAFTING_B5') return 'Đang chế B5';
            if (kind === 'DEPOSIT' || state === 'DEPOSITING') return 'Đang cất B5';
            if (kind === 'VERIFY' || state === 'VERIFYING') return 'Đang xác nhận B5';
            if (kind === 'CONVERT_BLOCKS') return 'Đang đổi khối';
            if (kind === 'SELL') return 'Đang bán';
            if (kind === 'STORE') return 'Đang cất nguyên liệu';
            if (kind === 'PLAN') return 'Đang tính các bước còn lại';
            return 'Đang chế tạo';
        }
        const byPhase = {
            STARTING: 'Đang bắt đầu',
            STARTUP_STORAGE_SAFETY: 'Đang cân B1 về reserve 3 B5',
            RESUMING: 'Đang chạy tiếp',
            WAITING_CONNECTION: 'Đang chờ kết nối',
            WAITING_SKYBLOCK: 'Đang vào SkyBlock',
            HOMING: 'Đang về đảo',
            MOVING_TO_PICKUP: 'Đang đến điểm nhặt',
            PREPROCESSING: 'Đang nung / đổi khối',
            CHECKING: 'Đang tính các bước còn lại',
            COLLECTING: 'Đang nhặt / chờ nguyên liệu',
            MAINTENANCE: 'Đang bảo trì kho',
            WAITING_RETRY: 'Đang thử lại',
            DEGRADED: 'Đang backoff sau lỗi',
            PAUSED_ERROR: 'Tạm dừng do lỗi',
            DAILY_SERVER_RECOVERY_WAIT: 'Đang chờ server',
            DAILY_SKY_RECOVERY_WAIT: 'Đang chờ vào lại SkyBlock'
        };
        return byPhase[this.phase] || (Number(b5Progress?.remainingStages) === 0 ? 'Đã thành công' : 'Đang chạy');
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
        return Object.freeze({
            enabled: config.enabled !== false,
            teleportHomeOnEnable: config.teleportHomeOnEnable !== false,
            waitForSkyblockReady: config.waitForSkyblockReady !== false,
            skyblockReadyTimeoutMs: positive('skyblockReadyTimeoutMs', 30000),
            pickupLocation: Object.freeze({ ...(config.pickupLocation || {}) }),
            arrivalRadius: positive('arrivalRadius', 1.2),
            reanchorRadius: positive('reanchorRadius', 2.5),
            moveTimeoutMs: positive('moveTimeoutMs', 30000),
            pollIntervalMs: positive('pollIntervalMs', 15000),
            errorRetryMs: positive('errorRetryMs', 5000),
            craftLoopDelayMs: positive('craftLoopDelayMs', 250)
        });
    }
}

module.exports = CollectorB5ModeService;
