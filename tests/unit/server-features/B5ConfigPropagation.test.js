'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B5AutomationService = require('../../../src/server-features/crafting/CraftAutomationService');
const B5AutomationRuntimeDecorator = require('../../../src/server-features/crafting/B5AutomationRuntimeDecorator');
const StageExecutionContract = require('../../../src/server-features/crafting/verification/StageExecutionContract');

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
        operationManager: { run() {} }, config: { targetId: 'super_alloy', b2InputSource: 'storage' }, flows,
        craftingVerificationService: new StageExecutionContract()
    });
    return { service, b2Input, plan };
}

test('B5 service reconfigure propagates one cycle-boundary config to all extracted coordinators', () => {
    const { service, b2Input, plan } = serviceFixture();
    const next = { targetId: 'super_alloy', b2InputSource: 'inventory', inventorySafetyEmptySlots: 3 };
    const stored = service.reconfigure(next);
    // Slice 4/7: legacy b2InputSource is mapped to generic inputSource once at the
    // boundary; stored config stays generic-only while behavior (inventory) matches.
    assert.equal(stored.inputSource, 'inventory');
    assert.equal('b2InputSource' in stored, false);
    assert.equal(service.config, stored);
    assert.equal(service.inventoryState.config, stored);
    assert.equal(service.recipeResolver.config, stored);
    assert.equal(plan.config, stored);
    assert.equal(b2Input.source, 'inventory');
    assert.equal(service.b1Inventory.config, stored);
    assert.equal(service.finalCraft.config, stored);
    assert.equal(service.intermediate.config, stored);
    assert.equal(service.reserveChain.config, stored);
    assert.equal(service.cycle.config, stored);
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
