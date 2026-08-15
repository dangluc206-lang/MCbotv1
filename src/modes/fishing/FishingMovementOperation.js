'use strict';

const FlowError = require('../../shared/errors/FlowError');
const Timeout = require('../../shared/time/Timeout');
const { Vec3 } = require('vec3');

class FishingMovementOperation {
    constructor({
        botId,
        context,
        connectionState,
        operationManager,
        controlStateManager,
        rotationService,
        positionService,
        config = {},
        delay = Timeout.delay,
        clock = () => Date.now(),
        logger = null
    }) {
        if (!botId || !context || !connectionState || !operationManager || !controlStateManager || !rotationService || !positionService) {
            throw new TypeError('FishingMovementOperation dependencies are required');
        }
        Object.assign(this, {
            botId, context, connectionState, operationManager, controlStateManager,
            rotationService, positionService, delay, clock, logger
        });
        this.reconfigure(config);
    }

    reconfigure(config = {}) {
        const movement = config.movement || config;
        this.config = Object.freeze({
            timeoutMs: this.#positive(movement.timeoutMs ?? movement.directFallbackTimeoutMs, 30000),
            tickMs: this.#positive(movement.tickMs ?? movement.inputIntervalMs, 100),
            arrivalRadius: this.#positive(movement.arrivalRadius ?? movement.targetReachDistance, 1),
            verticalTolerance: this.#positive(movement.verticalTolerance, 1.5),
            arrivalStableMs: this.#nonNegative(movement.arrivalStableMs, 400),
            noProgressMs: this.#positive(movement.noProgressMs ?? movement.directFallbackStuckMs, 4000),
            progressDelta: this.#positive(movement.progressDelta ?? movement.progressEpsilon, 0.05),
            lookIntervalMs: this.#positive(movement.lookIntervalMs, 500)
        });
    }

