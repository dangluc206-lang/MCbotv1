'use strict';

const ConfigRegistryError = require('./errors/ConfigRegistryError');
const { immutableClone } = require('../shared/utils/object');

class ConfigRegistry {
    constructor() {
        this.values = new Map();
    }

    register(key, value, { replace = false } = {}) {
        this.#key(key);
        if (this.values.has(key) && !replace) {
            throw new ConfigRegistryError(`Configuration key already exists: ${key}`, {
                code: 'CONFIG_KEY_ALREADY_EXISTS',
                key
            });
        }
        const next = new Map(this.values);
        next.set(key, immutableClone(value));
        this.values = next;
        return this.get(key);
    }

    replaceAll(values) {
        const entries = values instanceof Map
            ? [...values.entries()]
            : Object.entries(values || {});
        const next = new Map();
        for (const [key, value] of entries) {
            this.#key(key);
            if (next.has(key)) {
                throw new ConfigRegistryError(`Configuration key is duplicated: ${key}`, {
                    code: 'CONFIG_KEY_ALREADY_EXISTS',
                    key
                });
            }
            next.set(key, immutableClone(value));
        }
        this.values = next;
        return this.snapshot();
    }

    snapshot() {
        return immutableClone(Object.fromEntries(this.values));
    }

    has(key) {
        return this.values.has(key);
    }

    get(key) {
        return this.values.has(key) ? immutableClone(this.values.get(key)) : null;
    }

    require(key) {
        const value = this.get(key);
        if (value === null) {
            throw new ConfigRegistryError(`Configuration key not found: ${key}`, {
                code: 'CONFIG_KEY_NOT_FOUND',
                key
            });
        }
        return value;
    }

    keys() {
        return [...this.values.keys()];
    }

    clear() {
        this.values = new Map();
    }

    #key(key) {
        if (typeof key !== 'string' || !key.trim()) {
            throw new ConfigRegistryError('Configuration key must be a non-empty string.', {
                code: 'CONFIG_KEY_INVALID',
                key
            });
        }
    }
}

module.exports = ConfigRegistry;
