'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CraftAutomationService = require('../../../src/server-features/crafting/CraftAutomationService');
const CraftAutomationRuntimeDecorator = require('../../../src/server-features/crafting/CraftAutomationRuntimeDecorator');
const StageExecutionContract = require('../../../src/server-features/crafting/verification/StageExecutionContract');

function serviceFixture() {
    const b2Input = {
        source: 'storage',
        reconfigure({ source }) { this.source = source; }
    };
    const flows = {
        read: {}, storage: { returnBaseInventory() {} }, b2Input,
        deposit: {}, withdraw: {}, craft: {}
    };
    const service = new CraftAutomationService({
        planningService: {}, crafting: {}, personalVault: {}, storage: {}, b1Materials: {},
        inventoryReader: { snapshot() { return { items: [], emptySlotCount: 36 }; } },
        inventoryCounter: { count() { return 0; } },
        recipeRegistry: { require() { return { inputs: {} }; } },
        operationManager: { run() {} }, config: { inputSource: 'storage' }, flows,
        craftingVerificationService: new StageExecutionContract()
    });
    return { service, b2Input };
}

test('crafting service reconfigure propagates one cycle-boundary config to all generic coordinators', () => {
    const { service, b2Input } = serviceFixture();
    const next = { inputSource: 'inventory', inventorySafetyEmptySlots: 3 };
    const stored = service.reconfigure(next);
    // G3/G4: generic-only config, no B5 vocabulary; one path, no legacyCycle.
    assert.equal(stored.inputSource, 'inventory');
    assert.equal('b2InputSource' in stored, false);
    assert.equal('legacyCycle' in service, false);
    assert.equal(service.config, stored);
    assert.equal(service.inventoryState.config, stored);
    assert.equal(service.recipeResolver.config, stored);
    assert.equal(b2Input.source, 'inventory');
    assert.equal(service.baseInventory.config, stored);
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
    const decorator = new CraftAutomationRuntimeDecorator({ service });
    const next = { inputSource: 'inventory' };
    assert.equal(decorator.reconfigure(next), next);
    assert.equal(calls, 1);
    assert.equal(service.applied, next);
});
