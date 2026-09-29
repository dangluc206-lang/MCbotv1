'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CraftPlanningService = require('../../../src/server-features/crafting/CraftPlanningService');
const B5PlanningService = require('../../../src/server-features/crafting/B5PlanningService');
const CraftAutomationService = require('../../../src/server-features/crafting/CraftAutomationService');
const CraftTraceRecorder = require('../../../src/server-features/crafting/CraftTraceRecorder');
const ServerFeatureFacade = require('../../../src/server-features/ServerFeatureFacade');
const CraftingRecipeRegistry = require('../../../src/server-features/crafting/CraftingRecipeRegistry');
const MaterialCalculator = require('../../../src/planning/crafting/MaterialCalculator');
const CraftingPlanner = require('../../../src/planning/crafting/CraftingPlanner');
function createPlanning(inputSource = 'storage', inventoryB1 = 0) {
    const recipes = { b2: { output: 'b2', outputAmount: 1, inputs: { b1: 16 } }, b3: { output: 'b3', outputAmount: 1, inputs: { b2: 16 } }, b5: { output: 'b5', outputAmount: 1, inputs: { b3: 2 } } };
    const recipeRegistry = new CraftingRecipeRegistry(recipes);
    const materialCalculator = new MaterialCalculator({ recipeRegistry });
    const planner = new CraftingPlanner({ recipeRegistry, materialCalculator });
    const tiers = { B1: ['b1'], B2: ['b2'], B3: ['b3'], B4: [], B5: ['b5'] };
    const readFlows = { storage: { read: async () => ({ success: true, data: { items: { b1: 256 } } }) }, personalVault: { read: async () => ({ success: true, data: { totals: {} } }) }, inventory: { readViews: () => [] } };
    return new CraftPlanningService({ planner, materialCalculator, recipeRegistry, tiers, readFlows, inventoryCounter: { count: () => 0 }, config: { supplyMode: 'continuous', inputSource, vaultBackpressure: {} } });
}

