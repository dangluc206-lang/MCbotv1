'use strict';

const ManagedMode = require('./ManagedMode');
const { immutableClone } = require('../shared/utils/object');

class ModeSdk {
    constructor({ botId, catalog, modeContext, modeRegistry, modeControl, capabilityRegistry } = {}) {
        if (typeof botId !== 'string' || !botId.trim()) throw new TypeError('ModeSdk botId is required.');
        if (!catalog?.require || !catalog?.list) throw new TypeError('ModeSdk catalog is required.');
        if (!modeContext?.capability) throw new TypeError('ModeSdk modeContext is required.');
        if (!modeRegistry?.status) throw new TypeError('ModeSdk modeRegistry is required.');
        if (!modeControl?.status) throw new TypeError('ModeSdk modeControl is required.');
        if (!capabilityRegistry?.snapshot) throw new TypeError('ModeSdk capabilityRegistry is required.');
        this.botId = botId.trim();
        this.catalog = catalog;
        this.context = modeContext;
        this.registry = modeRegistry;
        this.control = modeControl;
        this.capabilities = capabilityRegistry;
        this.ManagedMode = ManagedMode;
    }

    definition(modeId) {
        return this.catalog.require(modeId);
    }

    baseOptions(modeId, { modeCoordinator, logger = null } = {}) {
        if (!modeCoordinator?.acquire) throw new TypeError('ModeSdk baseOptions requires modeCoordinator.');
        this.catalog.require(modeId);
        return Object.freeze({
            modeId,
            botId: this.botId,
            modeContext: this.context,
            modeCoordinator,
            catalog: this.catalog,
            logger
        });
    }

    snapshot() {
        return immutableClone({
            botId: this.botId,
            catalog: this.catalog.snapshot?.() || { modes: this.catalog.list() },
            runtime: this.registry.status(),
            capabilities: this.capabilities.snapshot()
        });
    }
}

ModeSdk.ManagedMode = ManagedMode;
module.exports = ModeSdk;
