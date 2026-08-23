'use strict';

const { immutableClone } = require('../../shared/utils/object');

const ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

function parseVersion(value, label = 'version') {
    const text = String(value || '').trim();
    const match = VERSION_PATTERN.exec(text);
    if (!match) throw new TypeError(`Invalid ${label}: ${text || '<empty>'}`);
    return Object.freeze({ text, major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) });
}

function versionSatisfies(actual, requested) {
    if (!requested) return true;
    const req = String(requested).trim();
    if (/^\d+\.x$/i.test(req)) return actual.major === Number(req.split('.')[0]);
    if (/^\^\d+\.\d+\.\d+$/.test(req)) {
        const base = parseVersion(req.slice(1), 'version range');
        return actual.major === base.major && (actual.minor > base.minor || (actual.minor === base.minor && actual.patch >= base.patch));
    }
    return actual.text === parseVersion(req, 'required version').text;
}

function normalizeDependency(raw) {
    if (typeof raw === 'string') return Object.freeze({ id: raw, version: null });
    if (!raw || typeof raw !== 'object') throw new TypeError('Capability dependency must be an id or descriptor.');
    return Object.freeze({ id: String(raw.id || '').trim(), version: raw.version == null ? null : String(raw.version).trim() });
}

class CapabilityRegistry {
    constructor({ botId = null } = {}) {
        this.botId = botId == null ? null : String(botId).trim();
        this.entries = new Map();
        this.sealed = false;
    }