test('slice6: CraftTraceRecorder keeps legacy id + generic fields', () => {
    const recorder = new CraftTraceRecorder({ botId: 'bot-01', historyLimit: 10 });
    // Generic owns the implementation (no B5 alias needed for parity).
    assert.equal(recorder.constructor.name, 'CraftTraceRecorder');
    assert.equal(recorder instanceof CraftTraceRecorder, true);
    const record = recorder.recordResult({
        success: true, status: 'SUCCESS',
        data: { targetId: 'carbon', productive: true, completedTarget: false, blockingReasons: [], actionSummary: {}, plan: null },
        meta: { operationId: 'bot-01:1', connectionGeneration: 3, trace: [] }
    }, { targetId: 'carbon' });
    assert.equal(record.traceId, 'bot-01:b5:1');
    assert.equal(record.targetId, 'carbon');
    assert.ok(String(record.craftTraceId).includes(':craft:'));
});
test('slice4: CraftAutomationService same engine + fail-closed', async () => {
    // Generic owns the implementation (no B5 alias needed for parity).
    assert.equal(CraftAutomationService.name, 'CraftAutomationService');
    assert.equal(typeof CraftAutomationService.normalizeAutomationConfig, 'function');
    assert.ok(Object.prototype.hasOwnProperty.call(CraftAutomationService, 'normalizeAutomationConfig'));
    const automation = new CraftAutomationService({
        planningService: { async inspectAdditional() { throw new Error('x'); }, async inspectAdditionalFresh() { throw new Error('x'); } },
        crafting: { async craft() { throw new Error('x'); } },
        personalVault: { async read() { throw new Error('x'); }, async withdraw() { throw new Error('x'); }, async deposit() { throw new Error('x'); } },
        storage: {}, b1Materials: {},
        inventoryReader: { read: () => ({}) }, inventoryCounter: { count: () => 0 },
        recipeRegistry: { require: id => ({ output: id, inputs: {} }) },
        operationManager: { async run() { throw new Error('x'); } }, config: {},
        craftingVerificationService: { requireInputReady() {}, handoff: () => ({ ready: true }), verifyOutput() {}, requireSettled() {} },
        flows: { read: {}, plan: {}, storage: {}, b2Input: {}, deposit: {}, withdraw: {}, craft: {} }
    });
    const result = await automation.runTarget({});
    assert.equal(result.success, false);
    assert.equal(result.status, 'INVALID_INPUT');
});
test('slice6: facade craftingTrace/b5Trace same instance', () => {
    const recorder = new CraftTraceRecorder({ botId: 'bot-01' });
    assert.equal(recorder.constructor.name, 'CraftTraceRecorder');
    const facade = new ServerFeatureFacade({ craftingTrace: recorder });
    assert.equal(facade.craftingTrace(), recorder);
    assert.equal(facade.b5Trace(), recorder);
});
test('slice4: automation reconfigure maps legacy input source', () => {
    const normalized = CraftAutomationService.normalizeAutomationConfig({ b2InputSource: 'inventory', inputSource: 'storage' }, { inputSource: 'storage' });
    assert.equal(normalized.inputSource, 'storage');
    assert.equal('b2InputSource' in normalized, false);
    assert.equal(CraftAutomationService.normalizeAutomationConfig({ b2InputSource: 'inventory' }, {}).inputSource, 'inventory');
});
test('slice3: legacy B5 view plans request targetId', async () => {
    const planning = createPlanning('inventory', 64);
    const b5 = new B5PlanningService({ planning, tiers: { B1: ['b1'], B2: ['b2'], B3: ['b3'], B4: [], B5: ['b5'] }, targetId: 'b5' });
    const legacy = await b5.inspectAdditional(1, { targetId: 'carbon' });
    const generic = await planning.inspectAdditional('carbon', 1);
    assert.equal(legacy.data.fullPlan.targetId, 'carbon');
    assert.deepEqual(legacy.data.fullPlan, generic.data.fullPlan);
});
test('slice5: generic run/runNext fail closed without targetId', async () => {
    const planning = createPlanning('storage', 0);
    const b5 = new B5PlanningService({ planning, tiers: { B1: ['b1'], B2: ['b2'], B3: ['b3'], B4: [], B5: ['b5'] }, targetId: 'b5' });
    const automation = new CraftAutomationService({
        planningService: planning,
        crafting: { async craft() { throw new Error('must not craft without inspection'); } },
        personalVault: { async read() { throw new Error('x'); }, async withdraw() { throw new Error('x'); }, async deposit() { throw new Error('x'); } },
        storage: {}, b1Materials: {},
        inventoryReader: { read: () => ({}) }, inventoryCounter: { count: () => 0 },
        recipeRegistry: { require: id => ({ output: id, inputs: {} }) },
        operationManager: { async run() { throw new Error('x'); } }, config: {},
        craftingVerificationService: { requireInputReady() {}, handoff: () => ({ ready: true }), verifyOutput() {}, requireSettled() {} },
        flows: {
            read: { planningService: planning },
            plan: {}, storage: {}, b2Input: {}, deposit: {}, withdraw: {}, craft: {}
        }
    });
    assert.equal(typeof automation.planningService.plan, 'function', 'generic automation must hold CraftPlanningService (plan authority)');
    assert.equal(automation.planningService, planning);
    assert.notEqual(automation.planningService, b5, 'generic automation must not hold the B5 compat view');
    const legacy = await b5.inspectAdditional(1, { targetId: 'b5' });
    const generic = await planning.inspectAdditional('b5', 1);
    assert.equal(legacy.success, true);
    assert.equal(generic.success, true);
    assert.deepEqual(legacy.data.fullPlan, generic.data.fullPlan);
    const closed = await automation.runTarget({});
    assert.equal(closed.success, false);
    assert.equal(closed.status, 'INVALID_INPUT');
    for (const options of [{}, { targetId: null }, { targetId: '' }, { targetId: '   ' }]) {
        const next = await automation.runNext(options);
        assert.equal(next.success, false);
        assert.equal(next.status, 'INVALID_INPUT');
        assert.equal(next.error?.code, 'CRAFT_TARGET_REQUIRED');
        const run = await automation.run(1, options);
        assert.equal(run.success, false);
        assert.equal(run.status, 'INVALID_INPUT');
        assert.equal(run.error?.code, 'CRAFT_TARGET_REQUIRED');
    }
});
test('slice5: composition root injects CraftPlanningService into generic automation', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/bootstrap/registerBotServices.js'), 'utf8');
    assert.match(source, /planningService:\s*craftPlanning/);
    assert.equal(/planningService:\s*b5Planning/.test(source), false);
    const automationSource = fs.readFileSync(path.resolve(__dirname, '../../../src/server-features/crafting/CraftAutomationService.js'), 'utf8');
    assert.equal(automationSource.includes('B5PlanningService'), false);
});
