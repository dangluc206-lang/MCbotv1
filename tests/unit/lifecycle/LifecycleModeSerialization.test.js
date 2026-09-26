'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const RuntimeModeRegistry = require('../../../src/modes/RuntimeModeRegistry');
const ModeCatalog = require('../../../src/modes/ModeCatalog');
const ManagedMode = require('../../../src/modes/ManagedMode');

function catalog() {
    return new ModeCatalog([{
        id: 'collector-b5',
        label: 'Collector B5',
        serviceName: 'collectorB5Mode',
        primary: true,
        requestedResources: ['primary-mode'],
        requiredCapabilities: []
    }]);
}

function capabilityRegistry() {
    return { missing: () => [], require: () => ({}), assertAvailable: () => true };
}

function modeContext(generationRef) {
    return {
        requireReadyCapabilities() {},
        requireCapabilities() {},
        subscriptions() { return { async close() { return []; }, add() {} }; },
        generation: () => generationRef.value
    };
}

class ProbeMode extends ManagedMode {
    async onEnable() {}
}

// I7: same-mode transitions serialize through the registry choke point.
test('registry serializes overlapping transitions for the same mode', async () => {
    const order = [];
    const slowService = {
        async enable() { order.push('enable-start'); await new Promise(r => setTimeout(r, 10)); order.push('enable-end'); return { success: true }; },
        async disable() { order.push('disable'); return { success: true }; },
        async pause() { order.push('pause-start'); await new Promise(r => setTimeout(r, 5)); order.push('pause-end'); return { success: true }; },
        async resume() { return { success: true }; },
        status: () => ({ enabled: true, paused: false })
    };
    const registry = new RuntimeModeRegistry({ botId: 'serial-bot', catalog: catalog(), capabilityRegistry: capabilityRegistry(), services: { collectorB5Mode: slowService } });
    const results = await Promise.all([
        registry.transition('collector-b5', 'enable'),
        registry.transition('collector-b5', 'pause')
    ]);
    assert.equal(results[0].success, true);
    assert.equal(results[1].success, true);
    assert.deepEqual(order, ['enable-start', 'enable-end', 'pause-start', 'pause-end']);
});

// I7: ManagedMode enable does not overwrite a pause that won during onEnable().
test('managed mode keeps PAUSED when pause wins during onEnable', async () => {
    const generationRef = { value: 1 };
    const coordinator = {
        acquire: modeId => ({ success: true, data: { leaseId: 'lease-1', modeId } }),
        pause: () => ({ success: true, data: {} }),
        resume: () => ({ success: true, data: {} }),
        release: () => ({ success: true, data: {} }),
        isHeldBy: () => true
    };
    const mode = new ProbeMode({ modeId: 'collector-b5', botId: 'phase-bot', modeContext: modeContext(generationRef), modeCoordinator: coordinator, catalog: catalog() });
    mode.onEnable = async () => { await mode.pause('race'); };
    const result = await mode.enable();
    assert.equal(result.success, true);
    assert.equal(mode.paused, true);
    assert.equal(mode.phase, 'PAUSED');
});

// I8: ManagedMode adopts the current generation via refreshGeneration().
test('managed mode refreshGeneration adopts the reconnected generation', async () => {
    const generationRef = { value: 1 };
    const coordinator = {
        acquire: modeId => ({ success: true, data: { leaseId: 'lease-1', modeId } }),
        pause: () => ({ success: true, data: {} }),
        resume: () => ({ success: true, data: {} }),
        release: () => ({ success: true, data: {} }),
        isHeldBy: () => true
    };
    const mode = new ProbeMode({ modeId: 'collector-b5', botId: 'gen-bot', modeContext: modeContext(generationRef), modeCoordinator: coordinator, catalog: catalog() });
    const enabled = await mode.enable();
    assert.equal(enabled.success, true);
    assert.equal(mode.status().activeGeneration, 1);
    generationRef.value = 2;
    assert.equal(mode.refreshGeneration(), 2);
    assert.equal(mode.status().activeGeneration, 2);
});
