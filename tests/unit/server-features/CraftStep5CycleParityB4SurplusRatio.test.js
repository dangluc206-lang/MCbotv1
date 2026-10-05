'use strict';
// ACT E-pre4 - B4 surplus-ratio allocation parity (isolated, no runtime cutover).
// Production-shaped feedback: every crafting.craft() call completes exactly one
// unit (the server craft contract), so a surplus batch only stays in ratio
// parity when both stacks run it through the final-chain execution owner
// (quantity policy + actualCrafts accounting + settlement) instead of one raw
// multi-unit craft() call that skips the quantity loop.
const test = require('node:test');
const assert = require('node:assert/strict');
const Result = require('../../../src/shared/result/Result');
const CraftAutomationService = require('../../../src/server-features/crafting/CraftAutomationService');
const StageExecutionContract = require('../../../src/server-features/crafting/verification/StageExecutionContract');
const Legacy = require('../../../src/server-features/crafting/b5/B5IntermediateCoordinator');
const Generic = require('../../../src/server-features/crafting/coordinators/CraftIntermediateCoordinator');

class HarnessContract extends StageExecutionContract {
    verifyOutput(o) { const d = Number(o?.after) - Number(o?.before);
        if (!Number.isFinite(Number(o?.after)) || d <= 0) return { ...o, tolerated: true };
        return super.verifyOutput(o); }
    requireSettled(o) { if (o?.settlement && o.settlement.settled === false) return o.settlement;
        return super.requireSettled(o); }
}

const RECIPES = {
    a: { output: 'a', inputs: { shared: 1 } },
    b: { output: 'b', inputs: { shared: 1 } },
    c: { output: 'c', inputs: { unavailable: 1 } },
    target: { output: 'target', inputs: { a: 1, b: 2, c: 1 } }
};

// Production-shaped surplus rig: 12 shared units, target needs a:1 b:2 (c is
// uncraftable). crafting.craft() always completes exactly one unit per call.
function surplusRig({ useAllForB4WhenExact = false } = {}) {
    const owned = { a: 0, b: 0, c: 0 };
    let shared = 12;
    const craftOrder = [];
    const planningService = { async inspectAdditional() { return Result.ok({
        personalVault: { totals: { ...owned }, emptySlotCount: 20, items: [] },
        personalVaultPressure: { allowNewIntermediates: true },
        inventoryTotals: {},
        nonStorageAvailable: { ...owned, shared, unavailable: 0 },
        fullPlan: { targetId: 'target', feasible: false },
        finalSteps: [], chains: [], progress: {} }); } };
    const service = new CraftAutomationService({
        craftingVerificationService: new HarnessContract(),
        planningService,
        crafting: { async craft(recipeId) {
            assert.ok(shared > 0, 'surplus allocator must never overdraw the shared input');
            shared -= 1;
            owned[recipeId] += 1;
            craftOrder.push(recipeId);
            return Result.ok({ actualCrafts: 1 }); } },
        personalVault: { async deposit() { return Result.ok({ movedStacks: 1 }); },
            async withdraw() { return Result.ok({ movedStacks: 0 }); },
            async read() { return Result.ok({ totals: { ...owned } }); } },
        storage: {},
        b1Materials: { async compactAll() { return Result.ok({ actualCrafts: 1, verification: { before: 0, after: 1 } }); } },
        inventoryReader: { readBotInventory: () => ({ source: 'bot-inventory', emptySlotCount: 35, counts: { shared } }) },
        inventoryCounter: { count: (snapshot, id) => Number(snapshot.counts?.[id] || 0) },
        recipeRegistry: { ids: () => Object.keys(RECIPES), require: id => RECIPES[id] },
        operationManager: { async run(op) { return Result.ok(await op.executor({ cancellation: { token: { throwIfCancelled() {}, onCancelled() { return () => {}; } } } })); } },
        config: { targetId: 'target', timeoutMs: 1000,
            quantityOptimization: { enabled: true, useAllForB4WhenExact } }
    });
    return { service, craftOrder, owned };
}

