'use strict';

const CancellationSource = require('../../shared/cancellation/CancellationSource');
const Timeout = require('../../shared/time/Timeout');
const { normalizeConnectionGeneration } = require('../../core/events/EventEnvelope');

class ServerLoginService {
    constructor({
        botId,
        context,
        eventBus,
        commandService,
        password,
        config = {},
        logger = null
    }) {
        if (typeof botId !== 'string' || !botId.trim()) {
            throw new TypeError('botId must be a non-empty string');
        }
        if (!context) throw new TypeError('context is required');
        if (!eventBus) throw new TypeError('eventBus is required');
        if (!commandService || typeof commandService.send !== 'function') {
            throw new TypeError('commandService.send is required');
        }

        const enabled = config.enabled !== false;
        const commandKey = config.commandKey || 'login';
        const delayMs = config.delayMs ?? 0;
        const timeoutMs = config.timeoutMs ?? 5000;
        const confirm = config.confirm === true;

        if (typeof commandKey !== 'string' || !commandKey.trim()) {
            throw new TypeError('server login commandKey must be a non-empty string');
        }
        if (!Number.isFinite(delayMs) || delayMs < 0) {
            throw new TypeError('server login delayMs must be a non-negative number');
        }
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
            throw new TypeError('server login timeoutMs must be a positive number');
        }

        this.name = 'ServerLoginService';
        this.botId = botId;
        this.context = context;
        this.eventBus = eventBus;
        this.commandService = commandService;
        this.password = typeof password === 'string' && password.length > 0
            ? password
            : null;
        this.enabled = enabled;
        this.commandKey = commandKey.trim();
        this.delayMs = delayMs;
        this.timeoutMs = timeoutMs;
        this.confirm = confirm;
        this.logger = logger;

        this.initialized = false;
        this.unsubscribeSpawn = null;
        this.unsubscribeEnd = null;
        this.pending = null;
        this.completedGenerations = new Set();
    }

    async initialize() {
        if (this.initialized) return;
        this.initialized = true;

        this.unsubscribeSpawn = this.eventBus.on('connection:spawned', event => {
            if (event.botId !== this.botId) return;
            const generation = normalizeConnectionGeneration(event);
            if (!this.#isCurrentGeneration(generation)) return;
            void this.#handleSpawn(event);
        });

        this.unsubscribeEnd = this.eventBus.on('connection:ended', event => {
            if (event.botId !== this.botId) return;
            const generation = normalizeConnectionGeneration(event);
            if (!Number.isInteger(generation) || generation <= 0) return;
            if (this.pending?.generation !== generation && this.#isCurrentGeneration(this.pending?.generation)) return;
            this.#cancelPending('Minecraft connection ended.');
            this.completedGenerations.delete(generation);
        });
    }

    async stop() {
        this.#cancelPending('Server login service stopped.');
        this.unsubscribeSpawn?.();
        this.unsubscribeEnd?.();
        this.unsubscribeSpawn = null;
        this.unsubscribeEnd = null;
        this.completedGenerations.clear();
        this.initialized = false;
    }

    async destroy() {
        await this.stop();
    }

    async #handleSpawn(event) {
        const generation = normalizeConnectionGeneration(event);
        if (!this.#isCurrentGeneration(generation)) return;

        if (!this.enabled) {
            this.eventBus.emit('server-login:disabled', {
                botId: this.botId,
                connectionGeneration: generation
            });
            return;
        }

        if (this.completedGenerations.has(generation)) return;
        if (this.pending?.generation === generation) return;

        this.#cancelPending('A newer server login attempt started.');

        const cancellationSource = new CancellationSource();
        this.pending = { generation, cancellationSource };

        this.eventBus.emit('server-login:started', {
            botId: this.botId,
            connectionGeneration: generation
        });

        try {
            if (!this.password) {
                throw new Error(
                    `Missing login password for ${this.botId}. `
                    + `Set MCBOT_${this.botId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_PASSWORD.`
                );
            }

            if (this.delayMs > 0) {
                await Timeout.delay(this.delayMs, {
                    cancellationToken: cancellationSource.token
                });
            }

            if (!this.#isCurrentGeneration(generation)) return;

            const result = await this.commandService.send(this.commandKey, {
                args: { password: this.password },
                confirm: this.confirm,
                timeoutMs: this.timeoutMs,
                cancellationToken: cancellationSource.token,
                expectedGeneration: generation,
                sensitive: true
            });

            if (!result.success) {
                throw result.error || new Error(result.message || 'Server login command failed.');
            }

            if (!this.#isCurrentGeneration(generation)) return;

            this.completedGenerations.add(generation);
            this.logger?.info?.('Server login command sent.', {
                botId: this.botId,
                connectionGeneration: generation,
                confirmed: Boolean(result.data?.confirmed)
            });
            this.eventBus.emit('server-login:succeeded', {
                botId: this.botId,
                connectionGeneration: generation,
                confirmed: Boolean(result.data?.confirmed)
            });
        } catch (error) {
            if (cancellationSource.token.isCancelled) return;
            if (this.pending?.generation !== generation || !this.#isCurrentGeneration(generation)) return;

            this.logger?.error?.('Server login failed.', {
                botId: this.botId,
                connectionGeneration: generation,
                error
            });
            this.eventBus.emit('server-login:failed', {
                botId: this.botId,
                connectionGeneration: generation,
                error
            });
        } finally {
            if (this.pending?.generation === generation) {
                cancellationSource.dispose();
                this.pending = null;
            }
        }
    }

    #isCurrentGeneration(generation) {
        return this.context.has() && this.context.getGeneration() === generation;
    }

    #cancelPending(reason) {
        if (!this.pending) return;
        this.pending.cancellationSource.cancel(reason);
        this.pending.cancellationSource.dispose();
        this.pending = null;
    }
}

module.exports = ServerLoginService;
