'use strict';

const { immutableClone } = require('../../shared/utils/object');

const REQUIRED_METHODS = Object.freeze(['enable', 'disable', 'pause', 'resume', 'status']);

class LegacyModeAdapter {
    constructor({ modeId, service, modeContext, requiredCapabilities = [] } = {}) {
        if (typeof modeId !== 'string' || !modeId.trim()) throw new TypeError('LegacyModeAdapter modeId is required.');
        if (!service || typeof service !== 'object') throw new TypeError('LegacyModeAdapter service is required.');
        const missing = REQUIRED_METHODS.filter(method => typeof service[method] !== 'function');
        if (missing.length) throw new TypeError(`Legacy mode ${modeId} is missing methods: ${missing.join(', ')}`);
        if (!modeContext?.requireReadyCapabilities || !modeContext?.generation) throw new TypeError('LegacyModeAdapter modeContext is required.');

        this.modeId = modeId.trim();
        this.service = service;
        this.modeContext = modeContext;
        this.requiredCapabilities = Object.freeze([...new Set((requiredCapabilities || []).map(String).map(value => value.trim()).filter(Boolean))].sort());
    }

    async enable() {
        this.#assertReady('enable');
        return this.service.enable();
    }

    async disable(reason) {
        return this.service.disable(reason);
    }

    async pause(reason) {
        return this.service.pause(reason);
    }

    async resume() {
        this.#assertReady('resume');
        return this.service.resume();
    }

    reconfigure(...args) {
        if (typeof this.service.reconfigure !== 'function') {
            const error = new Error(`Legacy mode ${this.modeId} does not support reconfigure.`);
            error.code = 'MODE_RECONFIGURE_UNSUPPORTED';
            throw error;
        }
        return this.service.reconfigure(...args);
    }

    publicConfig(...args) {
        if (typeof this.service.publicConfig !== 'function') {
            const error = new Error(`Legacy mode ${this.modeId} does not expose publicConfig.`);
            error.code = 'MODE_PUBLIC_CONFIG_UNSUPPORTED';
            throw error;
        }
        return immutableClone(this.service.publicConfig(...args));
    }

    status() {
        const legacy = this.service.status();
        const body = legacy && typeof legacy === 'object' && !Array.isArray(legacy) ? legacy : { value: legacy };
        return immutableClone({
            ...body,
            modeAdapter: {
                kind: 'legacy-strangler-v1',
                modeId: this.modeId,
                requiredCapabilities: [...this.requiredCapabilities],
                connectionGeneration: this.modeContext.generation()
            }
        });
    }

    #assertReady(action) {
        this.modeContext.requireReadyCapabilities(this.requiredCapabilities, `legacy mode ${this.modeId}:${action}`);
    }
}

LegacyModeAdapter.REQUIRED_METHODS = REQUIRED_METHODS;
module.exports = LegacyModeAdapter;
