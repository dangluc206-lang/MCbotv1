'use strict';

const TimeoutError = require('../shared/errors/TimeoutError');
const FlowError = require('../shared/errors/FlowError');

class ConnectionManager {
    constructor({
        botId,
        context,
        sessionManager,
        connectionFactory,
        profile,
        server,
        eventBus = null,
        logger = null,
        attemptCoordinator = null,
        readyTimeoutMs = 30000
    }) {
        Object.assign(this, {
            botId,
            context,
            sessionManager,
            connectionFactory,
            profile,
            server,
            eventBus,
            logger,
            attemptCoordinator,
            readyTimeoutMs
        });

        this.connecting = null;
        this.stopping = false;
        this.clientCleanups = new Map();
        this.clientSignals = new WeakMap();
    }

    async initialize() {}

    async start() {
        if (!this.profile.enabled) {
            this.eventBus?.emit('connection:disabled', { botId: this.botId });
            this.logger?.debug?.('Minecraft connection is disabled for bot profile.', {
                botId: this.botId
            });
            return null;
        }

        try {
            return await this.connect();
        } catch (error) {
            // Initial connection failure must not tear down the whole BotRuntime.
            // ReconnectManager receives connection:failed and keeps retrying.
            this.logger?.error?.('Initial Minecraft connection failed.', {
                botId: this.botId,
                error
            });
            return null;
        }
    }

