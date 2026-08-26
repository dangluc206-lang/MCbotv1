'use strict';

const FailureCircuitBreaker = require('../shared/resilience/FailureCircuitBreaker');
const OperatorErrorContract = require('../shared/contracts/OperatorErrorContract');
const Redactor = require('../shared/security/Redactor');
const { immutableClone } = require('../shared/utils/object');

const FAULT_CLASSES = Object.freeze({
    EXPECTED_WAIT: 'EXPECTED_WAIT',
    TRANSIENT_RETRY: 'TRANSIENT_RETRY',
    BUSINESS_BLOCKER: 'BUSINESS_BLOCKER',
    UNEXPECTED_FAULT: 'UNEXPECTED_FAULT',
    STALE_ABORT: 'STALE_ABORT',
    CANCELLED: 'CANCELLED'
});

const DEFAULT_POLICY = Object.freeze({
    baseBackoffMs: 1000,
    maxBackoffMs: 30000,
    multiplier: 2,
    jitterRatio: 0,
    maxConsecutiveFailures: 4,
    openDurationMs: 60000
});

class ModeFaultPolicy {
    constructor({ botId, modeId, policy = DEFAULT_POLICY, publisher = null, logger = null, clock = () => Date.now(), random = Math.random } = {}) {
        if (!botId || !modeId) throw new TypeError('ModeFaultPolicy botId and modeId are required.');
        this.botId = String(botId);
        this.modeId = String(modeId);
        this.publisher = publisher;
        this.logger = logger;
        this.clock = clock;
        this.breaker = new FailureCircuitBreaker({ policy: { ...DEFAULT_POLICY, ...(policy || {}) }, clock, random });
        this.episodes = new Map();
        this.lastFault = null;
        this.resetReason = 'created';
    }

    restartPolicy() {
        return Object.freeze({
            maxRestarts: Math.max(0, this.breaker.policy.maxConsecutiveFailures - 1),
            baseDelayMs: this.breaker.policy.baseBackoffMs,
            maxDelayMs: this.breaker.policy.maxBackoffMs
        });
    }

    beforeAttempt() {
        return this.breaker.beforeAttempt();
    }

    classify(error, context = {}) {
        if (context.faultClass && FAULT_CLASSES[context.faultClass]) return context.faultClass;
        const code = String(error?.code || context.code || '').toUpperCase();
        if (context.cancelled || code === 'CANCELLED') return FAULT_CLASSES.CANCELLED;
        if (context.stale || /(?:STALE_GENERATION|GENERATION_CHANGED|STALE_ABORT)/.test(code)) return FAULT_CLASSES.STALE_ABORT;
        if (context.expectedWait) return FAULT_CLASSES.EXPECTED_WAIT;
        if (context.businessBlocker) return FAULT_CLASSES.BUSINESS_BLOCKER;
        if (context.retryable === true || error?.retryable === true || /(?:TIMEOUT|TEMPORARY|DISCONNECTED|NOT_READY)/.test(code)) return FAULT_CLASSES.TRANSIENT_RETRY;
        return FAULT_CLASSES.UNEXPECTED_FAULT;
    }

    record(error, context = {}) {
        const faultClass = this.classify(error, context);
        const ignored = [FAULT_CLASSES.CANCELLED, FAULT_CLASSES.STALE_ABORT, FAULT_CLASSES.EXPECTED_WAIT, FAULT_CLASSES.BUSINESS_BLOCKER].includes(faultClass);
        const breaker = ignored ? this.breaker.snapshot() : this.breaker.recordFailure({ retryable: faultClass === FAULT_CLASSES.TRANSIENT_RETRY });
        const canonical = OperatorErrorContract.create(error, {
            code: context.code || error?.code || `MODE_${faultClass}`,
            severity: context.severity,
            retryClass: ignored ? 'NONE' : faultClass === FAULT_CLASSES.TRANSIENT_RETRY ? 'BACKOFF' : 'OPERATOR_GUARDED',
            safeToRetry: faultClass === FAULT_CLASSES.TRANSIENT_RETRY,
            allowedActions: context.allowedActions,
            incidentId: context.incidentId || context.episodeId || null,
            correlationId: context.correlationId,
            operatorSummary: context.operatorSummary || error?.message,
            details: { ...(context.details || {}), modeId: this.modeId, faultClass }
        });
        this.lastFault = { faultClass, at: this.clock(), canonical, breaker };
        if (!ignored) this.#publishOnce(context.episodeId || `${faultClass}:${canonical.code}`, canonical, faultClass, context);
        return this.snapshot();
    }

