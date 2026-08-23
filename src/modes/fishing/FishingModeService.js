'use strict';

const Timeout = require('../../shared/time/Timeout');
const Result = require('../../shared/result/Result');
const Status = require('../../shared/result/Status');
const FlowError = require('../../shared/errors/FlowError');
const FailureCircuitBreaker = require('../../shared/resilience/FailureCircuitBreaker');
const { classifyRuntimeResult } = require('../../shared/result/RuntimeResultClassifier');
const { createFailureEvent } = require('../../diagnostics/runtime/RuntimeFailureEvent');
const { normalizeConnectionGeneration } = require('../../core/events/EventEnvelope');
const ModeLeaseSession = require('../ModeLeaseSession');
const TaskSupervisor = require('../../core/TaskSupervisor');

const MODE_ID = 'fishing';

const DEFAULT_PROFILE = Object.freeze({
    name: 'shift-walk-continuous',
    forward: true,
    sneak: true,
    sprint: false,
    jump: false
});

class FishingModeService {
    constructor({
        botId,
        eventBus,
        connectionState,
        connectionControl = null,
        skyblockReadiness = null,
        skyTarget = null,
        afkAreas,
        fishing,
        island,
        movement,
        movementProbe,
        positionGuard,
        worldReadiness,
        recoveryPolicy,
        modeCoordinator,
        failurePublisher = null,
        failurePolicy,
        config = {},
        logger = null,
        delay = Timeout.delay
    }) {
        if (!botId || !eventBus || !connectionState || !afkAreas || !fishing || !island || !movement
            || !movementProbe || !positionGuard || !worldReadiness || !recoveryPolicy || !modeCoordinator) {
            throw new TypeError('FishingModeService dependencies are required');
        }
        Object.assign(this, {
            name: 'FishingModeService', botId, eventBus, connectionState, connectionControl, skyblockReadiness, skyTarget,
            afkAreas, fishing, island, movement, movementProbe, positionGuard, worldReadiness,
            recoveryPolicy, modeCoordinator, failurePublisher, logger, delay
        });
        this.failureBreaker = new FailureCircuitBreaker({ policy: failurePolicy });
        this.config = this.#freezeConfig(config);
        this.enabled = false;
        this.paused = false;
        this.phase = 'OFF';
        this.source = null;
        this.loopPromise = null;
        this.restartTimer = null;
        this.taskSupervisor = new TaskSupervisor({ name: `${botId}:fishing:tasks`, logger, historyLimit: 8, delay });
        this.restartSupervisor = this.taskSupervisor; // Compatibility alias for diagnostics/tests.
        this.startedAt = null;
        this.currentAreaId = null;
        this.needsHomeBeforeAfk = true;
        this.lastAreas = [];
        this.catches = 0;
        this.lastCatchAt = null;
        this.consecutiveCycleRetries = 0;
        this.lastError = null;
        this.lastMovementProfile = null;
        this.lastMovementCalibration = null;
        this.fishingAnchorKind = null;
        this.fishingPitchOverrideDegrees = null;
        this.unsubscribers = [];
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
                if (event?.botId !== this.botId) return;
                const eventGeneration = this.#eventGeneration(event);
                if (eventGeneration === null || eventGeneration !== Number(this.connectionState.generation())) return;
                this.#invalidateRoute();
                if (this.enabled && !this.paused) this.phase = 'WAITING_CONNECTION';
            }),
            this.eventBus.on('connection:spawned', event => {
                if (event?.botId !== this.botId) return;
                const eventGeneration = this.#eventGeneration(event);
                if (eventGeneration === null || eventGeneration !== Number(this.connectionState.generation())) return;
                if (this.enabled && !this.paused) {
                    // Route/anchor snapshots are generation-scoped. A current
                    // spawn is the authoritative point to discard any route
                    // state that might have belonged to the previous connection generation.
                    this.#invalidateRoute();
                    if (this.phase === 'WAITING_CONNECTION') this.phase = 'RESUMING';
                }
            })
        );
    }

    async start() {}

    async enable() {
        let acquiredLease = null;
        try {
            if (!this.config.enabled) return Result.fail(Status.NOT_READY, 'Fishing mode is disabled by config.');
            this.#requireDestinations();
            if (this.enabled) {
                if (!this.#hasModeLease()) {
                    return Result.fail(Status.BUSY, 'Fishing mode lease is no longer current.', null, {
                        owner: this.leaseSession.owner()
                    });
                }
                if (this.paused) return this.resume();
                return Result.ok(this.status(), { alreadyEnabled: true });
            }
            const acquired = this.leaseSession.acquire({ reason: 'Fishing mode enabled.' });
            if (!acquired.success) return acquired;
            acquiredLease = acquired.data;
            this.enabled = true;
            this.paused = false;
            this.phase = 'STARTING';
            this.startedAt = new Date().toISOString();
            this.currentAreaId = null;
            this.needsHomeBeforeAfk = true;
            this.lastAreas = [];
            this.catches = 0;
            this.lastCatchAt = null;
            this.consecutiveCycleRetries = 0;
            this.lastError = null;
            this.lastMovementProfile = null;
            this.lastMovementCalibration = null;
            this.fishingAnchorKind = null;
            this.fishingPitchOverrideDegrees = null;
            this.positionGuard.invalidate();
            this.failureBreaker.reset();
            this.skyblockReadiness?.requireTarget?.(this.skyTarget, { owner: MODE_ID, trigger: 'fishing-enabled' });
            this.#startLoop();
            return Result.ok(this.status(), { leaseId: this.leaseSession.leaseId() });
        } catch (error) {
            if (acquiredLease) this.#releaseModeLease();
            this.enabled = false;
            this.paused = false;
            this.phase = 'OFF';
            return Result.fail(Status.INVALID_INPUT, error.message, error);
        }
    }

    async pause(reason = 'Fishing mode paused.') {
        if (!this.enabled) return Result.fail(Status.NOT_READY, 'Fishing mode is not enabled.');
        if (this.paused) return Result.ok(this.status(), { alreadyPaused: true });
        const leasePause = this.leaseSession.pause();
        if (!leasePause.success) return leasePause;
        this.paused = true;
        this.phase = 'PAUSING';
        await this.#clearRestartTimer(reason);
        this.source?.cancel(reason);
        await this.#safeCleanup('pause');
        await this.#awaitLoop();
        if (this.enabled) this.phase = 'PAUSED';
        return Result.ok(this.status());
    }

    async resume() {
        try {
            if (!this.enabled) return Result.fail(Status.NOT_READY, 'Fishing mode is not enabled.');
            if (!this.paused) return Result.ok(this.status(), { alreadyRunning: true });
            this.#requireDestinations();
            const leaseResume = this.leaseSession.resume();
            if (!leaseResume.success) return leaseResume;
            const pausedForError = ['PAUSED_ERROR', 'DEGRADED'].includes(this.phase);
            this.paused = false;
            this.lastError = null;
            this.#invalidateRoute();
            if (pausedForError) this.failureBreaker.reset();
            this.phase = 'RESUMING';
            this.skyblockReadiness?.requireTarget?.(this.skyTarget, { owner: MODE_ID, trigger: 'fishing-resumed' });
            this.#startLoop();
            return Result.ok(this.status());
        } catch (error) {
            this.leaseSession.pause();
            return Result.fail(Status.INVALID_INPUT, error.message, error);
        }
    }

    async disable(reason = 'Fishing mode disabled.') {
        const alreadyDisabled = !this.enabled && !this.loopPromise;
        try {
            this.enabled = false;
            this.paused = false;
            this.phase = 'STOPPING';
            await this.#clearRestartTimer(reason);
            this.source?.cancel(reason);
            await this.#safeCleanup('disable');
            await this.#awaitLoop();
            this.#invalidateRoute();
            this.failureBreaker.reset();
            this.skyblockReadiness?.releaseTarget?.(MODE_ID);
            this.phase = 'OFF';
        } finally {
            this.#releaseModeLease();
        }
        return Result.ok(this.status(), alreadyDisabled ? { alreadyDisabled: true } : null);
    }

    status() {
        const currentArea = this.currentAreaId ? this.afkAreas.area(this.currentAreaId) : null;
        const anchor = this.positionGuard.snapshot();
        return Object.freeze({
            mode: 'fishing',
            enabled: this.enabled,
            paused: this.paused,
            phase: this.phase,
            currentAreaId: this.currentAreaId,
            destination: currentArea ? this.#destination(currentArea) : null,
            areas: this.lastAreas.map(area => ({
                id: area.id,
                menuSlot: area.menuSlot,
                priority: area.priority,
                current: area.occupancy?.current ?? null,
                capacity: area.occupancy?.capacity ?? null,
                full: area.occupancy?.full ?? null,
                known: Boolean(area.occupancy?.known)
            })),
            catches: this.catches,
            lastCatchAt: this.lastCatchAt,
            consecutiveCycleRetries: this.consecutiveCycleRetries,
            startedAt: this.startedAt,
            lastError: this.lastError?.message || null,
            movementProfile: this.enabled ? this.lastMovementProfile : null,
            movementCalibration: this.enabled ? this.lastMovementCalibration : null,
            fishingAnchor: anchor,
            fishingAnchorKind: this.fishingAnchorKind,
            fishingPitchOverrideDegrees: this.fishingPitchOverrideDegrees,
            failureBudget: this.failureBreaker.snapshot(),
            movementStrategy: {
                name: 'shift-walk-continuous', forward: true, sneak: true, sprint: false, jump: false,
                shoreFishingPitchDegrees: this.config.movement.shoreFishingPitchDegrees
            },
            position: this.connectionState.isConnected() ? this.positionGuard.current() : null,
            modeLease: this.leaseSession.status()
        });
    }

    publicConfig() {
        return JSON.parse(JSON.stringify(this.config));
    }

    async reconfigure(config) {
        const normalized = this.#freezeConfig(config);
        const wasRunning = this.enabled && !this.paused;
        if (wasRunning) {
            this.phase = 'RECONFIGURING';
            this.#clearRestartTimer();
            this.source?.cancel('Fishing configuration updated from Discord.');
            await this.#safeCleanup('reconfigure');
            await this.#awaitLoop();
        }
        this.config = normalized;
        this.afkAreas.reconfigure?.(normalized);
        this.fishing.reconfigure?.(normalized);
        this.movement.reconfigure?.(normalized);
        this.movementProbe.reconfigure?.(normalized);
        this.positionGuard.reconfigure?.(normalized);
        this.worldReadiness.reconfigure?.(normalized);
        this.recoveryPolicy.reconfigure?.(normalized);
        this.lastError = null;
        this.lastMovementProfile = null;
        this.lastMovementCalibration = null;
        this.#invalidateRoute();
        if (wasRunning && this.enabled && !this.paused) {
            this.phase = 'RESUMING';
            this.skyblockReadiness?.requireTarget?.(this.skyTarget, { owner: MODE_ID, trigger: 'fishing-resumed' });
            this.#startLoop();
        } else if (this.enabled && this.paused) this.phase = 'PAUSED';
        else if (!this.enabled) this.phase = 'OFF';
        return this.publicConfig();
    }

    async stop() {
        await this.disable('Runtime stopping.');
        for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    }

    async destroy() {
        await this.stop();
        await this.taskSupervisor.close('Fishing destroyed.');
    }

    #startLoop() {
        if (this.loopPromise || !this.enabled || this.paused) return;
        if (!this.#hasModeLease()) {
            this.#handleLostLease('Fishing cannot start without its current mode lease.');
            return;
        }
        void this.#clearRestartTimer('Fishing loop started.');
        let restart = false;
        let retryMs = 0;
        let loopToken = null;
        const handle = this.taskSupervisor.start('loop', async ({ cancellationToken }) => {
            loopToken = cancellationToken;
            try {
                return await this.#run(cancellationToken);
            } catch (error) {
                const classification = classifyRuntimeResult({ error, token: cancellationToken });
                if (classification.kind === 'TOKEN_CANCELLED') throw error;
                const decision = await this.#handleFailure({ error, classification, token: cancellationToken, unhandled: true });
                restart = this.enabled && !this.paused && !['STOP', 'PAUSE_ERROR'].includes(decision.action);
                retryMs = decision.delayMs;
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
                else if (restart) {
                    const breaker = this.failureBreaker.beforeAttempt();
                    if (breaker.state === 'OPEN') this.phase = 'DEGRADED';
                    const restartDelayMs = Math.max(50, retryMs);
                    const handle = this.taskSupervisor.start('restart', async ({ cancellationToken }) => {
                        await this.delay(restartDelayMs, { cancellationToken });
                        if (this.restartTimer === handle) this.restartTimer = null;
                        if (this.enabled && !this.paused && !this.loopPromise) this.#startLoop();
                    }, { metadata: { phase: this.phase, retryDelayMs: restartDelayMs } });
                    this.restartTimer = handle;
                    handle.promise.catch(error => {
                        if (error?.code !== 'CANCELLED') this.logger?.debug?.('Fishing supervised restart ended with error.', { error });
                    });
                }
            });
    }

    async #run(token) {
        while (this.enabled && !this.paused) {
            token.throwIfCancelled();
            if (!this.#hasModeLease()) {
                this.#handleLostLease('Fishing mode lease was lost while running.');
                return;
            }
            const permit = this.failureBreaker.beforeAttempt();
            if (!permit.allowed) {
                this.phase = 'DEGRADED';
                await this.#safeCleanup('breaker-open', token);
                await this.delay(Math.max(50, permit.retryInMs), { cancellationToken: token });
                continue;
            }
            if (!this.connectionState.isConnected()) {
                this.phase = 'WAITING_CONNECTION';
                await this.delay(this.config.connectionPollMs, { cancellationToken: token });
                continue;
            }
            const expectedGeneration = Number(this.connectionState.generation());
            if (!this.#isSkyblockReady(expectedGeneration)) {
                this.phase = 'WAITING_SKYBLOCK';
                await this.delay(this.config.connectionPollMs, { cancellationToken: token });
                continue;
            }
            try {
                await this.#businessCycle(token, expectedGeneration);
            } catch (error) {
                const classification = classifyRuntimeResult({ error, token });
                if (classification.kind === 'TOKEN_CANCELLED') throw error;
                if (!this.#isCurrentGeneration(expectedGeneration)) {
                    this.logger?.debug?.('Ignoring fishing outcome from a stale connection generation.', {
                        botId: this.botId,
                        expectedGeneration,
                        currentGeneration: this.connectionState.generation(),
                        code: error?.code || null
                    });
                    continue;
                }
                const decision = await this.#handleFailure({ error, classification, token, unhandled: false, expectedGeneration });
                if (!this.#isCurrentGeneration(expectedGeneration)) continue;
                if (decision.action === 'STOP' || decision.action === 'PAUSE_ERROR') return;
                if (decision.action === 'REQUEST_RECONNECT') {
                    const requested = await this.connectionControl?.requestReconnect?.(
                        'Fishing recovery policy requested reconnect.',
                        { expectedGeneration }
                    );
                    if (requested) this.#invalidateRoute();
                    else if (!this.#isCurrentGeneration(expectedGeneration)) continue;
                } else if (['REANCHOR', 'REJOIN_AREA'].includes(decision.action)) {
                    this.#invalidateRoute();
                }
                if (decision.delayMs > 0 && this.#isCurrentGeneration(expectedGeneration)) {
                    await this.delay(decision.delayMs, { cancellationToken: token });
                }
            }
        }
    }

    async #businessCycle(token, expectedGeneration) {
        token.throwIfCancelled();
        this.#assertCurrentGeneration(expectedGeneration, 'business-cycle-start');
        let area = this.currentAreaId ? this.afkAreas.area(this.currentAreaId) : null;
        const guard = this.positionGuard.verifyCurrent();
        if (area && guard.valid) {
            this.phase = 'EQUIPPING_ROD';
            await this.fishing.equipRod({ cancellationToken: token, expectedGeneration });
            this.#assertCurrentGeneration(expectedGeneration, 'fast-path-equip-complete');
            return this.#fishCycle(area, token, expectedGeneration);
        }
        if (area && !guard.valid) this.#invalidateRoute();

        this.phase = 'STOWING_ROD';
        await this.fishing.stowRod({ cancellationToken: token, expectedGeneration });
        this.#assertCurrentGeneration(expectedGeneration, 'stow-complete');
        area = null;
        if (this.needsHomeBeforeAfk) {
            this.phase = 'RETURNING_ISLAND';
            const home = await this.island.goHome({ cancellationToken: token });
            this.#assertCurrentGeneration(expectedGeneration, 'island-return-complete');
            if (!(await this.#consumeResult(home, token, 'WAITING_AREA', expectedGeneration))) return;
            this.#assertCurrentGeneration(expectedGeneration, 'island-result-consumed');
            this.needsHomeBeforeAfk = false;
        }

        this.phase = 'SELECTING_AREA';
        const joined = await this.afkAreas.joinBestAvailable({ cancellationToken: token });
        this.#assertCurrentGeneration(expectedGeneration, 'afk-join-complete');
        if (!(await this.#consumeResult(joined, token, 'WAITING_AREA', expectedGeneration))) return;
        this.#assertCurrentGeneration(expectedGeneration, 'afk-result-consumed');
        this.lastAreas = joined.data?.areas || [];
        if (!joined.data?.joined) {
            this.phase = 'WAITING_AREA';
            await this.delay(this.config.areaRetryMs, { cancellationToken: token });
            return;
        }
        area = joined.data.area;
        this.currentAreaId = area.id;
        const destination = this.#destination(area);

        this.phase = 'WAITING_AFK_WORLD';
        await this.worldReadiness.waitUntilReady({ expectedGeneration, cancellationToken: token });
        this.#assertCurrentGeneration(expectedGeneration, 'world-ready-complete');

        let profile = DEFAULT_PROFILE;
        if (this.config.probe?.enabled === true) {
            this.phase = 'PROBING_MOVEMENT';
            const probe = await this.movementProbe.run({ destination, expectedGeneration, cancellationToken: token });
            this.#assertCurrentGeneration(expectedGeneration, 'movement-probe-complete');
            this.lastMovementCalibration = probe;
            if (probe.requiresReconnect) {
                throw new FlowError('Fishing movement probe requires a clean connection.', {
                    code: 'FISHING_PROBE_RECONNECT_REQUIRED', subsystem: 'fishing-probe', operation: 'FishingModeService', step: 'probe', retryable: true
                });
            }
            const selected = this.config.probe.profiles.find(candidate => candidate.name === probe.selected);
            if (selected) profile = selected;
        }
        profile = Object.freeze({ ...profile, sneak: true });
        this.lastMovementProfile = profile;
        await this.#moveToShore({ area, destination, profile, token, expectedGeneration });
        this.#assertCurrentGeneration(expectedGeneration, 'capture-anchor');
        this.positionGuard.capture({ expectedGeneration });
        this.fishingAnchorKind = 'configured-destination';
        this.fishingPitchOverrideDegrees = this.config.movement.shoreFishingPitchDegrees;
        this.phase = 'EQUIPPING_ROD';
        await this.fishing.equipRod({ cancellationToken: token, expectedGeneration });
        this.#assertCurrentGeneration(expectedGeneration, 'equip-complete');
        const postEquipGuard = this.positionGuard.verifyCurrent();
        if (!postEquipGuard.valid) {
            await this.fishing.stowRod({ cancellationToken: token, expectedGeneration });
            throw new FlowError('Position changed while equipping fishing rod.', {
                code: postEquipGuard.code || 'FISHING_POSITION_LOST', subsystem: 'fishing-mode', operation: 'FishingModeService',
                step: 'post-equip-position-guard', retryable: true, details: postEquipGuard
            });
        }
        return this.#fishCycle(area, token, expectedGeneration);
    }

    async #fishCycle(area, token, expectedGeneration) {
        this.phase = 'FISHING';
        const guard = this.positionGuard.verifyCurrent();
        if (!guard.valid) {
            throw new FlowError('Fishing position was lost before cast.', {
                code: guard.code || 'FISHING_POSITION_LOST', subsystem: 'fishing-mode', operation: 'FishingModeService', step: 'pre-cast-position-guard',
                resource: area.id, retryable: true, details: guard
            });
        }
        const cycle = await this.fishing.fishOnce({
            cancellationToken: token,
            positionGuard: this.positionGuard,
            pitchDegrees: this.fishingPitchOverrideDegrees,
            expectedGeneration
        });
        this.#assertCurrentGeneration(expectedGeneration, 'fish-cycle-complete');
        this.lastError = null;
        if (cycle?.retry || cycle?.timeout) {
            this.consecutiveCycleRetries += 1;
            const retryLimit = this.#positiveInteger(this.config.recovery?.cycleRetryLimit, 3);
            if (this.consecutiveCycleRetries >= retryLimit) {
                throw new FlowError(`Fishing cycle failed ${this.consecutiveCycleRetries} consecutive times.`, {
                    code: 'FISHING_CYCLE_RETRY_EXHAUSTED',
                    subsystem: 'fishing',
                    operation: 'FishingModeService',
                    step: 'fish-cycle-retry-budget',
                    resource: area.id,
                    retryable: true,
                    details: {
                        consecutiveCycleRetries: this.consecutiveCycleRetries,
                        retryLimit,
                        signal: cycle.signal || null,
                        cycleError: cycle.error || null
                    }
                });
            }
            return cycle;
        }
        this.consecutiveCycleRetries = 0;
        if (cycle?.caught) {
            this.failureBreaker.recordSuccess({ verified: true });
            this.catches += 1;
            this.lastCatchAt = new Date().toISOString();
            // The catch belongs to the exact cycle generation captured before
            // asynchronous fishing work. Do not recapture the replacement connection generation.
            this.#assertCurrentGeneration(expectedGeneration, 'emit-catch');
            this.eventBus.emit('mode:fishing:catch', {
                botId: this.botId,
                connectionGeneration: expectedGeneration,
                areaId: area.id,
                catches: this.catches,
                at: this.lastCatchAt,
                signal: cycle.signal || null
            });
        }
        return cycle;
    }

    async #moveToShore({ area, destination, profile, token, expectedGeneration }) {
        this.phase = 'MOVING_TO_SHORE';
        const retryLimit = Math.max(0, Number(this.config.movement?.localRetryLimit || 0));
        const retryDelayMs = Math.max(0, Number(this.config.movement?.localRetryDelayMs || 0));
        let lastError = null;

        for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
            token.throwIfCancelled();
            this.#assertCurrentGeneration(expectedGeneration, `movement-attempt-${attempt + 1}`);
            const arrival = this.positionGuard.verifyDestination(destination);
            if (arrival.valid) return arrival;

            try {
                await this.movement.move({
                    destination,
                    expectedGeneration,
                    cancellationToken: token,
                    profile: { ...profile, sneak: true }
                });
                this.#assertCurrentGeneration(expectedGeneration, `movement-complete-${attempt + 1}`);
                const verified = this.positionGuard.verifyDestination(destination);
                if (verified.valid) return verified;
                lastError = new FlowError('Fishing destination arrival verification failed.', {
                    code: verified.code || 'FISHING_DESTINATION_NOT_REACHED',
                    subsystem: 'fishing-mode',
                    operation: 'FishingModeService',
                    step: 'verify-arrival',
                    resource: area.id,
                    retryable: true,
                    details: { ...verified, localAttempt: attempt + 1, localAttempts: retryLimit + 1 }
                });
            } catch (error) {
                const code = String(error?.code || '').toUpperCase();
                if (['CANCELLED', 'FISHING_STALE_GENERATION', 'FISHING_MOVEMENT_DISCONNECTED'].includes(code)) throw error;
                if (!this.#isLocalMovementRetryable(code)) throw error;
                lastError = error;
            }

            await this.movement.stop?.();
            if (attempt < retryLimit && retryDelayMs > 0) {
                this.logger?.warn?.('Fishing shore movement retrying in the same AFK area.', {
                    botId: this.botId,
                    areaId: area.id,
                    attempt: attempt + 1,
                    maxAttempts: retryLimit + 1,
                    error: lastError?.message || null,
                    code: lastError?.code || null,
                    sneak: true
                });
                await this.delay(retryDelayMs, { cancellationToken: token });
            }
        }

        throw lastError || new FlowError('Fishing movement could not reach the configured shore point.', {
            code: 'FISHING_DESTINATION_NOT_REACHED',
            subsystem: 'fishing-mode',
            operation: 'FishingModeService',
            step: 'move-to-shore',
            resource: area.id,
            retryable: true
        });
    }

    #isLocalMovementRetryable(code) {
        return new Set([
            'TIMEOUT',
            'FISHING_MOVEMENT_TIMEOUT',
            'FISHING_MOVEMENT_STUCK',
            'FISHING_DESTINATION_NOT_REACHED',
            'FISHING_DESTINATION_VERTICAL_DRIFT'
        ]).has(String(code || '').toUpperCase());
    }

    #isSkyblockReady(expectedGeneration) {
        if (!this.skyblockReadiness || typeof this.skyblockReadiness.isGenerationReady !== 'function') return true;
        try {
            return this.skyblockReadiness.isGenerationReady(expectedGeneration, this.skyTarget) === true;
        } catch (error) {
            this.logger?.warn?.('Fishing Skyblock readiness probe failed.', {
                botId: this.botId,
                expectedGeneration,
                error
            });
            return false;
        }
    }

    async #consumeResult(result, token, waitPhase, expectedGeneration = null) {
        if (expectedGeneration !== null) this.#assertCurrentGeneration(expectedGeneration, `${waitPhase}-result`);
        if (result?.success) return true;
        const classification = classifyRuntimeResult({ result, token });
        if (classification.kind === 'TOKEN_CANCELLED') {
            token.throwIfCancelled();
            return false;
        }
        if (classification.kind === 'EXPECTED_CANCEL' || classification.kind === 'WAIT') {
            this.phase = waitPhase;
            this.lastError = null;
            await this.delay(this.config.areaRetryMs, { cancellationToken: token });
            if (expectedGeneration !== null) this.#assertCurrentGeneration(expectedGeneration, `${waitPhase}-delay`);
            return false;
        }
        if (result?.error) throw result.error;
        throw new FlowError(result?.message || 'Fishing capability failed.', {
            code: classification.code || result?.status || 'FISHING_CAPABILITY_FAILED',
            subsystem: 'fishing-mode', operation: 'FishingModeService', step: waitPhase, retryable: true
        });
    }

    async #handleFailure({ error, classification, token, unhandled, expectedGeneration = null }) {
        if (expectedGeneration !== null && !this.#isCurrentGeneration(expectedGeneration)) {
            return Object.freeze({ action: 'WAIT', delayMs: 0, nextPhase: this.phase, publishFailure: false, staleGeneration: true });
        }
        if (classification.kind === 'EXPECTED_CANCEL' || classification.kind === 'WAIT') {
            const decision = this.recoveryPolicy.decide({ classification, error, phase: this.phase, breaker: this.failureBreaker.snapshot(), enabled: this.enabled, paused: this.paused });
            this.phase = decision.nextPhase;
            this.lastError = null;
            return decision;
        }
        const diagnostic = error?.toDiagnostic?.() || FlowError.errorDiagnostic(error) || {};
        const retryable = diagnostic.retryable !== false;
        const breakerState = this.failureBreaker.recordFailure({ retryable });
        const now = typeof this.failureBreaker.clock === 'function' ? this.failureBreaker.clock() : Date.now();
        const retryInMs = Math.max(0, breakerState.currentBackoffMs || 0, breakerState.openUntil ? breakerState.openUntil - now : 0);
        const decision = this.recoveryPolicy.decide({
            classification,
            error,
            phase: this.phase,
            breaker: { ...breakerState, retryInMs },
            enabled: this.enabled,
            paused: this.paused
        });
        this.lastError = error;
        if (decision.publishFailure) this.#publishFailure(error, diagnostic, retryInMs, unhandled, expectedGeneration);
        if (decision.action === 'PAUSE_ERROR') {
            this.paused = true;
            this.phase = 'PAUSED_ERROR';
            await this.#safeCleanup('non-retryable', token, expectedGeneration);
        } else if (breakerState.state === 'OPEN') {
            this.phase = 'DEGRADED';
            await this.#safeCleanup('breaker-open', token, expectedGeneration);
        } else this.phase = decision.nextPhase;
        return decision;
    }

    #publishFailure(error, diagnostic, retryInMs, unhandled, expectedGeneration = null) {
        const input = {
            botId: this.botId,
            connectionGeneration: expectedGeneration ?? this.connectionState.generation(),
            source: 'fishing',
            subsystem: diagnostic.subsystem || 'fishing-mode',
            severity: diagnostic.retryable === false ? 'error' : 'warn',
            code: diagnostic.code || error?.code || 'FISHING_RUNTIME_FAILURE',
            operation: diagnostic.operation || 'FishingModeService',
            step: diagnostic.step || this.phase,
            action: diagnostic.action || null,
            resource: diagnostic.resource || this.currentAreaId,
            message: diagnostic.message || error?.message || String(error || 'Fishing failure.'),
            retryable: diagnostic.retryable !== false,
            diagnostic,
            phase: this.phase,
            retryInMs,
            details: { unhandled }
        };
        const failure = this.failurePublisher?.publish
            ? this.failurePublisher.publish(input)
            : createFailureEvent(input, { botId: this.botId });
        if (!this.failurePublisher?.publish) this.eventBus.emit('runtime:failure', failure);
        return failure;
    }

    async #safeCleanup(reason, token = null, expectedGeneration = null) {
        if (expectedGeneration !== null && !this.#isCurrentGeneration(expectedGeneration)) return false;
        try {
            await this.movement.stop?.();
        } catch (error) {
            this.logger?.warn?.('Fishing movement cleanup failed.', { reason, error });
        }
        if (expectedGeneration !== null && !this.#isCurrentGeneration(expectedGeneration)) return false;
        if (!this.connectionState.isConnected()) return;
        try {
            await this.fishing.stowRod({
                cancellationToken: token?.isCancelled ? null : token,
                expectedGeneration: expectedGeneration ?? this.connectionState.generation()
            });
        } catch (error) {
            if (error?.code !== 'CANCELLED') this.logger?.debug?.('Fishing rod cleanup failed.', { reason, error });
        }
        return true;
    }

    async #awaitLoop() {
        if (!this.loopPromise) return;
        try {
            await this.loopPromise;
        } catch (error) {
            this.logger?.debug?.('Fishing loop settled with error during lifecycle cleanup.', { error });
        }
    }

    #invalidateRoute() {
        this.currentAreaId = null;
        this.needsHomeBeforeAfk = true;
        this.positionGuard.invalidate();
        this.fishingAnchorKind = null;
        this.fishingPitchOverrideDegrees = null;
    }

    async #clearRestartTimer(reason = 'Fishing restart cancelled.') {
        const handle = this.restartTimer;
        if (!handle) return;
        this.restartTimer = null;
        handle.cancel(reason);
        try {
            await handle.promise;
        } catch (error) {
            if (error?.code !== 'CANCELLED') {
                this.logger?.debug?.('Fishing restart cleanup observed an unexpected rejection.', { reason, error });
            }
        }
    }

    #eventGeneration(event) {
        return normalizeConnectionGeneration(event);
    }

    #isCurrentGeneration(expectedGeneration) {
        return this.connectionState.isConnected()
            && Number(this.connectionState.generation()) === Number(expectedGeneration);
    }

    #hasModeLease() {
        return this.leaseSession.isHeld();
    }

    #releaseModeLease() {
        const leaseId = this.leaseSession.leaseId();
        if (!leaseId) return;
        const released = this.leaseSession.release();
        if (!released.success) this.logger?.warn?.('Fishing mode lease release failed.', {
            botId: this.botId,
            leaseId,
            message: released.message
        });
    }

    #handleCoordinatorChange(change) {
        if (!this.leaseSession.matchesRelease(change) || !this.enabled) return;
        this.#handleLostLease('Fishing mode lease was revoked.');
    }

    #handleLostLease(message) {
        if (!this.enabled) return;
        this.lastError = new FlowError(message, {
            code: 'MODE_LEASE_LOST',
            subsystem: 'mode-coordinator',
            operation: 'FishingModeService',
            step: 'lease-ownership',
            retryable: false,
            details: { botId: this.botId, modeId: MODE_ID, leaseId: this.leaseSession.leaseId() }
        });
        this.paused = true;
        this.phase = 'PAUSED_ERROR';
        this.source?.cancel(message);
    }

    #assertCurrentGeneration(expectedGeneration, step) {
        if (this.#isCurrentGeneration(expectedGeneration)) return;
        throw new FlowError('Fishing operation belongs to a stale connection generation.', {
            code: 'FISHING_STALE_GENERATION',
            subsystem: 'fishing-mode',
            operation: 'FishingModeService',
            step,
            retryable: true,
            details: {
                expectedGeneration,
                currentGeneration: this.connectionState.generation(),
                connected: this.connectionState.isConnected()
            }
        });
    }

    #destination(area) {
        const destination = area?.destination;
        if (!destination || !['x', 'y', 'z'].every(axis => Number.isFinite(Number(destination[axis])))) {
            throw new FlowError(`Fishing destination is invalid for area ${area?.id || 'unknown'}.`, {
                code: 'FISHING_DESTINATION_INVALID', subsystem: 'fishing-mode', operation: 'FishingModeService', step: 'resolve-destination', retryable: false
            });
        }
        return Object.freeze({ x: Number(destination.x), y: Number(destination.y), z: Number(destination.z) });
    }

    #requireDestinations() {
        for (const area of this.config.areas || []) this.#destination(area);
    }

    #positiveInteger(value, fallback) {
        const number = Number(value);
        return Number.isInteger(number) && number > 0 ? number : fallback;
    }

    #freezeConfig(config) {
        if (!config || typeof config !== 'object') throw new TypeError('Fishing mode config is required.');
        return Object.freeze(JSON.parse(JSON.stringify(config)));
    }
}

module.exports = FishingModeService;
