'use strict';

const { immutableClone } = require('../shared/utils/object');
const ServerProfileReadinessError = require('./ServerProfileReadinessError');

const SECRET_FIELD_NAMES = new Set(['password', 'token', 'accesstoken', 'refreshtoken', 'secret', 'apikey', 'authorization', 'sessiontoken']);
function assertSecretFree(value, path = 'profile', seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
        const normalized = String(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
        if (SECRET_FIELD_NAMES.has(normalized)) throw new TypeError(`ServerProfile must not contain credential material: ${path}.${key}`);
        assertSecretFree(child, `${path}.${key}`, seen);
    }
}

function id(value, label) {
    const text = String(value || '').trim();
    if (!text || !/^[a-z0-9][a-z0-9._-]*$/i.test(text)) throw new TypeError(`${label} must be a stable identifier`);
    return text;
}

class ServerProfile {
    constructor({ id: profileId, revision, implementation = 'generic', endpoint, catalogs = {}, bindings = {}, capabilities = {} }) {
        assertSecretFree({ endpoint, catalogs, bindings });
        this.id = id(profileId, 'ServerProfile id');
        this.revision = id(revision, 'ServerProfile revision');
        this.implementation = id(implementation, 'ServerProfile implementation');
        if (!endpoint || typeof endpoint !== 'object' || !String(endpoint.host || '').trim()) {
            throw new TypeError('ServerProfile endpoint.host is required');
        }
        this.endpoint = immutableClone(endpoint);
        this.catalogs = immutableClone(catalogs || {});
        this.bindings = immutableClone(bindings || {});
        this.capabilities = immutableClone(capabilities || {});
        Object.freeze(this);
    }

    getCatalog(key) { return this.catalogs?.[key] ?? null; }
    getBinding(key) { return this.bindings?.[key] ?? null; }
    supports(capabilityId) { return this.capabilities?.[capabilityId] === true; }

    requireCatalog(key) {
        const value = this.getCatalog(key);
        if (value !== null && value !== undefined) return value;
        throw new ServerProfileReadinessError(`Server profile catalog is missing: ${key}`, {
            profileId: this.id, profileRevision: this.revision, missing: `catalog:${key}`
        });
    }

    requireBinding(key) {
        const value = this.getBinding(key);
        if (value !== null && value !== undefined) return value;
        throw new ServerProfileReadinessError(`Server profile binding is missing: ${key}`, {
            profileId: this.id, profileRevision: this.revision, missing: `binding:${key}`
        });
    }

    requireCapability(capabilityId) {
        if (this.supports(capabilityId)) return true;
        throw new ServerProfileReadinessError(`Server profile capability is unsupported: ${capabilityId}`, {
            profileId: this.id, profileRevision: this.revision, missing: `capability:${capabilityId}`
        });
    }

    descriptor() {
        return immutableClone({
            id: this.id,
            revision: this.revision,
            implementation: this.implementation,
            endpoint: this.endpoint,
            catalogs: Object.keys(this.catalogs || {}).sort(),
            bindings: Object.keys(this.bindings || {}).sort(),
            capabilities: Object.keys(this.capabilities || {}).filter(key => this.capabilities[key] === true).sort()
        });
    }
}

module.exports = ServerProfile;
