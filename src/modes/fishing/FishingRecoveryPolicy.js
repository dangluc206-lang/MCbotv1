'use strict';

class FishingRecoveryPolicy {
    constructor({ config = {} } = {}) {
        this.reconfigure(config);
    }

    reconfigure(config = {}) {
        const recovery = config.recovery || {};
        this.config = Object.freeze({
            waitMs: this.#nonNegative(recovery.waitMs ?? config.areaRetryMs, 5000),
            retryMs: this.#nonNegative(recovery.retryMs ?? config.errorRetryMs, 3000),
            movementRetryMs: this.#nonNegative(recovery.movementRetryMs ?? config.errorRetryMs, 3000),
            connectionRetryMs: this.#nonNegative(recovery.connectionRetryMs ?? config.connectionPollMs, 1000),
            cycleRetryLimit: this.#positiveInteger(recovery.cycleRetryLimit, 3)
        });
    }

    decide({ classification, error = null, phase = null, breaker = null, enabled = true, paused = false } = {}) {
        if (!enabled || classification?.kind === 'TOKEN_CANCELLED') {
            return this.#decision('STOP', 0, paused ? 'PAUSED' : 'OFF', false, false, 'lifecycle-cancel');
        }
        if (paused) return this.#decision('STOP', 0, 'PAUSED', false, false, 'paused');
        if (classification?.kind === 'EXPECTED_CANCEL') {
            return this.#decision('WAIT', this.config.waitMs, 'WAITING_AREA', false, false, 'expected-cancel');
        }
        if (classification?.kind === 'WAIT') {
            return this.#decision('WAIT', this.config.waitMs, 'WAITING_AREA', false, false, 'expected-wait');
        }
        const code = String(error?.code || '').toUpperCase();
        const diagnostic = typeof error?.toDiagnostic === 'function' ? error.toDiagnostic() : null;
        const retryable = diagnostic?.retryable !== false && error?.retryable !== false;
        if (!retryable) return this.#decision('PAUSE_ERROR', 0, 'PAUSED_ERROR', true, true, code || 'non-retryable');
        if (breaker?.state === 'OPEN') {
            // This policy is invoked after a real failure has already been recorded.
            // Opening the breaker changes the recovery action, but must not suppress
            // the canonical diagnostic for the physical failure that opened it.
            return this.#decision('WAIT', Math.max(0, Number(breaker.retryInMs || breaker.currentBackoffMs || 0)), 'DEGRADED', true, true, 'breaker-open');
        }

        if (code === 'TIMEOUT' && String(error?.subsystem || '').includes('fishing')) {
            return this.#decision('RETRY', this.config.retryMs, 'FISHING', true, true, 'fishing-timeout');
        }
        if (new Set([
            'FISHING_POSITION_LOST', 'FISHING_POSITION_NOT_READY', 'FISHING_HORIZONTAL_DRIFT',
            'FISHING_VERTICAL_DRIFT', 'FISHING_POSITION_UNAVAILABLE', 'FISHING_ANCHOR_UNAVAILABLE',
            'FISHING_DESTINATION_NOT_REACHED', 'FISHING_DESTINATION_VERTICAL_DRIFT',
            'FISHING_MOVEMENT_TIMEOUT', 'FISHING_MOVEMENT_STUCK', 'FISHING_MOVEMENT_DISCONNECTED'
        ]).has(code)) {
            return this.#decision('REANCHOR', this.config.movementRetryMs, 'REANCHORING', true, true, code || 'movement');
        }
        if (new Set(['CONNECTION_FAILED', 'FISHING_STALE_GENERATION', 'FISHING_WORLD_DISCONNECTED']).has(code)) {
            return this.#decision('REJOIN_AREA', this.config.connectionRetryMs, 'WAITING_CONNECTION', true, true, code || 'connection');
        }
        if (code === 'FISHING_PROBE_RECONNECT_REQUIRED') {
            return this.#decision('REQUEST_RECONNECT', this.config.connectionRetryMs, 'WAITING_CONNECTION', true, true, code);
        }
        return this.#decision('RETRY', this.config.retryMs, phase === 'FISHING' ? 'FISHING' : 'WAITING_RETRY', true, true, code || 'retryable');
    }

    #decision(action, delayMs, nextPhase, consumeFailureBudget, publishFailure, reason) {
        return Object.freeze({ action, delayMs, nextPhase, consumeFailureBudget, publishFailure, reason });
    }

    #nonNegative(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? number : fallback;
    }

    #positiveInteger(value, fallback) {
        const number = Number(value);
        return Number.isInteger(number) && number > 0 ? number : fallback;
    }
}

module.exports = FishingRecoveryPolicy;