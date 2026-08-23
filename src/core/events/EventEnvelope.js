'use strict';

const { randomUUID } = require('node:crypto');

const FORBIDDEN_RAW_KEYS = new Set(['bot', 'client', '_client', 'window', 'packet']);

function finitePositiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeConnectionGeneration(event) {
    if (!event || typeof event !== 'object') return null;
    return finitePositiveInteger(event.connectionGeneration ?? event.generation);
}

function cloneDetached(value, seen = new WeakMap()) {
    if (value === null || value === undefined) return value ?? null;
    if (['string', 'number', 'boolean'].includes(typeof value)) {
        return Number.isFinite(value) || typeof value !== 'number' ? value : null;
    }
    if (typeof value === 'bigint') return String(value);
    if (typeof value === 'function' || typeof value === 'symbol') return undefined;
    if (value instanceof Error) {
        if (seen.has(value)) return seen.get(value);
        const clone = {};
        seen.set(value, clone);
        const diagnostic = typeof value.toDiagnostic === 'function'
            ? value.toDiagnostic()
            : null;
        if (diagnostic && typeof diagnostic === 'object') Object.assign(clone, cloneDetached(diagnostic, seen));
        clone.name = String(value.name || diagnostic?.name || 'Error');
        clone.message = String(value.message || diagnostic?.message || '');
        clone.code = value.code ?? diagnostic?.code ?? null;
        clone.stack = value.stack ? String(value.stack) : (diagnostic?.stack ? String(diagnostic.stack) : null);
        // Preserve enumerable domain metadata on custom Error subclasses without
        // retaining the mutable Error instance itself.
        for (const key of Object.keys(value)) {
            if (FORBIDDEN_RAW_KEYS.has(key)) continue;
            const detached = cloneDetached(value[key], seen);
            if (detached !== undefined) clone[key] = detached;
        }
        return Object.freeze(clone);
    }
    if (seen.has(value)) return seen.get(value);
    if (Array.isArray(value)) {
        const clone = [];
        seen.set(value, clone);
        for (const item of value) {
            const detached = cloneDetached(item, seen);
            if (detached !== undefined) clone.push(detached);
        }
        return Object.freeze(clone);
    }

    // Event payloads must be detached plain data. Mineflayer Vec3-like positions
    // are normalized to coordinates rather than retaining their mutable prototype.
    const clone = {};
    seen.set(value, clone);
    for (const key of Object.keys(value)) {
        if (key === 'generation' || FORBIDDEN_RAW_KEYS.has(key)) continue;
        const detached = cloneDetached(value[key], seen);
        if (detached !== undefined) clone[key] = detached;
    }
    return Object.freeze(clone);
}

function createEventEnvelope(eventType, payload = {}, {
    scope = 'auto',
    clock = Date.now,
    idFactory = randomUUID
} = {}) {
    if (typeof eventType !== 'string' || !eventType.trim()) throw new TypeError('eventType is required');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('event payload must be an object');

    const emittedAt = Number(clock());
    if (!Number.isFinite(emittedAt)) throw new TypeError('event clock must return a finite timestamp');
    const connectionGeneration = normalizeConnectionGeneration(payload);
    const botId = typeof payload.botId === 'string' && payload.botId.trim() ? payload.botId : null;
    if (scope === 'connection' && (!botId || connectionGeneration === null)) {
        throw new TypeError(`Connection-scoped event ${eventType} requires botId and positive connectionGeneration`);
    }

    const detached = cloneDetached(payload);
    const envelope = {
        ...detached,
        eventId: String(idFactory()),
        eventType,
        emittedAt,
        botId,
        connectionGeneration,
        operationId: payload.operationId ?? null,
        correlationId: payload.correlationId ?? null
    };
    return Object.freeze(envelope);
}

module.exports = Object.freeze({
    createEventEnvelope,
    normalizeConnectionGeneration,
    cloneDetached
});