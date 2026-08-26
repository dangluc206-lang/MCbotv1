'use strict';

const Result = require('../shared/result/Result');
const Status = require('../shared/result/Status');
const { immutableClone } = require('../shared/utils/object');
const FleetIntentCoordinator = require('./fleet/FleetIntentCoordinator');
const FleetReconciler = require('./fleet/FleetReconciler');
const FleetEmergencyTransactionManager = require('./fleet/FleetEmergencyTransactionManager');

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
        this.reconciler = new FleetReconciler({
            store, scheduler, modeCatalog, logger,
            requireRuntime: botId => this.#requireRuntime(botId),
            profileFor: botId => this.profiles.get(botId)
        });
        this.intentCoordinator = new FleetIntentCoordinator({
            store, botRegistry,
            requireRuntime: botId => this.#requireRuntime(botId),
            supportsMode: modeId => this.#supportsMode(modeId),
            reconcileBot: (botId, options) => this.reconcileBot(botId, options)
        });
        this.emergencyManager = new FleetEmergencyTransactionManager({
            store,
            profileIds: () => [...this.profiles.keys()],
            requireRuntime: botId => this.#requireRuntime(botId),
            reconcileBot: (botId, options) => this.reconcileBot(botId, options),
            resetRuntime: (runtime, reason) => this.reconciler.resetRuntime(runtime, reason)
        });
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
        return this.intentCoordinator.requestConnection(botId, desiredConnection, { source });
    }

    async requestMode(botId, desiredMode, { state = 'ACTIVE', source = 'operator' } = {}) {
        return this.intentCoordinator.requestMode(botId, desiredMode, { state, source });
    }

    async requestModeState(botId, state, { source = 'operator' } = {}) {
        return this.intentCoordinator.requestModeState(botId, state, { source });
    }

    async restartMode(botId, desiredMode, { source = 'operator' } = {}) {
        return this.intentCoordinator.restartMode(botId, desiredMode, { source });
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

    emergencyStop(botIds = null, options = {}) {
        return this.emergencyManager.stop(botIds, options);
    }

    reconcileBot(botId, options = {}) {
        return this.reconciler.reconcileBot(botId, options);
    }

    status() {
        return immutableClone({
            lifecycleState: this.lifecycleState,
            intents: this.store.snapshot(),
            scheduler: this.scheduler.status(),
            lastOutcomes: this.reconciler.outcomes()
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
        this.emergencyManager.clear();
        this.lifecycleState = 'DESTROYED';
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
