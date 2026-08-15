'use strict';

const STATES = Object.freeze({ CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' });

class FailureCircuitBreaker {
    constructor({ policy, clock = () => Date.now(), random = Math.random } = {}) {
        if (!policy || typeof policy !== 'object') throw new TypeError('FailureCircuitBreaker policy is required.');
        for (const key of ['baseBackoffMs', 'maxBackoffMs', 'multiplier', 'jitterRatio', 'maxConsecutiveFailures', 'openDurationMs']) {
            if (!Number.isFinite(Number(policy[key]))) throw new TypeError(`FailureCircuitBreaker policy.${key} is required.`);
        }
        if (Number(policy.baseBackoffMs) < 0 || Number(policy.maxBackoffMs) < 0 || Number(policy.openDurationMs) < 0) {
            throw new RangeError('FailureCircuitBreaker backoff/open durations must be non-negative.');
        }
        if (Number(policy.maxBackoffMs) < Number(policy.baseBackoffMs)) throw new RangeError('FailureCircuitBreaker maxBackoffMs must be >= baseBackoffMs.');
        if (Number(policy.multiplier) < 1) throw new RangeError('FailureCircuitBreaker multiplier must be >= 1.');
        if (Number(policy.jitterRatio) < 0 || Number(policy.jitterRatio) > 1) throw new RangeError('FailureCircuitBreaker jitterRatio must be between 0 and 1.');
        if (!Number.isInteger(Number(policy.maxConsecutiveFailures)) || Number(policy.maxConsecutiveFailures) < 1) {
            throw new RangeError('FailureCircuitBreaker maxConsecutiveFailures must be a positive integer.');
        }
        this.policy = Object.freeze({
            baseBackoffMs: Number(policy.baseBackoffMs),
            maxBackoffMs: Number(policy.maxBackoffMs),
            multiplier: Number(policy.multiplier),
            jitterRatio: Number(policy.jitterRatio),
            maxConsecutiveFailures: Number(policy.maxConsecutiveFailures),
            openDurationMs: Number(policy.openDurationMs)
        });
        this.clock = clock;
        this.random = random;
        this.reset();
    }

    reset() {
        this.consecutiveFailures = 0;
        this.firstFailureAt = null;
        this.lastFailureAt = null;
        this.currentBackoffMs = 0;
        this.state = STATES.CLOSED;
        this.openUntil = null;
        return this.snapshot();
    }

    beforeAttempt() {
        const now = this.clock();
        if (this.state === STATES.OPEN && now >= Number(this.openUntil || 0)) this.state = STATES.HALF_OPEN;
        return Object.freeze({
            allowed: this.state !== STATES.OPEN,
            retryInMs: this.state === STATES.OPEN ? Math.max(0, Number(this.openUntil || now) - now) : 0,
            state: this.state
        });
    }

    recordFailure({ retryable = true, cancelled = false } = {}) {
        if (cancelled) return this.snapshot();
        const now = this.clock();
        if (this.firstFailureAt === null) this.firstFailureAt = now;
        this.lastFailureAt = now;
        this.consecutiveFailures += 1;
        const base = Math.min(
            this.policy.maxBackoffMs,
            this.policy.baseBackoffMs * (this.policy.multiplier ** Math.max(0, this.consecutiveFailures - 1))
        );
        const spread = base * this.policy.jitterRatio;
        const jitter = spread > 0 ? ((this.random() * 2) - 1) * spread : 0;
        this.currentBackoffMs = Math.max(0, Math.round(Math.min(this.policy.maxBackoffMs, base + jitter)));
        if (!retryable || this.state === STATES.HALF_OPEN || this.consecutiveFailures >= this.policy.maxConsecutiveFailures) {
            this.state = STATES.OPEN;
            this.openUntil = now + this.policy.openDurationMs;
        }
        return this.snapshot();
    }

    recordSuccess({ verified = false } = {}) {
        return verified ? this.reset() : this.snapshot();
    }

    snapshot() {
        return Object.freeze({
            state: this.state,
            consecutiveFailures: this.consecutiveFailures,
            firstFailureAt: this.firstFailureAt,
            lastFailureAt: this.lastFailureAt,
            currentBackoffMs: this.currentBackoffMs,
            openUntil: this.openUntil
        });
    }
}

FailureCircuitBreaker.STATES = STATES;
module.exports = FailureCircuitBreaker;