    recordBlocker(error, context = {}) {
        const episodeId = String(context.episodeId || context.incidentId || '').trim();
        if (!episodeId) throw new TypeError('Mode business blocker episodeId is required.');
        const canonical = OperatorErrorContract.create(error, {
            code: context.code || error?.code || 'MODE_BUSINESS_BLOCKER',
            severity: context.severity || 'warning',
            retryClass: 'OPERATOR_GUARDED',
            safeToRetry: false,
            allowedActions: context.allowedActions || ['inspect-diagnostic', 'retry-storage-protection', 'export-support'],
            incidentId: episodeId,
            correlationId: context.correlationId || episodeId,
            operatorSummary: context.operatorSummary || error?.message,
            details: { ...(context.details || {}), modeId: this.modeId, faultClass: FAULT_CLASSES.BUSINESS_BLOCKER }
        });
        this.lastFault = { faultClass: FAULT_CLASSES.BUSINESS_BLOCKER, at: this.clock(), canonical, breaker: this.breaker.snapshot() };
        this.#publishOnce(episodeId, canonical, FAULT_CLASSES.BUSINESS_BLOCKER, context);
        return this.snapshot();
    }

    resolveEpisode(episodeId, evidence = null) {
        const episode = this.episodes.get(String(episodeId || ''));
        if (!episode || episode.resolvedAt !== null) return false;
        episode.resolvedAt = this.clock();
        episode.resolution = Redactor.sanitize(evidence);
        return true;
    }

    recordVerifiedSuccess({ reason = 'verified-success', episodeId = null, evidence = null } = {}) {
        if (episodeId) this.resolveEpisode(episodeId, evidence);
        else this.#resolveActiveEpisodes({ reason, ...(evidence || {}) });
        this.breaker.recordSuccess({ verified: true });
        this.resetReason = reason;
        return this.snapshot();
    }

    reset(reason = 'explicit-reset') {
        this.#resolveActiveEpisodes({ reason });
        this.breaker.reset();
        this.lastFault = null;
        this.resetReason = reason;
        return this.snapshot();
    }

    close(reason = 'mode-stopped') {
        this.#resolveActiveEpisodes({ reason });
        this.breaker.reset();
        this.resetReason = reason;
    }

    snapshot() {
        return immutableClone({
            contract: 'mode-fault-snapshot-v1',
            botId: this.botId,
            modeId: this.modeId,
            circuit: this.breaker.snapshot(),
            restartPolicy: this.restartPolicy(),
            resetReason: this.resetReason,
            lastFault: this.lastFault,
            episodes: [...this.episodes.values()].slice(-16)
        });
    }

    #publishOnce(episodeId, canonical, faultClass, context) {
        const key = String(episodeId);
        const existing = this.episodes.get(key);
        if (existing?.resolvedAt === null) return false;
        // Reusing a stable episode key after verified recovery is a new
        // incident. Replace the resolved slot so it cannot be silently hidden.
        if (existing) this.episodes.delete(key);
        const episode = {
            episodeId: key,
            incidentId: canonical.incidentId || key,
            faultClass,
            code: canonical.code,
            openedAt: this.clock(),
            resolvedAt: null,
            resolution: null
        };
        this.episodes.set(key, episode);
        while (this.episodes.size > 16) this.episodes.delete(this.episodes.keys().next().value);
        this.publisher?.publish?.({
            source: 'mode', subsystem: this.modeId, severity: canonical.severity,
            code: canonical.code, operation: context.operation || this.modeId,
            step: context.step || null, action: context.action || null, resource: context.resource || null,
            message: canonical.technicalSummary, retryable: canonical.safeToRetry,
            correlationId: canonical.correlationId, phase: context.phase || null,
            retryInMs: this.breaker.snapshot().currentBackoffMs,
            details: { operatorError: canonical, faultClass, episodeId: key }
        });
        return true;
    }

    #resolveActiveEpisodes(evidence) {
        const resolvedAt = this.clock();
        for (const episode of this.episodes.values()) {
            if (episode.resolvedAt !== null) continue;
            episode.resolvedAt = resolvedAt;
            episode.resolution = Redactor.sanitize(evidence);
        }
    }
}

ModeFaultPolicy.FAULT_CLASSES = FAULT_CLASSES;
ModeFaultPolicy.DEFAULT_POLICY = DEFAULT_POLICY;
module.exports = ModeFaultPolicy;
