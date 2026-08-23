'use strict';

const { immutableClone } = require('../shared/utils/object');

const STATES = new Set(['HEALTHY', 'DEGRADED', 'UNHEALTHY', 'UNKNOWN']);

class HealthRegistry {
    constructor({ botId = null, clock = Date.now, probeTimeoutMs = 2000 } = {}) {
        if (typeof clock !== 'function') throw new TypeError('HealthRegistry clock must be a function.');
        if (!Number.isFinite(probeTimeoutMs) || probeTimeoutMs < 1) throw new TypeError('HealthRegistry probeTimeoutMs must be positive.');
        this.botId = botId == null ? null : String(botId).trim();
        this.clock = clock;
        this.probeTimeoutMs = probeTimeoutMs;
        this.probes = new Map();
    }

    register(id, probe, { critical = false, description = null } = {}) {
        const key = this.#id(id);
        if (typeof probe !== 'function') throw new TypeError(`Health probe must be a function: ${key}`);
        if (this.probes.has(key)) throw new Error(`Health probe already registered: ${key}`);
        this.probes.set(key, Object.freeze({ id: key, probe, critical: Boolean(critical), description: description == null ? null : String(description) }));
        return () => this.probes.delete(key);
    }

    async check(id) {
        const key = this.#id(id);
        const entry = this.probes.get(key);
        if (!entry) throw new Error(`Health probe not found: ${key}`);
        const startedAt = this.clock();
        try {
            const result = await this.#withTimeout(Promise.resolve().then(() => entry.probe()), key);
            return this.#normalize(entry, result, startedAt);
        } catch (error) {
            return this.#normalize(entry, {
                state: 'UNHEALTHY',
                message: error.message,
                details: { code: error.code || null }
            }, startedAt);
        }
    }

    async snapshot() {
        const checks = await Promise.all([...this.probes.keys()].sort().map(id => this.check(id)));
        let state = 'HEALTHY';
        if (checks.some(check => check.state === 'UNHEALTHY' && check.critical)) state = 'UNHEALTHY';
        else if (checks.some(check => check.state === 'UNHEALTHY' || check.state === 'DEGRADED')) state = 'DEGRADED';
        else if (checks.length === 0 || checks.every(check => check.state === 'UNKNOWN')) state = 'UNKNOWN';
        return immutableClone({
            botId: this.botId,
            state,
            checkedAt: new Date(this.clock()).toISOString(),
            checks
        });
    }

    list() {
        return [...this.probes.values()].map(entry => ({ id: entry.id, critical: entry.critical, description: entry.description })).sort((a, b) => a.id.localeCompare(b.id));
    }

    #normalize(entry, value, startedAt) {
        const object = value && typeof value === 'object' && !Array.isArray(value) ? value : { state: value === true ? 'HEALTHY' : value === false ? 'UNHEALTHY' : 'UNKNOWN' };
        const state = STATES.has(object.state) ? object.state : 'UNKNOWN';
        return {
            id: entry.id,
            critical: entry.critical,
            description: entry.description,
            state,
            message: object.message == null ? null : String(object.message),
            details: object.details && typeof object.details === 'object' ? object.details : null,
            durationMs: Math.max(0, Number(this.clock()) - Number(startedAt))
        };
    }

    #withTimeout(promise, id) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const error = new Error(`Health probe timed out: ${id}`);
                error.code = 'HEALTH_PROBE_TIMEOUT';
                reject(error);
            }, this.probeTimeoutMs);
            timer.unref?.();
            promise.then(
                value => { clearTimeout(timer); resolve(value); },
                error => { clearTimeout(timer); reject(error); }
            );
        });
    }

    #id(value) {
        const id = String(value || '').trim();
        if (!/^[a-z][a-z0-9]*(?:[-.:][a-z0-9]+)*$/.test(id)) throw new TypeError(`Invalid health probe id: ${id || '<empty>'}`);
        return id;
    }
}

module.exports = HealthRegistry;
