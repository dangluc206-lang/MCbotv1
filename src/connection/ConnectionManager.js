'use strict';

const TimeoutError = require('../shared/errors/TimeoutError');
const FlowError = require('../shared/errors/FlowError');
const ConnectionFailureSignalContract = require('./ConnectionFailureSignalContract');
const ConnectionSuccessResultContract = require('./ConnectionSuccessResultContract');

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
        readyTimeoutMs = 30000,
        autoConnect = profile?.enabled
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
            readyTimeoutMs,
            autoConnect: Boolean(autoConnect)
        });

        this.connecting = null;
        this.stopping = false;
        this.clientCleanups = new Map();
        this.clientSignals = new WeakMap();
        this.connectionSuccesses = new WeakMap();
        this.attemptEpoch = 0;
        this.currentAttempt = null;
    }

    async initialize() {}

    async start() {
        if (!this.autoConnect) {
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

    async connectWithResult() {
        const joinedExisting = this.context.has();
        const joinedInFlight = Boolean(this.connecting);
        const attemptEpochBefore = this.attemptEpoch;
        const client = joinedInFlight ? await this.connecting : await this.connect();
        const success = client && (typeof client === 'object' || typeof client === 'function')
            ? this.connectionSuccesses.get(client)
            : null;
        const startedByInvocation = !joinedExisting
            && !joinedInFlight
            && success?.attemptEpoch > attemptEpochBefore;

        return ConnectionSuccessResultContract.create({
            client,
            connectionGeneration: success?.connectionGeneration
                ?? (client === this.context.get() ? this.context.getGeneration() : null),
            attemptId: success?.attemptId ?? null,
            attemptEpoch: success?.attemptEpoch ?? null,
            startedByInvocation,
            joinedExisting,
            joinedInFlight
        });
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
            }, { scope: 'bot' });
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
        const attemptEpoch = ++this.attemptEpoch;
        const attemptId = `${this.botId}:connection-attempt:${attemptEpoch}`;
        const attempt = Object.freeze({ attemptId, attemptEpoch });
        this.currentAttempt = attempt;
        let attemptLease = null;
        let leaseReleased = false;
        let client = null;
        let generation = null;
        let stage = 'acquire-turn';

        const releaseLease = outcome => {
            if (!attemptLease?.release || leaseReleased) return;
            leaseReleased = true;
            attemptLease.release(outcome);
        };

        this.eventBus?.emit('connection:attempt-started', {
            botId: this.botId,
            attemptId,
            attemptEpoch,
            host: this.server.host ?? null,
            port: this.server.port ?? null
        });

        try {
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
                attemptId,
                attemptEpoch,
                host: this.server.host,
                port: this.server.port,
                username: this.profile.username,
                auth: this.profile.auth ?? this.server.auth ?? 'offline',
                version: this.profile.version !== undefined
                    ? this.profile.version
                    : (this.server.version ?? false)
            });
            this.eventBus?.emit('connection:connecting', { botId: this.botId, attemptId, attemptEpoch });

            stage = 'create-client';
            client = this.connectionFactory.create(this.profile, this.server);
            stage = 'register-pathfinder';
            this.#registerPathfinder(client);
            stage = 'attach-client';
            generation = this.context.attach(client);
            this.sessionManager.open(client, generation);
            this.#bindClientEvents(client, generation);
            this.eventBus?.emit('connection:client-attached', {
                botId: this.botId,
                connectionGeneration: generation,
                attemptId,
                attemptEpoch
            });

            stage = 'wait-for-spawn';
            await this.#waitForSpawn(client, generation);
            stage = 'verify-pathfinder';
            this.#assertPathfinderReady(client);

            stage = 'verify-current-session';
            if (!this.sessionManager.isCurrent(client, generation)) {
                throw new Error(`Connection ${generation} is no longer current for ${this.botId}`);
            }

            this.connectionSuccesses.set(client, Object.freeze({
                connectionGeneration: generation,
                attemptId,
                attemptEpoch
            }));
            this.logger?.info?.('Minecraft bot spawned.', {
                botId: this.botId,
                connectionGeneration: generation,
                attemptId,
                attemptEpoch
            });
            this.eventBus?.emit('connection:spawned', {
                botId: this.botId,
                connectionGeneration: generation,
                attemptId,
                attemptEpoch
            });
            releaseLease({ outcome: 'success' });
            return client;
        } catch (error) {
            const signals = client ? (this.clientSignals.get(client) || {}) : {};
            const failureClass = this.#classifyConnectionFailure(error, signals);
            releaseLease({ outcome: 'failure', failureClass });

            const attachedGeneration = Number.isInteger(generation) && generation > 0 ? generation : null;
            if (client && attachedGeneration !== null) {
                this.#cleanupClient(client);
                this.context.detach(client);
                this.sessionManager.close(client);
            }

            const wrapped = FlowError.wrap(error, {
                code: error?.code || (attachedGeneration === null ? 'CONNECTION_ATTEMPT_FAILED' : 'CONNECTION_FAILED'),
                subsystem: 'connection', operation: 'ConnectionManager', step: stage,
                action: 'connect Minecraft bot', resource: this.server.host,
                details: {
                    botId: this.botId,
                    attemptId,
                    attemptEpoch,
                    connectionGeneration: attachedGeneration,
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
                    endReason: signals.endReason || null,
                    failureSignal: {
                        contract: ConnectionFailureSignalContract.contract,
                        eventType: attachedGeneration === null ? 'connection:attempt-failed' : 'connection:failed',
                        ownerScope: attachedGeneration === null ? 'attempt' : 'generation',
                        attemptEpoch,
                        connectionGeneration: attachedGeneration
                    }
                }
            });

            this.logger?.error?.('Minecraft bot failed to connect.', {
                botId: this.botId,
                attemptId,
                attemptEpoch,
                connectionGeneration: attachedGeneration,
                code: wrapped.code,
                step: wrapped.step,
                action: wrapped.action,
                error: wrapped
            });

            if (attachedGeneration === null) {
                // Pre-attach failures are owned by the immutable attempt identity,
                // not by a fabricated connection generation.
                this.eventBus?.emit('connection:attempt-failed', {
                    botId: this.botId,
                    attemptId,
                    attemptEpoch,
                    stage,
                    retryable: wrapped.retryable !== false,
                    failureClass,
                    error: wrapped,
                    diagnostic: wrapped.toDiagnostic()
                });
            } else {
                this.eventBus?.emit('connection:failed', {
                    botId: this.botId,
                    connectionGeneration: attachedGeneration,
                    attemptId,
                    attemptEpoch,
                    retryable: wrapped.retryable !== false,
                    failureClass,
                    error: wrapped,
                    diagnostic: wrapped.toDiagnostic()
                });
            }

            try {
                client?.end?.('connection failed');
            } catch (endError) {
                this.logger?.debug?.('Failed to close rejected Minecraft client.', {
                    botId: this.botId,
                    attemptId,
                    error: endError
                });
            }
            throw wrapped;
        } finally {
            if (this.currentAttempt?.attemptId === attemptId) this.currentAttempt = null;
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

        // stop() may race with a connect attempt that had not attached its
        // client yet. Re-check after the in-flight promise settles so an
        // operator disconnect can never leave a late client online.
        const lateClient = this.context.get();
        if (lateClient) {
            try {
                lateClient.end?.('runtime stopping');
            } finally {
                this.#cleanupClient(lateClient);
                this.context.detach(lateClient);
                this.sessionManager.close(lateClient);
            }
        }
    }

    async destroy() {
        await this.stop();
        for (const cleanup of this.clientCleanups.values()) cleanup();
        this.clientCleanups.clear();
    }
}

module.exports = ConnectionManager;
