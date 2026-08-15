'use strict';

const { randomUUID } = require('node:crypto');
const { createFailureEvent } = require('./RuntimeFailureEvent');
const Redactor = require('../../shared/security/Redactor');

const CONNECTION_EVENTS = Object.freeze(['connection:error', 'connection:kicked', 'connection:failed', 'connection:ended']);
const CONNECTION_PRIORITY = Object.freeze({
    'connection:ended': 1,
    'connection:kicked': 2,
    'connection:error': 3,
    'connection:failed': 4
});

class RuntimeFailurePublisher {
    constructor({ botId, eventBus, connectionAggregationMs, logger = null } = {}) {
        if (!Number.isFinite(Number(connectionAggregationMs)) || Number(connectionAggregationMs) < 0) {
            throw new TypeError('RuntimeFailurePublisher connectionAggregationMs must be a non-negative number.');
        }
        this.name = 'RuntimeFailurePublisher';
        this.botId = botId;
        this.eventBus = eventBus;
        this.connectionAggregationMs = Number(connectionAggregationMs);
        this.logger = logger;
        this.unsubscribers = [];
        this.connectionIncidents = new Map();
        this.stopping = false;
    }

    async initialize() {
        if (!this.eventBus) return;
        for (const eventName of CONNECTION_EVENTS) {
            this.unsubscribers.push(this.eventBus.on(eventName, event => {
                if (event?.botId && event.botId !== this.botId) return;
                if (eventName === 'connection:ended' && event?.intentional) return;
                try { this.#queueConnection(eventName, event || {}); }
                catch (error) { this.logger?.debug?.('Runtime failure connection bridge skipped.', { eventName, error }); }
            }));
        }
    }

    async start() {}

    publish(input = {}, { failureId = null } = {}) {
        const failure = createFailureEvent(input, { botId: this.botId, failureId });
        this.eventBus?.emit('runtime:failure', failure);
        return failure;
    }

    #queueConnection(eventName, event) {
        const generation = Number.isInteger(event.connectionGeneration) ? event.connectionGeneration : null;
        const key = generation === null ? 'unknown' : String(generation);
        let incident = this.connectionIncidents.get(key);
        if (!incident) {
            incident = {
                failureId: randomUUID(),
                generation,
                best: null,
                bestScore: -1,
                signals: [],
                timer: null
            };
            this.connectionIncidents.set(key, incident);
        }

        const candidate = this.#connectionCandidate(eventName, event, incident.failureId);
        const score = this.#diagnosticScore(eventName, candidate);
        if (!incident.best || score >= incident.bestScore) {
            incident.best = candidate;
            incident.bestScore = score;
        }
        incident.signals.push(Redactor.sanitize({
            eventName,
            code: candidate.code,
            step: candidate.step,
            message: candidate.message,
            reason: event.reason ?? null
        }));

        clearTimeout(incident.timer);
        const flush = () => {
            incident.timer = null;
            this.#flushConnection(key).catch(error => this.logger?.debug?.('Runtime failure connection aggregation skipped.', { error }));
        };
        if (this.connectionAggregationMs === 0) queueMicrotask(flush);
        else {
            incident.timer = setTimeout(flush, this.connectionAggregationMs);
            incident.timer.unref?.();
        }
    }

    #connectionCandidate(eventName, event, failureId) {
        const diagnostic = event.diagnostic || event.error?.toDiagnostic?.() || null;
        const reason = ['connection:kicked', 'connection:ended'].includes(eventName) ? event.reason : null;
        return createFailureEvent({
            ...event,
            failureId,
            source: 'connection',
            subsystem: 'connection',
            severity: ['connection:kicked', 'connection:ended'].includes(eventName) ? 'warn' : 'error',
            code: diagnostic?.code || event.error?.code || (eventName === 'connection:kicked' ? 'CONNECTION_KICKED' : eventName === 'connection:ended' ? 'CONNECTION_ENDED' : 'CONNECTION_FAILED'),
            operation: diagnostic?.operation || 'ConnectionManager',
            step: diagnostic?.step || eventName.replace('connection:', ''),
            action: diagnostic?.action || null,
            resource: diagnostic?.resource || null,
            message: diagnostic?.message || event.error?.message || (reason == null ? eventName : String(reason)),
            retryable: diagnostic?.retryable !== false,
            diagnostic,
            details: { eventName, reason: reason ?? null }
        }, { botId: this.botId, failureId });
    }

    #diagnosticScore(eventName, failure) {
        const diagnostic = failure.diagnostic || {};
        // Diagnostic richness is the primary ordering. Event priority is only a
        // small tie-breaker so a generic connection:failed event cannot replace a
        // richer connection:error/kicked diagnostic from the same generation.
        let richness = 0;
        for (const key of ['code', 'operation', 'step', 'action', 'resource', 'message']) if (failure[key]) richness += 10;
        for (const key of ['subsystem', 'attempt', 'trace', 'cause', 'stack', 'details']) {
            const value = diagnostic[key];
            if (value !== null && value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0)) richness += 12;
        }
        try {
            richness += Math.min(200, JSON.stringify(diagnostic).length / 50);
        } catch (error) {
            this.logger?.debug?.('Runtime failure diagnostic scoring used deterministic fallback.', {
                error: Redactor.sanitize(error),
                eventName
            });
        }
        const score = richness * 100 + (CONNECTION_PRIORITY[eventName] || 0);
        return score;
    }

    async #flushConnection(key) {
        const incident = this.connectionIncidents.get(key);
        if (!incident) return null;
        this.connectionIncidents.delete(key);
        clearTimeout(incident.timer);
        incident.timer = null;
        if (!incident.best || this.stopping && incident.signals.length === 0) return null;
        const failure = createFailureEvent({
            ...incident.best,
            details: {
                ...(incident.best.details || {}),
                connectionSignals: incident.signals
            }
        }, { botId: this.botId, failureId: incident.failureId });
        this.eventBus?.emit('runtime:failure', failure);
        return failure;
    }

    async stop() {
        if (this.stopping) return;
        this.stopping = true;
        for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
        const keys = [...this.connectionIncidents.keys()];
        for (const key of keys) await this.#flushConnection(key);
        this.connectionIncidents.clear();
    }

    async destroy() { await this.stop(); }
}

module.exports = RuntimeFailurePublisher;