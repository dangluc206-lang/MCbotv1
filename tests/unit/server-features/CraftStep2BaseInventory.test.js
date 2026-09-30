'use strict';
// Slice 6 Step 2 - generic base-inventory leaf tests (no runtime cutover).
// Covers acquire/return parity against the legacy coordinator on neutral
// fixtures plus boundary gates. No test depends on chain-specific naming.
const test = require('node:test');
const assert = require('node:assert/strict');
const CraftBaseInventoryCoordinator = require('../../../src/server-features/crafting/coordinators/CraftBaseInventoryCoordinator');
const LegacyCoordinator = require('../../../src/server-features/crafting/b5/B5B1InventoryCoordinator');
const StageExecutionContract = require('../../../src/server-features/crafting/verification/StageExecutionContract');
const { fromLegacyChain } = require('../../../src/server-features/crafting/support/CraftChainAdapter');

function ctx() { return { trace: { id: 't' }, connectionGeneration: 2, cancellation: { token: { throwIfCancelled() {} } } }; }
function harness(opts) {
    opts = opts || {};
    const source = opts.source || 'inventory';
    const configured = opts.configuredSource !== undefined ? opts.configuredSource : 'inventory';
    let count = opts.count !== undefined ? opts.count : 0;
    let slots = opts.emptySlots !== undefined ? opts.emptySlots : 6;
    const seen = { acquire: null, freed: null, returned: 0 };
    const inventoryState = {
        count(id) { return id === 'coal' ? count : 0; },
        spaceSnapshot() { return { emptySlotCount: slots }; }
    };
    const storageFlow = {
        async returnBaseInventory(id) {
            seen.returned += count;
            count = 0;
            slots = opts.emptySlots !== undefined ? opts.emptySlots : 6;
            if (opts.returnReady === false) return { success: true, data: { ready: false, resource: id } };
            return { success: true, data: { ready: true, moved: seen.returned, resource: id } };
        }
    };
    const flow = {
        source,
        async acquire(id, requiredAmount, options) {
            seen.acquire = { id, requiredAmount, options };
            count = requiredAmount;
            return { success: true, data: { source: 'inventory', actualDelta: requiredAmount } };
        }
    };
    const mk = (Cls, extra) => new Cls(Object.assign({
        storageFlow, inventoryState,
        recipeRegistry: { require: () => ({ inputs: { coal: 16 } }) },
        config: { inventorySafetyEmptySlots: 2, b2InputSource: configured, inputSource: configured },
        runStep(_c, _s, action) { return action(); },
        childOptions(_c, extra2) { return extra2 || {}; },
        ensureFreeIntermediateSlots(_chain, _ctx2, _min, _opts2) { seen.freed = _opts2 || null; slots += 4; return { snapshot: { emptySlotCount: slots } }; },
        verificationService: new StageExecutionContract()
    }, extra || {}));
    const generic = mk(CraftBaseInventoryCoordinator, { storageFlow, inputAcquisition: flow, b2Input: flow });
    const legacy = mk(LegacyCoordinator, { storageFlow, b2Input: flow });
    const legacyChain = { baseId: 'coal', b2Id: 'refined_coal', b2RecipeId: 'refined_coal', b3InputPerCraft: 4 };
    const genericChain = fromLegacyChain(legacyChain);
    return { generic, legacy, legacyChain, genericChain, seen, setCount(v) { count = v; }, setSlots(v) { slots = v; } };
}
test('step2: acquire success parity (generic vs legacy, neutral fixture)', async () => {
    const g = harness({ count: 0, emptySlots: 6 });
    const l = harness({ count: 0, emptySlots: 6 });
    const opts = { intermediateRemaining: 3, b2Remaining: 3, minFreeForOutputAll: 1, minFreeForB3All: 1 };
    const a = await g.generic.acquire(g.genericChain, ctx(), { intermediateRemaining: 3, minFreeForOutputAll: 1 });
    const b = await l.legacy.acquire(l.legacyChain, ctx(), opts);
    assert.equal(a.ready, true);
    assert.equal(a.available, b.available);
    assert.equal(a.craftable, b.craftable);
    assert.equal(a.basePerIntermediate, 16);
    assert.equal(a.plannedCrafts, 3);
    assert.equal(a.reserveSlots, b.reserveSlots);
    assert.equal(a.maxAmount, b.maxAmount);
    assert.equal(a.intermediateId, 'refined_coal');
    assert.ok(!('b2Id' in a));
});
test('step2: missing input stays not-ready without withdraw', async () => {
    const h = harness({ count: 0, emptySlots: 1 });
    h.generic.ensureFreeIntermediateSlots = async () => ({ snapshot: { emptySlotCount: 1 } });
    const r = await h.generic.acquire(h.genericChain, ctx(), { intermediateRemaining: 4, minFreeForOutputAll: 2 });
    assert.equal(r.ready, false);
    assert.equal(r.reason, 'b1-transfer-not-ready');
    assert.equal(r.craftable, 0);
});
test('step2: storage/inventory quantity parity', async () => {
    const storageHarness = harness({ source: 'storage', configuredSource: 'storage', count: 0, emptySlots: 6 });
    const s = await storageHarness.generic.acquire(storageHarness.genericChain, ctx(), { intermediateRemaining: 3, minFreeForOutputAll: 1 });
    assert.equal(s.source, 'storage');
    assert.equal(s.available, 48);
    assert.equal(s.craftable, 3);
    assert.equal(s.transfer, null);
    const inv = harness({ count: 0, emptySlots: 6 });
    const v = await inv.generic.acquire(inv.genericChain, ctx(), { intermediateRemaining: 3, minFreeForOutputAll: 1 });
    assert.equal(v.available, 48);
    assert.equal(v.craftable, 3);
    assert.equal(s.available, v.available);
});
test('step2: stale rebalance + headroom + zero-slot + return + incomplete', async () => {
    const h = harness({ count: 32, emptySlots: 1 });
    const r = await h.generic.acquire(h.genericChain, ctx(), { intermediateRemaining: 2, minFreeForOutputAll: 1 });
    assert.equal(h.seen.returned, 32);
    assert.equal(r.ready, true);
    assert.equal(r.available, 32);
    const headroom = harness({ count: 64, emptySlots: 0 });
    headroom.generic.storageFlow = { async returnBaseInventory() { return { success: true, data: { ready: true, moved: 0 } }; } };
    headroom.generic.ensureFreeIntermediateSlots = async () => { throw new Error('must not free: headroom is terminal'); };
    const hr = await headroom.generic.acquire(headroom.genericChain, ctx(), { intermediateRemaining: 4, minFreeForOutputAll: 1 });
    assert.equal(hr.ready, false);
    assert.equal(hr.reason, 'b1-inventory-headroom-not-ready');
    assert.equal(hr.available, 64);
    const zero = harness({ count: 0, emptySlots: 0 });
    let freedWith = null;
    zero.generic.ensureFreeIntermediateSlots = async (_c, _x, _m, o) => { freedWith = o; return { snapshot: { emptySlotCount: 1 } }; };
    await zero.generic.acquire(zero.genericChain, ctx(), { intermediateRemaining: 2, minFreeForOutputAll: 1 });
    assert.equal(freedWith.reason, 'reserve one B1 transfer slot before B2');
    const ret = harness({ count: 32, emptySlots: 6 });
    const out = await ret.generic.returnToStorage(ret.genericChain, ctx());
    assert.equal(out.returned, 32);
    assert.equal(out.remaining, 0);
    const noop = harness({ count: 0, emptySlots: 6 });
    assert.equal((await noop.generic.returnToStorage(noop.genericChain, ctx())).skipped, true);
    const stuck = harness({ count: 32, emptySlots: 6 });
    stuck.generic.inventoryState.count = () => 32;
    await assert.rejects(stuck.generic.returnToStorage(stuck.genericChain, ctx()), e => e && e.code === 'CRAFT_B1_RETURN_INCOMPLETE');
    const notReady = harness({ count: 32, emptySlots: 6, returnReady: false });
    await assert.rejects(notReady.generic.returnToStorage(notReady.genericChain, ctx()), e => e && e.code === 'CRAFT_B1_RETURN_NOT_READY');
});
test('step2: stale generation + cancellation + contract boundaries', async () => {
    // Generation guard lives in the B1->B2 stage handoff: storage-mode acquire
    // asserts INPUT_READY then hands off with the caller generation, so a
    // caller/connection mismatch surfaces as CRAFT_STAGE_STALE_GENERATION.
    // (No runStep side effect precedes the handoff in this branch.)
    const storageHarness = harness({ source: 'storage', configuredSource: 'storage', count: 0, emptySlots: 6 });
    const badGen = { trace: { id: 't' }, connectionGeneration: 3, cancellation: { token: { throwIfCancelled() {} } } };
    const acquireWithCallerGen = (coord, chain, connGen, callerGen) => {
        const real = coord.stageContract.handoff.bind(coord.stageContract);
        coord.stageContract.handoff = args => real({ ...args, generation: callerGen });
        return coord.acquire(chain, { trace: { id: 't' }, connectionGeneration: connGen, cancellation: { token: { throwIfCancelled() {} } } }, { intermediateRemaining: 3, minFreeForOutputAll: 1 })
            .finally(() => { coord.stageContract.handoff = real; });
    };
    await assert.rejects(acquireWithCallerGen(storageHarness.generic, storageHarness.genericChain, 3, 2), e => e && e.code === 'CRAFT_STAGE_STALE_GENERATION');
    // Legacy twin takes the same branch with the same caller/connection skew.
    const legacyStorage = harness({ source: 'storage', configuredSource: 'storage', count: 0, emptySlots: 6 });
    const realLegacy = legacyStorage.legacy.stageContract.handoff.bind(legacyStorage.legacy.stageContract);
    legacyStorage.legacy.stageContract.handoff = args => realLegacy({ ...args, generation: 2 });
    await assert.rejects(legacyStorage.legacy.acquire(legacyStorage.legacyChain, { trace: { id: 't' }, connectionGeneration: 3, cancellation: { token: { throwIfCancelled() {} } } }, { b2Remaining: 3, minFreeForB3All: 1 }), e => e && e.code === 'CRAFT_STAGE_STALE_GENERATION');
    legacyStorage.legacy.stageContract.handoff = realLegacy;
    const cancelHarness = harness({ count: 0, emptySlots: 0 });
    cancelHarness.generic.runStep = async () => { const e = new Error('x'); e.code = 'CANCELLED'; throw e; };
    const cancelled = { trace: { id: 't' }, connectionGeneration: 2, cancellation: { token: { throwIfCancelled() {} } } };
    await assert.rejects(cancelHarness.generic.acquire(cancelHarness.genericChain, cancelled, { intermediateRemaining: 3, minFreeForOutputAll: 1 }), e => e && e.code === 'CANCELLED');
    const badFlow = harness({ count: 0, emptySlots: 6 });
    badFlow.generic.inputAcquisition = { source: 'weird', acquire: async () => ({}) };
    await assert.rejects(badFlow.generic.acquire(badFlow.genericChain, ctx(), { intermediateRemaining: 1 }), e => e && e.code === 'CRAFT_B1_INPUT_FLOW_UNAVAILABLE');
    const mismatch = harness({ source: 'storage', configuredSource: 'inventory', count: 0, emptySlots: 6 });
    await assert.rejects(mismatch.generic.acquire(mismatch.genericChain, ctx(), { intermediateRemaining: 1 }), e => e && e.code === 'CRAFT_B1_INVENTORY_TRANSFER_UNAVAILABLE');
    const noReturn = harness({ count: 8, emptySlots: 6 });
    noReturn.generic.storageFlow = {};
    await assert.rejects(noReturn.generic.returnToStorage(noReturn.genericChain, ctx()), e => e && e.code === 'CRAFT_B1_RETURN_UNAVAILABLE');
});
test('step2: legacy-shaped chain accepted at compat boundary', async () => {
    const h = harness({ count: 0, emptySlots: 6 });
    const viaLegacy = await h.generic.acquire(h.legacyChain, ctx(), { b2Remaining: 3, minFreeForB3All: 1 });
    assert.equal(viaLegacy.ready, true);
    assert.equal(viaLegacy.available, 48);
    assert.equal(viaLegacy.intermediateId, 'refined_coal');
    const viaGeneric = await h.generic.acquire(h.genericChain, ctx(), { intermediateRemaining: 1, minFreeForOutputAll: 1 });
    assert.equal(viaGeneric.ready, true);
});
test('step2: full parity matrix generic vs legacy (acquire + return)', async () => {
    const cases = [
        { count: 0, emptySlots: 6, opts: { r: 3, s: 1 } },
        { count: 32, emptySlots: 1, opts: { r: 2, s: 1 } },
        { count: 64, emptySlots: 6, opts: { r: 4, s: 2 } }
    ];
    for (const c of cases) {
        const g = harness({ count: c.count, emptySlots: c.emptySlots });
        const l = harness({ count: c.count, emptySlots: c.emptySlots });
        const a = await g.generic.acquire(g.genericChain, ctx(), { intermediateRemaining: c.opts.r, minFreeForOutputAll: c.opts.s });
        const b = await l.legacy.acquire(l.legacyChain, ctx(), { b2Remaining: c.opts.r, minFreeForB3All: c.opts.s });
        assert.equal(a.ready, b.ready);
        assert.equal(a.available, b.available);
        assert.equal(a.craftable, b.craftable);
        assert.equal(a.reserveSlots, b.reserveSlots);
        assert.equal(a.maxAmount, b.maxAmount);
        const gr = harness({ count: 24, emptySlots: 6 });
        const lr = harness({ count: 24, emptySlots: 6 });
        const ra = await gr.generic.returnToStorage(gr.genericChain, ctx());
        const rb = await lr.legacy.returnToStorage(lr.legacyChain, ctx());
        assert.deepEqual({ returned: ra.returned, remaining: ra.remaining, skipped: ra.skipped }, { returned: rb.returned, remaining: rb.remaining, skipped: rb.skipped });
    }
});
test('step2: no chain-specific keys leak; static contract holds', async () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(require.resolve('../../../src/server-features/crafting/coordinators/CraftBaseInventoryCoordinator'), 'utf8');
    assert.match(src, /stageContract\.requireInputReady/);
    assert.match(src, /stageContract\.handoff\(\{ from: 'B1', to: 'B2'/);
    assert.doesNotMatch(src, /chain\.b2Id/);
    assert.doesNotMatch(src, /chain\.b3Id/);
    assert.doesNotMatch(src, /chain\.b2RecipeId/);
    assert.doesNotMatch(src, /compactableB1/);
    assert.doesNotMatch(src, /plannedB2Exact/);
    const h = harness({ count: 0, emptySlots: 6 });
    const r = await h.generic.acquire(h.genericChain, ctx(), { intermediateRemaining: 2, minFreeForOutputAll: 1 });
    assert.ok(!('b2Id' in r) && !('basePerB2' in r));
    assert.equal(r.basePerIntermediate, 16);
});