'use strict';
// Slice 6 Step 4 - generic intermediate coordinator tests (no runtime cutover).
// Neutral fixtures only; legacy adapter at the boundary; parity included.
const test = require('node:test');
const assert = require('node:assert/strict');
const Generic = require('../../../src/server-features/crafting/coordinators/CraftIntermediateCoordinator');
const Legacy = require('../../../src/server-features/crafting/b5/B5IntermediateCoordinator');
const CraftAutomationService = require('../../../src/server-features/crafting/CraftAutomationService');

function token(cancelled = false) {
    return { throwIfCancelled() { if (cancelled) throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' }); } };
}
function ctx(cancelled = false) {
    return { cancellation: { token: token(cancelled) }, trace: { id: 't' } };
}

const MID = 'mid-neutral';
const OUT = 'out-neutral';
const MID_RECIPE = 'mid-recipe-neutral';
const OUT_RECIPE = 'out-recipe-neutral';

function neutralChain(extra = {}) {
    return {
        baseId: 'base-neutral', intermediateId: MID, outputId: OUT,
        intermediateRecipeId: MID_RECIPE, outputRecipeId: OUT_RECIPE,
        intermediatePerOutput: 16, intermediateOutputAmount: 1,
        intermediateCrafts: 0, outputCrafts: 0,
        vaultIntermediate: 0, vaultOutput: 0,
        inventoryIntermediate: 0, inventoryOutput: 0, ...extra
    };
}
function legacyChain(extra = {}) {
    const n = neutralChain(extra);
    return {
        baseId: n.baseId, b2Id: MID, b3Id: OUT,
        b2RecipeId: MID_RECIPE, b3RecipeId: OUT_RECIPE,
        b3InputPerCraft: n.intermediatePerOutput, b2OutputAmount: n.intermediateOutputAmount,
        b2Crafts: n.intermediateCrafts, b3Crafts: n.outputCrafts,
        vaultB2: n.vaultIntermediate, vaultB3: n.vaultOutput,
        inventoryB2: n.inventoryIntermediate, inventoryB3: n.inventoryOutput
    };
}
function harnessFor(Cls, opts) {
    opts = opts || {};
    const counts = opts.counts || {};
    const inspectionData = opts.inspectionData !== undefined ? opts.inspectionData : null;
    const reserveImpl = opts.reserveImpl || null;
    const overrides = opts.overrides || {};
    const policy = opts.policy || {};
    const calls = [];
    const store = { ...counts };
    const inspections = [];
    const inventoryState = {
        count: (id) => Number(store[id] || 0),
        spaceSnapshot: () => ({ emptySlotCount: overrides.emptySlots !== undefined ? overrides.emptySlots : 10 }),
        actualCrafts: (d, q) => (d && typeof d.actualCrafts === 'number' ? d.actualCrafts : Number(q || 0)),
        waitForFreeSlots: async (min) => { calls.push('wait-free:' + min); return { emptySlotCount: Math.max(Number(min || 0), 5) }; }
    };
    const recipeResolver = {
        isTargetDirectlyReady: () => overrides.targetReady === true,
        recipeForOutput: (id) => {
            calls.push('resolve:' + id);
            if (overrides.recipes && Object.prototype.hasOwnProperty.call(overrides.recipes, id)) return overrides.recipes[id];
            if (id === OUT) return { recipeId: OUT_RECIPE, recipe: { inputs: { [MID]: 16 } } };
            if (id === 'final-neutral') return { recipeId: 'final-recipe-neutral', recipe: { inputs: { [OUT]: 2 } } };
            return null;
        }
    };
    const finalCraft = {
        async craft(recipeId, quantity, context, logicalId) {
            calls.push('craft:' + recipeId + ':' + quantity + ':' + logicalId);
            if (overrides.craftImpl) return overrides.craftImpl(recipeId, quantity, logicalId);
            if (recipeId === OUT_RECIPE) { const n = Number(quantity || 0); store[OUT] = Number(store[OUT] || 0) + n; return { actualCrafts: n }; }
            return { actualCrafts: Number(quantity || 0) };
        }
    };
    const flows = {
        deposit: {
            async deposit(id) { calls.push('deposit:' + id); if (overrides.depositImpl) return overrides.depositImpl(id); return { success: true }; },
            async depositRemainders() { calls.push('depositRemainders'); if (overrides.depositRemaindersImpl) return overrides.depositRemaindersImpl(); return { success: true }; }
        }
    };
    const reserveChain = reserveImpl || { async prepare(chain) { calls.push('reserve:' + chain.outputId + ':' + chain.outputCrafts); return { ok: true }; } };
    const seq = Array.isArray(inspectionData) ? inspectionData : [inspectionData];
    const inspect = async () => {
        const next = seq[Math.min(inspections.length + 1, seq.length - 1)] || { chains: [], finalSteps: [] };
        inspections.push(next);
        return { success: true, data: next };
    };
    const first = { success: true, data: seq[0] || { chains: [], finalSteps: [] } };
    const deps = {
        flows, inventoryState,
        inventoryCounter: { count: (snapshot, id) => (overrides.counterImpl ? overrides.counterImpl(snapshot, id) : Number(store[id] || 0)) },
        recipeResolver,
        progressTracker: { set: (s) => calls.push('progress:' + (s && s.state)) },
        finalCraft, config: {},
        runStep: async (_c, _m, fn) => ({ data: await fn() }),
        childOptions: (_c, o) => o || {}
    };
    if (policy.finalStepOrder) deps.finalStepOrder = policy.finalStepOrder;
    if (policy.spaceCandidateOrder) deps.spaceCandidateOrder = policy.spaceCandidateOrder;
    const coordinator = new Cls(deps);
    if (reserveChain && coordinator.setReserveCoordinator) coordinator.setReserveCoordinator(reserveChain);
    return { coordinator, calls, store, inspections, inspect, first, inventoryState };
}
test('step4: normalize maps legacy once; generic passes through', () => {
    const n = Generic.normalize(legacyChain({ intermediateCrafts: 2, outputCrafts: 3, vaultIntermediate: 5 }));
    assert.equal(n.intermediateId, MID);
    assert.equal(n.outputId, OUT);
    assert.equal(n.intermediateRecipeId, MID_RECIPE);
    assert.equal(n.outputRecipeId, OUT_RECIPE);
    assert.equal(n.intermediatePerOutput, 16);
    assert.equal(n.outputCrafts, 3);
    assert.equal(n.vaultIntermediate, 5);
    assert.ok(!('b2Id' in n) && !('b3Id' in n) && !('b3InputPerCraft' in n));
    const generic = neutralChain({ outputCrafts: 1 });
    assert.equal(Generic.normalize(generic), generic);
});

test('step4: promotion success crafts owned intermediates and re-inspects', async () => {
    const after = { chains: [], finalSteps: [] };
    const h = harnessFor(Generic, { counts: { [MID]: 32 }, inspectionData: [{ chains: [neutralChain({ vaultIntermediate: 0 })], finalSteps: [] }, after] });
    const out = await h.coordinator.promoteOwned(h.first, h.inspect, ctx());
    assert.ok(out.actions.some((a) => a.status === 'b2-promoted-to-b3' && a.crafts === 2));
    assert.ok(h.calls.some((c) => c === 'reserve:' + OUT + ':2'));
    assert.equal(h.inspections.length, 1);
    assert.equal(out.inspection.data, after);
});

test('step4: partial promotion skips empty chains and promotes the rest', async () => {
    const h = harnessFor(Generic, { counts: {}, inspectionData: [{ chains: [neutralChain(), neutralChain({ vaultIntermediate: 16 })], finalSteps: [] }] });
    const out = await h.coordinator.promoteOwned(h.first, h.inspect, ctx());
    assert.ok(out.actions.some((a) => a.status === 'b2-promoted-to-b3' && a.crafts === 1));
    assert.ok(h.calls.some((c) => c === 'reserve:' + OUT + ':1'));
});

test('step4: cancellation aborts the promotion loop', async () => {
    const h = harnessFor(Generic, { counts: { [MID]: 64 }, inspectionData: [{ chains: [neutralChain({ vaultIntermediate: 64 })], finalSteps: [] }] });
    await assert.rejects(() => h.coordinator.promoteOwned(h.first, h.inspect, ctx(true)), /cancelled/);
    assert.ok(!h.calls.some((c) => c.startsWith('reserve:')));
});

test('step4: compact-ready crafts capped output and deposits remainders', async () => {
    const data = { chains: [], finalSteps: [{ outputId: OUT, crafts: 5 }] };
    const h = harnessFor(Generic, { counts: { [MID]: 48 }, inspectionData: [data] });
    const done = await h.coordinator.compactReadyOutputs(h.first, ctx(), { targetId: null });
    assert.equal(done.length, 1);
    assert.equal(done[0].ready, 3);
    assert.ok(h.calls.some((c) => c === 'craft:' + OUT_RECIPE + ':3:' + OUT));
    assert.ok(h.calls.includes('depositRemainders'));
    const alias = await h.coordinator.compactReadyB4(h.first, h.inspect, ctx(), { targetId: null });
    assert.equal(alias.length, 1);
});

test('step4: priority policy orders compact-ready and space candidates', async () => {
    const data = { chains: [], finalSteps: [{ outputId: 'other-neutral', crafts: 2 }, { outputId: OUT, crafts: 2 }] };
    const recipes = {
        [OUT]: { recipeId: OUT_RECIPE, recipe: { inputs: { [MID]: 16 } } },
        'other-neutral': { recipeId: 'other-recipe-neutral', recipe: { inputs: { [MID]: 16 } } }
    };
    const order = [];
    const h = harnessFor(Generic, { counts: { [MID]: 64 }, inspectionData: [data],
        overrides: { recipes },
        policy: { finalStepOrder: (steps) => { order.push(steps.map((s) => s.outputId).join(',')); return [...steps].reverse(); } } });
    const done = await h.coordinator.compactReadyOutputs(h.first, ctx(), { targetId: null });
    assert.deepEqual(order, ['other-neutral,' + OUT]);
    assert.deepEqual(done.map((d) => d.outputId), [OUT, 'other-neutral']);
    const space = harnessFor(Generic, { counts: { 'custom-neutral': 5 }, overrides: { emptySlots: 0, depositImpl: () => ({ success: true }) },
        policy: { spaceCandidateOrder: () => ['custom-neutral'] } });
    const freed = await space.coordinator.ensureFreeIntermediateSlots(neutralChain(), ctx(), 1, { reason: 'probe' });
    assert.ok(space.calls.includes('deposit:custom-neutral'));
    assert.ok(Number(freed.snapshot.emptySlotCount || 0) >= 1);
});

test('step4: space success parks one owned stack then offloads candidates', async () => {
    const chain = neutralChain();
    const h = harnessFor(Generic, { counts: { [MID]: 128, 'other-neutral': 10 }, overrides: { emptySlots: 0,
        counterImpl: () => 128,
        depositImpl: (id) => { if (id === MID) h.store[MID] = 64; if (id === 'other-neutral') h.store['other-neutral'] = 0; return { success: true }; } } });
    const out = await h.coordinator.ensureFreeIntermediateSlots(chain, ctx(), 1, { allChains: [neutralChain()] });
    assert.equal(out.depositedB2Count, 64);
    assert.equal(out.emergencyParkedCurrentB2, true);
    assert.ok(h.calls.includes('deposit:' + MID));
});

test('step4: space exhausted throws NO_SPACE with generic details', async () => {
    const h = harnessFor(Generic, { counts: {}, overrides: { emptySlots: 0 } });
    await assert.rejects(() => h.coordinator.ensureFreeIntermediateSlots(neutralChain(), ctx(), 2, { reason: 'probe-space' }), (e) => {
        assert.equal(e.code, 'CRAFT_INTERMEDIATE_NO_SPACE');
        assert.equal(e.details.minFreeSlots, 2);
        assert.ok(!('b2Count' in e.details) && !('b3Count' in e.details));
        assert.ok('intermediateCount' in e.details && 'outputCount' in e.details);
        return true;
    });
});

test('step4: deferred reserve result parks progress and re-inspects', async () => {
    const after = { chains: [], finalSteps: [] };
    const reserveImpl = { async prepare() { return { deferredForSpace: true }; } };
    const h = harnessFor(Generic, { counts: { [MID]: 32 }, inspectionData: [{ chains: [neutralChain({ vaultIntermediate: 32 })], finalSteps: [] }, after], reserveImpl });
    const out = await h.coordinator.promoteOwned(h.first, h.inspect, ctx());
    assert.ok(out.actions.some((a) => a.status === 'b2-pv2-parked-for-space'));
    assert.equal(out.inspection.data, after);
});

test('step4: legacy-vs-generic parity on neutral fixtures', async () => {
    const mkData = () => [{ chains: [legacyChain({ vaultIntermediate: 32 }), legacyChain()], finalSteps: [] }, { chains: [], finalSteps: [] }];
    const mkCounts = () => ({ [MID]: 32 });
    const mkReserve = () => ({ async prepare(chain) { return { ok: true }; } });
    const gData = [{ chains: [neutralChain({ vaultIntermediate: 32 }), neutralChain()], finalSteps: [] }, { chains: [], finalSteps: [] }];
    const g = harnessFor(Generic, { counts: mkCounts(), inspectionData: gData, reserveImpl: mkReserve() });
    const l = harnessFor(Legacy, { counts: mkCounts(), inspectionData: mkData(), reserveImpl: mkReserve() });
    const gOut = await g.coordinator.promoteOwned(g.first, g.inspect, ctx());
    const lOut = await l.coordinator.promoteOwned(l.first, l.inspect, ctx());
    assert.deepEqual(gOut.actions.map((a) => a.status), lOut.actions.map((a) => a.status));
});

test('step4: no chain-specific keys leak; static contract holds', () => {
    const src = require('node:fs').readFileSync('src/server-features/crafting/coordinators/CraftIntermediateCoordinator.js', 'utf8');
    for (const key of ['chain.b2Id', 'chain.b3Id', 'chain.b2Crafts', 'chain.b3Crafts', 'chain.vaultB2', 'chain.vaultB3', 'chain.b3InputPerCraft', 'chain.b2OutputAmount', 'b5Planning', 'B5StorageFlow']) {
        assert.ok(!src.includes(key), key + ' leaks into generic core');
    }
    assert.equal(typeof CraftAutomationService.CraftIntermediateCoordinator, 'function');
    assert.equal(CraftAutomationService.CraftIntermediateCoordinator, Generic);
});
