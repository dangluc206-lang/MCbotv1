'use strict';

const FlowError = require('../../shared/errors/FlowError');
const { Vec3 } = require('vec3');

/**
 * Fishing AFK direct movement ported from the first V1 FishingService.
 *
 * Intentional behavior parity with old walkDirectlyToTarget():
 * - start moving immediately with forward + sprint + jump;
 * - server forcedMove only re-applies movement controls (it does NOT spam lookAt);
 * - aim at the target at most once every 500 ms;
 * - progress is measured by 3D distance and must improve by 0.15 blocks;
 * - if stuck, perform the exact old back -> left -> right unstuck maneuver;
 * - arrival is only true when 3D distance <= targetReachDistance;
 * - always release every movement control on finish/failure/cancel.
 *
 * This executor never equips or uses a fishing rod. FishingModeService owns that
 * transition and may equip only after this executor has returned successfully and
 * a second arrival guard has passed.
 */
class SprintJumpRouteExecutor {
    constructor({ context, controlStateManager, rotationService, positionService, logger = null }) {
        if (!context || !controlStateManager || !rotationService || !positionService) {
            throw new TypeError('SprintJumpRouteExecutor dependencies are required');
        }
        Object.assign(this, { context, controlStateManager, rotationService, positionService, logger });
        this.active = false;
        this.unsticking = false;
    }