    async connect() {
        if (this.context.has()) return this.context.get();
        if (this.connecting) return this.connecting;

        this.stopping = false;
        this.connecting = this.#connect().finally(() => {
            this.connecting = null;
        });
        return this.connecting;
    }

    async requestReconnect(reason = 'Reconnect requested by runtime capability.', { expectedGeneration = null } = {}) {
        if (this.stopping) return false;
        const currentGeneration = Number(this.context.getGeneration());
        if (expectedGeneration !== null && expectedGeneration !== undefined) {
            const expected = Number(expectedGeneration);
            if (!Number.isFinite(expected) || expected !== currentGeneration) {
                this.logger?.debug?.('Ignoring reconnect request from a stale connection generation.', {
                    botId: this.botId,
                    expectedGeneration,
                    currentGeneration
                });
                return false;
            }
        }
        const client = this.context.get();
        if (!client) {
            this.eventBus?.emit('connection:ended', {
                botId: this.botId,
                connectionGeneration: currentGeneration,
                intentional: false,
                synthetic: true,
                reason: String(reason)
            });
            return false;
        }
        if (typeof client.end !== 'function') {
            this.logger?.debug?.('Reconnect request ignored because current client has no end() capability.', {
                botId: this.botId,
                connectionGeneration: currentGeneration
            });
            return false;
        }
        if (this.context.get() !== client || Number(this.context.getGeneration()) !== currentGeneration) {
            this.logger?.debug?.('Reconnect request became stale before client termination.', {
                botId: this.botId,
                expectedGeneration: expectedGeneration ?? currentGeneration,
                currentGeneration: this.context.getGeneration()
            });
            return false;
        }
        this.logger?.warn?.('Minecraft reconnect requested through ConnectionManager.', {
            botId: this.botId,
            connectionGeneration: currentGeneration,
            reason: String(reason)
        });
        try {
            client.end(String(reason));
            return true;
        } catch (error) {
            this.logger?.warn?.('Minecraft reconnect request could not close the current client.', {
                botId: this.botId,
                connectionGeneration: currentGeneration,
                error
            });
            return false;
        }
    }

    async #connect() {
        let attemptLease = null;
        if (this.attemptCoordinator?.acquireTurn) {
            attemptLease = await this.attemptCoordinator.acquireTurn({
                botId: this.botId,
                host: this.server.host,
                port: this.server.port
            });
        } else if (this.attemptCoordinator?.waitTurn) {
            await this.attemptCoordinator.waitTurn({
                botId: this.botId,
                host: this.server.host,
                port: this.server.port
            });
        }

        this.logger?.info?.('Connecting Minecraft bot.', {
            botId: this.botId,
            host: this.server.host,
            port: this.server.port,
            username: this.profile.username,
            auth: this.profile.auth ?? this.server.auth ?? 'offline',
            version: this.profile.version !== undefined
                ? this.profile.version
                : (this.server.version ?? false)
        });
        this.eventBus?.emit('connection:connecting', { botId: this.botId });

        let client;
        let generation;
        let stage = 'create-client';

        try {
            client = this.connectionFactory.create(this.profile, this.server);
            stage = 'register-pathfinder';
            this.#registerPathfinder(client);
            stage = 'attach-client';
            generation = this.context.attach(client);
            this.sessionManager.open(client, generation);
            this.#bindClientEvents(client, generation);
            this.eventBus?.emit('connection:client-attached', {
                botId: this.botId,
                connectionGeneration: generation
            });

            stage = 'wait-for-spawn';
            await this.#waitForSpawn(client, generation);
            stage = 'verify-pathfinder';
            this.#assertPathfinderReady(client);

            stage = 'verify-current-session';
            if (!this.sessionManager.isCurrent(client, generation)) {
                throw new Error(`Connection ${generation} is no longer current for ${this.botId}`);
            }

            this.logger?.info?.('Minecraft bot spawned.', {
                botId: this.botId,
                connectionGeneration: generation
            });
            this.eventBus?.emit('connection:spawned', {
                botId: this.botId,
                connectionGeneration: generation
            });
            attemptLease?.release?.({ outcome: 'success' });

            return client;
        } catch (error) {
            const signals = client ? (this.clientSignals.get(client) || {}) : {};
            const failureClass = this.#classifyConnectionFailure(error, signals);
            attemptLease?.release?.({ outcome: 'failure', failureClass });

            if (client) {
                this.#cleanupClient(client);
                this.context.detach(client);
                this.sessionManager.close(client);
            }

            const wrapped = FlowError.wrap(error, {
                // Preserve stable lower-level error codes (notably TIMEOUT) so
                // callers can classify failures without parsing messages. The flow
                // step/action below provides the more specific connection context.
                code: error?.code || 'CONNECTION_FAILED',
                subsystem: 'connection', operation: 'ConnectionManager', step: stage,
                action: 'connect Minecraft bot', resource: this.server.host,
                details: {
                    botId: this.botId,
                    connectionGeneration: generation ?? null,
                    host: this.server.host,
                    port: this.server.port,
                    username: this.profile.username,
                    version: this.profile.version !== undefined ? this.profile.version : (this.server.version ?? false),
                    readyTimeoutMs: this.readyTimeoutMs,
                    failureType: error?.code === 'TIMEOUT' ? 'CONNECTION_SPAWN_TIMEOUT' : 'CONNECTION_FAILED',
                    failureClass,
                    kickReason: signals.kickReason || null,
                    socketErrorCode: signals.errorCode || error?.code || null,
                    socketErrorMessage: signals.errorMessage || null,
                    endReason: signals.endReason || null
                }
            });

            this.logger?.error?.('Minecraft bot failed to connect.', {
                botId: this.botId,
                connectionGeneration: generation,
                code: wrapped.code,
                step: wrapped.step,
                action: wrapped.action,
                error: wrapped
            });
            this.eventBus?.emit('connection:failed', {
                botId: this.botId,
                connectionGeneration: generation,
                error: wrapped,
                diagnostic: wrapped.toDiagnostic()
            });

            try {
                client?.end?.('connection failed');
            } catch (endError) {
                this.logger?.debug?.('Failed to close rejected Minecraft client.', {
                    botId: this.botId,
                    error: endError
                });
            }

            throw wrapped;
        }
    }

    #registerPathfinder(client) {
        if (client?.pathfinder?.goto) return;

        // Mineflayer loadPlugin() queues plugins until its internal `inject_allowed`
        // event. Do not verify bot.pathfinder immediately after loadPlugin().
        if (typeof client?.loadPlugin !== 'function') return;

        let plugin;
        try {
            ({ pathfinder: plugin } = require('mineflayer-pathfinder'));
        } catch (error) {
            throw new FlowError('mineflayer-pathfinder is not installed.', { code: 'PATHFINDER_NOT_INSTALLED', subsystem: 'connection', operation: 'ConnectionManager', step: 'register-pathfinder', action: 'require mineflayer-pathfinder', resource: 'mineflayer-pathfinder', retryable: false, cause: error });
        }

        if (typeof plugin !== 'function') {
            throw new FlowError('mineflayer-pathfinder did not export a valid pathfinder plugin.', { code: 'PATHFINDER_INVALID_PLUGIN', subsystem: 'connection', operation: 'ConnectionManager', step: 'register-pathfinder', action: 'validate plugin export', resource: 'mineflayer-pathfinder', retryable: false });
        }

        if (typeof client.hasPlugin !== 'function' || !client.hasPlugin(plugin)) {
            client.loadPlugin(plugin);
        }

        this.logger?.debug?.('mineflayer-pathfinder registered for injection.', {
            botId: this.botId
        });
    }

    #assertPathfinderReady(client) {
        // Test doubles and alternate clients may not support Mineflayer plugins.
        if (typeof client?.loadPlugin !== 'function') return;

        if (!client?.pathfinder?.goto) {
            throw new FlowError('mineflayer-pathfinder was not ready after Minecraft spawn.', { code: 'PATHFINDER_NOT_READY_AFTER_SPAWN', subsystem: 'connection', operation: 'ConnectionManager', step: 'verify-pathfinder', action: 'check bot.pathfinder.goto', resource: 'mineflayer-pathfinder', retryable: true });
        }

        this.logger?.debug?.('mineflayer-pathfinder ready.', { botId: this.botId });
    }

    async #waitForSpawn(client, generation) {
        return new Promise((resolve, reject) => {
            let settled = false;

            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                client.off?.('spawn', onSpawn);
                client.off?.('error', onError);
                client.off?.('end', onEnd);
                callback(value);
            };

            const onSpawn = () => finish(resolve, client);
            const onError = error => finish(reject, error);
            const onEnd = reason => finish(
                reject,
                new Error(`Connection ended before spawn: ${reason || 'unknown'}`)
            );
            const timer = setTimeout(() => finish(
                reject,
                new TimeoutError(`Bot ${this.botId} did not spawn in time.`, {
                    details: {
                        botId: this.botId,
                        connectionGeneration: generation,
                        readyTimeoutMs: this.readyTimeoutMs
                    }
                })
            ), this.readyTimeoutMs);

            client.once?.('spawn', onSpawn);
            client.once?.('error', onError);
            client.once?.('end', onEnd);
        });
    }

    #bindClientEvents(client, generation) {
        let cleaned = false;
        const signals = { kickReason: null, errorCode: null, errorMessage: null, endReason: null };
        this.clientSignals.set(client, signals);

        const isCurrent = () => this.sessionManager.isCurrent(client, generation);

        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            client.off?.('login', onLogin);
            client.off?.('kicked', onKicked);
            client.off?.('error', onError);
            client.off?.('end', onEnd);
            this.clientCleanups.delete(client);
        };

        const onLogin = () => {
            if (!isCurrent()) return;
            this.logger?.info?.('Minecraft login completed.', {
                botId: this.botId,
                connectionGeneration: generation
            });
            this.eventBus?.emit('connection:login', {
                botId: this.botId,
                connectionGeneration: generation
            });
        };

        const onKicked = reason => {
            if (!isCurrent()) return;
            signals.kickReason = this.#stringifyReason(reason);
            this.logger?.warn?.('Minecraft bot was kicked.', {
                botId: this.botId,
                connectionGeneration: generation,
                reason: signals.kickReason
            });
            this.eventBus?.emit('connection:kicked', {
                botId: this.botId,
                connectionGeneration: generation,
                reason
            });
        };

        const onError = error => {
            if (!isCurrent()) return;
            signals.errorCode = error?.code || null;
            signals.errorMessage = error?.message || String(error || '');
            this.logger?.error?.('Minecraft connection error.', {
                botId: this.botId,
                connectionGeneration: generation,
                error
            });
            this.eventBus?.emit('connection:error', {
                botId: this.botId,
                connectionGeneration: generation,
                error
            });
        };

        const onEnd = reason => {
            const current = isCurrent();
            signals.endReason = reason == null ? null : String(reason);
            cleanup();
            if (!current) return;

            this.context.detach(client);
            this.sessionManager.close(client);

            this.logger?.warn?.('Minecraft connection ended.', {
                botId: this.botId,
                connectionGeneration: generation,
                reason,
                intentional: this.stopping
            });
            this.eventBus?.emit('connection:ended', {
                botId: this.botId,
                connectionGeneration: generation,
                reason,
                intentional: this.stopping
            });
        };

        client.on?.('login', onLogin);
        client.on?.('kicked', onKicked);
        client.on?.('error', onError);
        client.on?.('end', onEnd);
        this.clientCleanups.set(client, cleanup);
    }


    #classifyConnectionFailure(error, signals = {}) {
        const text = [
            error?.code,
            error?.message,
            signals.kickReason,
            signals.errorCode,
            signals.errorMessage,
            signals.endReason
        ].filter(Boolean).join(' ').toLowerCase();

        if (text.includes('đăng nhập quá nhanh') || text.includes('dang nhap qua nhanh')
            || text.includes('login too fast') || text.includes('too quickly')) {
            return 'login-too-fast';
        }
        if (text.includes('econnreset') || text.includes('connection reset')) {
            return 'connection-reset';
        }
        if (text.includes('lost connection')) return 'lost-connection';
        if (text.includes('socketclosed') || text.includes('ended before spawn')) return 'pre-spawn-disconnect';
        return 'transient';
    }

    #cleanupClient(client) {
        this.clientCleanups.get(client)?.();
    }

    #stringifyReason(reason) {
        if (typeof reason === 'string') return reason;
        try {
            return JSON.stringify(reason);
        } catch (error) {
            this.logger?.debug?.('Could not JSON-serialize Minecraft kick reason; using String fallback.', {
                botId: this.botId,
                error
            });
            return String(reason);
        }
    }

    async stop() {
        this.stopping = true;
        const client = this.context.get();

        if (client) {
            try {
                client.end?.('runtime stopping');
            } finally {
                this.#cleanupClient(client);
                this.context.detach(client);
                this.sessionManager.close(client);
            }
        }

        if (this.connecting) {
            await Promise.allSettled([this.connecting]);
        }
    }

    async destroy() {
        await this.stop();
        for (const cleanup of this.clientCleanups.values()) cleanup();
        this.clientCleanups.clear();
    }
}

module.exports = ConnectionManager;
