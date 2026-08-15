'use strict';

const CancellationSource = require('../../shared/cancellation/CancellationSource');
const DailyRecoverySchedule = require('../../shared/time/DailyRecoverySchedule');

class SkyblockAutoJoinService {
    constructor({
        botId,
        eventBus,
        skyblock,
        config = {},
        dailyRecovery = {},
        logger = null
    }) {
        if (typeof botId !== 'string' || !botId.trim()) {
            throw new TypeError('botId must be a non-empty string');
        }
        if (!eventBus || typeof eventBus.on !== 'function') {
            throw new TypeError('eventBus is required');
        }
        if (!skyblock || typeof skyblock.join !== 'function') {
            throw new TypeError('skyblock service with join() is required');
        }

        this.name = 'SkyblockAutoJoinService';
        this.botId = botId;
        this.eventBus = eventBus;
        this.skyblock = skyblock;
        this.config = this.#normalizeConfig(config);
        this.logger = logger;
        this.dailyRecovery = new DailyRecoverySchedule(dailyRecovery);

        this.initialized = false;
        this.unsubscribers = [];
        this.pending = null;
        this.completedGenerations = new Set();
        this.resourcePackReadyGenerations = new Set();
        this.deferredSchedules = new Map();
    }

    async initialize() {
        if (this.initialized) return;
        this.initialized = true;

        this.logger?.debug?.('Skyblock auto join initialized.', {
            botId: this.botId,
            enabled: this.config.enabled,
            selectionId: this.config.selection,
            delayMs: this.config.delayMs,
            spawnFallbackDelayMs: this.config.spawnFallbackDelayMs,
            maxAttempts: this.config.maxAttempts,
            waitForResourcePack: this.config.waitForResourcePack
        });

        if (!this.config.enabled) return;

        this.unsubscribers.push(
            this.eventBus.on('connection:spawned', event => {
                if (event.botId !== this.botId) return;
                this.#requestSchedule(
                    event.connectionGeneration,
                    this.config.spawnFallbackDelayMs,
                    1,
                    'connection:spawned',
                    { replace: false }
                );
            }),
            this.eventBus.on('server-login:succeeded', event => {
                if (event.botId !== this.botId) return;
                this.#requestSchedule(
                    event.connectionGeneration,
                    this.config.delayMs,
                    1,
                    'server-login:succeeded',
                    { replace: true }
                );
            }),
            this.eventBus.on('server-login:disabled', event => {
                if (event.botId !== this.botId) return;
                this.#requestSchedule(
                    event.connectionGeneration,
                    this.config.delayMs,
                    1,
                    'server-login:disabled',
                    { replace: true }
                );
            }),
            this.eventBus.on('resource-pack:ready', event => {
                if (event.botId !== this.botId) return;
                const generation = event.connectionGeneration;
                this.resourcePackReadyGenerations.add(generation);

                const deferred = this.deferredSchedules.get(generation);
                if (!deferred) return;
                this.deferredSchedules.delete(generation);

                this.logger?.info?.('Skyblock auto join resource-pack gate is ready.', {
                    botId: this.botId,
                    connectionGeneration: generation,
                    trigger: deferred.trigger
                });
                this.#schedule(
                    generation,
                    deferred.delayMs,
                    deferred.attempt,
                    `${deferred.trigger}+resource-pack:ready`,
                    { replace: deferred.replace }
                );
            }),
            this.eventBus.on('server-login:failed', event => {
                if (event.botId !== this.botId) return;
                if (this.pending?.generation !== event.connectionGeneration) return;
                this.logger?.warn?.('Skyblock auto join fallback cancelled because server login failed.', {
                    botId: this.botId,
                    connectionGeneration: event.connectionGeneration
                });
                this.#cancelPending('Server login failed.');
            }),
            this.eventBus.on('connection:ended', event => {
                if (event.botId !== this.botId) return;
                this.#cancelPending('Minecraft connection ended.');
                this.completedGenerations.delete(event.connectionGeneration);
                this.resourcePackReadyGenerations.delete(event.connectionGeneration);
                this.deferredSchedules.delete(event.connectionGeneration);
            })
        );
    }

    async stop() {
        this.#cancelPending('Skyblock auto join stopped.');
        for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
        this.completedGenerations.clear();
        this.resourcePackReadyGenerations.clear();
        this.deferredSchedules.clear();
        this.initialized = false;
    }

    async destroy() {
        await this.stop();
    }

    #requestSchedule(generation, delayMs, attempt, trigger, { replace = false } = {}) {
        const dailyState = this.dailyRecovery.state('sky');
        const effectiveDelayMs = dailyState.active ? Math.max(delayMs, dailyState.waitMs) : delayMs;
        if (dailyState.active) {
            this.logger?.warn?.('Skyblock auto join held for daily 03:00 recovery window.', {
                botId: this.botId,
                connectionGeneration: generation,
                trigger,
                delayMs: effectiveDelayMs,
                dailyWindow: dailyState.start,
                resumeAt: dailyState.resumeAt
            });
        }
        if (!this.config.waitForResourcePack || this.resourcePackReadyGenerations.has(generation)) {
            this.#schedule(generation, effectiveDelayMs, attempt, trigger, { replace });
            return;
        }

        const existing = this.deferredSchedules.get(generation);
        if (existing && !replace) return;

        this.deferredSchedules.set(generation, {
            delayMs: effectiveDelayMs,
            attempt,
            trigger,
            replace
        });

        this.logger?.info?.('Skyblock auto join waiting for server resource pack.', {
            botId: this.botId,
            connectionGeneration: generation,
            selectionId: this.config.selection,
            trigger
        });
        this.eventBus.emit('skyblock:auto-join:waiting-resource-pack', {
            botId: this.botId,
            connectionGeneration: generation,
            selectionId: this.config.selection,
            trigger
        });
    }

    #schedule(generation, delayMs, attempt, trigger, { replace = false } = {}) {
        if (generation === null || generation === undefined) {
            this.logger?.warn?.('Skyblock auto join ignored a trigger without connectionGeneration.', {
                botId: this.botId,
                trigger
            });
            return;
        }
        if (this.completedGenerations.has(generation)) return;

        if (this.pending?.generation === generation) {
            if (!replace) return;
            this.#cancelPending(`Skyblock auto join rescheduled by ${trigger}.`);
        } else if (this.pending) {
            this.#cancelPending('A newer skyblock auto join was scheduled.');
        }

        const cancellationSource = new CancellationSource();
        const pending = {
            generation,
            attempt,
            trigger,
            cancellationSource,
            timer: null
        };
        this.pending = pending;

        this.logger?.debug?.('Skyblock auto join scheduled.', {
            botId: this.botId,
            connectionGeneration: generation,
            selectionId: this.config.selection,
            attempt,
            trigger,
            delayMs
        });

        this.eventBus.emit('skyblock:auto-join:scheduled', {
            botId: this.botId,
            connectionGeneration: generation,
            selectionId: this.config.selection,
            attempt,
            trigger,
            delayMs
        });

        pending.timer = setTimeout(() => {
            pending.timer = null;
            void this.#run(pending);
        }, delayMs);
    }

    async #run(pending) {
        if (this.pending !== pending || pending.cancellationSource.token.isCancelled) return;

        const { generation, attempt, trigger, cancellationSource } = pending;

        this.logger?.info?.('Skyblock auto join attempting /sky.', {
            botId: this.botId,
            connectionGeneration: generation,
            selectionId: this.config.selection,
            attempt,
            trigger
        });

        this.eventBus.emit('skyblock:auto-join:attempting', {
            botId: this.botId,
            connectionGeneration: generation,
            selectionId: this.config.selection,
            attempt,
            trigger
        });

        try {
            const result = await this.skyblock.join(this.config.selection, {
                cancellationToken: cancellationSource.token
            });

            if (this.pending !== pending || cancellationSource.token.isCancelled) return;

            if (result?.success) {
                this.completedGenerations.add(generation);
                this.logger?.info?.('Skyblock auto join succeeded.', {
                    botId: this.botId,
                    connectionGeneration: generation,
                    selectionId: this.config.selection,
                    attempt,
                    trigger
                });
                this.eventBus.emit('skyblock:auto-join:succeeded', {
                    botId: this.botId,
                    connectionGeneration: generation,
                    selectionId: this.config.selection,
                    attempt,
                    trigger,
                    result: result.data || null
                });
                this.#clearPending(pending);
                return;
            }

            const error = result?.error || new Error(result?.message || 'Skyblock auto join failed.');
            await this.#handleFailure(pending, error);
        } catch (error) {
            if (cancellationSource.token.isCancelled) return;
            await this.#handleFailure(pending, error);
        }
    }

    async #handleFailure(pending, error) {
        if (this.pending !== pending) return;

        const { generation, attempt, trigger } = pending;
        this.logger?.warn?.('Skyblock auto join attempt failed.', {
            botId: this.botId,
            connectionGeneration: generation,
            selectionId: this.config.selection,
            attempt,
            trigger,
            error: {
                name: error?.name || 'Error',
                code: error?.code || null,
                message: error?.message || String(error)
            }
        });

        this.eventBus.emit('skyblock:auto-join:failed', {
            botId: this.botId,
            connectionGeneration: generation,
            selectionId: this.config.selection,
            attempt,
            trigger,
            final: attempt >= this.config.maxAttempts,
            error
        });

        if (attempt >= this.config.maxAttempts) {
            this.#clearPending(pending);
            return;
        }

        this.#clearPending(pending);
        this.#requestSchedule(
            generation,
            this.config.retryDelayMs,
            attempt + 1,
            'retry',
            { replace: false }
        );
    }

    #cancelPending(reason) {
        if (!this.pending) return;
        const pending = this.pending;
        this.pending = null;
        if (pending.timer) clearTimeout(pending.timer);
        pending.timer = null;
        pending.cancellationSource.cancel(reason);
        pending.cancellationSource.dispose();
    }

    #clearPending(pending) {
        if (this.pending !== pending) return;
        this.pending = null;
        if (pending.timer) clearTimeout(pending.timer);
        pending.timer = null;
        pending.cancellationSource.dispose();
    }

    #normalizeConfig(config) {
        const raw = typeof config === 'boolean' ? { enabled: config } : (config || {});
        const enabled = raw.enabled === true;
        const selection = raw.selection === null || raw.selection === undefined || raw.selection === ''
            ? null
            : String(raw.selection).trim();
        const delayMs = raw.delayMs ?? 1200;
        const spawnFallbackDelayMs = raw.spawnFallbackDelayMs ?? 5000;
        const maxAttempts = raw.maxAttempts ?? 3;
        const retryDelayMs = raw.retryDelayMs ?? 2000;
        const waitForResourcePack = raw.waitForResourcePack === true;

        for (const [key, value] of Object.entries({ delayMs, spawnFallbackDelayMs, retryDelayMs })) {
            if (!Number.isFinite(value) || value < 0) {
                throw new TypeError(`skyblock.autoJoin.${key} must be a non-negative number`);
            }
        }
        if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
            throw new TypeError('skyblock.autoJoin.maxAttempts must be a positive integer');
        }

        return Object.freeze({
            enabled,
            selection,
            delayMs,
            spawnFallbackDelayMs,
            maxAttempts,
            retryDelayMs,
            waitForResourcePack
        });
    }
}

module.exports = SkyblockAutoJoinService;
