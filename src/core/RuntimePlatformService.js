'use strict';

const { immutableClone } = require('../shared/utils/object');

class RuntimePlatformService {
    constructor({ botId, capabilityRegistry, modeRegistry, modeCoordinator, operationManager, healthRegistry, eventBus } = {}) {
        if (typeof botId !== 'string' || !botId.trim()) throw new TypeError('RuntimePlatformService botId is required.');
        if (!capabilityRegistry?.snapshot || !modeRegistry?.status || !modeCoordinator?.snapshot || !operationManager?.snapshot) {
            throw new TypeError('RuntimePlatformService requires capability, mode and operation platform services.');
        }
        this.botId = botId.trim();
        this.capabilityRegistry = capabilityRegistry;
        this.modeRegistry = modeRegistry;
        this.modeCoordinator = modeCoordinator;
        this.operationManager = operationManager;
        this.healthRegistry = healthRegistry;
        this.eventBus = eventBus;
    }

    snapshot() {
        return immutableClone({
            botId: this.botId,
            capabilities: this.capabilityRegistry.snapshot(),
            modes: this.modeRegistry.status(),
            resources: this.modeCoordinator.snapshot(),
            operations: this.operationManager.snapshot(),
            events: this.eventBus?.scopeSnapshot?.() || null
        });
    }

    async health() {
        return this.healthRegistry?.snapshot?.() || immutableClone({ botId: this.botId, state: 'UNKNOWN', checks: [] });
    }

    async inspect() {
        const snapshot = this.snapshot();
        const health = await this.health();
        return immutableClone({ ...snapshot, health });
    }
}

module.exports = RuntimePlatformService;
