'use strict';

const Timeout = require('../../shared/time/Timeout');
const FlowError = require('../../shared/errors/FlowError');

class FishingService {
    constructor({ context, rotationService, config = {}, logger = null }) {
        if (!context || !rotationService) throw new TypeError('FishingService dependencies are required');
        Object.assign(this, { context, rotationService, logger });
        this.config = this.#normalize(config);
    }

    reconfigure(config = {}) {
        this.config = this.#normalize(config);
        return this.publicConfig();
    }

    publicConfig() {
        return { ...this.config };
    }

    isRod(item) {
        return Boolean(item && String(item.name || item.itemName || '') === this.config.rodMaterial);
    }

    async stowRod({ cancellationToken = null, expectedGeneration = null } = {}) {
        this.#assertGeneration(expectedGeneration);
        cancellationToken?.throwIfCancelled?.();
        const bot = this.context.require();
        if (this.isRod(bot.inventory?.slots?.[45])) {
            const empty = bot.inventory?.firstEmptyInventorySlot?.();
            if (!Number.isInteger(empty) || empty < 0) {
                throw new FlowError('Cannot remove fishing rod from off-hand because inventory has no free slot.', {
                    code: 'FISHING_CANNOT_STOW_OFFHAND_ROD', subsystem: 'fishing', operation: 'FishingService', step: 'stow-rod'
                });
            }
            await bot.unequip('off-hand');
            cancellationToken?.throwIfCancelled?.();
            this.#assertGeneration(expectedGeneration, bot);
        }

        if (this.isRod(bot.heldItem)) {
            const hotbar = bot.inventory?.slots || [];
            let safeQuickbar = -1;
            for (let index = 0; index < 9; index += 1) {
                const item = hotbar[36 + index] || null;
                if (!this.isRod(item)) {
                    safeQuickbar = index;
                    break;
                }
            }
            if (safeQuickbar >= 0) {
                bot.setQuickBarSlot(safeQuickbar);
                await Timeout.delay(25, { cancellationToken });
                this.#assertGeneration(expectedGeneration, bot);
            } else {
                const empty = bot.inventory?.firstEmptyInventorySlot?.();
                if (!Number.isInteger(empty) || empty < 0) {
                    throw new FlowError('Cannot put fishing rod away before travel; no safe hand slot is available.', {
                        code: 'FISHING_CANNOT_STOW_MAINHAND_ROD', subsystem: 'fishing', operation: 'FishingService', step: 'stow-rod'
                    });
                }
                await bot.unequip('hand');
                cancellationToken?.throwIfCancelled?.();
                this.#assertGeneration(expectedGeneration, bot);
            }
        }

        if (this.isRod(bot.heldItem) || this.isRod(bot.inventory?.slots?.[45])) {
            throw new FlowError('Fishing rod is still equipped before travel.', {
                code: 'FISHING_ROD_STILL_EQUIPPED', subsystem: 'fishing', operation: 'FishingService', step: 'verify-stowed'
            });
        }
        return { stowed: true };
    }

    async equipRod({ cancellationToken = null, expectedGeneration = null } = {}) {
        this.#assertGeneration(expectedGeneration);
        cancellationToken?.throwIfCancelled?.();
        const bot = this.context.require();
        if (this.isRod(bot.heldItem)) return { equipped: true, alreadyEquipped: true };
        const slots = bot.inventory?.slots || [];
        const rod = slots.find(item => this.isRod(item));
        if (!rod) {
            throw new FlowError(`Fishing rod not found: ${this.config.rodMaterial}`, {
                code: 'FISHING_ROD_NOT_FOUND', subsystem: 'fishing', operation: 'FishingService', step: 'equip-rod', resource: this.config.rodMaterial,
                retryable: false
            });
        }
        await bot.equip(rod, 'hand');
        cancellationToken?.throwIfCancelled?.();
        this.#assertGeneration(expectedGeneration, bot);
        if (!this.isRod(bot.heldItem)) {
            throw new FlowError('Fishing rod equip verification failed.', {
                code: 'FISHING_ROD_EQUIP_VERIFY_FAILED', subsystem: 'fishing', operation: 'FishingService', step: 'equip-rod', resource: this.config.rodMaterial
            });
        }
        return { equipped: true };
    }

    async aimDown(pitchDegrees = this.config.lookPitchDegrees) {
        const bot = this.context.require();
        const yaw = Number(bot.entity?.yaw || 0);
        const requestedDegrees = Number.isFinite(Number(pitchDegrees))
            ? Number(pitchDegrees)
            : this.config.lookPitchDegrees;
        const magnitudeDegrees = Math.max(0, Math.min(89, Math.abs(requestedDegrees)));
        const internalPitchDegrees = -magnitudeDegrees;
        const pitch = internalPitchDegrees * Math.PI / 180;

        await this.rotationService.look(yaw, pitch, true);

        this.logger?.debug?.('FISHING AIM', {
            operation: 'FishingService',
            step: 'aim',
            yaw,
            requestedPitchDegrees: requestedDegrees,
            internalPitchDegrees,
            actualPitchRadians: Number(bot.entity?.pitch ?? pitch)
        });

        return { yaw, pitch, pitchDegrees: internalPitchDegrees, requestedPitchDegrees: requestedDegrees };
    }

