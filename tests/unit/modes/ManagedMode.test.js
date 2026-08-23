'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ManagedMode = require('../../../src/modes/ManagedMode');
const ModeCatalog = require('../../../src/modes/ModeCatalog');
const ModeCoordinator = require('../../../src/modes/ModeCoordinator');
const ModeContext = require('../../../src/modes/ModeContext');
const CapabilityRegistry = require('../../../src/core/registry/CapabilityRegistry');
const EventBus = require('../../../src/core/EventBus');

class ExampleMode extends ManagedMode {
    constructor(options) { super(options); this.hooks = []; this.value = 0; }
    async onEnable() { this.hooks.push('enable'); this.subscriptions.add(() => this.hooks.push('cleanup')); this.value += 1; }
    async onPause() { this.hooks.push('pause'); }
    async onResume() { this.hooks.push('resume'); }
    async onDisable() { this.hooks.push('disable'); }
    statusDetails() { return { value: this.value }; }
}

function harness() {
    const catalog = new ModeCatalog([{ id: 'mining', serviceName: 'miningMode', label: 'Mining', requiredCapabilities: ['movement'] }]).seal();
    const capabilities = new CapabilityRegistry({ botId: 'bot-01' }).register('movement', {}).seal();
    const eventBus = new EventBus();
    const botContext = { has: () => true, getGeneration: () => 3 };
    const modeContext = new ModeContext({
        botId: 'bot-01', botContext, capabilityRegistry: capabilities, eventBus,
        operationManager: { run: (...args) => args }
    });
    const coordinator = new ModeCoordinator({ botId: 'bot-01' });
    return { catalog, modeContext, coordinator };
}

test('ManagedMode owns capability checks, leases, lifecycle hooks, cleanup and status', async () => {
    const { catalog, modeContext, coordinator } = harness();
    await coordinator.initialize();
    await coordinator.start();
    const mode = new ExampleMode({ modeId: 'mining', botId: 'bot-01', modeContext, modeCoordinator: coordinator, catalog });
    assert.equal((await mode.enable()).success, true);
    assert.equal(mode.status().phase, 'RUNNING');
    assert.equal(mode.status().details.value, 1);
    assert.equal(coordinator.owner().modeId, 'mining');
    assert.equal((await mode.pause()).success, true);
    assert.equal(mode.status().paused, true);
    assert.equal((await mode.resume()).success, true);
    assert.equal(mode.status().paused, false);
    assert.equal((await mode.disable()).success, true);
    assert.equal(coordinator.owner(), null);
    assert.deepEqual(mode.hooks, ['enable', 'pause', 'resume', 'disable', 'cleanup']);
});

test('ManagedMode fails closed before lease acquisition when capabilities are missing', async () => {
    const catalog = new ModeCatalog([{ id: 'mining', serviceName: 'miningMode', requiredCapabilities: ['mining'] }]).seal();
    const capabilities = new CapabilityRegistry({ botId: 'bot-01' }).register('movement', {}).seal();
    const eventBus = new EventBus();
    const modeContext = new ModeContext({
        botId: 'bot-01', botContext: { has: () => true, getGeneration: () => 1 }, capabilityRegistry: capabilities, eventBus,
        operationManager: { run() {} }
    });
    const coordinator = new ModeCoordinator({ botId: 'bot-01' });
    await coordinator.initialize(); await coordinator.start();
    const mode = new ExampleMode({ modeId: 'mining', botId: 'bot-01', modeContext, modeCoordinator: coordinator, catalog });
    const result = await mode.enable();
    assert.equal(result.success, false);
    assert.equal(result.status, 'NOT_READY');
    assert.equal(coordinator.owner(), null);
});
