'use strict';

const { immutableClone } = require('../shared/utils/object');

const MODE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const CAPABILITY_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const RESOURCE_ID = /^[a-z][a-z0-9]*(?:[-.:][a-z0-9]+)*$/;

class ModeCatalog {
    constructor(definitions = []) {
        this.definitions = new Map();
        this.sealed = false;
        for (const definition of definitions) this.register(definition);
    }

    register(definition) {
        if (this.sealed) throw new Error('ModeCatalog is sealed.');
        const normalized = this.#definition(definition);
        if (this.definitions.has(normalized.id)) throw new Error(`Mode already registered: ${normalized.id}`);
        this.definitions.set(normalized.id, normalized);
        return this;
    }

    has(id) {
        return this.definitions.has(String(id || '').trim());
    }

    get(id) {
        const value = this.definitions.get(String(id || '').trim());
        return value ? immutableClone(value) : null;
    }

    require(id) {
        const modeId = String(id || '').trim();
        const value = this.definitions.get(modeId);
        if (!value) {
            const error = new Error(`Mode is not registered: ${modeId || '<empty>'}`);
            error.code = 'MODE_NOT_REGISTERED';
            error.modeId = modeId || null;
            throw error;
        }
        return immutableClone(value);
    }

    ids() {
        return [...this.definitions.keys()].sort();
    }

    list() {
        return this.ids().map(id => this.get(id));
    }

    snapshot() {
        return immutableClone({ sealed: this.sealed, modes: this.list() });
    }

    seal() {
        this.sealed = true;
        return this;
    }

    #definition(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Mode definition must be an object.');
        const id = String(value.id || '').trim();
        if (!MODE_ID.test(id)) throw new TypeError(`Invalid mode id: ${id || '<empty>'}`);
        const serviceName = String(value.serviceName || '').trim();
        if (!serviceName) throw new TypeError(`Mode ${id} serviceName is required.`);
        const label = String(value.label || id).trim() || id;
        const requiredCapabilities = this.#unique(value.requiredCapabilities, CAPABILITY_ID, 'capability');
        const requestedResources = this.#unique(value.requestedResources?.length ? value.requestedResources : ['primary-mode'], RESOURCE_ID, 'resource');
        return Object.freeze({
            id,
            serviceName,
            label,
            description: value.description == null ? null : String(value.description),
            primary: value.primary !== false,
            durable: value.durable !== false,
            requiredCapabilities: Object.freeze(requiredCapabilities),
            requestedResources: Object.freeze(requestedResources),
            metadata: Object.freeze({ ...(value.metadata || {}) })
        });
    }

    #unique(values, pattern, label) {
        const source = Array.isArray(values) ? values : values == null ? [] : [values];
        const normalized = source.map(value => String(value || '').trim()).filter(Boolean);
        for (const item of normalized) {
            if (!pattern.test(item)) throw new TypeError(`Invalid mode ${label} id: ${item}`);
        }
        return [...new Set(normalized)].sort();
    }
}

module.exports = ModeCatalog;
