'use strict';
// Slice 6 Step 5 - generic cycle cutover boundary tests.
// Status: the generic cycle core + generic quantity policy are implemented and
// boundary-tested. The production runtime still runs the legacy B5 cycle: the
// generic coordinators they call diverge from the locked behavior on 11 cycle
// scenarios, so the cutover stays open (see the last test for the audit).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CraftCycleCoordinator = require('../../../src/server-features/crafting/coordinators/CraftCycleCoordinator');
const CraftQuantityPolicy = require('../../../src/server-features/crafting/support/CraftQuantityPolicy');
const B5PlanningFlow = require('../../../src/server-features/crafting/b5/flows/B5PlanningFlow');
const CraftAutomationService = require('../../../src/server-features/crafting/CraftAutomationService');
const Result = require('../../../src/shared/result/Result');
const StageExecutionContract = require('../../../src/server-features/crafting/verification/StageExecutionContract');
const CraftChainAdapter = require('../../../src/server-features/crafting/support/CraftChainAdapter');

const TARGET = 'target-neutral';
const MID = 'mid-neutral';
const OUT = 'out-neutral';
const MID_RECIPE = 'mid-recipe-neutral';
const OUT_RECIPE = 'out-recipe-neutral';

function token(cancelled = false) {
    return { throwIfCancelled() { if (cancelled) throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' }); } };
}
function ctx(cancelled = false, generation = 7) {
    return { cancellation: { token: token(cancelled) }, connectionGeneration: generation, trace: { id: 't' } };
}
function neutralChain(extra = {}) {
    return {
        baseId: 'base-neutral', intermediateId: MID, outputId: OUT,
        intermediateRecipeId: MID_RECIPE, outputRecipeId: OUT_RECIPE,
        intermediatePerOutput: 16, intermediateOutputAmount: 1,
        intermediateCrafts: 0, outputCrafts: 0,
        vaultIntermediate: 0, vaultOutput: 0,
        inventoryIntermediate: 0, inventoryOutput: 0,
        storedEffective: 0, storedTotalEffective: 0, ...extra
    };
}
function legacyChain(extra = {}) {
    const c = neutralChain(extra);
    return {
        baseId: c.baseId, b2Id: c.intermediateId, b3Id: c.outputId,
        b2RecipeId: c.intermediateRecipeId, b3RecipeId: c.outputRecipeId,
        b3InputPerCraft: c.intermediatePerOutput, b2OutputAmount: c.intermediateOutputAmount,
        b2Crafts: c.intermediateCrafts, b3Crafts: c.outputCrafts,
        vaultB2: c.vaultIntermediate, vaultB3: c.vaultOutput,
        inventoryB2: c.inventoryIntermediate, inventoryB3: c.inventoryOutput,
        storedEffective: c.storedEffective, storedTotalEffective: c.storedTotalEffective
    };
}

// ---- quantity policy ----
test('step5: quantity policy maps legacy config once and drops B-chain names', () => {
    const policy = CraftQuantityPolicy.fromConfig({
        quantityOptimization: { enabled: true, useAllForB2: true, useAllForB3: true, useAllForB4WhenExact: true, useAllForB5: false, b2BatchSize: 64 },
        b3AllMinEmptySlots: 1, inventorySafetyEmptySlots: 2, b2InputSource: 'storage'
    });
    assert.equal(policy.useAllForIntermediate, true);
    assert.equal(policy.useAllForOutput, true);
    assert.equal(policy.useAllForDirectInputWhenExact, true);
    assert.equal(policy.useAllForTarget, false);
    assert.equal(policy.intermediateBatchSize, 64);
    assert.equal(policy.outputAllMinEmptySlots, 1);
    assert.equal(policy.inventorySafetyEmptySlots, 2);
    assert.equal(policy.inputSource, 'storage');
    assert.ok(!('useAllForB2' in policy) && !('useAllForB3' in policy) && !('b2BatchSize' in policy));
});

test('step5: quantity policy planChain matches the legacy planning flow', () => {
    const recipeRegistry = { require: () => ({ inputs: { 'base-neutral': 16 } }) };
    const config = { quantityOptimization: { enabled: true, useAllForB2: true, b2BatchSize: 64 } };
    const cases = [
        { storedEffective: 4096, intermediateCrafts: 64, outputCrafts: 0 },
        { storedEffective: 64 * 16, intermediateCrafts: 7, outputCrafts: 1 },
        { storedEffective: 0, intermediateCrafts: 5, outputCrafts: 2 },
        { storedEffective: 8 * 16 * 64, intermediateCrafts: 200, outputCrafts: 3 }
    ];
    for (const c of cases) {
        const legacy = new B5PlanningFlow({ recipeRegistry, config }).planChain(legacyChain(c));
        const policy = CraftQuantityPolicy.fromConfig(config).planChain({
            plannedIntermediateExact: c.intermediateCrafts, plannedOutput: c.outputCrafts,
            basePerIntermediate: 16, immediatelyCraftable: c.storedEffective, totalEffective: c.storedEffective
        });
        assert.equal(policy.plannedIntermediateExact, legacy.plannedB2Exact, JSON.stringify(c));
        assert.equal(policy.plannedIntermediate, legacy.plannedB2, JSON.stringify(c));
        assert.equal(policy.plannedOutput, legacy.plannedB3, JSON.stringify(c));
        assert.equal(policy.intermediateBatchSize, legacy.b2BatchSize, JSON.stringify(c));
        assert.equal(policy.useAllForIntermediate, legacy.useAllForB2, JSON.stringify(c));
        assert.equal(policy.basePerIntermediate, legacy.basePerB2, JSON.stringify(c));
        assert.equal(policy.requiredRawForStart, legacy.requiredRawForStart, JSON.stringify(c));
        assert.equal(policy.totalIntermediateCrafts, legacy.totalB2Crafts, JSON.stringify(c));
        assert.equal(policy.decompressionBlocked, legacy.decompressionBlocked, JSON.stringify(c));
    }
});
test('step5: intermediate/output/final quantity matrix keeps ALL/64/1', () => {
    const all = CraftQuantityPolicy.fromConfig({ quantityOptimization: { enabled: true, useAllForB2: true, useAllForB3: true, useAllForB4WhenExact: true } });
    assert.equal(all.intermediateQuantity({ planned: 128, craftable: 64 }).quantity, 'ALL');
    assert.equal(all.outputQuantity({ remaining: 8, available: 4 }).quantity, 'ALL');
    assert.equal(all.finalQuantity({ remaining: 4, maxCraftable: 4, isTarget: false }).quantity, 'ALL');
    assert.equal(all.finalQuantity({ remaining: 4, maxCraftable: 4, isTarget: true }).quantity, 1, 'target stays exact');
    const exact = CraftQuantityPolicy.fromConfig({});
    assert.equal(exact.intermediateQuantity({ planned: 64, craftable: 64 }).quantity, 64);
    assert.equal(exact.intermediateQuantity({ planned: 5, craftable: 5 }).quantity, 1);
    assert.equal(exact.outputQuantity({ remaining: 64, available: 64 }).quantity, 64);
    assert.equal(exact.outputQuantity({ remaining: 3, available: 3 }).quantity, 1);
    assert.equal(exact.finalQuantity({ remaining: 64, maxCraftable: 64, isTarget: true }).quantity, 64);
    assert.equal(exact.finalQuantity({ remaining: 64, maxCraftable: 63, isTarget: true }).quantity, 64, 'target exact cycle uses 64 when remaining >= 64');
});

test('step5: reserve guard code keeps LOOP_GUARD for zero-progress free-slot stall', () => {
    const policy = CraftQuantityPolicy.fromConfig({});
    assert.equal(policy.loopGuardCode({ guardExceeded: true }), 'CRAFT_RESERVE_LOOP_GUARD');
    assert.equal(policy.loopGuardCode({ zeroProgressWithFreeSlotStall: true }), 'CRAFT_RESERVE_LOOP_GUARD');
    assert.equal(policy.loopGuardCode({}), 'CRAFT_RESERVE_INPUT_STALLED');
});

// ---- generic cycle ----
function harness(opts = {}) {
    const calls = [];
    const chain = opts.chain || neutralChain({ intermediateCrafts: 2, outputCrafts: 1, storedEffective: 64 * 16, storedTotalEffective: 64 * 16 });
    const data = {
        chains: opts.chains === undefined ? [chain] : opts.chains,
        fullPlan: { targetId: TARGET, feasible: opts.feasible !== false },
        finalSteps: opts.finalSteps || [],
        personalVault: { totals: { [TARGET]: opts.targetVaultBefore || 0 } },
        personalVaultPressure: null, inventoryTotals: opts.inventoryTotals || {}, nonStorageAvailable: {},
        progress: { state: 'READY', remainingStages: 1, remainingCrafts: 1, nextStep: null }
    };
    let seq = Array.isArray(opts.inspections) ? opts.inspections.slice() : null;
    const inspect = async () => {
        calls.push('inspect');
        if (seq && seq.length > 1) return { success: true, data: seq.shift() };
        return { success: true, data: seq ? seq[0] : data };
    };
    const tracker = { value: {}, sync: () => calls.push('sync'), set: (v) => calls.push('progress:' + (v && v.state)), advance: () => calls.push('advance'), status: () => ({ state: 'RUNNING' }) };
    const deps = {
        flows: {
            read: { inspect, readPv2: async () => { calls.push('readPv2'); return { data: { totals: { [TARGET]: opts.targetVaultAfter !== undefined ? opts.targetVaultAfter : (opts.targetVaultBefore || 0) + (opts.amount || 1) } } }; } },
            storage: { prepareBase: async () => { calls.push('prepareBase'); return opts.prepareResult || { success: true, data: { ready: true, available: 64 } }; }, finalizeBase: async () => { calls.push('finalizeBase'); return { data: {} }; }, compactAll: async () => { calls.push('compactAll'); return { data: {} }; } },
            deposit: { deposit: async (id) => { calls.push('deposit:' + id); return { success: true, data: {} }; } }
        },
        inventoryState: {
            vaultCanAccept: () => opts.vaultCanAccept !== false,
            waitForAtMost: async () => 0,
            spaceSnapshot: () => ({ emptySlotCount: 10 }),
            count: () => 0,
            allowsNewIntermediates: () => opts.allowsNew !== false
        },
        recipeResolver: {
            isTargetDirectlyReady: () => opts.targetReady === true,
            recipeForOutput: () => opts.targetRecipe || { recipeId: 'target-recipe', recipe: { inputs: { [OUT]: 1 } } }
        },
        progressTracker: tracker,
        intermediate: {
            promoteOwned: async (ins) => { calls.push('promote'); return { actions: opts.promoteActions || [], inspection: ins }; },
            compactReadyB4: async () => [],
            depositRemainders: async () => { calls.push('depositRemainders'); }
        },
        reserveChain: { prepare: async () => { calls.push('reserve'); return opts.reserveResult || {}; } },
        baseInventory: { returnToStorage: async () => { calls.push('returnBase'); return {}; } },
        finalCraft: { execute: async () => { calls.push('finalChain'); return {}; } },
        recipeRegistry: { require: () => ({ inputs: { 'base-neutral': 16 } }) },
        quantity: opts.quantity || CraftQuantityPolicy.fromConfig(opts.config || {}),
        config: opts.config || {},
        runStep: async (_c, _m, fn) => {
            if (opts.staleGeneration) throw Object.assign(new Error('stale'), { code: 'CRAFT_STAGE_STALE_GENERATION' });
            return fn();
        },
        childOptions: (_c, o) => o || {},
        status: () => ({ state: 'RUNNING' })
    };
    return { cycle: new CraftCycleCoordinator(deps), calls, data, chain, tracker };
}
function options(extra = {}) {
    return { additional: 0, mode: 'production', craftFinalTarget: true, allowNewB2: true, recoveryOnly: false, ...extra };
}
test('step5: generic cycle promotes, reserves and finishes without executionPlan', async () => {
    const h = harness();
    const result = await h.cycle.execute(1, ctx(), options());
    assert.ok(h.calls.indexOf('promote') >= 0, 'phase 3 promote ran: ' + h.calls.join(','));
    assert.ok(h.calls.indexOf('reserve') >= 0, 'phase 4 reserve ran');
    assert.ok(h.calls.indexOf('returnBase') >= 0, 'phase 4 finalize ran');
    assert.ok(h.calls.indexOf('depositRemainders') >= 0, 'phase 6 finish ran');
    assert.equal(result.targetId, TARGET);
    assert.equal(result.plan, null, 'generic result carries no B5 executionPlan');
    assert.ok(!('executionPlan' in result));
    assert.equal(result.progress.state, 'RUNNING');
});

test('step5: generic cycle crafts and stores the target when capacity allows', async () => {
    const h = harness({ targetReady: true, targetVaultBefore: 0, amount: 1, targetVaultAfter: 1 });
    const result = await h.cycle.execute(1, ctx(), options());
    assert.ok(h.calls.includes('finalChain'), 'final chain ran: ' + h.calls.join(','));
    assert.ok(h.calls.includes('deposit:' + TARGET));
    assert.ok(h.calls.includes('readPv2'), 'deposit verified against /pv 2');
    assert.equal(result.completedTarget, true);
    assert.equal(result.completedAmount, 1);
    assert.ok(result.actions.some((a) => a.status === 'final-crafted-and-deposited'));
});

test('step5: generic cycle orphan recovery deposits and verifies before crafting', async () => {
    const h = harness({ inventoryTotals: { [TARGET]: 1 }, targetVaultBefore: 0, targetVaultAfter: 1 });
    const result = await h.cycle.execute(1, ctx(), options());
    assert.ok(h.calls.includes('deposit:' + TARGET));
    assert.ok(h.calls.includes('readPv2'));
    assert.equal(result.completedTarget, false);
    assert.equal(result.recoveredExistingB5, true);
    assert.ok(result.actions.some((a) => a.status === 'existing-b5-recovered'));
    assert.ok(!h.calls.includes('finalChain'), 'no new craft after recovery');
});

test('step5: generic cycle blocks the target when /pv 2 cannot accept it', async () => {
    const h = harness({ feasible: true, vaultCanAccept: false });
    const result = await h.cycle.execute(1, ctx(), options());
    assert.equal(result.waitingForMaterials, true);
    assert.ok(result.actions.some((a) => a.reason === 'pv2-target-capacity'));
    assert.ok(!h.calls.includes('finalChain'));
});

test('step5: generic cycle space-deferred reserve is reported, not retried', async () => {
    const h = harness({ reserveResult: { deferredForSpace: true, emptySlotCount: 0 } });
    const result = await h.cycle.execute(1, ctx(), options());
    assert.ok(result.actions.some((a) => a.status === 'deferred-for-space'), JSON.stringify(result.actions));
    assert.equal(h.calls.filter((c) => c === 'reserve').length, 1, 'one reserve attempt only');
});

test('step5: generic cycle waiting-for-material is a normal wait', async () => {
    const h = harness({ reserveResult: { waitingForMaterial: true } });
    const result = await h.cycle.execute(1, ctx(), options());
    assert.ok(result.actions.some((a) => a.status === 'waiting-current-material'), JSON.stringify(result.actions.map((a) => a.status)));
    assert.equal(h.calls.filter((c) => c === 'reserve').length, 1);
    const starved = harness({ chain: neutralChain({ intermediateCrafts: 2, outputCrafts: 1, storedEffective: 0, storedTotalEffective: 0 }), feasible: false });
    const starvedResult = await starved.cycle.execute(1, ctx(), options());
    assert.ok(starvedResult.actions.some((a) => a.status === 'waiting' && a.reason === 'waiting-for-complete-b2-batch'), JSON.stringify(starvedResult.actions));
    assert.equal(starvedResult.waitingForMaterials, true);
    assert.equal(starvedResult.productive, false);
    assert.ok(!starved.calls.includes('reserve'));
});
test('step5: generic cycle cancellation aborts before any side effect', async () => {
    const h = harness();
    await assert.rejects(() => h.cycle.execute(1, ctx(true), options()), /cancelled/);
    assert.ok(!h.calls.includes('reserve'));
    assert.ok(!h.calls.includes('finalChain'));
});

test('step5: stale generation rejection propagates instead of being converted', async () => {
    const h = harness({ staleGeneration: true });
    await assert.rejects(() => h.cycle.execute(1, ctx(), options()), (e) => e.code === 'CRAFT_STAGE_STALE_GENERATION');
});

test('step5: maintenance mode never crafts the target', async () => {
    const h = harness({ targetReady: true });
    const result = await h.cycle.execute(1, ctx(), options({ mode: 'maintenance', craftFinalTarget: false }));
    assert.ok(!h.calls.includes('finalChain'));
    assert.ok(result.actions.some((a) => a.status === 'maintenance-b1-compacted'));
});

test('step5: generic cycle normalizes legacy chain shapes at its boundary', async () => {
    const legacy = [legacyChain({ intermediateCrafts: 2, outputCrafts: 1, storedEffective: 64 * 16, storedTotalEffective: 64 * 16 })];
    const h = harness({ chains: legacy });
    const result = await h.cycle.execute(1, ctx(), options());
    assert.ok(h.calls.includes('reserve'), 'legacy chain still planned and reserved');
    assert.equal(result.targetId, TARGET);
});

test('step5: no B5 coordinator, planning service or legacy chain key is reachable from the generic cycle', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../src/server-features/crafting/coordinators/CraftCycleCoordinator.js'), 'utf8');
    for (const banned of ['B5CycleCoordinator', 'B5PlanningService', 'B5IntermediateCoordinator', 'B5ReserveChainCoordinator', 'B5B1InventoryCoordinator', 'executionPlan', 'b5Planning', 'flows.plan', 'chain.b2Id', 'chain.b3Id', 'chain.b2Crafts', 'chain.b3Crafts']) {
        assert.ok(!src.includes(banned), banned + ' leaks into the generic cycle');
    }
    assert.ok(src.includes('CraftQuantityPolicy') === false, 'the cycle receives the policy, it does not own it');
    assert.equal(typeof CraftAutomationService.CraftCycleCoordinator, 'function');
    assert.equal(CraftAutomationService.CraftCycleCoordinator, CraftCycleCoordinator);
    assert.equal(CraftAutomationService.CraftQuantityPolicy, CraftQuantityPolicy);
});

// ---- ACT D3: B1 prepare/planning parity (legacy B5PlanningFlow vs generic) ----
// Locked fixture: baseNeededFromStorage 320 / storedEffective 6400 /
// intermediateCrafts 20 / outputCrafts 1 / intermediatePerOutput 16 /
// useAllForB2 true / input source storage. Legacy naming is only translated
// here at the test boundary; the generic contract stays generic.
const D3_CONFIG = { targetId: 'super_alloy', timeoutMs: 1000, b3AllMinEmptySlots: 1,
    quantityOptimization: { enabled: true, useAllForB2: true, useAllForB3: true, useAllForB4WhenExact: true, useAllForB5: false } };
const D3_RECIPE_REGISTRY = { require: id => (id === 'b2-recipe' ? { output: 'b2', inputs: { coal: 16 } } : { output: id, inputs: {} }) };
const D3_NEXT_ACTION = { PREPARE_B1: 'PREPARE_BASE', CRAFT_B2: 'CRAFT_INTERMEDIATE', CRAFT_B3: 'CRAFT_OUTPUT', WAIT_MATERIAL: 'WAIT_MATERIAL' };

function d3LegacyChain(extra = {}) {
    return { baseId: 'coal', b2Id: 'b2', b3Id: 'b3', b2RecipeId: 'b2-recipe', b3RecipeId: 'b3-recipe',
        b2OutputAmount: 1, b3InputPerCraft: 16, rawNeededFromStorage: 320, storedEffective: 6400,
        readyToReserve: true, b2Crafts: 20, b3Crafts: 1, vaultB2: 0, vaultB3: 0, inventoryB2: 0, inventoryB3: 0, ...extra };
}
function d3Cycle(config = D3_CONFIG) {
    return new CraftCycleCoordinator({
        flows: {}, inventoryState: {}, recipeResolver: {}, progressTracker: {},
        intermediate: {}, reserveChain: {}, baseInventory: {}, finalCraft: {},
        recipeRegistry: D3_RECIPE_REGISTRY, quantity: CraftQuantityPolicy.fromConfig(config), config,
        runStep: async (_c, _m, fn) => fn(), childOptions: (_c, o) => o || {}, status: () => ({})
    });
}
// Legacy vs generic planChain parity with the intentional nextAction rename mapped.
function assertD3PlanParity(legacyChain, config = D3_CONFIG) {
    const legacy = new B5PlanningFlow({ recipeRegistry: D3_RECIPE_REGISTRY, config }).planChain(legacyChain);
    const generic = d3Cycle(config).planChain(legacyChain);
    assert.equal(generic.plannedIntermediateExact, legacy.plannedB2Exact, 'plannedIntermediateExact');
    assert.equal(generic.plannedIntermediate, legacy.plannedB2, 'plannedIntermediate');
    assert.equal(generic.plannedOutput, legacy.plannedB3, 'plannedOutput');
    assert.equal(generic.intermediateBatchSize, legacy.b2BatchSize, 'intermediateBatchSize');
    assert.equal(generic.useAllForIntermediate, legacy.useAllForB2, 'useAllForIntermediate');
    assert.equal(generic.inputSource, legacy.b2InputSource, 'inputSource');
    assert.equal(generic.basePerIntermediate, legacy.basePerB2, 'basePerIntermediate resolved via recipeRegistry');
    assert.equal(generic.requiredRawForStart, legacy.requiredRawForStart, 'requiredRawForStart');
    assert.equal(generic.immediatelyCraftable, legacy.immediatelyCraftable, 'immediatelyCraftable');
    assert.equal(generic.totalEffective, legacy.totalEffective, 'totalEffective');
    assert.equal(generic.totalIntermediateCrafts, legacy.totalB2Crafts, 'totalIntermediateCrafts');
    assert.equal(generic.decompressionBlocked, legacy.decompressionBlocked, 'decompressionBlocked');
    assert.equal(generic.nextAction, D3_NEXT_ACTION[legacy.nextAction], 'nextAction (legacy name mapped at the boundary)');
    return { legacy, generic };
}

test('d3: legacy planChain vs generic planChain on the locked 6400/320/20/1/16 fixture', () => {
    const { legacy, generic } = assertD3PlanParity(d3LegacyChain());
    // Explicit locks on the values the fixture is about.
    assert.equal(generic.totalEffective, 6400, 'storedTotalEffective absent/zero must not shrink the effective total');
    assert.equal(generic.totalIntermediateCrafts, 400);
    assert.equal(generic.plannedIntermediateExact, 20);
    assert.equal(generic.plannedIntermediate, 20, 'ALL plan keeps the exact 20 instead of collapsing to 0');
    assert.equal(generic.plannedOutput, 1);
    assert.equal(generic.intermediateBatchSize, 64);
    assert.equal(generic.useAllForIntermediate, true);
    assert.equal(generic.basePerIntermediate, 16);
    assert.equal(generic.requiredRawForStart, 16, 'ALL start needs exactly one basePerIntermediate unit');
    assert.equal(generic.immediatelyCraftable, 6400);
    assert.equal(generic.decompressionBlocked, false);
    assert.equal(generic.nextAction, 'CRAFT_INTERMEDIATE');
    assert.equal(legacy.nextAction, 'CRAFT_B2');
    // The adapter must carry every planning input the generic planChain reads.
    const adapted = CraftChainAdapter.fromLegacyChain(d3LegacyChain());
    assert.equal(adapted.storedEffective, 6400);
    assert.equal(adapted.baseNeededFromStorage, 320);
    assert.equal(adapted.intermediateCrafts, 20);
    assert.equal(adapted.intermediatePerOutput, 16);
});

test('d3: totalEffective resolve parity when storedTotalEffective differs (ACT D3)', () => {
    const cases = [
        { name: 'storedEffective > storedTotalEffective', extra: { storedTotalEffective: 100 }, expectedTotal: 6400 },
        { name: 'storedTotalEffective missing', extra: {}, expectedTotal: 6400 },
        { name: 'storedTotalEffective = 0', extra: { storedTotalEffective: 0 }, expectedTotal: 6400 },
        { name: 'storedTotalEffective > storedEffective', extra: { storedTotalEffective: 8192 }, expectedTotal: 8192, expectedBlocked: true }
    ];
    for (const c of cases) {
        const { legacy, generic } = assertD3PlanParity(d3LegacyChain(c.extra));
        assert.equal(generic.totalEffective, c.expectedTotal, c.name);
        assert.equal(generic.plannedIntermediate, legacy.plannedB2, c.name);
        assert.equal(generic.decompressionBlocked, Boolean(c.expectedBlocked), c.name);
    }
});

test('d3: inventory source disables intermediate ALL in both planners (ACT D3)', () => {
    const config = { inputSource: 'inventory',
        quantityOptimization: { enabled: true, useAllForB2: true, useAllForB3: true, useAllForB4WhenExact: true, useAllForB5: false } };
    const { legacy, generic } = assertD3PlanParity(d3LegacyChain(), config);
    assert.equal(legacy.useAllForB2, false);
    assert.equal(generic.useAllForIntermediate, false);
    assert.equal(generic.inputSource, 'inventory');
    assert.equal(generic.plannedIntermediate, 64, 'non-ALL rounds 20 up to one 64 batch backed by full stock');
    assert.equal(generic.requiredRawForStart, 1024, 'non-ALL start needs planned * basePerIntermediate');
});

test('d3: requiredRawForStart falls back to baseNeededFromStorage when nothing is planned (ACT D3)', () => {
    const starved = d3LegacyChain({ storedEffective: 0, storedTotalEffective: 0 });
    const { legacy, generic } = assertD3PlanParity(starved);
    assert.equal(generic.plannedIntermediate, 0);
    assert.equal(generic.plannedOutput, 1);
    assert.equal(generic.requiredRawForStart, 320);
    assert.equal(generic.requiredRawForStart, legacy.requiredRawForStart);
    assert.equal(generic.nextAction, 'CRAFT_OUTPUT');
    assert.equal(legacy.nextAction, 'CRAFT_B3');
});

test('d3: chain adapter preserves planning state and drops legacy keys (ACT D3)', () => {
    const withTotal = CraftChainAdapter.fromLegacyChain(d3LegacyChain({ storedTotalEffective: 364 }));
    assert.equal(withTotal.storedEffective, 6400);
    assert.equal(withTotal.storedTotalEffective, 364);
    assert.equal(withTotal.baseNeededFromStorage, 320);
    assert.ok(!('rawNeededFromStorage' in withTotal), 'legacy raw key is mapped, not kept');
    assert.ok(!('b2Crafts' in withTotal) && !('b2Id' in withTotal) && !('b3InputPerCraft' in withTotal), 'no B5-only key enters the generic contract');
    assert.equal(CraftChainAdapter.isGenericChain(withTotal), true);
    const adapted = CraftChainAdapter.fromLegacyChain(d3LegacyChain());
    assert.ok(!('storedTotalEffective' in adapted), 'missing legacy state stays missing deterministically');
    assert.equal(adapted.storedEffective, 6400);
});

// Full-service rig on the locked D3 fixture (mirrors the Step 0 B1->B2 ALL
// baseline body). Runs the legacy cycle via runNext and the generic cycle via
// genericCycle.execute on identical inputs; both must emit the same call order.
function d3Rig() {
    const calls = [];
    const counts = { b2: 0, b3: 0 };
    const vault = { carried: 0, inspectCall: 0 };
    const toD3Legacy = n => ({ baseId: n.base, b2Id: n.intermediate, b3Id: n.output,
        b2RecipeId: n.intermediateRecipe, b3RecipeId: n.outputRecipe, b2OutputAmount: 1,
        b3InputPerCraft: n.intermediatePerOutput, rawNeededFromStorage: n.baseNeededFromStorage ?? 0,
        storedEffective: n.storedEffective ?? 0, storedTotalEffective: n.storedTotalEffective ?? 0,
        readyToReserve: true, b2Crafts: n.intermediateCrafts ?? 0, b3Crafts: n.outputCrafts ?? 0,
        vaultB2: n.vaultIntermediate ?? 0, inventoryB2: n.inventoryIntermediate ?? 0, inventoryB3: n.inventoryOutput ?? 0 });
    const chain = { base: 'coal', intermediate: 'b2', output: 'b3', intermediateRecipe: 'b2-recipe', outputRecipe: 'b3-recipe',
        intermediatePerOutput: 16, baseNeededFromStorage: 320, storedEffective: 6400,
        intermediateCrafts: 20, outputCrafts: 1, vaultIntermediate: 0, inventoryIntermediate: 0 };
    const planningService = { async inspectAdditional() {
        vault.inspectCall += 1;
        return Result.ok({ personalVault: { totals: { super_alloy: 0 } },
            fullPlan: { targetId: 'super_alloy', feasible: false }, finalSteps: [],
            chains: vault.inspectCall === 1 ? [toD3Legacy(chain)] : [toD3Legacy({ ...chain, baseNeededFromStorage: 0,
                storedEffective: 0, intermediateCrafts: 0, outputCrafts: Math.floor(counts.b2 / 16),
                vaultIntermediate: vault.carried, inventoryIntermediate: counts.b2, inventoryOutput: counts.b3 })] });
    } };
    const tk = () => ({ throwIfCancelled() {}, onCancelled() { return () => {}; } });
    const service = new CraftAutomationService({
        craftingVerificationService: new StageExecutionContract(), planningService,
        crafting: { async craft(recipeId, quantity, craftOptions = {}) {
            calls.push(`craft:${recipeId}:${quantity}`);
            if (recipeId === 'b2-recipe' && quantity === 'ALL') {
                assert.deepEqual(craftOptions.reconciliationBaseline?.inputs?.coal, { source: 'storage', count: 320 });
                counts.b2 += 160;
                return Result.ok({ actualCrafts: 160 });
            }
            const crafts = Math.floor(counts.b2 / 16);
            counts.b2 -= crafts * 16; counts.b3 += crafts;
            return Result.ok({ actualCrafts: crafts });
        } },
        personalVault: {
            async deposit(id, depositOptions = {}) {
                calls.push(`deposit:${id}:${depositOptions.maxStacks || 'all'}`);
                if (id === 'b2' && depositOptions.maxStacks === 1 && counts.b2 >= 64) { counts.b2 -= 64; vault.carried += 64; return Result.ok({ movedStacks: 1 }); }
                return Result.ok({ movedStacks: 0 });
            },
            async withdraw(id) {
                calls.push(`withdraw:${id}`);
                if (id === 'b2' && vault.carried >= 64) { vault.carried -= 64; counts.b2 += 64; return Result.ok({ movedStacks: 1 }); }
                return Result.ok({ movedStacks: 0 });
            }
        },
        storage: {},
        b1Materials: {
            async inspectStoragePressure() { calls.push('storage-guard'); throw new Error('mid-craft sale gate must not run'); },
            async ensureBaseAvailable(_id, required, ensureOptions = {}) { calls.push(`ensure:${required}`); assert.equal(ensureOptions.decompressionPolicy, 'unbounded'); return Result.ok({ ready: true, available: 320 }); },
            async compact() { return Result.ok({ actualCrafts: 1, verification: { before: 0, after: 1 } }); },
            async compactAll() { return Result.ok({ actualCrafts: 1, verification: { before: 0, after: 1 } }); }
        },
        inventoryReader: { readBotInventory: () => ({ source: 'bot-inventory',
            emptySlotCount: Math.max(0, 3 - Math.ceil(counts.b2 / 64) - Math.ceil(counts.b3 / 64)), counts: { ...counts } }) },
        inventoryCounter: { count: (snapshot, id) => Number(snapshot.counts?.[id] || 0) },
        recipeRegistry: D3_RECIPE_REGISTRY,
        operationManager: { async run(op) { return Result.ok(await op.executor({ cancellation: { token: tk() } })); } },
        config: D3_CONFIG
    });
    return { service, calls, counts, vault, tk };
}

test('d3: prepareBase NOT_READY stays a waiting result instead of throwing (ACT D3)', async () => {
    const h = harness({ feasible: false,
        prepareResult: Result.fail('NOT_READY', 'Not enough effective coal in /kho.', null, { required: 16, effective: 0 }) });
    const result = await h.cycle.execute(1, ctx(), options());
    assert.ok(h.calls.includes('prepareBase'), 'prepareBase ran: ' + h.calls.join(','));
    assert.ok(!h.calls.includes('reserve'), 'no reserve after NOT_READY');
    assert.ok(result.actions.some((a) => a.status === 'waiting' && a.reason === 'b1-not-ready'), JSON.stringify(result.actions));
    assert.equal(result.waitingForMaterials, true);
    assert.equal(result.productive, false);
});

test('d3: generic #prepareB1 runs the locked ensure:16 -> B2 ALL -> park -> withdraw -> B3 ALL sequence (ACT D3)', async () => {
    const legacyRun = d3Rig();
    const legacyResult = await legacyRun.service.runNext({ targetId: 'super_alloy' });
    assert.equal(legacyResult.success, true);

    const genericRun = d3Rig();
    const genericResult = await genericRun.service.genericCycle.execute(1,
        { cancellation: { token: genericRun.tk() }, trace: null },
        { additional: true, mode: 'production', craftFinalTarget: true, allowNewB2: true, freshInspection: false,
            recoveryOnly: false, decompressionPolicy: 'unbounded', decompressionMaxUsageRatio: null,
            requireKnownCapacity: false, targetId: 'super_alloy' });

    assert.deepEqual(genericRun.calls, legacyRun.calls, 'generic sequence must equal legacy sequence on the same input');
    assert.deepEqual(genericRun.calls, [
        'ensure:16', 'craft:b2-recipe:ALL', 'deposit:b2:1', 'craft:b3-recipe:ALL',
        'withdraw:b2', 'craft:b3-recipe:ALL', 'deposit:b3:all'
    ]);
    assert.deepEqual(genericRun.calls.filter(c => c.startsWith('craft:')),
        ['craft:b2-recipe:ALL', 'craft:b3-recipe:ALL', 'craft:b3-recipe:ALL'], 'no wrong craft branch');
    assert.equal(genericRun.calls.includes('storage-guard'), false, 'mid-craft sale gate never runs');
    assert.equal(genericRun.counts.b3, legacyRun.counts.b3, 'final B3 parity');
    assert.equal(genericRun.counts.b3, 10);
    assert.equal(genericRun.vault.carried, legacyRun.vault.carried, 'parked B2 parity');
    assert.equal(genericRun.vault.carried, 0);
    assert.ok(genericResult.actions.some((a) => a.status === 'base-ready'), JSON.stringify(genericResult.actions));
    assert.ok(genericResult.actions.some((a) => a.status === 'reserved'), JSON.stringify(genericResult.actions));
    assert.ok(!genericResult.actions.some((a) => a.status === 'waiting'), 'no waiting regression: ' + JSON.stringify(genericResult.actions));
});

test('step5: cutover audit - production still runs the legacy cycle, generic stack is not wired yet', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../src/server-features/crafting/CraftAutomationService.js'), 'utf8');
    assert.match(src, /this\.cycle = new B5CycleCoordinator\(/);
    assert.match(src, /this\.genericCycle = new CraftCycleCoordinator\(/);
    const generic = new CraftAutomationService({
        planningService: { async inspectAdditional() {}, async inspectAdditionalFresh() {} },
        crafting: {}, storage: {}, b1Materials: {},
        personalVault: { deposit: async () => ({}), withdraw: async () => ({}), read: async () => ({}) },
        inventoryReader: { read: () => ({}) }, inventoryCounter: { count: () => 0 },
        recipeRegistry: { require: (id) => ({ output: id, inputs: {} }) },
        operationManager: {}, config: {},
        craftingVerificationService: { requireInputReady() {}, handoff: () => ({}), verifyOutput() {}, requireSettled() {} }
    });
    assert.equal(generic.quantity.constructor.name, 'CraftQuantityPolicy', 'quantity authority is injected');
    assert.equal(generic.genericCycle.constructor.name, 'CraftCycleCoordinator');
    assert.equal(generic.cycle.constructor.name, 'B5CycleCoordinator');
});
