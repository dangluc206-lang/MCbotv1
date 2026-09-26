'use strict';

const Redactor = require('../../shared/security/Redactor');

// Concrete event names emitted via eventBus.emit across the codebase. The
// EventBus is a named EventEmitter (no wildcard catch-all), so the bridge
// subscribes to each known name. New event names must be added here to appear
// in the Dev inspector. Ordered by the pipeline the operator cares about.
const EMITTED_EVENTS = Object.freeze([
    // connection
    'connection:disabled', 'connection:attempt-started', 'connection:connecting',
    'connection:client-attached', 'connection:spawned', 'connection:attempt-failed',
    'connection:failed', 'connection:login', 'connection:kicked', 'connection:error',
    'connection:ended',
    // reconnect
    'reconnect:exhausted', 'reconnect:scheduled', 'reconnect:attempting',
    'reconnect:succeeded', 'reconnect:cancelled', 'reconnect:suspended',
    'reconnect:resumed',
    // mode
    'mode:collector-b5:paused', 'mode:collector-b5:resumed',
    'mode:collector-b5:config-updated', 'mode:collector-b5:cycle-completed',
    'mode:collector-b5:error', 'mode:fishing:catch',
    // operation / runtime
    'runtime:failure',
    // gui
    'gui:opened', 'gui:updated', 'gui:closed',
    // inventory
    'inventory:observed', 'inventory:delta',
    // crafting (via mode events)
    // movement
    'movement:position', 'movement:teleport',
    // skyblock
    'skyblock:gateway:scheduled', 'skyblock:gateway:attempting',
    'skyblock:gateway:succeeded', 'skyblock:gateway:failed',
    'resource-pack:disabled', 'resource-pack:requested', 'resource-pack:accepted',
    'resource-pack:ready', 'resource-pack:failed',
    'server-login:disabled', 'server-login:started', 'server-login:succeeded',
    'server-login:failed',
    // player / command (connection event binding)
    'player:death', 'command:message',
    // fishing
    'fishing:packet-observation'
]);

// Ordered eventType -> subsystem taxonomy. Order matters: longer prefixes
// match first so e.g. 'mode:collector-b5:*' stays 'mode' not 'collector'.
const SUBSYSTEM_RULES = Object.freeze([
    { prefix: 'mode:', value: 'mode' },
    { prefix: 'reconnect:', value: 'reconnect' },
    { prefix: 'connection:', value: 'connection' },
    { prefix: 'operation:', value: 'operation' },
    { prefix: 'gui:', value: 'gui' },
    { prefix: 'inventory:', value: 'inventory' },
    { prefix: 'storage:', value: 'storage' },
    { prefix: 'kho:', value: 'storage' },
    { prefix: 'b1:', value: 'storage' },
    { prefix: 'crafting:', value: 'crafting' },
    { prefix: 'recipe:', value: 'crafting' },
    { prefix: 'movement:', value: 'movement' },
    { prefix: 'skyblock:', value: 'skyblock' },
    { prefix: 'resource-pack:', value: 'skyblock' },
    { prefix: 'server-login:', value: 'skyblock' },
    { prefix: 'player:', value: 'skyblock' },
    { prefix: 'fishing:', value: 'mode' },
    { prefix: 'command:', value: 'mode' },
    { prefix: 'runtime:', value: 'operation' }
]);

const DEFAULT_SUBSYSTEM = 'mode';

const SEVERITY_RULES = Object.freeze([
    { test: /(?:error|failed|exhausted|kicked|rejected|blocked)/i, value: 'error' },
    { test: /(?:warn|retry|timeout|cancelled|suspended|scheduled|attempting|connecting)/i, value: 'warn' },
    { test: /(?:debug|capture|packet|observed|delta|ping|position|teleport|update)/i, value: 'debug' }
]);

const DEFAULT_SEVERITY = 'info';

function normalizeLegalString(value) {
    return String(value ?? '').trim() ? String(value ?? '').trim() : null;
}

function normalizePositiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeAttemptEpoch(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

function inferSubsystem(eventType) {
    const value = String(eventType || '');
    if (!value) return DEFAULT_SUBSYSTEM;
    for (const rule of SUBSYSTEM_RULES) {
        if (value.startsWith(rule.prefix)) return rule.value;
    }
    // Fall back to the first segment before ':', e.g. 'command' for 'command:message'.
    const first = value.split(':')[0];
    if (first && first !== value) return first;
    return DEFAULT_SUBSYSTEM;
}

function inferSeverity(eventType) {
    const value = String(eventType || '');
    for (const rule of SEVERITY_RULES) {
        if (rule.test.test(value)) return rule.value;
    }
    return DEFAULT_SEVERITY;
}

// EventBus emit delivers either the raw payload (primitive compatibility path)
// or the enveloped object { eventId, eventType, emittedAt, botId,
// connectionGeneration, operationId, correlationId, ...payload }.
function normalizeEnvelope(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const eventType = normalizeLegalString(input.eventType);
    if (!eventType) return null;
    const payload = { ...(input.payload || {}) };
    // Envelope already carries these at the top level; fall back to payload for
    // callers that emit the raw payload object (primitive compatibility path).
    const botId = normalizeLegalString(input.botId ?? payload.botId);
    const generation = normalizePositiveInteger(input.connectionGeneration ?? input.generation ?? payload.connectionGeneration ?? payload.generation);
    const attemptEpoch = normalizeAttemptEpoch(input.attemptEpoch ?? payload.attemptEpoch);
    const modeId = normalizeLegalString(input.modeId ?? payload.modeId ?? payload.mode);
    const operationId = normalizeLegalString(input.operationId ?? payload.operationId);
    const correlationId = normalizeLegalString(input.correlationId ?? payload.correlationId ?? operationId);
    const subsystem = normalizeLegalString(input.subsystem ?? payload.subsystem) || inferSubsystem(eventType);
    const source = normalizeLegalString(input.source ?? payload.source) || subsystem;
    const severity = normalizeLegalString(input.severity) || inferSeverity(eventType);
    const eventId = normalizeLegalString(input.eventId) || `evt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const timestamp = Number.isFinite(Number(input.emittedAt)) ? Number(input.emittedAt) : Date.now();
    return Redactor.sanitize({
        eventId,
        eventType,
        timestamp,
        botId,
        generation,
        attemptEpoch,
        modeId,
        operationId,
        correlationId,
        source,
        subsystem,
        severity,
        payload
    });
}

function matchesFilter(record = {}, filter = {}) {
    if (filter.botId && String(record.botId || '') !== String(filter.botId)) return false;
    if (filter.eventType && String(record.eventType || '') !== String(filter.eventType)) return false;
    if (filter.generation !== undefined && filter.generation !== null && filter.generation !== '') {
        if (Number(record.generation) !== Number(filter.generation)) return false;
    }
    if (filter.attemptEpoch !== undefined && filter.attemptEpoch !== null && filter.attemptEpoch !== '') {
        if (Number(record.attemptEpoch) !== Number(filter.attemptEpoch)) return false;
    }
    if (filter.operationId && String(record.operationId || '') !== String(filter.operationId)) return false;
    return true;
}

class EventInspectorBridge {
    constructor({
        sharedEventBus = null,
        runtimes = () => [],
        maxEvents = 3000,
        listener = null
    } = {}) {
        this.sharedEventBus = sharedEventBus;
        this.getRuntimes = typeof runtimes === 'function' ? runtimes : () => [];
        this.maxEvents = Math.max(100, Number(maxEvents) || 3000);
        this.listener = typeof listener === 'function' ? listener : null;
        this.events = [];
        this.unsubscribers = new Set();
        this.emittedEventNames = EMITTED_EVENTS;
    }

    #dispatch(eventType, envelope = {}) {
        if (!eventType || !this.emittedEventNames.includes(eventType)) return;
        const record = normalizeEnvelope(envelope);
        if (!record) return;
        this.events.push(record);
        if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
        if (this.listener) {
            try { this.listener(record); } catch { /* listener errors are non-fatal for the bridge */ }
        }
    }

    #subscribeToBus(eventBus) {
        if (!eventBus || typeof eventBus?.on !== 'function') return;
        for (const eventType of this.emittedEventNames) {
            const off = eventBus.on(eventType, envelope => this.#dispatch(eventType, envelope));
            if (typeof off === 'function') this.unsubscribers.add(off);
        }
        // Unknown events: never drop observability. New eventBus.emit names that
        // are not in EMITTED_EVENTS are still normalized (subsystem inferred from
        // prefix, severity from keywords) so the Dev stream shows them.
        const known = new Set(this.emittedEventNames);
        let extraNames = [];
        try {
            const emitter = eventBus.emitter || eventBus._emitter || null;
            if (typeof emitter?.eventNames === 'function') extraNames = emitter.eventNames();
            else if (typeof eventBus.eventNames === 'function') extraNames = eventBus.eventNames();
        } catch { extraNames = []; }
        for (const eventType of extraNames) {
            if (typeof eventType !== 'string' || known.has(eventType)) continue;
            const off = eventBus.on(eventType, envelope => this.#dispatchUnknown(eventType, envelope));
            if (typeof off === 'function') this.unsubscribers.add(off);
        }
    }

    #dispatchUnknown(eventType, envelope = {}) {
        if (!eventType) return;
        const candidate = envelope && typeof envelope === 'object' && !Array.isArray(envelope)
            ? { ...envelope, eventType: envelope.eventType || eventType }
            : { eventType, payload: { value: String(envelope ?? '') } };
        const record = normalizeEnvelope(candidate);
        if (!record) return;
        this.events.push(record);
        if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
        if (this.listener) {
            try { this.listener(record); } catch { /* listener errors are non-fatal for the bridge */ }
        }
    }

    recordUnknown(eventType, envelope = {}) {
        return this.#dispatchUnknown(eventType, envelope);
    }

    watchAll() {
        this.unwatch();
        const buses = [];
        if (this.sharedEventBus && typeof this.sharedEventBus?.on === 'function') buses.push(this.sharedEventBus);
        const runtimeEventBuses = (this.getRuntimes() || [])
            .map(runtime => runtime?.getService?.('eventBus'))
            .filter(bus => bus && typeof bus?.on === 'function');
        buses.push(...runtimeEventBuses);
        for (const bus of buses) this.#subscribeToBus(bus);
        return buses.length;
    }

    unwatch() {
        for (const off of this.unsubscribers) { try { off(); } catch { /* ignore */ } }
        this.unsubscribers.clear();
        this.events = [];
    }

    snapshot({ limit = 1000, botId = null, generation = null, attemptEpoch = null, operationId = null, eventType = null } = {}) {
        const safeLimit = Math.max(1, Math.min(this.maxEvents, Number(limit) || 1000));
        const filter = { botId, generation, attemptEpoch, operationId, eventType };
        const hasFilter = Object.values(filter).some(value => value !== null && value !== undefined && value !== '');
        const scoped = hasFilter ? this.events.filter(record => matchesFilter(record, filter)) : this.events;
        return scoped.slice(-safeLimit).map(entry => ({ ...entry }));
    }

    onEvent(listener) {
        if (typeof listener !== 'function') throw new TypeError('event listener must be a function');
        this.listener = listener;
        return () => { this.listener = null; };
    }
}

module.exports = Object.freeze({
    EventInspectorBridge,
    normalizeEnvelope,
    matchesFilter,
    inferSubsystem,
    inferSeverity,
    normalizePositiveInteger,
    normalizeAttemptEpoch,
    normalizeLegalString,
    EMITTED_EVENTS,
    SUBSYSTEM_RULES,
    SEVERITY_RULES,
    DEFAULT_SUBSYSTEM,
    DEFAULT_SEVERITY
});