    goTo(destination, {
        timeoutMs = 15000,
        targetReachDistance = 1,
        stuckMs = 4000,
        unstuckAttempts = 3,
        lookIntervalMs = 500,
        progressDelta = 0.15,
        forceDirectSprintJump = true,
        jumpOverGroundBlocks = ['cyan_terracotta', 'blue_terracotta'],
        cancellationToken = null
    } = {}) {
        const bot = this.context.require();
        if (typeof bot.setControlState !== 'function' || typeof bot.lookAt !== 'function') {
            return Promise.reject(new FlowError('Mineflayer cannot direct-walk to the fishing target.', {
                code: 'SPRINT_JUMP_UNSUPPORTED',
                subsystem: 'movement',
                operation: 'SprintJumpRouteExecutor',
                step: 'validate',
                retryable: false
            }));
        }

        const start = this.positionService.current();
        const startedAt = Date.now();

        return new Promise((resolve, reject) => {
            let lastDistance = Infinity;
            let lastProgressAt = Date.now();
            let lastLookAt = 0;
            let forcedMoves = 0;
            let unstuckCount = 0;
            let done = false;
            let unsubscribeCancel = () => {};

            const atTarget = () => {
                const current = this.positionService.current();
                return Boolean(current && this.positionService.distance(current, destination) <= targetReachDistance);
            };

            const applyDirectMovementControls = () => {
                const position = this.positionService.current();
                if (!position || !this.active || this.unsticking) return;
                this.controlStateManager.set('forward', true);
                this.controlStateManager.set('sprint', true);
                this.controlStateManager.set(
                    'jump',
                    destination.y > position.y + 0.6
                    || forceDirectSprintJump !== false
                    || this.#hasObstacleAhead(destination)
                    || this.#hasHazardousGroundAhead(destination, jumpOverGroundBlocks)
                );
            };

            // Exact old V1 forcedMove behavior: restore controls only.
            // Do not issue lookAt here; high-frequency forcedMove packets must not
            // become high-frequency rotation packets.
            const onForcedMove = () => {
                forcedMoves += 1;
                applyDirectMovementControls();
                if (forcedMoves !== 1 && forcedMoves % 5 !== 0) return;
                this.logger?.warn?.('FISHING SERVER POSITION CORRECTION', {
                    operation: 'SprintJumpRouteExecutor',
                    step: 'forced-move-reapply',
                    phase: 'RETRYING',
                    action: 'old-v1 re-apply forward+sprint+jump after forcedMove',
                    forcedMoves,
                    current: this.positionService.current(),
                    destination
                });
            };

            const cleanup = () => {
                clearInterval(interval);
                clearTimeout(timer);
                bot.off?.('forcedMove', onForcedMove);
                bot.removeListener?.('forcedMove', onForcedMove);
                unsubscribeCancel();
                this.#releaseDirectWalk();
            };

            const finish = (error = null) => {
                if (done) return;
                done = true;
                cleanup();
                if (error) reject(error);
                else {
                    resolve({
                        start,
                        destination,
                        position: this.positionService.current(),
                        forcedMoves,
                        unstuckAttempts: unstuckCount,
                        elapsedMs: Date.now() - startedAt
                    });
                }
            };

            this.active = true;
            applyDirectMovementControls();

            const interval = setInterval(() => {
                if (done) return;
                try {
                    cancellationToken?.throwIfCancelled?.();
                } catch (error) {
                    finish(error);
                    return;
                }

                if (!this.context.has()) {
                    finish(new FlowError('Connection ended while moving to the fishing target.', {
                        code: 'SPRINT_JUMP_CONNECTION_LOST',
                        subsystem: 'movement',
                        operation: 'SprintJumpRouteExecutor',
                        step: 'navigate',
                        retryable: true
                    }));
                    return;
                }

                if (atTarget()) {
                    this.logger?.info?.('SPRINT-JUMP ARRIVAL OK', {
                        operation: 'SprintJumpRouteExecutor',
                        step: 'verify-arrival',
                        phase: 'OK',
                        action: 'old-v1 direct sprint+jump reached target',
                        current: this.positionService.current(),
                        destination,
                        targetReachDistance,
                        forcedMoves,
                        unstuckAttempts: unstuckCount,
                        elapsedMs: Date.now() - startedAt
                    });
                    finish();
                    return;
                }

                if (this.unsticking) return;
                const position = this.positionService.current();
                if (!position) return;
                const distance = this.positionService.distance(position, destination);

                if (distance < lastDistance - progressDelta) {
                    lastDistance = distance;
                    lastProgressAt = Date.now();
                }

                if (Date.now() - lastProgressAt >= stuckMs) {
                    if (unstuckCount < unstuckAttempts) {
                        unstuckCount += 1;
                        this.unsticking = true;
                        lastProgressAt = Date.now();
                        this.logger?.warn?.('FISHING MOVEMENT STUCK; OLD V1 UNSTUCK', {
                            operation: 'SprintJumpRouteExecutor',
                            step: 'unstuck',
                            phase: 'RETRYING',
                            action: 'old-v1 back + left + right + jump then resume',
                            attempt: unstuckCount,
                            maxAttempts: unstuckAttempts,
                            current: position,
                            destination,
                            distance,
                            forcedMoves
                        });

                        this.#performUnstuck({ cancellationToken })
                            .catch(error => {
                                if (error?.code === 'CANCELLED') finish(error);
                                else this.logger?.warn?.('FISHING OLD V1 UNSTUCK FAILED', {
                                    operation: 'SprintJumpRouteExecutor',
                                    step: 'unstuck',
                                    phase: 'RETRYING',
                                    error: error?.message || String(error)
                                });
                            })
                            .finally(() => {
                                if (done) return;
                                this.unsticking = false;
                                lastDistance = Infinity;
                                lastProgressAt = Date.now();
                                applyDirectMovementControls();
                            });
                        return;
                    }

                    const velocity = bot.entity?.velocity;
                    const motion = velocity
                        ? `velocity=${velocity.x.toFixed(2)},${velocity.y.toFixed(2)},${velocity.z.toFixed(2)}`
                        : 'velocity=unknown';
                    finish(new FlowError(
                        `Old-V1 direct movement is still stuck; distance=${distance.toFixed(1)}, serverCorrections=${forcedMoves}, ${motion}. ${this.#blockedPathDiagnostic(destination)}`,
                        {
                            code: 'SPRINT_JUMP_NAVIGATION_STUCK',
                            subsystem: 'movement',
                            operation: 'SprintJumpRouteExecutor',
                            step: 'unstuck',
                            action: 'old-v1 direct movement recovery',
                            resource: `${destination.x},${destination.y},${destination.z}`,
                            retryable: true,
                            details: {
                                start,
                                current: position,
                                destination,
                                distance,
                                forcedMoves,
                                unstuckAttempts: unstuckCount
                            }
                        }
                    ));
                    return;
                }

                if (Date.now() - lastLookAt >= lookIntervalMs) {
                    lastLookAt = Date.now();
                    // Exact old V1 target: destination X/Z, but keep eye-height Y
                    // from the bot's current position so it runs horizontally at it.
                    Promise.resolve(this.rotationService.lookAt(
                        new Vec3(destination.x, position.y + 1.5, destination.z),
                        true
                    )).catch(error => {
                        this.logger?.debug?.('Sprint+jump periodic look update failed.', { error });
                    });
                }

                applyDirectMovementControls();
            }, 100);

            const timer = setTimeout(() => {
                const current = this.positionService.current();
                finish(new FlowError(`Old-V1 direct movement did not reach the fishing target within ${timeoutMs} ms.`, {
                    code: 'SPRINT_JUMP_NAVIGATION_TIMEOUT',
                    subsystem: 'movement',
                    operation: 'SprintJumpRouteExecutor',
                    step: 'navigate',
                    action: 'old-v1 direct sprint+jump to destination',
                    resource: `${destination.x},${destination.y},${destination.z}`,
                    retryable: true,
                    details: {
                        start,
                        current,
                        destination,
                        distance: current ? this.positionService.distance(current, destination) : null,
                        timeoutMs,
                        targetReachDistance,
                        forcedMoves,
                        unstuckAttempts: unstuckCount
                    }
                }));
            }, timeoutMs);

            bot.on('forcedMove', onForcedMove);
            if (cancellationToken?.onCancelled) {
                unsubscribeCancel = cancellationToken.onCancelled(reason => {
                    const error = new FlowError(String(reason || 'Fishing movement cancelled.'), {
                        code: 'CANCELLED',
                        subsystem: 'movement',
                        operation: 'SprintJumpRouteExecutor',
                        step: 'navigate'
                    });
                    finish(error);
                });
            }
        });
    }

