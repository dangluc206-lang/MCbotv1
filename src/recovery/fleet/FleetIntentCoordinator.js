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
        this.requireRuntime(botId);
        if (desiredMode !== null && !this.supportsMode(desiredMode)) throw new TypeError('desiredMode is invalid');
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
        this.requireRuntime(botId);
        if (!this.supportsMode(desiredMode)) throw new TypeError('desiredMode is invalid');
        const intent = await this.store.setIntent(botId, { desiredConnection: 'CONNECTED', desiredMode, modeState: 'ACTIVE', source });
        return this.reconcileBot(botId, {
            reason: `mode-restart:${source}`, priority: 'high', expectedRevision: intent.revision, forceModeRestart: true
        });
    }
}

module.exports = FleetIntentCoordinator;