function ctx(cancelled = false) {
    return { cancellation: { token: { throwIfCancelled() { if (cancelled) throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' }); },
        onCancelled() { return () => {}; } } }, connectionGeneration: 7, trace: null };
}
function opts() {
    return { additional: true, mode: 'maintenance', craftFinalTarget: false, allowNewB2: false,
        freshInspection: false, recoveryOnly: false, targetId: null,
        decompressionPolicy: 'unbounded', decompressionMaxUsageRatio: null, requireKnownCapacity: false };
}


test('e-pre4: generic surplus allocation reproduces the legacy B4 ratio order (production-shaped parity)', async () => {
    const l = surplusRig();
    await l.service.cycle.execute(1, ctx(), opts());
    const g = surplusRig();
    await g.service.genericCycle.execute(1, ctx(), opts());
    // Legacy order semantics locked: fill priority shortage (a:1, b:2), then
    // top up the least-covered output by ratio (b,b,a) until shared runs dry.
    assert.deepEqual(l.craftOrder.slice(0, 6), ['a', 'b', 'b', 'b', 'b', 'a'], 'legacy order lock: ' + JSON.stringify(l.craftOrder));
    assert.deepEqual(g.craftOrder.slice(0, 6), ['a', 'b', 'b', 'b', 'b', 'a'], 'generic must reproduce the legacy surplus order: ' + JSON.stringify(g.craftOrder));
    assert.deepEqual(g.craftOrder, l.craftOrder, 'full allocation order parity');
    assert.deepEqual(g.owned, l.owned, 'allocated totals parity');
    assert.ok(Math.abs(g.owned.b / 2 - g.owned.a) <= 1, 'per-target ratio invariant: ' + JSON.stringify(g.owned));
    assert.equal(g.owned.c, 0, 'uncraftable target input is never fabricated');
});

test('e-pre4: surplus allocation stays in parity with exact-ALL enabled (policy preserved)', async () => {
    const l = surplusRig({ useAllForB4WhenExact: true });
    await l.service.cycle.execute(1, ctx(), opts());
    const g = surplusRig({ useAllForB4WhenExact: true });
    await g.service.genericCycle.execute(1, ctx(), opts());
    assert.deepEqual(g.craftOrder, l.craftOrder, 'exact-ALL variant order parity: ' + JSON.stringify(g.craftOrder));
    assert.deepEqual(g.owned, l.owned, 'exact-ALL variant totals parity');
    assert.deepEqual(g.craftOrder.slice(0, 6), ['a', 'b', 'b', 'b', 'b', 'a'], 'ratio order stays locked under exact-ALL');
});


// Stale cancellation: an already-cancelled token must abort surplus promotion
// before any craft side effect, on both the legacy and the generic coordinator.
test('e-pre4: stale cancellation aborts surplus promotion before any craft (legacy and generic)', async () => {
    const run = async (Cls) => {
        const order = [];
        let shared = 12;
        const owned = { a: 0, b: 0, c: 0 };
        const snapshot = () => ({ personalVault: { totals: { ...owned }, emptySlotCount: 20, items: [] },
            personalVaultPressure: { allowNewIntermediates: true },
            inventoryTotals: {}, nonStorageAvailable: { ...owned, shared, unavailable: 0 },
            fullPlan: { targetId: 'target', feasible: false }, finalSteps: [], chains: [], progress: {} });
        const inspect = async () => ({ success: true, data: snapshot() });
        const finalCraft = {
            async craft(recipeId, quantity) {
                for (let i = 0; i < Number(quantity || 0); i += 1) { order.push(recipeId); shared -= 1; owned[recipeId] += 1; }
                return { actualCrafts: Number(quantity || 0) };
            },
            async execute(steps) {
                for (const step of steps || []) await finalCraft.craft(step.recipeId, step.crafts);
                return { data: { steps } };
            }
        };
        const coordinator = new Cls({
            flows: { deposit: { async deposit() { return { success: true }; } } },
            inventoryState: { count: (id) => Number(({ shared, ...rest })[id] || 0), actualCrafts: (d, q) => (d && typeof d.actualCrafts === 'number' ? d.actualCrafts : Number(q || 0)) },
            inventoryCounter: { count: () => 0 },
            recipeResolver: { isTargetDirectlyReady: () => false, recipeForOutput: (id) => (RECIPES[id] ? { recipeId: id, recipe: RECIPES[id] } : null) },
            progressTracker: { set() {}, sync() {}, advance() {} },
            finalCraft,
            config: {},
            runStep: async (_c, _m, fn) => ({ data: await fn() }),
            childOptions: (_c, o) => o || {}
        });
        await assert.rejects(() => coordinator.promoteOwned({ success: true, data: snapshot() }, inspect, ctx(true)), /cancelled/);
        return order;
    };
    assert.deepEqual(await run(Legacy), [], 'legacy: cancelled promotion must not craft');
    assert.deepEqual(await run(Generic), [], 'generic: cancelled promotion must not craft');
});
