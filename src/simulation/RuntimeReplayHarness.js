'use strict';

const EventBus = require('../core/EventBus');
const VirtualClock = require('./VirtualClock');
const { immutableClone } = require('../shared/utils/object');

function plainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function errorSnapshot(error) {
    return {
        name: error?.name || 'Error',
        code: error?.code || null,
        message: String(error?.message || error || 'Unknown replay error')
    };
}

class RuntimeReplayHarness {
    constructor({ clock = new VirtualClock(), eventBus = new EventBus(), strict = true } = {}) {
        this.clock = clock;
        this.eventBus = eventBus;
        this.strict = Boolean(strict);
        this.actions = new Map();
        this.faults = [];
        this.invariants = [];
        this.cleanups = [];
        this.timeline = [];
        this.sequence = 0;
        this.running = false;
        this.completed = false;
    }

    registerAction(name, handler) {
        if (typeof name !== 'string' || !name.trim()) throw new TypeError('action name is required');
        if (typeof handler !== 'function') throw new TypeError('action handler must be a function');
        if (this.actions.has(name)) throw new Error(`Replay action already registered: ${name}`);
        this.actions.set(name, handler);
        return this;
    }

    addFault(fault) {
        if (!plainObject(fault) || typeof fault.id !== 'string' || !fault.id.trim()) throw new TypeError('fault.id is required');
        if (!plainObject(fault.match) || !plainObject(fault.effect)) throw new TypeError(`fault ${fault.id} requires match and effect`);
        if (this.faults.some(entry => entry.id === fault.id)) throw new Error(`Duplicate replay fault id: ${fault.id}`);
        const allowedMatchKeys = new Set(['id', 'kind', 'name', 'operation', 'path']);
        for (const key of Object.keys(fault.match)) {
            if (!allowedMatchKeys.has(key)) throw new Error(`fault ${fault.id}.match has unknown key: ${key}`);
        }
        const type = String(fault.effect.type || '');
        const supported = new Set(['drop', 'delay', 'duplicate', 'error', 'before-error', 'after-error', 'resolve-wrong', 'read-transient']);
        if (!supported.has(type)) throw new Error(`Unsupported fault effect type: ${type || '<missing>'}`);
        const times = fault.times === undefined ? 1 : Number(fault.times);
        if (!Number.isInteger(times) || times < 1) throw new TypeError(`fault ${fault.id}.times must be a positive integer`);
        this.faults.push({ ...immutableClone(fault), remaining: times });
        return this;
    }

    addInvariant(name, check) {
        if (typeof name !== 'string' || !name.trim() || typeof check !== 'function') throw new TypeError('invariant name and check are required');
        this.invariants.push({ name, check });
        return this;
    }

    addCleanup(cleanup) {
        if (typeof cleanup !== 'function') throw new TypeError('cleanup must be a function');
        this.cleanups.push(cleanup);
        return this;
    }