    async move({ destination, expectedGeneration, timeoutMs = null, cancellationToken = null, profile = null } = {}) {
        const target = this.#destination(destination);
        const generation = Number(expectedGeneration);
        if (!this.connectionState.isCurrentGeneration(generation)) throw this.#stale(generation);
        const operationTimeout = this.#positive(timeoutMs, this.config.timeoutMs);
        const movementProfile = Object.freeze({
            name: String(profile?.name || 'shift-walk-continuous'),
            forward: profile?.forward !== false,
            sneak: profile?.sneak !== false,
            sprint: profile?.sprint === true,
            jump: profile?.jump === true
        });

        return this.operationManager.run({
            run: async (operationContext, { lockPolicy }) => {
                const locks = ['movement'];
                if (!lockPolicy.acquire(locks, operationContext.operationId)) {
                    throw new FlowError('Fishing movement lock is busy.', {
                        code: 'FISHING_MOVEMENT_BUSY', subsystem: 'fishing-movement', operation: 'FishingMovementOperation',
                        step: 'acquire-lock', retryable: true
                    });
                }
                try {
                    return await this.#execute({
                        operationId: operationContext.operationId,
                        destination: target,
                        expectedGeneration: generation,
                        timeoutMs: operationTimeout,
                        cancellationToken: operationContext.cancellation.token,
                        profile: movementProfile
                    });
                } finally {
                    lockPolicy.release(locks, operationContext.operationId);
                }
            }
        }, {
            timeoutMs: operationTimeout,
            cancellationToken,
            metadata: { subsystem: 'fishing-movement', destination: target, expectedGeneration: generation }
        });
    }

    async #execute({ operationId, destination, expectedGeneration, timeoutMs, cancellationToken, profile }) {
        const bot = this.context.require();
        if (!this.#isCurrent(bot, expectedGeneration)) throw this.#stale(expectedGeneration);
        const start = this.#snapshot(this.positionService.current());
        const startedAt = this.clock();
        let stableSince = null;
        let lastProgressAt = startedAt;
        let bestDistance = Infinity;
        let lastLookAt = 0;
        let forcedMoves = 0;

        const applyControls = () => {
            this.controlStateManager.set('forward', profile.forward);
            this.controlStateManager.set('sneak', profile.sneak);
            this.controlStateManager.set('sprint', profile.sprint);
            this.controlStateManager.set('jump', profile.jump);
        };
        const onForcedMove = () => {
            if (!this.#isCurrent(bot, expectedGeneration)) return;
            forcedMoves += 1;
            applyControls();
        };
        bot.on?.('forcedMove', onForcedMove);

        try {
            while (true) {
                cancellationToken?.throwIfCancelled?.();
                if (!this.#isCurrent(bot, expectedGeneration)) {
                    throw new FlowError('Connection changed during fishing movement.', {
                        code: 'FISHING_MOVEMENT_DISCONNECTED', subsystem: 'fishing-movement', operation: 'FishingMovementOperation',
                        step: 'move', retryable: true, details: { expectedGeneration, currentGeneration: this.connectionState.generation() }
                    });
                }
                const now = this.clock();
                if (now - startedAt >= timeoutMs) {
                    throw new FlowError(`Fishing movement timed out after ${timeoutMs} ms.`, {
                        code: 'FISHING_MOVEMENT_TIMEOUT', subsystem: 'fishing-movement', operation: 'FishingMovementOperation',
                        step: 'move', retryable: true, details: { operationId, start, destination, forcedMoves, timeoutMs }
                    });
                }
                const current = this.#snapshot(this.positionService.current());
                if (!current) {
                    await this.delay(this.config.tickMs, { cancellationToken });
                    continue;
                }
                const horizontal = Math.hypot(current.x - destination.x, current.z - destination.z);
                const vertical = Math.abs(current.y - destination.y);
                const distance = Math.hypot(horizontal, vertical);
                if (horizontal <= this.config.arrivalRadius && vertical <= this.config.verticalTolerance) {
                    if (stableSince === null) stableSince = now;
                    if (now - stableSince >= this.config.arrivalStableMs) {
                        return Object.freeze({
                            operationId, start, destination: { ...destination }, position: current,
                            forcedMoves, elapsedMs: now - startedAt, profile: profile.name,
                            connectionGeneration: expectedGeneration
                        });
                    }
                } else {
                    stableSince = null;
                }
                if (distance < bestDistance - this.config.progressDelta) {
                    bestDistance = distance;
                    lastProgressAt = now;
                } else if (now - lastProgressAt >= this.config.noProgressMs) {
                    throw new FlowError('Fishing movement made no verified progress.', {
                        code: 'FISHING_MOVEMENT_STUCK', subsystem: 'fishing-movement', operation: 'FishingMovementOperation',
                        step: 'progress-guard', retryable: true,
                        details: { operationId, start, current, destination, bestDistance, forcedMoves, noProgressMs: this.config.noProgressMs }
                    });
                }

                if (now - lastLookAt >= this.config.lookIntervalMs) {
                    lastLookAt = now;
                    await this.rotationService.lookAt(new Vec3(destination.x, current.y + 1.5, destination.z), true);
                }
                applyControls();
                await this.delay(this.config.tickMs, { cancellationToken });
            }
        } finally {
            bot.removeListener?.('forcedMove', onForcedMove);
            try {
                this.controlStateManager.clear();
            } catch (error) {
                this.logger?.warn?.('Fishing movement control cleanup failed.', { operationId, error });
            }
        }
    }

    async stop() {
        try {
            this.controlStateManager.clear();
        } catch (error) {
            this.logger?.warn?.('Fishing movement stop cleanup failed.', { error });
        }
    }

    async destroy() { await this.stop(); }

    #isCurrent(bot, generation) {
        return this.context.get() === bot && this.connectionState.isCurrentGeneration(generation);
    }

    #stale(expectedGeneration) {
        return new FlowError('Fishing movement belongs to a stale connection generation.', {
            code: 'FISHING_STALE_GENERATION', subsystem: 'fishing-movement', operation: 'FishingMovementOperation',
            step: 'generation-guard', retryable: true,
            details: { expectedGeneration, currentGeneration: this.connectionState.generation() }
        });
    }

    #destination(destination) {
        if (!destination || !['x', 'y', 'z'].every(axis => Number.isFinite(Number(destination[axis])))) {
            throw new FlowError('Fishing movement destination must contain finite x/y/z.', {
                code: 'FISHING_DESTINATION_INVALID', subsystem: 'fishing-movement', operation: 'FishingMovementOperation',
                step: 'validate-destination', retryable: false
            });
        }
        return Object.freeze({ x: Number(destination.x), y: Number(destination.y), z: Number(destination.z) });
    }

    #snapshot(position) {
        if (!position || !['x', 'y', 'z'].every(axis => Number.isFinite(Number(position[axis])))) return null;
        return Object.freeze({ x: Number(position.x), y: Number(position.y), z: Number(position.z) });
    }

    #positive(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : fallback;
    }

    #nonNegative(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? number : fallback;
    }
}

module.exports = FishingMovementOperation;