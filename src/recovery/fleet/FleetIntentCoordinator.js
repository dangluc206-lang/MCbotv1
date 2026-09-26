'use strict';

class FleetIntentCoordinator {
    constructor({ store, botRegistry, requireRuntime, supportsMode, reconcileBot }) {
        Object.assign(this, { store, botRegistry, requireRuntime, supportsMode, reconcileBot });
    }

    async requestConnection(botId, desiredConnection, { source = 'operator' } = {}) {
        const runtime = this.requireRuntime(botId);
        if (!['CONNECTED', 'DISCONNECTED'].includes(desiredConnection)) throw new TypeError('desiredConnection must be CONNECTED or DISCONNECTED');
        const reconnectManager = runtime.getService?.('reconnectManager');
        if (desiredConnection === 'DISCONNECTED') {
            if (typeof reconnectManager?.suspend === 'function') reconnectManager.suspend(`Explicit disconnect requested by ${source}.`);
            else reconnectManager?.cancelPending?.(`Explicit disconnect requested by ${source}.`);
        } else reconnectManager?.resume?.(`Explicit connect requested by ${source}.`);
        // I9: read-modify-write inside the store write queue so interleaved
        // operator requests cannot lose each other's updates.
        const updated = await this.store.updateIntent(botId, current => ({
            desiredConnection,
            desiredMode: desiredConnection === 'DISCONNECTED' ? null : current?.desiredMode || null,
            modeState: desiredConnection === 'DISCONNECTED' ? null : current?.modeState || null,
            source
        }));
        return this.reconcileBot(botId, { reason: `connection-intent:${source}`, priority: 'high', expectedRevision: updated.revision });
    }

    async requestMode(botId, desiredMode, { state = 'ACTIVE', source = 'operator' } = {}) {
        this.requireRuntime(botId);
        if (desiredMode !== null && !this.supportsMode(desiredMode)) throw new TypeError('desiredMode is invalid');
        if (desiredMode !== null && !['ACTIVE', 'PAUSED'].includes(state)) throw new TypeError('mode state is invalid');
        // I9: read-modify-write inside the store write queue so interleaved
        // connection/mode requests cannot lose each other's updates.
        const updated = await this.store.updateIntent(botId, current => ({
            desiredConnection: desiredMode ? 'CONNECTED' : current?.desiredConnection || (this.botRegistry.require(botId).context.has() ? 'CONNECTED' : 'DISCONNECTED'),
            desiredMode,
            modeState: desiredMode ? state : null,
            source
        }));
        return this.reconcileBot(botId, { reason: `mode-intent:${source}`, priority: 'high', expectedRevision: updated.revision });
    }

    async requestModeState(botId, state, { source = 'operator' } = {}) {
        if (!['ACTIVE', 'PAUSED'].includes(state)) throw new TypeError('mode state is invalid');
        // I9: the read of current.desiredMode happens inside the store write
        // queue so a concurrent DISCONNECTED cannot slip between get() and set.
        const updated = await this.store.updateIntent(botId, current => {
            if (!current?.desiredMode) throw new Error(`No durable mode intent exists for ${botId}.`);
            return { desiredConnection: current.desiredConnection, desiredMode: current.desiredMode, modeState: state, source };
        });
        return this.reconcileBot(botId, { reason: `mode-state:${source}`, priority: 'high', expectedRevision: updated.revision });
    }

    async restartMode(botId, desiredMode, { source = 'operator' } = {}) {
        this.requireRuntime(botId);
        if (!this.supportsMode(desiredMode)) throw new TypeError('desiredMode is invalid');
        const intent = await this.store.updateIntent(botId, () => ({ desiredConnection: 'CONNECTED', desiredMode, modeState: 'ACTIVE', source }));
        return this.reconcileBot(botId, {
            reason: `mode-restart:${source}`, priority: 'high', expectedRevision: intent.revision, forceModeRestart: true
        });
    }
}

module.exports = FleetIntentCoordinator;
