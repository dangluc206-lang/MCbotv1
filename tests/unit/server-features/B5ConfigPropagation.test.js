'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B5AutomationService = require('../../../src/server-features/crafting/B5AutomationService');
const B5AutomationRuntimeDecorator = require('../../../src/server-features/crafting/B5AutomationRuntimeDecorator');

function serviceFixture() {
    const b2Input = {
        source: 'storage',
        reconfigure({ source }) { this.source = source; }
    };
    const plan = { reconfigure(config) { this.config = config; }, planChain() { return {}; } };
    const flows = {
        read: {}, plan, storage: { returnBaseInventory() {} }, b2Input,
        deposit: {}, withdraw: {}, craft: {}
    };
    const service = new B5AutomationService({
        planningService: {}, crafting: {}, personalVault: {}, storage: {}, b1Materials: {},
        inventoryReader: { snapshot() { return { items: [], emptySlotCount: 36 }; } },
        inventoryCounter: { count() { return 0; } },
        recipeRegistry: { require() { return { inputs: {} }; } },
        operationManager: { run() {} }, config: { targetId: 'super_alloy', b2InputSource: 'storage' }, flows
    });
    return { service, b2Input, plan };
}

test('B5 service reconfigure propagates one cycle-boundary config to all extracted coordinators', () => {
    const { service, b2Input, plan } = serviceFixture();
    const next = { targetId: 'super_alloy', b2InputSource: 'inventory', inventorySafetyEmptySlots: 3 };
    service.reconfigure(next);
    assert.equal(service.config, next);
    assert.equal(service.inventoryState.config, next);
    assert.equal(service.recipeResolver.config, next);
    assert.equal(plan.config, next);
    assert.equal(b2Input.source, 'inventory');
    assert.equal(service.b1Inventory.config, next);
    assert.equal(service.finalCraft.config, next);
    assert.equal(service.intermediate.config, next);
    assert.equal(service.reserveChain.config, next);
    assert.equal(service.cycle.config, next);
});

test('runtime decorator delegates reconfigure to the service boundary exactly once', () => {
    let calls = 0;
    const service = {
        runNext() {}, status() {},
        reconfigure(config) { calls += 1; this.applied = config; return config; }
    };
    const decorator = new B5AutomationRuntimeDecorator({ service });
    const next = { b2InputSource: 'inventory' };
    assert.equal(decorator.reconfigure(next), next);
    assert.equal(calls, 1);
    assert.equal(service.applied, next);
});