    async replay(entries, { faults = [], maxTasks = 100000 } = {}) {
        if (this.running || this.completed) throw new Error('Replay harness may run exactly once.');
        const normalized = this.#normalizeEntries(entries);
        for (const fault of faults) this.addFault(fault);
        this.running = true;
        try {
            for (const entry of normalized) {
                this.clock.schedule(() => this.#dispatch(entry), entry.atMs, { label: `replay:${entry.id}` });
            }
            await this.clock.runAll({ maxTasks });
            await this.#checkInvariants(null, true);
            if (this.clock.pendingSnapshot().length !== 0) throw new Error('Replay completed with pending virtual-clock tasks.');
            this.completed = true;
            return this.snapshot();
        } finally {
            this.running = false;
        }
    }

    snapshot() {
        return immutableClone({
            nowMs: this.clock.now(),
            completed: this.completed,
            timeline: this.timeline,
            pendingTasks: this.clock.pendingSnapshot(),
            faults: this.faults.map(fault => ({ id: fault.id, remaining: fault.remaining }))
        });
    }

    async dispose(reason = 'Replay harness disposed.') {
        const errors = [];
        for (const cleanup of this.cleanups.splice(0).reverse()) {
            try {
                await cleanup(reason);
            } catch (error) {
                errors.push(error);
            }
        }
        this.clock.dispose(reason);
        if (errors.length > 0) throw new AggregateError(errors, 'Replay cleanup failed.');
    }

    #normalizeEntries(entries) {
        if (!Array.isArray(entries)) throw new TypeError('Replay entries must be an array.');
        const ids = new Set();
        return entries.map((input, index) => {
            if (!plainObject(input)) throw new TypeError(`Replay entry ${index} must be an object.`);
            const allowed = new Set(['id', 'atMs', 'kind', 'name', 'payload', 'options', 'expect']);
            for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`Replay entry ${index} has unknown key: ${key}`);
            if (typeof input.id !== 'string' || !input.id.trim()) throw new TypeError(`Replay entry ${index}.id is required.`);
            if (ids.has(input.id)) throw new Error(`Duplicate replay entry id: ${input.id}`);
            ids.add(input.id);
            if (!Number.isFinite(input.atMs) || input.atMs < 0) throw new TypeError(`Replay entry ${input.id}.atMs must be non-negative.`);
            if (!['event', 'action'].includes(input.kind)) throw new TypeError(`Replay entry ${input.id}.kind must be event or action.`);
            if (typeof input.name !== 'string' || !input.name.trim()) throw new TypeError(`Replay entry ${input.id}.name is required.`);
            if (input.payload !== undefined && !plainObject(input.payload)) throw new TypeError(`Replay entry ${input.id}.payload must be an object.`);
            if (input.options !== undefined && !plainObject(input.options)) throw new TypeError(`Replay entry ${input.id}.options must be an object.`);
            if (input.expect !== undefined && !plainObject(input.expect)) throw new TypeError(`Replay entry ${input.id}.expect must be an object.`);
            return immutableClone({
                id: input.id,
                atMs: Number(input.atMs),
                kind: input.kind,
                name: input.name,
                payload: input.payload || {},
                options: input.options || {},
                expect: input.expect || null,
                sourceOrder: index
            });
        });
    }

    async #dispatch(entry) {
        const fault = this.#matchingFault(entry);
        if (fault) {
            fault.remaining -= 1;
            const selector = this.#faultSelector(entry);
            this.#record({
                entryId: entry.id,
                kind: 'fault',
                name: fault.id,
                status: 'applied',
                data: { effect: fault.effect, match: fault.match, selector }
            });
            const type = fault.effect.type;
            if (type === 'drop') return this.#settle(entry, { status: 'dropped', data: null });
            if (type === 'delay') {
                const delayMs = Number(fault.effect.delayMs);
                if (!Number.isFinite(delayMs) || delayMs < 0) throw new TypeError(`Fault ${fault.id} delayMs must be non-negative.`);
                this.clock.schedule(() => this.#execute(entry, 1), delayMs, { label: `fault:${fault.id}:${entry.id}` });
                return;
            }
            if (type === 'duplicate') {
                const copies = Number(fault.effect.copies ?? 2);
                if (!Number.isInteger(copies) || copies < 2 || copies > 100) throw new TypeError(`Fault ${fault.id} copies must be 2..100.`);
                await Promise.all(Array.from({ length: copies }, (_, index) => this.#execute(entry, index + 1)));
                return;
            }
            if (type === 'error' || type === 'before-error') {
                return this.#settle(entry, { status: 'rejected', error: errorSnapshot(this.#faultError(fault)) });
            }
            if (type === 'after-error') return this.#executeWithPostFault(entry, fault);
            if (type === 'resolve-wrong') return this.#executeWithOverride(entry, fault.effect.value);
            if (type === 'read-transient') {
                if (entry.kind !== 'action') throw new TypeError(`Fault ${fault.id} read-transient requires an action entry.`);
                return this.#settle(entry, { status: 'fulfilled', data: immutableClone(fault.effect.value ?? null) });
            }
        }
        return this.#execute(entry, 1);
    }

    async #invoke(entry, instance) {
        if (entry.kind === 'event') {
            const delivered = this.eventBus.emit(entry.name, entry.payload, entry.options);
            return { delivered: Boolean(delivered) };
        }
        const handler = this.actions.get(entry.name);
        if (!handler) throw new Error(`Replay action is not registered: ${entry.name}`);
        return handler(immutableClone(entry.payload), Object.freeze({
            entryId: entry.id,
            instance,
            nowMs: this.clock.now(),
            clock: this.clock,
            eventBus: this.eventBus
        }));
    }

    async #execute(entry, instance) {
        try {
            const data = await this.#invoke(entry, instance);
            return this.#settle(entry, { status: 'fulfilled', instance, data });
        } catch (error) {
            return this.#settle(entry, { status: 'rejected', instance, error: errorSnapshot(error) });
        }
    }

    async #executeWithPostFault(entry, fault) {
        try {
            await this.#invoke(entry, 1);
            return this.#settle(entry, { status: 'rejected', error: errorSnapshot(this.#faultError(fault)) });
        } catch (error) {
            return this.#settle(entry, { status: 'rejected', error: errorSnapshot(error) });
        }
    }

    async #executeWithOverride(entry, value) {
        try {
            await this.#invoke(entry, 1);
            return this.#settle(entry, { status: 'fulfilled', data: immutableClone(value ?? null) });
        } catch (error) {
            return this.#settle(entry, { status: 'rejected', error: errorSnapshot(error) });
        }
    }

    async #settle(entry, outcome) {
        const record = this.#record({
            entryId: entry.id,
            kind: entry.kind,
            name: entry.name,
            status: outcome.status,
            instance: outcome.instance || 1,
            data: outcome.data === undefined ? null : outcome.data,
            error: outcome.error || null
        });
        const mismatch = this.#expectationMismatch(entry.expect, record);
        await this.#checkInvariants(record, false);
        if (mismatch) throw new Error(`Replay expectation failed for ${entry.id}: ${mismatch}`);
        if (!entry.expect && this.strict && record.status === 'rejected') {
            const error = new Error(`Unexpected replay rejection for ${entry.id}: ${record.error?.message || 'unknown error'}`);
            error.code = record.error?.code || 'REPLAY_UNEXPECTED_REJECTION';
            throw error;
        }
        return record;
    }

    #faultError(fault) {
        const error = new Error(String(fault.effect.message || `Injected fault: ${fault.id}`));
        if (fault.effect.code) error.code = String(fault.effect.code);
        return error;
    }

    #faultSelector(entry) {
        return Object.freeze({
            id: entry.id,
            kind: entry.kind,
            name: entry.name,
            operation: entry.payload.operation ?? entry.options.operation ?? entry.name,
            path: entry.payload.path ?? entry.options.path ?? null
        });
    }

    #matchingFault(entry) {
        const selector = this.#faultSelector(entry);
        return this.faults.find(fault => {
            if (fault.remaining <= 0) return false;
            const match = fault.match;
            return (match.id === undefined || match.id === selector.id)
                && (match.kind === undefined || match.kind === selector.kind)
                && (match.name === undefined || match.name === selector.name)
                && (match.operation === undefined || match.operation === selector.operation)
                && (match.path === undefined || match.path === selector.path);
        }) || null;
    }

    #expectationMismatch(expect, outcome) {
        if (!expect) return null;
        const allowed = new Set(['status', 'errorCode', 'delivered']);
        for (const key of Object.keys(expect)) if (!allowed.has(key)) return `unknown expectation key ${key}`;
        if (expect.status !== undefined && expect.status !== outcome.status) return `expected status ${expect.status}, got ${outcome.status}`;
        if (expect.errorCode !== undefined && expect.errorCode !== outcome.error?.code) return `expected errorCode ${expect.errorCode}, got ${outcome.error?.code || null}`;
        if (expect.delivered !== undefined && Boolean(expect.delivered) !== Boolean(outcome.data?.delivered)) return `expected delivered=${Boolean(expect.delivered)}`;
        return null;
    }

    async #checkInvariants(outcome, final) {
        for (const invariant of this.invariants) {
            try {
                await invariant.check({ outcome, final, snapshot: this.snapshot() });
            } catch (error) {
                throw new Error(`Replay invariant failed (${invariant.name}): ${error.message}`, { cause: error });
            }
        }
    }

    #record(record) {
        const normalized = immutableClone({
            sequence: ++this.sequence,
            atMs: this.clock.now(),
            ...record
        });
        this.timeline.push(normalized);
        return normalized;
    }
}

module.exports = RuntimeReplayHarness;
