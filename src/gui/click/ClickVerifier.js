'use strict';

const TimeoutError = require('../../shared/errors/TimeoutError');
const OperationCancelledError = require('../../shared/errors/OperationCancelledError');
const FlowError = require('../../shared/errors/FlowError');
const { normalizeConnectionGeneration } = require('../../core/events/EventEnvelope');

class ClickVerifier {
    constructor({ eventBus, context = null }) { this.eventBus = eventBus; this.context = context; }

    verify(options) { return this.arm(options).promise; }

    arm({ botId, session, timeoutMs = 3000, acceptWindowChange = true, cancellationToken = null, expectedGeneration = session?.connectionGeneration }) {
        if (!this.eventBus) return Object.freeze({ promise: Promise.resolve(true), cancel: () => false });
        const expected = Number(expectedGeneration);
        let cancelExternal = null;
        const promise = new Promise((resolve, reject) => {
            let done = false;
            let cancelUnsubscribe = () => {};
            const subscriptions = [];
            const cleanup = () => {
                clearTimeout(timer);
                for (const off of subscriptions.splice(0)) off();
                cancelUnsubscribe();
                cancelUnsubscribe = () => {};
            };
            const finish = (fn, value) => { if (done) return; done = true; cleanup(); fn(value); };
            cancelExternal = reason => {
                if (done) return false;
                const error = reason instanceof Error ? reason : new OperationCancelledError(String(reason || 'Click verification cancelled.'));
                finish(reject, error);
                return true;
            };
            const matchesConnection = event => event.botId === botId
                && normalizeConnectionGeneration(event) === expected
                && this.#isConnectionCurrent(expected, session);
            const matchesSession = event => matchesConnection(event) && session?.active === true;
            subscriptions.push(this.eventBus.on('gui:updated', event => {
                if (matchesSession(event) && event.sessionId === session.id) finish(resolve, true);
            }));
            if (acceptWindowChange) {
                // A real open/close invalidates the clicked session before the
                // manager emits its transition event. Verify the captured
                // connection/generation here, not the old session's active
                // flag, or legitimate window changes are discarded.
                subscriptions.push(this.eventBus.on('gui:opened', event => { if (matchesConnection(event)) finish(resolve, true); }));
                subscriptions.push(this.eventBus.on('gui:closed', event => { if (matchesConnection(event) && event.sessionId === session.id) finish(resolve, true); }));
            }
            subscriptions.push(this.eventBus.on('connection:ended', event => {
                if (event.botId !== botId || normalizeConnectionGeneration(event) !== expected) return;
                finish(reject, new FlowError('Connection ended during click verification.', { code: 'GUI_CLICK_DISCONNECTED', subsystem: 'gui', operation: 'ClickVerifier', retryable: true }));
            }));
            const timer = setTimeout(() => finish(reject, new TimeoutError('Click verification timed out.')), timeoutMs);
            if (cancellationToken) cancelUnsubscribe = cancellationToken.onCancelled(reason => finish(reject, new OperationCancelledError(String(reason || 'Operation cancelled.'))));
        });
        return Object.freeze({ promise, cancel: reason => cancelExternal?.(reason) || false });
    }

    #isConnectionCurrent(expectedGeneration, session) {
        if (!session || Number(session.connectionGeneration) !== Number(expectedGeneration)) return false;
        if (!this.context) return true;
        const currentClient = this.context.get?.() || null;
        const capturedClient = session.client || currentClient;
        return currentClient === capturedClient
            && Number(this.context.getGeneration?.()) === Number(expectedGeneration);
    }
}

module.exports = ClickVerifier;