    register(id, provider, {
        description = null,
        tags = [],
        version = '1.0.0',
        scope = 'bot',
        dependencies = [],
        readiness = null,
        resultContract = 'operation-result-v1'
    } = {}) {
        if (this.sealed) throw new Error('CapabilityRegistry is sealed.');
        const capabilityId = this.#id(id);
        if (provider == null) throw new TypeError(`Capability provider is required: ${capabilityId}`);
        if (this.entries.has(capabilityId)) throw new Error(`Capability already registered: ${capabilityId}`);
        const parsedVersion = parseVersion(version);
        const normalizedScope = String(scope || '').trim();
        if (!['bot', 'connection', 'application'].includes(normalizedScope)) throw new TypeError(`Invalid capability scope: ${normalizedScope || '<empty>'}`);
        if (readiness !== null && typeof readiness !== 'function') throw new TypeError('Capability readiness must be a function or null.');
        const normalizedTags = [...new Set((Array.isArray(tags) ? tags : [tags]).map(value => String(value || '').trim()).filter(Boolean))].sort();
        const normalizedDependencies = Object.freeze((Array.isArray(dependencies) ? dependencies : [dependencies]).map(normalizeDependency).map(dep => Object.freeze({ id: this.#id(dep.id), version: dep.version })));
        this.entries.set(capabilityId, Object.freeze({
            id: capabilityId, provider, description: description == null ? null : String(description),
            tags: Object.freeze(normalizedTags), version: parsedVersion.text, scope: normalizedScope,
            dependencies: normalizedDependencies, readiness, resultContract: String(resultContract || 'operation-result-v1')
        }));
        return this;
    }

    alias(aliasId, targetId) {
        const target = this.requireEntry(targetId);
        return this.register(aliasId, target.provider, {
            description: target.description, tags: [...target.tags, 'alias'], version: target.version,
            scope: target.scope, dependencies: target.dependencies, readiness: target.readiness, resultContract: target.resultContract
        });
    }

    has(id) { const key = String(id || '').trim(); return Boolean(key && this.entries.has(key)); }
    get(id) { const entry = this.entries.get(String(id || '').trim()); return entry ? entry.provider : null; }

    require(id, options = null) {
        const entry = this.requireEntry(id);
        if (options?.version && !versionSatisfies(parseVersion(entry.version), options.version)) {
            const error = new Error(`Capability version mismatch: ${entry.id} provides ${entry.version}, requested ${options.version}`);
            error.code = 'CAPABILITY_VERSION_MISMATCH'; error.capabilityId = entry.id; error.actualVersion = entry.version; error.requiredVersion = options.version;
            if (this.botId) error.botId = this.botId;
            throw error;
        }
        if (options?.ready === true) {
            const state = this.readiness(entry.id);
            if (!state.ready) {
                const error = new Error(`Capability not ready: ${entry.id}${state.reason ? ` (${state.reason})` : ''}`);
                error.code = 'CAPABILITY_NOT_READY'; error.capabilityId = entry.id; error.readiness = state;
                if (this.botId) error.botId = this.botId;
                throw error;
            }
        }
        return entry.provider;
    }

    requireEntry(id) {
        const key = this.#id(id); const entry = this.entries.get(key);
        if (!entry) { const error = new Error(`Capability not available: ${key}`); error.code = 'CAPABILITY_NOT_AVAILABLE'; error.capabilityId = key; if (this.botId) error.botId = this.botId; throw error; }
        return entry;
    }

    missing(ids = []) { const requested = Array.isArray(ids) ? ids : [ids]; return [...new Set(requested.map(id => this.#id(typeof id === 'object' ? id.id : id)).filter(id => !this.entries.has(id)))].sort(); }

    assertAvailable(ids = [], context = 'operation') {
        const requested = Array.isArray(ids) ? ids : [ids];
        const missing = this.missing(requested);
        const incompatible = [];
        for (const raw of requested) {
            if (!raw || typeof raw !== 'object' || !raw.version || !this.has(raw.id)) continue;
            const entry = this.requireEntry(raw.id);
            if (!versionSatisfies(parseVersion(entry.version), raw.version)) incompatible.push({ id: entry.id, actual: entry.version, required: raw.version });
        }
        if (missing.length === 0 && incompatible.length === 0) return true;
        const error = new Error(`Capability requirements unmet for ${context}: ${[...missing, ...incompatible.map(item => `${item.id}@${item.required}`)].join(', ')}`);
        error.code = 'CAPABILITY_REQUIREMENTS_UNMET'; error.missingCapabilities = missing; error.incompatibleCapabilities = incompatible;
        if (this.botId) error.botId = this.botId; throw error;
    }

    readiness(id, seen = new Set()) {
        const entry = this.requireEntry(id);
        if (seen.has(entry.id)) return immutableClone({ id: entry.id, ready: false, reason: 'dependency-cycle', dependencies: [] });
        const nextSeen = new Set(seen); nextSeen.add(entry.id);
        const dependencies = entry.dependencies.map(dep => {
            if (!this.has(dep.id)) return { id: dep.id, ready: false, reason: 'missing' };
            const target = this.requireEntry(dep.id);
            if (dep.version && !versionSatisfies(parseVersion(target.version), dep.version)) return { id: dep.id, ready: false, reason: 'version-mismatch', actualVersion: target.version, requiredVersion: dep.version };
            return this.readiness(dep.id, nextSeen);
        });
        const blocked = dependencies.find(dep => dep.ready === false);
        if (blocked) return immutableClone({ id: entry.id, ready: false, reason: `dependency:${blocked.id}`, dependencies });
        let own = { ready: true, reason: null };
        if (entry.readiness) {
            try { const value = entry.readiness(); own = typeof value === 'boolean' ? { ready: value, reason: value ? null : 'provider' } : { ready: value?.ready !== false, reason: value?.reason || null }; }
            catch (error) { own = { ready: false, reason: error?.code || error?.message || 'readiness-error' }; }
        }
        return immutableClone({ id: entry.id, ready: Boolean(own.ready), reason: own.reason || null, dependencies });
    }

    list() {
        return [...this.entries.values()].map(entry => ({
            id: entry.id, description: entry.description, tags: [...entry.tags], version: entry.version,
            scope: entry.scope, dependencies: entry.dependencies.map(dep => ({ ...dep })), resultContract: entry.resultContract,
            readiness: this.readiness(entry.id)
        })).sort((left, right) => left.id.localeCompare(right.id));
    }

    snapshot() { return immutableClone({ botId: this.botId, sealed: this.sealed, capabilities: this.list() }); }

    seal() {
        for (const entry of this.entries.values()) {
            for (const dep of entry.dependencies) {
                if (!this.entries.has(dep.id)) throw Object.assign(new Error(`Capability dependency missing: ${entry.id} -> ${dep.id}`), { code: 'CAPABILITY_DEPENDENCY_MISSING', capabilityId: entry.id, dependencyId: dep.id });
                const target = this.entries.get(dep.id);
                if (dep.version && !versionSatisfies(parseVersion(target.version), dep.version)) throw Object.assign(new Error(`Capability dependency version mismatch: ${entry.id} -> ${dep.id}@${dep.version} (actual ${target.version})`), { code: 'CAPABILITY_DEPENDENCY_VERSION_MISMATCH', capabilityId: entry.id, dependencyId: dep.id });
            }
        }
        this.sealed = true; return this;
    }

    #id(value) { const id = String(value || '').trim(); if (!ID_PATTERN.test(id)) throw new TypeError(`Invalid capability id: ${id || '<empty>'}`); return id; }
}

module.exports = CapabilityRegistry;
module.exports.versionSatisfies = versionSatisfies;
