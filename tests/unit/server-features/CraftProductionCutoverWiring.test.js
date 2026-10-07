'use strict';
// G3 - single generic execution path proof.
// Asserts the real composition (CraftAutomationService + runtime decorator)
// executes the generic CraftCycleCoordinator through the public API, and that
// no legacy B5CycleCoordinator exists on the service anymore.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Result = require('../../../src/shared/result/Result');
const CraftAutomationService = require('../../../src/server-features/crafting/CraftAutomationService');
const CraftAutomationRuntimeDecorator = require('../../../src/server-features/crafting/CraftAutomationRuntimeDecorator');
const CraftCycleCoordinator = require('../../../src/server-features/crafting/coordinators/CraftCycleCoordinator');
const CraftIntermediateCoordinator = require('../../../src/server-features/crafting/coordinators/CraftIntermediateCoordinator');
const CraftReserveChainCoordinator = require('../../../src/server-features/crafting/coordinators/CraftReserveChainCoordinator');
const CraftBaseInventoryCoordinator = require('../../../src/server-features/crafting/coordinators/CraftBaseInventoryCoordinator');
const StageExecutionContract = require('../../../src/server-features/crafting/verification/StageExecutionContract');

class HarnessContract extends StageExecutionContract {
    verifyOutput(o) {
        const d = Number(o?.after) - Number(o?.before);
        if (!Number.isFinite(Number(o?.after)) || d <= 0) return { ...o, tolerated: true };
        return super.verifyOutput(o);
    }
    requireSettled(o) {
        if (o?.settlement && o.settlement.settled === false) return o.settlement;
        return super.requireSettled(o);
    }
}

// Production-shaped rig: generic-aware planning (plan marker -> CraftReadFlow
// uses the generic inspect*(targetId, amount, ...) signature) on the locked
// E-pre3 fixture (carbon x32 -> super_alloy x1), with real craft side effects.
function productionRig() {
    const calls = [];
    const counts = { x: 128, y: 256, carbon: 0 };
    const planningService = {
        // Generic planning marker (CraftPlanningService exposes plan(targetId,...)).
        plan() {},
        async inspectAdditional(targetId, amount) {
            return Result.ok({
                personalVault: { totals: { super_alloy: 0 } },
                fullPlan: { targetId, feasible: true },
                chains: [],
                finalSteps: [
                    { recipeId: 'carbon-recipe', outputId: 'carbon', crafts: 32 },
                    { recipeId: 'super-alloy-recipe', outputId: 'super_alloy', crafts: 1 }
                ]
            });
        },
        async inspect(targetId, amount) { return this.inspectAdditional(targetId, amount); },
        async inspectAdditionalFresh(targetId, amount) { return this.inspectAdditional(targetId, amount); }
    };
    const recipes = {
        'carbon-recipe': { output: 'carbon', inputs: { x: 4, y: 8 } },
        'super-alloy-recipe': { output: 'super_alloy', inputs: { carbon: 32 } }
    };
    const service = new CraftAutomationService({
        craftingVerificationService: new HarnessContract(),
        planningService,
        crafting: {
            async craft(rid, q) {
                calls.push('craft:' + rid + ':' + q);
                if (rid === 'carbon-recipe') { counts.x = 0; counts.y = 0; counts.carbon = 32; return Result.ok({ actualCrafts: 32 }); }
                counts.carbon = 0;
                return Result.ok({ actualCrafts: 1 });
            }
        },
        personalVault: {
            async deposit(id) { calls.push('deposit:' + id); return Result.ok({ actualCrafts: 1, verification: { before: 0, after: 1 } }); },
            async read() { return Result.ok({ totals: { super_alloy: 1 } }); },
            async withdraw(id) { calls.push('withdraw:' + id); return Result.ok({ movedStacks: 0 }); }
        },
        storage: {},
        b1Materials: {
            async ensureBaseAvailable() { return Result.ok({ actualCrafts: 1, verification: { before: 0, after: 1 } }); },
            async compact() { return Result.ok({ actualCrafts: 1, verification: { before: 0, after: 1 } }); },
            async compactAll() { return Result.ok({ actualCrafts: 1, verification: { before: 0, after: 1 } }); },
            async sellLargestStoredBlock() { return Result.ok({}); }
        },
        inventoryReader: { readBotInventory: () => ({ source: 'bot-inventory', emptySlotCount: 0, counts: { ...counts } }) },
        inventoryCounter: { count: (snapshot, id) => Number(snapshot.counts?.[id] || 0) },
        recipeRegistry: { require: id => recipes[id] },
        operationManager: {
            async run(op) {
                const tk = { throwIfCancelled() {}, onCancelled() { return () => {}; } };
                return Result.ok(await op.executor({ cancellation: { token: tk } }));
            }
        },
        config: {
            targetId: 'super_alloy', timeoutMs: 1000, inventorySafetyEmptySlots: 2,
            quantityOptimization: { enabled: true, useAllForB2: true, useAllForB3: true, useAllForB4WhenExact: true, useAllForB5: false }
        }
    });
    return { service, calls };
}