    /**
     * Fishing cycle based on the original MCbot behavior.
     *
     * The rod stays selected for the whole fishing session. Mineflayer's
     * bot.fish() performs the normal main-hand use-item action (right click),
     * watches the fishing bite particles, reels the rod with another right
     * click, and resolves when that cycle completes.
     *
     * This server can also finish the catch automatically. In that case
     * Mineflayer reports "Fishing cancelled" when the bobber is destroyed.
     * Treat that as the end of the server fishing cycle and immediately start
     * the next cycle after the short recast delay, instead of resetting the
     * whole fishing mode or waiting for the server's slower auto-recast.
     */
    async fishOnce({ cancellationToken = null, positionGuard = null, pitchDegrees = null, expectedGeneration = null } = {}) {
        this.#assertGeneration(expectedGeneration);
        const bot = this.context.require();
        cancellationToken?.throwIfCancelled?.();

        if (!this.isRod(bot.heldItem)) {
            throw new FlowError('Fishing rod must remain in the main hand while fishing.', {
                code: 'FISHING_ROD_NOT_EQUIPPED', subsystem: 'fishing', operation: 'FishingService', step: 'fish-once'
            });
        }
        if (positionGuard && !this.#positionValid(positionGuard)) {
            throw new FlowError('Fishing position is not verified; cast blocked.', {
                code: 'FISHING_POSITION_NOT_READY', subsystem: 'fishing', operation: 'FishingService', step: 'pre-cast-guard', retryable: true
            });
        }
        if (typeof bot.fish !== 'function') {
            throw new FlowError('Mineflayer bot.fish() is unavailable.', {
                code: 'FISHING_API_UNAVAILABLE', subsystem: 'fishing', operation: 'FishingService', step: 'fish-once', retryable: false
            });
        }

        await this.aimDown(Number.isFinite(Number(pitchDegrees)) ? Number(pitchDegrees) : this.config.lookPitchDegrees);

        let result;
        try {
            await this.#waitFishingTask(
                Promise.resolve().then(() => bot.fish()),
                { cancellationToken, positionGuard, timeoutMs: this.config.biteTimeoutMs }
            );
            this.#assertGeneration(expectedGeneration, bot);

            result = {
                caught: true,
                completed: true,
                signal: 'mineflayer-fish-complete',
                rodHeld: this.isRod(bot.heldItem)
            };
            this.logger?.debug?.('FISHING ORIGINAL FLOW CYCLE COMPLETE', {
                operation: 'FishingService',
                step: 'fish-once',
                signal: result.signal,
                rodHeld: result.rodHeld
            });
        } catch (error) {
            if (error?.code === 'CANCELLED') throw error;
            if (error?.code === 'FISHING_POSITION_LOST') throw error;

            const message = String(error?.message || error || '');
            const serverAutoFinished = /^Fishing cancelled$/i.test(message.trim());
            const overlappingFishCall = /due to calling bot\.fish\(\) again/i.test(message);

            if (serverAutoFinished && !overlappingFishCall) {
                result = {
                    caught: true,
                    completed: true,
                    serverAutoCompleted: true,
                    signal: 'server-bobber-destroyed',
                    rodHeld: this.isRod(bot.heldItem)
                };
                this.logger?.debug?.('FISHING SERVER AUTO CYCLE COMPLETE; RECAST EARLY', {
                    operation: 'FishingService',
                    step: 'fish-once',
                    signal: result.signal,
                    rodHeld: result.rodHeld
                });
            } else if (error?.code === 'TIMEOUT' || error?.name === 'TimeoutError') {
                // Keep the rod selected and let the next bot.fish() call cancel any
                // stale Mineflayer fishing task before it right-clicks to cast again.
                result = {
                    caught: false,
                    completed: false,
                    timeout: true,
                    signal: 'fish-timeout',
                    rodHeld: this.isRod(bot.heldItem)
                };
                this.logger?.warn?.('FISHING ORIGINAL FLOW TIMEOUT; WILL RIGHT-CLICK AGAIN', {
                    operation: 'FishingService',
                    step: 'fish-once',
                    rodHeld: result.rodHeld
                });
            } else {
                // Match the original MCbot behavior: an ordinary fishing-cycle
                // failure must not reset /is -> /afk. Keep the same rod/position and
                // simply let the next loop cast again.
                result = {
                    caught: false,
                    completed: false,
                    retry: true,
                    signal: 'fish-cycle-error',
                    error: message,
                    rodHeld: this.isRod(bot.heldItem)
                };
                this.logger?.warn?.('FISHING ORIGINAL FLOW CYCLE ERROR; RECASTING', {
                    operation: 'FishingService',
                    step: 'fish-once',
                    error: message,
                    rodHeld: result.rodHeld
                });
            }
        }

