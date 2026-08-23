'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const RuntimePlatformService = require('../../../src/core/RuntimePlatformService');

test('RuntimePlatformService aggregates stable introspection contracts', async () => {
    const service = new RuntimePlatformService({
        botId: 'bot-01',
        capabilityRegistry: { snapshot: () => ({ capabilities: [{ id: 'movement' }] }) },
        modeRegistry: { status: () => ({ modes: [{ definition: { id: 'mining' } }] }) },
        modeCoordinator: { snapshot: () => ({ leases: [] }) },
        operationManager: { snapshot: () => ({ active: 0 }) },
        healthRegistry: { snapshot: async () => ({ state: 'HEALTHY', checks: [] }) },
        eventBus: { scopeSnapshot: () => ({ connectionScopedEvents: ['mode:mining:block'] }) }
    });
    const inspected = await service.inspect();
    assert.equal(inspected.botId, 'bot-01');
    assert.equal(inspected.capabilities.capabilities[0].id, 'movement');
    assert.equal(inspected.modes.modes[0].definition.id, 'mining');
    assert.equal(inspected.health.state, 'HEALTHY');
    assert.deepEqual(inspected.events.connectionScopedEvents, ['mode:mining:block']);
});