    async #performUnstuck({ cancellationToken = null } = {}) {
        const set = (control, value) => this.controlStateManager.set(control, value);
        const wait = ms => new Promise((resolve, reject) => {
            let unsubscribe = () => {};
            const timer = setTimeout(() => {
                unsubscribe();
                resolve();
            }, ms);
            if (cancellationToken?.onCancelled) {
                unsubscribe = cancellationToken.onCancelled(reason => {
                    clearTimeout(timer);
                    unsubscribe();
                    reject(new FlowError(String(reason || 'Fishing movement cancelled.'), {
                        code: 'CANCELLED', subsystem: 'movement', operation: 'SprintJumpRouteExecutor', step: 'unstuck'
                    }));
                });
            }
        });

        set('forward', false);
        set('back', true);
        set('sprint', true);
        await wait(300);
        if (!this.active) return;

        set('back', false);
        set('left', true);
        set('forward', true);
        set('jump', true);
        await wait(550);
        if (!this.active) return;

        set('left', false);
        set('right', true);
        await wait(700);
        if (!this.active) return;

        set('right', false);
        set('jump', false);
    }

    #hasObstacleAhead(target) {
        const bot = this.context.get();
        const position = this.positionService.current();
        if (!bot || !position || typeof bot.blockAt !== 'function') return false;
        const dx = target.x - position.x;
        const dz = target.z - position.z;
        const length = Math.hypot(dx, dz);
        if (!length) return false;
        const ahead = new Vec3(
            Math.floor(position.x + dx / length),
            Math.floor(position.y),
            Math.floor(position.z + dz / length)
        );
        const block = bot.blockAt(ahead);
        return Boolean(block && block.boundingBox === 'block');
    }

    #hasHazardousGroundAhead(target, hazards = ['cyan_terracotta', 'blue_terracotta']) {
        const bot = this.context.get();
        const position = this.positionService.current();
        if (!bot || !position || typeof bot.blockAt !== 'function') return false;
        const dx = target.x - position.x;
        const dz = target.z - position.z;
        const length = Math.hypot(dx, dz);
        if (!length) return false;
        const y = Math.floor(position.y) - 1;
        const ground = [
            new Vec3(Math.floor(position.x), y, Math.floor(position.z)),
            new Vec3(
                Math.floor(position.x + dx / length),
                y,
                Math.floor(position.z + dz / length)
            )
        ];
        return ground.some(blockPosition => hazards.includes(bot.blockAt(blockPosition)?.name));
    }

    #blockedPathDiagnostic(target) {
        const bot = this.context.get();
        const position = this.positionService.current();
        if (!bot || !position || typeof bot.blockAt !== 'function') return 'Cannot read nearby blocks.';
        const dx = target.x - position.x;
        const dz = target.z - position.z;
        const length = Math.hypot(dx, dz) || 1;
        const forwardX = dx / length;
        const forwardZ = dz / length;
        const leftX = -forwardZ;
        const leftZ = forwardX;
        const y = Math.floor(position.y);
        const point = (x, yOffset, z) => new Vec3(Math.floor(x), y + yOffset, Math.floor(z));
        const describe = (label, blockPosition) => {
            const block = bot.blockAt(blockPosition);
            return `${label}=${block?.name || 'unloaded'}@${blockPosition.x},${blockPosition.y},${blockPosition.z}`;
        };
        const aheadX = position.x + forwardX;
        const aheadZ = position.z + forwardZ;
        return [
            describe('ahead-feet', point(aheadX, 0, aheadZ)),
            describe('ahead-head', point(aheadX, 1, aheadZ)),
            describe('left', point(position.x + leftX, 0, position.z + leftZ)),
            describe('right', point(position.x - leftX, 0, position.z - leftZ)),
            describe('below', point(position.x, -1, position.z))
        ].join(' | ');
    }

    #releaseDirectWalk() {
        this.active = false;
        this.unsticking = false;
        // Exact old V1 cleanup, but through the per-bot control manager.
        for (const control of ['forward', 'back', 'left', 'right', 'jump', 'sprint']) {
            try {
                this.controlStateManager.set(control, false);
            } catch (error) {
                this.logger?.warn?.('Sprint+jump control release failed.', { control, error });
            }
        }
        try {
            this.controlStateManager.clear();
        } catch (error) {
            this.logger?.warn?.('Sprint+jump control manager clear failed.', { error });
        }
    }
}

module.exports = SprintJumpRouteExecutor;