        cancellationToken?.throwIfCancelled?.();
        this.#assertGeneration(expectedGeneration, bot);
        if (positionGuard && !this.#positionValid(positionGuard)) {
            throw new FlowError('Fishing position changed after the fishing cycle.', {
                code: 'FISHING_POSITION_LOST', subsystem: 'fishing', operation: 'FishingService', step: 'post-cycle-guard', retryable: true
            });
        }
        if (!this.isRod(bot.heldItem)) {
            throw new FlowError('Fishing rod left the main hand during the fishing cycle.', {
                code: 'FISHING_ROD_NOT_EQUIPPED', subsystem: 'fishing', operation: 'FishingService', step: 'post-cycle-rod-guard', retryable: true
            });
        }

        if (this.config.recastDelayMs > 0) {
            await Timeout.delay(this.config.recastDelayMs, { cancellationToken });
        }
        return result;
    }

    #waitFishingTask(promise, { cancellationToken = null, positionGuard = null, timeoutMs = 0 } = {}) {
        return new Promise((resolve, reject) => {
            let done = false;
            let guardTimer = null;
            let timeoutTimer = null;
            let cancelOff = () => {};

            const cleanup = () => {
                if (guardTimer) clearInterval(guardTimer);
                if (timeoutTimer) clearTimeout(timeoutTimer);
                cancelOff();
            };
            const finish = (callback, value) => {
                if (done) return;
                done = true;
                cleanup();
                callback(value);
            };

            if (positionGuard) {
                guardTimer = setInterval(() => {
                    try {
                        if (!this.#positionValid(positionGuard)) {
                            finish(reject, new FlowError('Fishing position was lost while waiting for the fishing cycle.', {
                                code: 'FISHING_POSITION_LOST', subsystem: 'fishing', operation: 'FishingService', step: 'position-guard', retryable: true
                            }));
                        }
                    } catch (error) {
                        this.logger?.debug?.('Fishing position guard threw while waiting for cycle.', { error });
                        finish(reject, new FlowError('Fishing position guard failed.', {
                            code: 'FISHING_POSITION_LOST', subsystem: 'fishing', operation: 'FishingService', step: 'position-guard', retryable: true
                        }));
                    }
                }, this.config.positionGuardPollMs);
            }

            if (cancellationToken) {
                cancelOff = cancellationToken.onCancelled(reason => {
                    finish(reject, new FlowError(reason || 'Fishing cancelled.', {
                        code: 'CANCELLED', subsystem: 'fishing', operation: 'FishingService', step: 'fish-once'
                    }));
                });
            }

            if (Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0) {
                timeoutTimer = setTimeout(() => {
                    finish(reject, new FlowError(`Fishing cycle timed out after ${Number(timeoutMs)} ms.`, {
                        code: 'TIMEOUT', subsystem: 'fishing', operation: 'FishingService', step: 'fish-timeout', retryable: true
                    }));
                }, Number(timeoutMs));
            }

            Promise.resolve(promise).then(
                value => finish(resolve, value),
                error => finish(reject, error)
            );
        });
    }

    #normalize(config) {
        if (typeof config.rodMaterial !== 'string' || !config.rodMaterial.trim()) throw new Error('fishing.rodMaterial is required');
        return Object.freeze({
            rodMaterial: config.rodMaterial.trim(),
            lookPitchDegrees: Number.isFinite(config.lookPitchDegrees) ? Number(config.lookPitchDegrees) : 85,
            biteTimeoutMs: this.#positive(config.biteTimeoutMs, 65000),
            positionGuardPollMs: this.#positive(config.positionGuardPollMs, 100),
            bobberMaxDistance: this.#positive(config.bobberMaxDistance, 32),
            recastDelayMs: this.#nonNegative(config.recastDelayMs, 250)
        });
    }

    #positionValid(positionGuard) {
        if (typeof positionGuard === 'function') return Boolean(positionGuard());
        if (typeof positionGuard?.verifyCurrent === 'function') return positionGuard.verifyCurrent().valid === true;
        if (typeof positionGuard?.verify === 'function') return positionGuard.verify().valid === true;
        return false;
    }

    #assertGeneration(expectedGeneration, expectedBot = null) {
        if (expectedGeneration === null || expectedGeneration === undefined) return;
        const currentGeneration = typeof this.context.getGeneration === 'function' ? Number(this.context.getGeneration()) : Number(expectedGeneration);
        const currentBot = typeof this.context.get === 'function' ? this.context.get() : null;
        if (currentGeneration !== Number(expectedGeneration) || (expectedBot && currentBot && currentBot !== expectedBot)) {
            throw new FlowError('Fishing action belongs to a stale connection generation.', {
                code: 'FISHING_STALE_GENERATION', subsystem: 'fishing', operation: 'FishingService', step: 'generation-guard', retryable: true,
                details: { expectedGeneration, currentGeneration }
            });
        }
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

module.exports = FishingService;
