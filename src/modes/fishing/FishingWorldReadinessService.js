'use strict';

const FlowError = require('../../shared/errors/FlowError');
const Timeout = require('../../shared/time/Timeout');

class FishingWorldReadinessService {
    constructor({ context, connectionState, config = {}, delay = Timeout.delay, logger = null }) {
        if (!context || !connectionState) throw new TypeError('FishingWorldReadinessService dependencies are required');
        Object.assign(this, { context, connectionState, delay, logger });
        this.reconfigure(config);
    }

    reconfigure(config = {}) {
        const world = config.worldReadiness || {};
        this.config = Object.freeze({
            timeoutMs: this.#positive(world.timeoutMs ?? config.movement?.worldReadyTimeoutMs, 10000),
            pollMs: this.#positive(world.pollMs, 100),
            settleMs: this.#nonNegative(world.settleMs ?? config.movement?.worldSettleMs, 350)
        });
    }

    async waitUntilReady({ expectedGeneration, cancellationToken = null } = {}) {
        const startedAt = Date.now();
        while (Date.now() - startedAt <= this.config.timeoutMs) {
            cancellationToken?.throwIfCancelled?.();
            if (!this.connectionState.isCurrentGeneration(expectedGeneration)) {
                throw new FlowError('Connection changed while waiting for the fishing world.', {
                    code: 'FISHING_WORLD_DISCONNECTED', subsystem: 'fishing-world', operation: 'FishingWorldReadinessService',
                    step: 'wait-ready', retryable: true, details: { expectedGeneration, currentGeneration: this.connectionState.generation() }
                });
            }
            const bot = this.context.get();
            const position = bot?.entity?.position || null;
            if (position && [position.x, position.y, position.z].every(Number.isFinite)) {
                let blockReady = true;
                if (typeof bot.blockAt === 'function') {
                    try {
                        blockReady = Boolean(bot.blockAt(position, false));
                    } catch (error) {
                        blockReady = false;
                        this.logger?.debug?.('Fishing world readiness block probe failed.', { error });
                    }
                }
                if (blockReady) {
                    if (this.config.settleMs > 0) await this.delay(this.config.settleMs, { cancellationToken });
                    cancellationToken?.throwIfCancelled?.();
                    if (!this.connectionState.isCurrentGeneration(expectedGeneration)) continue;
                    return Object.freeze({ ready: true, connectionGeneration: Number(expectedGeneration) });
                }
            }
            await this.delay(this.config.pollMs, { cancellationToken });
        }
        throw new FlowError(`Fishing world was not ready within ${this.config.timeoutMs} ms.`, {
            code: 'FISHING_WORLD_READY_TIMEOUT', subsystem: 'fishing-world', operation: 'FishingWorldReadinessService',
            step: 'wait-ready', retryable: true, details: { expectedGeneration, timeoutMs: this.config.timeoutMs }
        });
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

module.exports = FishingWorldReadinessService;