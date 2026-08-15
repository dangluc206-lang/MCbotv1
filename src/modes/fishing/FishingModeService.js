'use strict';

const CancellationSource = require('../../shared/cancellation/CancellationSource');
const Timeout = require('../../shared/time/Timeout');
const Result = require('../../shared/result/Result');
const Status = require('../../shared/result/Status');
const FlowError = require('../../shared/errors/FlowError');
const FailureCircuitBreaker = require('../../shared/resilience/FailureCircuitBreaker');
const { classifyRuntimeResult } = require('../../shared/result/RuntimeResultClassifier');
const { createFailureEvent } = require('../../diagnostics/runtime/RuntimeFailureEvent');

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
        afkAreas,
        fishing,
        island,
        movement,
        movementProbe,
        positionGuard,
        worldReadiness,
        recoveryPolicy,
        collectorB5Mode = null,
        failurePublisher = null,
        failurePolicy,
        config = {},
        logger = null,
        delay = Timeout.delay
    }) {
        if (!botId || !eventBus || !connectionState || !afkAreas || !fishing || !island || !movement
            || !movementProbe || !positionGuard || !worldReadiness || !recoveryPolicy) {
            throw new TypeError('FishingModeService dependencies are required');
        }
        Object.assign(this, {
            name: 'FishingModeService', botId, eventBus, connectionState, connectionControl,
            afkAreas, fishing, island, movement, movementProbe, positionGuard, worldReadiness,
            recoveryPolicy, collectorB5Mode, failurePublisher, logger, delay
        });
        this.failureBreaker = new FailureCircuitBreaker({ policy: failurePolicy });
        this.config = this.#freezeConfig(config);
        this.enabled = false;
        this.paused = false;
        this.phase = 'OFF';
        this.source = null;
        this.loopPromise = null;
        this.restartTimer = null;
        this.startedAt = null;
        this.currentAreaId = null;
        this.needsHomeBeforeAfk = true;
        this.lastAreas = [];
        this.catches = 0;
        this.lastCatchAt = null;
        this.lastError = null;
        this.lastMovementProfile = null;
        this.lastMovementCalibration = null;
        this.fishingAnchorKind = null;
        this.fishingPitchOverrideDegrees = null;
        this.unsubscribers = [];
    }

    async initialize() {
        if (this.unsubscribers.length > 0) return;
        this.unsubscribers.push(
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
        try {
            if (!this.config.enabled) return Result.fail(Status.NOT_READY, 'Fishing mode is disabled by config.');
            if (this.collectorB5Mode?.status?.().enabled) return Result.fail(Status.BUSY, 'Tắt hoặc dừng mode Nhặt+B5 trước khi bật mode câu cá.');
            this.#requireDestinations();
            if (this.enabled) {
                if (this.paused) return this.resume();
                return Result.ok(this.status(), { alreadyEnabled: true });
            }
            this.enabled = true;
            this.paused = false;
            this.phase = 'STARTING';
            this.startedAt = new Date().toISOString();
            this.currentAreaId = null;
            this.needsHomeBeforeAfk = true;
            this.lastAreas = [];
            this.catches = 0;
            this.lastCatchAt = null;
            this.lastError = null;
            this.lastMovementProfile = null;
            this.lastMovementCalibration = null;
            this.fishingAnchorKind = null;
            this.fishingPitchOverrideDegrees = null;
            this.positionGuard.invalidate();
            this.failureBreaker.reset();
            this.#startLoop();
            return Result.ok(this.status());
        } catch (error) {
            return Result.fail(Status.INVALID_INPUT, error.message, error);
        }
    }

    async pause(reason = 'Fishing mode paused.') {
        if (!this.enabled) return Result.fail(Status.NOT_READY, 'Fishing mode is not enabled.');
        if (this.paused) return Result.ok(this.status(), { alreadyPaused: true });
        this.paused = true;
        this.phase = 'PAUSING';
        this.#clearRestartTimer();
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
            if (this.collectorB5Mode?.status?.().enabled) return Result.fail(Status.BUSY, 'Tắt hoặc dừng mode Nhặt+B5 trước khi chạy tiếp mode câu cá.');
            this.#requireDestinations();
            const pausedForError = ['PAUSED_ERROR', 'DEGRADED'].includes(this.phase);
            this.paused = false;
            this.lastError = null;
            this.#invalidateRoute();
            if (pausedForError) this.failureBreaker.reset();
            this.phase = 'RESUMING';
            this.#startLoop();
            return Result.ok(this.status());
        } catch (error) {
            return Result.fail(Status.INVALID_INPUT, error.message, error);
        }
    }

    async disable(reason = 'Fishing mode disabled.') {
        if (!this.enabled && !this.loopPromise) return Result.ok(this.status(), { alreadyDisabled: true });
        this.enabled = false;
        this.paused = false;
        this.phase = 'STOPPING';
        this.#clearRestartTimer();
        this.source?.cancel(reason);
        await this.#safeCleanup('disable');
        await this.#awaitLoop();
        this.#invalidateRoute();
        this.failureBreaker.reset();
        this.phase = 'OFF';
        return Result.ok(this.status());
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
            position: this.connectionState.isConnected() ? this.positionGuard.current() : null
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
            this.#startLoop();
        } else if (this.enabled && this.paused) this.phase = 'PAUSED';
        else if (!this.enabled) this.phase = 'OFF';
        return this.publicConfig();
    }

    async stop() {
        await this.disable('Runtime stopping.');
        for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    }

    async destroy() { await this.stop(); }

    #startLoop() {
        if (this.loopPromise || !this.enabled || this.paused) return;
        this.#clearRestartTimer();
        const source = new CancellationSource();
        this.source = source;
        let restart = false;
        let retryMs = 0;
        this.loopPromise = this.#run(source.token)
            .catch(async error => {
                const classification = classifyRuntimeResult({ error, token: source.token });
                if (classification.kind === 'TOKEN_CANCELLED') return;
                const decision = await this.#handleFailure({ error, classification, token: source.token, unhandled: true });
                restart = this.enabled && !this.paused && !['STOP', 'PAUSE_ERROR'].includes(decision.action);
                retryMs = decision.delayMs;
            })
            .finally(() => {
                source.dispose();
                if (this.source === source) this.source = null;
                this.loopPromise = null;
                if (!this.enabled) this.phase = 'OFF';
                else if (this.paused && this.phase !== 'PAUSED_ERROR') this.phase = 'PAUSED';
                else if (restart) {
                    const breaker = this.failureBreaker.beforeAttempt();
                    if (breaker.state === 'OPEN') this.phase = 'DEGRADED';
                    this.restartTimer = setTimeout(() => {
                        this.restartTimer = null;
                        if (this.enabled && !this.paused && !this.loopPromise) this.#startLoop();
                    }, Math.max(50, retryMs));
                    this.restartTimer.unref?.();
                }
            });
    }

    async #run(token) {
        while (this.enabled && !this.paused) {
            token.throwIfCancelled();
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
            const expectedGeneration = this.connectionState.generation();
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
        this.lastMovementProfile = Object.freeze({ ...profile });
        this.phase = 'MOVING_TO_SHORE';
        const arrival = this.positionGuard.verifyDestination(destination);
        if (!arrival.valid) await this.movement.move({ destination, expectedGeneration, cancellationToken: token, profile });
        this.#assertCurrentGeneration(expectedGeneration, 'movement-complete');
        const verified = this.positionGuard.verifyDestination(destination);
        if (!verified.valid) {
            throw new FlowError('Fishing destination arrival verification failed.', {
                code: verified.code || 'FISHING_DESTINATION_NOT_REACHED', subsystem: 'fishing-mode', operation: 'FishingModeService',
                step: 'verify-arrival', resource: area.id, retryable: true, details: verified
            });
        }
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
        if (cycle?.caught) {
            this.failureBreaker.recordSuccess({ verified: true });
            this.catches += 1;
            this.lastCatchAt = new Date().toISOString();
            this.eventBus.emit('mode:fishing:catch', {
                botId: this.botId,
                areaId: area.id,
                catches: this.catches,
                at: this.lastCatchAt,
                signal: cycle.signal || null
            });
        }
        return cycle;
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

    #clearRestartTimer() {
        if (!this.restartTimer) return;
        clearTimeout(this.restartTimer);
        this.restartTimer = null;
    }

    #eventGeneration(event) {
        const value = event?.connectionGeneration ?? event?.generation;
        const generation = Number(value);
        return Number.isFinite(generation) ? generation : null;
    }

    #isCurrentGeneration(expectedGeneration) {
        return this.connectionState.isConnected()
            && Number(this.connectionState.generation()) === Number(expectedGeneration);
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

    #freezeConfig(config) {
        if (!config || typeof config !== 'object') throw new TypeError('Fishing mode config is required.');
        return Object.freeze(JSON.parse(JSON.stringify(config)));
    }
}

module.exports = FishingModeService;