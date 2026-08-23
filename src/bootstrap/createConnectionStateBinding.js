'use strict';

const { normalizeConnectionGeneration } = require('../core/events/EventEnvelope');

function createConnectionStateBinding({ botId, state, eventBus, context }) {
    const unsubscribers = [];
    let latestAttemptEpoch = 0;
    const currentGeneration = () => Number(context?.getGeneration?.());
    const positiveInteger = value => {
        const number = Number(value);
        return Number.isInteger(number) && number > 0 ? number : null;
    };
    const isExactCurrent = event => {
        const generation = normalizeConnectionGeneration(event);
        return Number.isInteger(generation)
            && generation > 0
            && context?.has?.()
            && currentGeneration() === generation;
    };
    const isLatestKnownGeneration = event => {
        const generation = normalizeConnectionGeneration(event);
        if (!Number.isInteger(generation) || generation <= 0 || context?.has?.()) return false;
        return currentGeneration() === generation;
    };
    const acceptAttemptStart = event => {
        if (context?.has?.()) return false;
        const attemptEpoch = positiveInteger(event?.attemptEpoch);
        if (attemptEpoch === null || attemptEpoch <= latestAttemptEpoch) return false;
        latestAttemptEpoch = attemptEpoch;
        return true;
    };
    const isCurrentAttempt = event => {
        const attemptEpoch = positiveInteger(event?.attemptEpoch);
        return attemptEpoch !== null
            && attemptEpoch === latestAttemptEpoch
            && !context?.has?.();
    };
    const isActionableReconnectOwner = event => {
        const generation = positiveInteger(event?.sourceGeneration);
        const attemptEpoch = positiveInteger(event?.sourceAttemptEpoch);
        if (generation === null && attemptEpoch === null) return false;
        if (generation !== null && currentGeneration() !== generation) return false;
        if (attemptEpoch !== null) {
            if (context?.has?.() || attemptEpoch !== latestAttemptEpoch) return false;
        }
        return true;
    };
    const on = (eventName, handler, predicate = null) => {
        unsubscribers.push(eventBus.on(eventName, event => {
            if (event?.botId !== botId) return;
            if (predicate && !predicate(event)) return;
            handler(event);
        }));
    };

    return {
        name: 'ConnectionStateBinding',
        async initialize() {
            on('connection:disabled', () => state.patch({ connectionState: 'DISABLED' }));
            on('connection:attempt-started', () => {
                state.patch({ connectionState: 'CONNECTING', lastError: null });
            }, acceptAttemptStart);
            on('connection:attempt-failed', event => state.patch({
                connectionState: 'DISCONNECTED',
                lastError: event.error || event.diagnostic || null
            }), isCurrentAttempt);
            on('connection:connecting', () => state.patch({ connectionState: 'CONNECTING', lastError: null }), isCurrentAttempt);
            on('connection:login', () => state.patch({ connectionState: 'LOGGED_IN', lastError: null }), isExactCurrent);
            on('connection:spawned', event => {
                const attemptEpoch = positiveInteger(event?.attemptEpoch);
                if (attemptEpoch !== null) latestAttemptEpoch = Math.max(latestAttemptEpoch, attemptEpoch);
                state.patch({ connectionState: 'CONNECTED', lastError: null });
            }, isExactCurrent);
            on('server-login:started', () => state.patch({ connectionState: 'AUTHENTICATING', lastError: null }), isExactCurrent);
            on('server-login:succeeded', () => state.patch({ connectionState: 'CONNECTED', lastError: null }), isExactCurrent);
            on('server-login:failed', event => state.patch({ connectionState: 'AUTHENTICATION_FAILED', lastError: event.error || null }), isExactCurrent);
            on('connection:kicked', event => state.patch({ connectionState: 'KICKED', lastError: event.reason || null }), isExactCurrent);
            on('connection:error', event => state.patch({ lastError: event.error || null }), isExactCurrent);
            // failed/ended can arrive after the client is detached. They may only
            // mutate state when their generation is still the exact latest
            // generation ever attached to this bot context and no replacement exists.
            on('connection:failed', event => state.patch({ connectionState: 'DISCONNECTED', lastError: event.error || null }), isLatestKnownGeneration);
            on('connection:ended', event => state.patch({ connectionState: 'DISCONNECTED', lastError: event.reason || null }), isLatestKnownGeneration);
            on('reconnect:scheduled', () => state.patch({ connectionState: 'RECONNECTING' }), isActionableReconnectOwner);
            on('reconnect:attempting', () => state.patch({ connectionState: 'CONNECTING' }), isActionableReconnectOwner);
            on('reconnect:exhausted', event => state.patch({ connectionState: 'FAILED', lastError: event.reason || null }), isActionableReconnectOwner);
        },
        async stop() {
            for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
        },
        async destroy() { await this.stop(); }
    };
}

module.exports = createConnectionStateBinding;
