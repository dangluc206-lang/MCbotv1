'use strict';
// Slice 6 Step 3 - generic reserve-chain core tests (no runtime cutover).
// Neutral fixtures only; legacy adapter at the boundary; parity included.
const test = require('node:test');
const assert = require('node:assert/strict');
const Generic = require('../../../src/server-features/crafting/coordinators/CraftReserveChainCoordinator');
const Legacy = require('../../../src/server-features/crafting/b5/B5ReserveChainCoordinator');
const CraftAutomationService = require('../../../src/server-features/crafting/CraftAutomationService');

function token(cancelled = false) {
    return { throwIfCancelled() { if (cancelled) throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' }); } };
}
function ctx(generation = 2, cancelled = false) {
    return { cancellation: { token: token(cancelled) }, connectionGeneration: generation, trace: { id: 't' } };
}
function toLegacyChain(n) {
    return {
        baseId: n.base, b2Id: n.intermediate, b3Id: n.output,
        b2RecipeId: n.intermediateRecipe, b3RecipeId: n.outputRecipe,
        b2OutputAmount: n.intermediateOutputAmount ?? 1,
        b3InputPerCraft: n.intermediatePerOutput,
        b2Crafts: n.intermediateCrafts ?? 0, b3Crafts: n.outputCrafts ?? 0,
        vaultB2: n.vaultIntermediate ?? 0,
        ...(n.useAllForIntermediate !== undefined ? { useAllForB2: n.useAllForIntermediate } : {}),
        ...(n.extra || {})
    };
}
function harnessFor(Cls, neutral, { config, overrides = {}, legacyKeys = false } = {}) {
    const chain = legacyKeys ? toLegacyChain(neutral) : Generic.normalize(toLegacyChain(neutral));
    const calls = [];
    let intermediate = neutral.inventoryIntermediate ?? 0;
    let withdrawnTotal = 0;
    const inventoryState = {
        snapshot: () => ({ emptySlotCount: overrides.emptySlots ?? 10 }),
        allEnabled: key => (config?.quantityOptimization?.[key] === true)
            && (config?.quantityOptimization?.enabled !== false),
        actualCrafts: d => d.actualCrafts,
        waitForIncrease: async (_id, before) => { const gain = overrides.waitGain !== undefined ? overrides.waitGain : 0; withdrawnTotal += gain; return before + gain; },
        waitForSettledCount: async (id, min) => ({ settled: true, count: Math.max(min, 0), elapsedMs: 1 })
    };
    const traces = [];
    const per = chain[legacyKeys ? 'b3InputPerCraft' : 'intermediatePerOutput'];
    const r2 = legacyKeys ? chain.b2RecipeId : chain.intermediateRecipeId;
    const finalCraft = {
        async craft(recipeId, quantity) {
            calls.push('craft:' + recipeId + ':' + quantity);
            if (recipeId === r2) {
                const n = quantity === 'ALL' ? (overrides.intermediateAllCrafts ?? 64) : Number(quantity);
                intermediate += n;
                return { actualCrafts: (overrides.zeroIntermediate ? 0 : n), stageContract: { stage: 'B2', after: intermediate } };
            }
            const n = quantity === 'ALL' ? (overrides.outputAllCrafts ?? Math.floor(intermediate / per)) : Number(quantity);
            intermediate -= n * per;
            return { actualCrafts: (overrides.zeroOutput ? 0 : n), stageContract: { stage: 'B3', after: 0 } };
        },
        async settleStage({ stage }) { calls.push('settle-' + stage); return { settled: true, count: 0, elapsedMs: 1 }; }
    };
    const compatAcquire = { ready: true, available: 1024, basePerIntermediate: 16, basePerB2: 16, source: 'inventory' };
    const baseAcquire = overrides.baseAcquire || (legacyKeys ? compatAcquire : { ready: true, available: 1024, basePerIntermediate: 16, source: 'inventory' });
    const baseInventory = { async acquire(c, context, opts) { calls.push('acquire'); return baseAcquire; } };
    const spaceFreer = { async ensureFreeIntermediateSlots(c, context, min, opts) {
        calls.push('free:' + min);
        return overrides.ensureFree || { snapshot: { emptySlotCount: 10 }, depositedB2Count: 0 };
    } };
    const deps = {
        flows: { withdraw: { async withdraw() { calls.push('withdraw'); } }, deposit: { async deposit(id) { calls.push('deposit:' + id); } } },
        inventoryState,
        inventoryCounter: overrides.counter || { count: (s, id) => (id === (legacyKeys ? chain.b2Id : chain.intermediateId) ? intermediate + withdrawnTotal : 0) },
        progressTracker: { set() {} },
        finalCraft: overrides.finalCraft || finalCraft,
        config: config || { quantityOptimization: { enabled: true, useAllForB2: true, useAllForB3: true } },
        logger: null,
        runStep: async (_c, _m, fn) => ({ data: await fn() }),
        childOptions: (_c, o = {}) => o,
        quantityTrace: (...a) => traces.push(a)
    };
    if (legacyKeys) { deps.b1Inventory = baseInventory; deps.intermediate = spaceFreer; }
    else { deps.baseInventory = baseInventory; deps.spaceFreer = spaceFreer; }
    return { coordinator: new Cls(deps), chain, calls, traces, getIntermediate: () => intermediate };
}
test('step3: normalize maps legacy once; generic passes through', () => {
    const legacy = toLegacyChain({ base: 'coal', intermediate: 'mid', output: 'out',
        intermediateRecipe: 'mid-r', outputRecipe: 'out-r', intermediatePerOutput: 16,
        intermediateCrafts: 3, outputCrafts: 4, vaultIntermediate: 5, useAllForIntermediate: true });
    const n = Generic.normalize(legacy);
    assert.equal(n.intermediateId, 'mid');
    assert.equal(n.outputId, 'out');
    assert.equal(n.intermediateRecipeId, 'mid-r');
    assert.equal(n.outputRecipeId, 'out-r');
    assert.equal(n.intermediateCrafts, 3);
    assert.equal(n.outputCrafts, 4);
    assert.equal(n.vaultIntermediate, 5);
    assert.equal(n.useAllForIntermediate, true);
    assert.ok(!('b2Id' in n) && !('b3Id' in n) && !('useAllForB2' in n));
    assert.equal(legacy.b2Id, 'mid');
    const generic = { intermediateId: 'mid', outputId: 'out',
        intermediateRecipeId: 'mid-r', outputRecipeId: 'out-r',
        intermediateCrafts: 1, outputCrafts: 2, vaultIntermediate: 0,
        intermediatePerOutput: 16, intermediateOutputAmount: 1, baseId: 'coal' };
    assert.deepEqual(Generic.normalize(generic), generic);
});
test('step3: full pass completes with B2+B3 settlement order', async () => {
    const h = harnessFor(Generic, { base: 'coal', intermediate: 'mid', output: 'out',
        intermediateRecipe: 'mid-r', outputRecipe: 'out-r',
        intermediatePerOutput: 16, intermediateCrafts: 128, outputCrafts: 8 },
        { overrides: { intermediateAllCrafts: 64 } });
    await h.coordinator.prepare(h.chain, ctx(), { deferIntermediateDeposit: true });
    assert.ok(h.calls.includes('craft:mid-r:ALL') || h.calls.includes('craft:mid-r:64'));
    assert.ok(h.calls.includes('settle-B2'));
    assert.ok(h.calls.includes('settle-B3'));
});
test('step3: partial pass breaks instead of stalling', async () => {
    const h = harnessFor(Generic, { base: 'coal', intermediate: 'mid', output: 'out',
        intermediateRecipe: 'mid-r', outputRecipe: 'out-r', intermediatePerOutput: 16,
        intermediateCrafts: 0, outputCrafts: 0, extra: { partialReservePass: true } }, {});
    h.chain = { ...h.chain, intermediateCrafts: 5 };
    const result = await h.coordinator.prepare(h.chain, ctx(), { deferIntermediateDeposit: true });
    assert.equal(result.outputId, 'out');
});
test('step3: guard 512 throws LOOP_GUARD on livelock', { timeout: 15000 }, async () => {
    const h = harnessFor(Generic, { base: 'coal', intermediate: 'mid', output: 'out',
        intermediateRecipe: 'mid-r', outputRecipe: 'out-r', intermediatePerOutput: 16,
        intermediateCrafts: 0, outputCrafts: 1, vaultIntermediate: 512 },
        { config: { quantityOptimization: { enabled: true, useAllForB3: true }, b3AllMinEmptySlots: 1 },
            overrides: { emptySlots: 0, baseAcquire: { ready: true, available: 0, basePerIntermediate: 16, source: 'inventory' } } });
    await assert.rejects(h.coordinator.prepare(h.chain, ctx(), { deferIntermediateDeposit: true }),
        err => err?.code === 'CRAFT_RESERVE_LOOP_GUARD' || err?.code === 'CRAFT_RESERVE_INPUT_STALLED');
});
test('step3: quantity ALL vs 64 vs 1 for both stages', async () => {
    async function craftsFor(neutral, config, overrides) {
        const h = harnessFor(Generic, neutral, { config, overrides });
        try { await h.coordinator.prepare(h.chain, ctx(), { deferIntermediateDeposit: true }); } catch {}
        return h.calls.filter(c => c.startsWith('craft:'));
    }
    const base = { base: 'coal', intermediate: 'mid', output: 'out',
        intermediateRecipe: 'mid-r', outputRecipe: 'out-r', intermediatePerOutput: 16 };
    const outAll = await craftsFor({ ...base, intermediateCrafts: 0, outputCrafts: 4, inventoryIntermediate: 64 },
        { quantityOptimization: { enabled: true, useAllForOutput: true, useAllForB3: true } }, {});
    assert.ok(outAll.some(c => c === 'craft:out-r:ALL'), 'out ALL: ' + outAll);
    const out64 = await craftsFor({ ...base, intermediateCrafts: 0, outputCrafts: 64, inventoryIntermediate: 2048 },
        { quantityOptimization: { enabled: true } }, {});
    assert.ok(out64.some(c => c === 'craft:out-r:64'), 'out 64: ' + out64);
    const out1 = await craftsFor({ ...base, intermediateCrafts: 0, outputCrafts: 1, inventoryIntermediate: 16 },
        { quantityOptimization: { enabled: true } }, {});
    assert.ok(out1.some(c => c === 'craft:out-r:1'), 'out 1: ' + out1);
    const midAll = await craftsFor({ ...base, intermediateCrafts: 64, outputCrafts: 0, useAllForIntermediate: true }, {}, {});
    assert.ok(midAll.some(c => c === 'craft:mid-r:ALL'), 'mid ALL: ' + midAll);
    const mid64 = await craftsFor({ ...base, intermediateCrafts: 64, outputCrafts: 0 }, {}, {});
    assert.ok(mid64.some(c => c === 'craft:mid-r:64'), 'mid 64: ' + mid64);
    const mid1 = await craftsFor({ ...base, intermediateCrafts: 1, outputCrafts: 0 }, {}, {});
    assert.ok(mid1.some(c => c === 'craft:mid-r:1'), 'mid 1: ' + mid1);
});
test('step3: withdraw decrements vault; cancellation aborts', async () => {
    const h = harnessFor(Generic, { base: 'coal', intermediate: 'mid', output: 'out',
        intermediateRecipe: 'mid-r', outputRecipe: 'out-r', intermediatePerOutput: 16,
        intermediateCrafts: 0, outputCrafts: 1, vaultIntermediate: 64, inventoryIntermediate: 0 },
        { overrides: { waitGain: 64, outputAllCrafts: 1 } });
    await h.coordinator.prepare(h.chain, ctx(), { deferIntermediateDeposit: true });
    assert.ok(h.calls.includes('withdraw'));
    const cancelled = harnessFor(Generic, { base: 'coal', intermediate: 'mid', output: 'out',
        intermediateRecipe: 'mid-r', outputRecipe: 'out-r', intermediatePerOutput: 16,
        intermediateCrafts: 1, outputCrafts: 1 }, {});
    await assert.rejects(cancelled.coordinator.prepare(cancelled.chain, ctx(2, true), { deferIntermediateDeposit: true }),
        err => err?.code === 'CANCELLED');
});
test('step3: space-deferred parks intermediate and replans', async () => {
    const h = harnessFor(Generic, { base: 'coal', intermediate: 'mid', output: 'out',
        intermediateRecipe: 'mid-r', outputRecipe: 'out-r', intermediatePerOutput: 16,
        intermediateCrafts: 0, outputCrafts: 4, inventoryIntermediate: 64 },
        { overrides: { emptySlots: 0,
            ensureFree: { snapshot: { emptySlotCount: 1 }, depositedB2Count: 64, emergencyParkedCurrentB2: true } } });
    h.coordinator.inventoryCounter = { count: () => 0 };
    const result = await h.coordinator.prepare(h.chain, ctx(), { deferIntermediateDeposit: true });
    assert.equal(result.deferredForSpace, true);
    assert.equal(result.parkedIntermediateCount, 64);
    assert.equal(result.parkedB2Count, 64);
});
test('step3: legacy-vs-generic parity on neutral fixtures', async () => {
    const cases = [
        { base: 'coal', intermediate: 'mid', output: 'out', intermediateRecipe: 'mid-r',
            outputRecipe: 'out-r', intermediatePerOutput: 16, intermediateCrafts: 64, outputCrafts: 4 },
        { base: 'coal', intermediate: 'mid', output: 'out', intermediateRecipe: 'mid-r',
            outputRecipe: 'out-r', intermediatePerOutput: 16, intermediateCrafts: 0, outputCrafts: 1, inventoryIntermediate: 16 },
        { base: 'coal', intermediate: 'mid', output: 'out', intermediateRecipe: 'mid-r',
            outputRecipe: 'out-r', intermediatePerOutput: 16, intermediateCrafts: 4, outputCrafts: 0, useAllForIntermediate: true }
    ];
    for (const neutral of cases) {
        const g = harnessFor(Generic, neutral, {});
        const l = harnessFor(Legacy, neutral, { legacyKeys: true });
        const gr = await g.coordinator.prepare(g.chain, ctx(), { deferIntermediateDeposit: true });
        const lr = await l.coordinator.prepare(l.chain, ctx(), { deferIntermediateDeposit: true });
        const norm = calls => calls.map(c => c.replaceAll('mid-r', 'R2').replaceAll('out-r', 'R3').replaceAll('mid', 'M').replaceAll('out', 'O'));
        assert.deepEqual(norm(g.calls), norm(l.calls));
        assert.equal(gr.outputId, 'out');
        assert.equal(lr.b3Id, 'out');
    }
});
test('step3: no chain-specific keys leak; static contract holds', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(require.resolve('../../../src/server-features/crafting/coordinators/CraftReserveChainCoordinator'), 'utf8');
    for (const banned of ['chain.b2Id', 'chain.b3Id', 'chain.b2RecipeId', 'chain.b3RecipeId',
        'chain.b2Crafts', 'chain.b3Crafts', 'chain.vaultB2', 'chain.b3InputPerCraft',
        'chain.b2OutputAmount', 'chain.useAllForB2', 'minFreeForB3All',
        'compactableB1', 'plannedB2Exact']) {
        assert.ok(!src.includes(banned), 'banned token leaks: ' + banned);
    }
    assert.ok(!src.includes('b2Remaining:') && !src.includes('b3Remaining:') && !src.includes('vaultB2Remaining:'));
    assert.equal(CraftAutomationService.CraftReserveChainCoordinator, Generic);
    assert.equal(typeof Generic.normalize, 'function');
});
test('step3: stalled input throws CRAFT_RESERVE_INPUT_STALLED', async () => {
    const h = harnessFor(Generic, { base: 'coal', intermediate: 'mid', output: 'out',
        intermediateRecipe: 'mid-r', outputRecipe: 'out-r', intermediatePerOutput: 16,
        intermediateCrafts: 0, outputCrafts: 1 },
        { overrides: { baseAcquire: { ready: false, reason: 'x', available: 0, basePerIntermediate: 16 } } });
    await assert.rejects(h.coordinator.prepare(h.chain, ctx(), { deferIntermediateDeposit: true }),
        err => err?.code === 'CRAFT_RESERVE_INPUT_STALLED');
});
test('step3 E-pre2: output ALL satisfying target cancels stale remaining intermediate work', async () => {
    // Generic parity with legacy B3 branch (b3Remaining==0 => b2Remaining=0).
    // Neutral fixture: 128 planned intermediate, 4 planned output, ALL output.
    // Expected: intermediate:64 -> output:ALL -> stop (no second intermediate).
    const neutral = { base: 'coal', intermediate: 'mid', output: 'out',
        intermediateRecipe: 'mid-r', outputRecipe: 'out-r', intermediatePerOutput: 16,
        intermediateCrafts: 128, outputCrafts: 4 };
    const cfg = { quantityOptimization: { enabled: true, useAllForB3: true } };
    const g = harnessFor(Generic, neutral, { config: cfg });
    const result = await g.coordinator.prepare(g.chain, ctx(), { deferIntermediateDeposit: true });
    const crafts = g.calls.filter((c) => c.startsWith('craft:'));
    assert.deepEqual(crafts, ['craft:mid-r:64', 'craft:out-r:ALL']);
    assert.equal(result.intermediateId, 'mid');
    assert.equal(result.outputId, 'out');
    assert.equal(result.deferred, true);
    // No unintended side effects: deferred pass performs no deposit, no stall.
    assert.ok(!g.calls.some((c) => c.startsWith('deposit')));
    // Legacy parity on the same neutral shape: identical craft order.
    const l = harnessFor(Legacy, neutral, { config: cfg, legacyKeys: true });
    await l.coordinator.prepare(l.chain, ctx(), { deferIntermediateDeposit: true });
    const norm = (calls) => calls.map((c) => c.replaceAll('mid-r', 'R2').replaceAll('out-r', 'R3'));
    assert.deepEqual(norm(g.calls), norm(l.calls));
});
