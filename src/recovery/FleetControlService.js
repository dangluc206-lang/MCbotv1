'use strict';

const Result = require('../shared/result/Result');
const Status = require('../shared/result/Status');
const Operation = require('../operations/Operation');
const { immutableClone } = require('../shared/utils/object');

class FleetControlService {
    constructor({ store, scheduler, botRegistry, modeCatalog = null, logger = null } = {}) {
        if (!store || !scheduler || !botRegistry) throw new TypeError('FleetControlService store, scheduler and botRegistry are required');
        this.name = 'FleetControlService';
        this.store = store;
        this.scheduler = scheduler;
        this.botRegistry = botRegistry;
        this.modeCatalog = modeCatalog;
        this.logger = logger;
        this.profiles = new Map();
        this.runtimeSubscriptions = new Map();
        this.offRegistry = null;
        this.lifecycleState = 'CREATED';
        this.lastOutcomes = new Map();
    }

    setProfiles(profiles) {
        if (!Array.isArray(profiles)) throw new TypeError('profiles must be an array');
        this.profiles = new Map(profiles.map(profile => [profile.id, immutableClone(this.#plainProfile(profile))]));
        return this.profileSnapshot();
    }

    upsertProfile(profile) {
        if (!profile || typeof profile.id !== 'string') throw new TypeError('profile.id is required');
        this.profiles.set(profile.id, immutableClone(this.#plainProfile(profile)));
        return this.profiles.get(profile.id);
    }

    removeProfile(botId) {
        return this.profiles.delete(botId);
    }

    profileSnapshot() {
        return immutableClone(Object.fromEntries([...this.profiles.entries()].sort(([left], [right]) => left.localeCompare(right))));
    }

    async prepareApplicationSession({ source = 'application-startup' } = {}) {
        if (this.lifecycleState === 'DESTROYED') throw new Error('FleetControlService is destroyed.');
        if (this.store.lifecycleState === 'CREATED' || this.store.lifecycleState === 'STOPPED') await this.store.initialize();
        const results = [];
        for (const profile of [...this.profiles.values()].sort((left, right) => left.id.localeCompare(right.id))) {
            const intent = await this.store.setIntent(profile.id, {
                desiredConnection: profile.enabled === false ? 'DISCONNECTED' : 'CONNECTED',
                desiredMode: null,
                modeState: null,
                source
            });
            results.push(intent);
        }
        return immutableClone(results);
    }

    intent(botId) {
        return this.store.get(botId);
    }

    runtimeProfile(profile) {
        if (!profile || typeof profile.id !== 'string') throw new TypeError('profile.id is required');
        const intent = this.store.get(profile.id);
        return Object.freeze({
            ...profile,
            runtimeAutoConnect: Boolean(profile.enabled) && intent?.desiredConnection !== 'DISCONNECTED'
        });
    }

    async initialize() {
        if (this.lifecycleState === 'DESTROYED') throw new Error('FleetControlService is destroyed.');
        await this.store.initialize();
        await this.scheduler.initialize();
        this.lifecycleState = 'INITIALIZED';
    }

    async start() {
        if (['CREATED', 'STOPPED'].includes(this.lifecycleState)) await this.initialize();
        if (this.lifecycleState === 'DESTROYED') throw new Error('FleetControlService is destroyed.');
        await this.store.start();
        await this.scheduler.start();
        for (const runtime of this.botRegistry.list()) this.#attachRuntime(runtime);
        if (!this.offRegistry) {
            this.offRegistry = this.botRegistry.onChange(change => {
                if (change.type === 'registered') {
                    this.#attachRuntime(change.runtime);
                } else if (change.type === 'removed') {
                    this.#detachRuntime(change.botId);
                }
            });
        }
        this.lifecycleState = 'RUNNING';
    }

    async requestConnection(botId, desiredConnection, { source = 'operator' } = {}) {
        const runtime = this.#requireRuntime(botId);
        if (!['CONNECTED', 'DISCONNECTED'].includes(desiredConnection)) throw new TypeError('desiredConnection must be CONNECTED or DISCONNECTED');
        const reconnectManager = runtime.getService?.('reconnectManager');
        if (desiredConnection === 'DISCONNECTED') {
            if (typeof reconnectManager?.suspend === 'function') reconnectManager.suspend(`Explicit disconnect requested by ${source}.`);
            else reconnectManager?.cancelPending?.(`Explicit disconnect requested by ${source}.`);
        } else {
            reconnectManager?.resume?.(`Explicit connect requested by ${source}.`);
        }
        const current = this.store.get(botId);
        const intent = await this.store.setIntent(botId, {
            desiredConnection,
            desiredMode: desiredConnection === 'DISCONNECTED' ? null : current?.desiredMode || null,
            modeState: desiredConnection === 'DISCONNECTED' ? null : current?.modeState || null,
            source
        });
        return this.reconcileBot(botId, { reason: `connection-intent:${source}`, priority: 'high', expectedRevision: intent.revision });
    }

    async requestMode(botId, desiredMode, { state = 'ACTIVE', source = 'operator' } = {}) {
        this.#requireRuntime(botId);
        if (desiredMode !== null && !this.#supportsMode(desiredMode)) throw new TypeError('desiredMode is invalid');
        if (desiredMode !== null && !['ACTIVE', 'PAUSED'].includes(state)) throw new TypeError('mode state is invalid');
        const current = this.store.get(botId);
        const intent = await this.store.setIntent(botId, {
            desiredConnection: desiredMode ? 'CONNECTED' : current?.desiredConnection || (this.botRegistry.require(botId).context.has() ? 'CONNECTED' : 'DISCONNECTED'),
            desiredMode,
            modeState: desiredMode ? state : null,
            source
        });
        return this.reconcileBot(botId, { reason: `mode-intent:${source}`, priority: 'high', expectedRevision: intent.revision });
    }

    async requestModeState(botId, state, { source = 'operator' } = {}) {
        const current = this.store.get(botId);
        if (!current?.desiredMode) throw new Error(`No durable mode intent exists for ${botId}.`);
        return this.requestMode(botId, current.desiredMode, { state, source });
    }

    async restartMode(botId, desiredMode, { source = 'operator' } = {}) {
        this.#requireRuntime(botId);
        if (!this.#supportsMode(desiredMode)) throw new TypeError('desiredMode is invalid');
        const intent = await this.store.setIntent(botId, {
            desiredConnection: 'CONNECTED',
            desiredMode,
            modeState: 'ACTIVE',
            source
        });
        return this.reconcileBot(botId, {
            reason: `mode-restart:${source}`,
            priority: 'high',
            expectedRevision: intent.revision,
            forceModeRestart: true
        });
    }

    async reconcileAll({ reason = 'fleet-reconcile', priority = 'normal' } = {}) {
        const intents = this.store.snapshot().intents;
        const entries = Object.keys(intents).sort();
        const results = await Promise.allSettled(entries.map(botId => this.reconcileBot(botId, { reason, priority })));
        return immutableClone(entries.map((botId, index) => {
            const result = results[index];
            return result.status === 'fulfilled'
                ? { botId, result: result.value }
                : { botId, result: Result.fail(Status.FAILED, result.reason?.message || 'Fleet reconciliation failed.', result.reason) };
        }));
    }

    async reconcileBot(botId, {
        reason = 'reconcile',
        priority = 'normal',
        expectedRevision = null,
        forceModeRestart = false
    } = {}) {
        try {
            let value = null;
            let restartPending = forceModeRestart;
            for (let attempt = 1; attempt <= 8; attempt += 1) {
                value = await this.scheduler.schedule({
                    botId,
                    key: forceModeRestart ? 'durable-intent-mode-restart' : 'durable-intent-reconcile',
                    priority,
                    run: async context => {
                        if (restartPending) {
                            restartPending = false;
                            const runtime = this.#requireRuntime(botId);
                            const profile = this.profiles.get(botId);
                            if (profile && profile.enabled !== false) {
                                context.cancellationToken.throwIfCancelled();
                                await this.#resetRuntime(runtime, 'Durable mode restart requested.', context.cancellationToken);
                            }
                        }
                        return this.#reconcileUntilCurrent(botId, context, reason);
                    }
                });
                if (expectedRevision === null
                    || value.status === 'NO_INTENT'
                    || Number(value.intentRevision || 0) >= Number(expectedRevision)) break;
                if (attempt === 8) {
                    const error = new Error(`Intent revision ${expectedRevision} was not reconciled for ${botId}.`);
                    error.code = 'INTENT_RECONCILE_LIVELOCK';
                    throw error;
                }
            }
            const current = this.store.get(botId);
            if (expectedRevision !== null && current && current.revision < expectedRevision) {
                throw new Error(`Intent revision ${expectedRevision} was not published for ${botId}.`);
            }
            this.lastOutcomes.set(botId, immutableClone(value));
            if (String(value.status).startsWith('BLOCKED')) {
                return Result.fail(Status.NOT_READY, value.message || value.status, null, value);
            }
            return Result.ok(value);
        } catch (error) {
            this.logger?.error?.('Fleet intent reconciliation failed.', { botId, reason, error });
            return Result.fail(Operation.statusForError(error), error.message, error, {
                botId,
                reason
            });
        }
    }

    status() {
        return immutableClone({
            lifecycleState: this.lifecycleState,
            intents: this.store.snapshot(),
            scheduler: this.scheduler.status(),
            lastOutcomes: Object.fromEntries([...this.lastOutcomes.entries()].sort(([left], [right]) => left.localeCompare(right)))
        });
    }

    async stop() {
        if (['STOPPED', 'DESTROYED'].includes(this.lifecycleState)) return;
        this.offRegistry?.();
        this.offRegistry = null;
        for (const botId of [...this.runtimeSubscriptions.keys()]) this.#detachRuntime(botId);
        await this.scheduler.stop('Fleet control stopping.');
        await this.store.stop();
        this.lifecycleState = 'STOPPED';
    }

    async destroy() {
        if (this.lifecycleState === 'DESTROYED') return;
        await this.stop();
        await this.scheduler.destroy();
        await this.store.destroy();
        this.lifecycleState = 'DESTROYED';
    }

    async #reconcileUntilCurrent(botId, taskContext, reason) {
        let outcome = null;
        for (let pass = 1; pass <= 8; pass += 1) {
            taskContext.cancellationToken.throwIfCancelled();
            const intent = this.store.get(botId);
            if (!intent) return { botId, status: 'NO_INTENT', reason, pass };
            outcome = await this.#applyIntent(botId, intent, taskContext, reason);
            const latest = this.store.get(botId);
            if (latest?.revision === intent.revision) {
                return { ...outcome, botId, intentRevision: intent.revision, reason, pass };
            }
        }
        const error = new Error(`Intent for ${botId} changed too often during reconciliation.`);
        error.code = 'INTENT_RECONCILE_LIVELOCK';
        throw error;
    }

    async #applyIntent(botId, intent, taskContext) {
        const runtime = this.#requireRuntime(botId);
        const profile = this.profiles.get(botId);
        if (!profile) return { status: 'BLOCKED_PROFILE_MISSING', message: `Bot profile is missing: ${botId}` };
        if (intent.desiredConnection === 'CONNECTED' && profile.enabled === false) {
            return { status: 'BLOCKED_PROFILE_DISABLED', message: `Bot profile is disabled: ${botId}` };
        }

        taskContext.cancellationToken.throwIfCancelled();
        if (intent.desiredConnection === 'DISCONNECTED') {
            const reconnectManager = runtime.getService?.('reconnectManager');
            if (typeof reconnectManager?.suspend === 'function') reconnectManager.suspend('Durable intent requests disconnect.');
            else reconnectManager?.cancelPending?.('Durable intent requests disconnect.');
            await this.#resetRuntime(runtime, 'Durable intent requests disconnect.', taskContext.cancellationToken);
            taskContext.cancellationToken.throwIfCancelled();
            await runtime.requireService('connectionManager').stop();
            return { status: 'APPLIED_DISCONNECTED', modeStatus: null };
        }

        runtime.getService?.('reconnectManager')?.resume?.('Durable intent requests connection.');
        if (!runtime.context.has()) {
            await runtime.requireService('connectionManager').connect();
        }
        taskContext.cancellationToken.throwIfCancelled();
        if (!runtime.context.has()) return { status: 'WAITING_CONNECTION', modeStatus: null };

        if (!intent.desiredMode) {
            await this.#resetRuntime(runtime, 'Durable intent has no active mode.', taskContext.cancellationToken);
            return { status: 'APPLIED_CONNECTED_IDLE', modeStatus: null };
        }

        const modeRegistry = runtime.getService?.('modeRegistry');
        let target;
        if (modeRegistry) {
            modeRegistry.assertReady(intent.desiredMode);
            target = modeRegistry.require(intent.desiredMode);
            const disabledModes = await modeRegistry.disableAll('Durable intent switched primary mode.', { except: intent.desiredMode });
            for (const entry of disabledModes) {
                if (entry.result?.success === false) {
                    throw entry.result.error || new Error(entry.result.message || `Failed to disable previous mode: ${entry.modeId}.`);
                }
            }
        } else {
            const definitions = this.modeCatalog?.list?.() || [
                { id: 'collector-b5', serviceName: 'collectorB5Mode' },
                { id: 'fishing', serviceName: 'fishingMode' }
            ];
            const definition = definitions.find(item => item.id === intent.desiredMode);
            if (!definition) throw new Error(`Mode definition is missing: ${intent.desiredMode}`);
            target = runtime.requireService(definition.serviceName);
            for (const otherDefinition of definitions) {
                if (otherDefinition.id === intent.desiredMode) continue;
                const other = runtime.getService?.(otherDefinition.serviceName);
                if (!other?.status?.().enabled) continue;
                const disabled = await other.disable('Durable intent switched primary mode.');
                if (disabled?.success === false) throw disabled.error || new Error(disabled.message || `Failed to disable previous mode: ${otherDefinition.id}.`);
            }
        }

        taskContext.cancellationToken.throwIfCancelled();
        if (intent.modeState === 'PAUSED' && !target.status().enabled) {
            return {
                status: 'SAFE_PAUSED_NOT_REPLAYED',
                message: 'Paused mode intent was not re-enabled because recovery never replays startup side effects merely to pause.',
                modeStatus: target.status()
            };
        }
        if (!target.status().enabled) {
            const enabled = await target.enable();
            if (enabled?.success === false) throw enabled.error || new Error(enabled.message || `Failed to enable ${intent.desiredMode}.`);
        }
        taskContext.cancellationToken.throwIfCancelled();
        if (intent.modeState === 'PAUSED' && !target.status().paused) {
            const paused = await target.pause('Restored durable paused intent.');
            if (paused?.success === false) throw paused.error || new Error(paused.message || `Failed to pause ${intent.desiredMode}.`);
        } else if (intent.modeState === 'ACTIVE' && target.status().paused) {
            const resumed = await target.resume();
            if (resumed?.success === false) throw resumed.error || new Error(resumed.message || `Failed to resume ${intent.desiredMode}.`);
        }
        return { status: intent.modeState === 'PAUSED' ? 'APPLIED_MODE_PAUSED' : 'APPLIED_MODE_ACTIVE', modeStatus: target.status() };
    }

    async #disableModes(runtime, reason, cancellationToken = null) {
        cancellationToken?.throwIfCancelled?.();
        const registry = runtime.getService?.('modeRegistry');
        if (registry?.disableAll) {
            const results = await registry.disableAll(reason);
            for (const entry of results) {
                cancellationToken?.throwIfCancelled?.();
                if (entry.result?.success === false) {
                    throw entry.result.error || new Error(entry.result.message || `Failed to disable ${entry.modeId}.`);
                }
            }
            return;
        }
        const definitions = this.modeCatalog?.list?.() || [
            { id: 'collector-b5', serviceName: 'collectorB5Mode' },
            { id: 'fishing', serviceName: 'fishingMode' }
        ];
        for (const definition of definitions) {
            cancellationToken?.throwIfCancelled?.();
            const mode = runtime.getService?.(definition.serviceName);
            if (!mode?.status?.().enabled) continue;
            const result = await mode.disable(reason);
            if (result?.success === false) throw result.error || new Error(result.message || `Failed to disable ${definition.id}.`);
        }
    }

    async #resetRuntime(runtime, reason, cancellationToken = null) {
        await this.#disableModes(runtime, reason, cancellationToken);
        cancellationToken?.throwIfCancelled?.();
        runtime.getService?.('operationManager')?.cancelAll?.(reason);
        cancellationToken?.throwIfCancelled?.();
        await runtime.getService?.('movementManager')?.stop?.();
        cancellationToken?.throwIfCancelled?.();
        await runtime.getService?.('guiManager')?.closeCurrentWindow?.();
    }

    #attachRuntime(runtime) {
        if (!runtime || this.runtimeSubscriptions.has(runtime.botId)) return;
        const eventBus = runtime.getService?.('eventBus');
        if (!eventBus?.on) return;
        const off = eventBus.on('connection:spawned', event => {
            if (event?.botId !== runtime.botId) return;
            const lifecycleState = runtime.getState?.()?.lifecycleState || null;
            if (lifecycleState && lifecycleState !== 'RUNNING') return;
            this.#reconcileInBackground(runtime.botId, 'connection-spawned');
        });
        this.runtimeSubscriptions.set(runtime.botId, off);
    }

    #detachRuntime(botId) {
        this.runtimeSubscriptions.get(botId)?.();
        this.runtimeSubscriptions.delete(botId);
    }

    #reconcileInBackground(botId, reason) {
        if (!this.store.get(botId) || this.lifecycleState !== 'RUNNING') return;
        this.reconcileBot(botId, { reason }).then(result => {
            if (!result.success) this.logger?.warn?.('Background durable-intent reconcile did not complete.', { botId, reason, result });
        }, error => {
            this.logger?.error?.('Background durable-intent reconcile rejected.', { botId, reason, error });
        });
    }


    #supportsMode(modeId) {
        const id = String(modeId || '').trim();
        if (!id) return false;
        if (this.modeCatalog?.has) return this.modeCatalog.has(id);
        return ['collector-b5', 'fishing'].includes(id);
    }

    #requireRuntime(botId) {
        return this.botRegistry.require(botId);
    }

    #plainProfile(profile) {
        const { password, __filePath, ...plain } = profile;
        return plain;
    }
}

module.exports = FleetControlService;