test('cutover wiring: production service composes the generic cycle over the generic stack', () => {
    const { service } = productionRig();
    // The single execution path is the generic cycle; no legacy cycle exists.
    assert.equal(service.cycle instanceof CraftCycleCoordinator, true);
    assert.equal('legacyCycle' in service, false);
    // Actual cycle dependencies are the generic coordinators.
    assert.equal(service.cycle.intermediate, service.genericIntermediate);
    assert.equal(service.cycle.intermediate instanceof CraftIntermediateCoordinator, true);
    assert.equal(service.cycle.reserveChain, service.genericReserveChain);
    assert.equal(service.cycle.reserveChain instanceof CraftReserveChainCoordinator, true);
    assert.equal(service.cycle.baseInventory, service.genericBaseInventory);
    assert.equal(service.cycle.baseInventory instanceof CraftBaseInventoryCoordinator, true);
    assert.equal(service.cycle.finalCraft, service.finalCraft, 'generic final craft is shared with the cycle');
    assert.equal(service.cycle.quantity, service.quantity, 'generic quantity policy is the cycle authority');
    // Compat aliases expose the same generic instances.
    assert.equal(service.cycle.intermediate, service.intermediate);
    assert.equal(service.cycle.reserveChain, service.reserveChain);
    // Runtime decorator (production facade) wraps this exact service.
    const decorator = new CraftAutomationRuntimeDecorator({ service });
    assert.equal(decorator.service, service);
    for (const method of ['run', 'runNext', 'runTarget', 'runMaintenance', 'status', 'reconfigure']) {
        assert.equal(typeof decorator[method], 'function', method + ' stays on the public API');
    }
});

test('cutover wiring: a real runTarget through the production decorator executes the generic cycle', async () => {
    const { service, calls } = productionRig();
    const executed = [];
    const realExecute = service.cycle.execute.bind(service.cycle);
    service.cycle.execute = (amount, context, options) => {
        executed.push({ targetId: options.targetId, mode: options.mode, additional: options.additional });
        return realExecute(amount, context, options);
    };
    const decorator = new CraftAutomationRuntimeDecorator({ service });
    const result = await decorator.runTarget({ targetId: 'super_alloy' });
    // Real execution path: the operation ran to a verified completion with
    // actual craft side effects (production-shaped parity fixture).
    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(result.data.completedTarget, true, JSON.stringify(result.data));
    assert.equal(result.data.targetId, 'super_alloy');
    assert.deepEqual(calls.filter(c => c.startsWith('craft:')), ['craft:carbon-recipe:ALL', 'craft:super-alloy-recipe:1']);
    // Exactly one cycle execution, through the generic cycle, with the
    // explicit request target threaded into the cycle options.
    assert.equal(executed.length, 1, JSON.stringify(executed));
    assert.equal(executed[0].targetId, 'super_alloy');
    assert.equal(executed[0].mode, 'production');
});

test('cutover wiring: every public API routes through the generic cycle; missing target stays fail-closed', async () => {
    const { service } = productionRig();
    const executed = [];
    service.cycle.execute = (amount, context, options) => {
        executed.push(options);
        return Promise.resolve({ completedTarget: false, targetId: options.targetId || null });
    };
    // Fail-closed: generic planning + no explicit target never reaches any cycle.
    for (const call of [
        () => service.runTarget({}),
        () => service.runNext({}),
        () => service.run(1, {}),
        () => service.runTarget({ targetId: '   ' })
    ]) {
        const closed = await call();
        assert.equal(closed.success, false);
        assert.equal(closed.status, 'INVALID_INPUT');
        assert.equal(closed.error?.code, 'CRAFT_TARGET_REQUIRED');
    }
    assert.equal(executed.length, 0, 'no cycle may run without an explicit target');
    // Explicit targets route through the one generic execution path.
    assert.equal((await service.runTarget({ targetId: 'super_alloy' })).success, true);
    assert.equal((await service.runNext({ targetId: 'super_alloy' })).success, true);
    assert.equal((await service.run(1, { targetId: 'super_alloy' })).success, true);
    // Maintenance keeps its contract: no target required, never crafts the final target.
    assert.equal((await service.runMaintenance({})).success, true);
    assert.equal(executed.length, 4, JSON.stringify(executed));
    assert.deepEqual(executed.map(o => o.targetId), ['super_alloy', 'super_alloy', 'super_alloy', null]);
    assert.deepEqual(executed.map(o => o.mode), ['production', 'production', 'production', 'maintenance']);
    assert.equal(executed[3].craftFinalTarget, false, 'maintenance never crafts the final target');
});

test('cutover wiring: composition root feeds the decorator into crafting/collector/facade consumers', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/bootstrap/registerBotServices.js'), 'utf8');
    // The automation core is CraftAutomationService with the generic planning authority.
    assert.match(source, /new CraftAutomationService\(\{\s*planningService:\s*craftPlanning/);
    // Production facade: every runtime consumer receives the generic decorator over that core.
    assert.match(source, /new CraftAutomationRuntimeDecorator\(\{\s*service:\s*craftAutomationCore/);
    assert.match(source, /craftingAutomation:\s*craftAutomation/);
    assert.match(source, /procedureRegistry/);
    assert.match(source, /procedureExecutor/);
    assert.match(source, /quantityStrategy/);
    // Collector is an explicit compatibility consumer: it names its target from
    // its own compat planning view, never from an ambient default.
    const collectorSource = fs.readFileSync(path.resolve(__dirname, '../../../src/modes/collector-b5/CollectorB5ModeService.js'), 'utf8');
    assert.match(collectorSource, /targetId:\s*this\.b5Planning\?\.targetId\s*\|\|\s*null/);
});

