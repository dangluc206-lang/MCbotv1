'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const B5FinalCraftCoordinator = require('../../../src/server-features/crafting/b5/B5FinalCraftCoordinator');
const B5ReserveChainCoordinator = require('../../../src/server-features/crafting/b5/B5ReserveChainCoordinator');

function token() { return { throwIfCancelled() {} }; }
function context() { return { cancellation: { token: token() }, connectionGeneration: 2, trace: null }; }

function makeFinal({ settleCounts = [] } = {}) {
    let outputCount = 0;
    let settleCalls = 0;
    const recipeRegistry = {
        require(id) {
            if (id === 'b4') return { output: 'b4out', outputAmount: 1, inputs: {} };
            if (id === 'b5') return { output: 'b5out', outputAmount: 1, inputs: { b4in: 1 } };
            if (id === 'b2') return { output: 'b2out', outputAmount: 1, inputs: { b1in: 1 } };
            if (id === 'b3') return { output: 'b3out', outputAmount: 1, inputs: { b2in: 16 } };
            throw new Error(`unknown recipe ${id}`);
        }
    };
    const inventory = {
        count() { return outputCount; },
        countFromSource() { return outputCount; },
        maxCraftable() { return 1; },
        actualCrafts(data) { return data.actualCrafts; },
        allEnabled() { return false; },
        async waitForIncrease(logicalId, before) { return before; },
        async waitForSettledCount(logicalId, minimumCount) {
            settleCalls += 1;
            outputCount = Math.max(outputCount, minimumCount);
            const result = settleCounts[settleCalls - 1] || { settled: true, count: outputCount, elapsedMs: 1, stablePasses: 2, quietForMs: 100 };
            return { ...result, logicalId, minimumCount, count: Math.max(Number(result.count || 0), outputCount) };
        }
    };
    const progressTracker = { set() {}, advance() {} };
    const runStep = async (_ctx, _meta, fn) => ({ data: await fn() });
    const childOptions = (_ctx, opts = {}) => opts;
    const craftFlow = {
        async craft(recipeId) {
            outputCount += 1;
            return { actualCrafts: 1, verification: { before: outputCount - 1, after: outputCount } };
        }
    };
    const coordinator = new B5FinalCraftCoordinator({
        recipeRegistry, inventoryState: inventory, progressTracker,
        withdrawFlow: { async withdraw() {} }, craftFlow, config: { targetId: 'b5out' },
        runStep, childOptions, quantityTrace() {}
    });
    return { coordinator, get settleCalls() { return settleCalls; } };
}

test('craft verifies output but does not perform stage settlement per craft', async () => {
    const final = makeFinal();
    const result = await final.coordinator.craft('b4', 1, context(), 'b4out', { stage: 'B4' });
    assert.equal(result.actualCrafts, 1);
    assert.equal(final.settleCalls, 0);
    assert.equal(result.stageContract.settled, false);
});

test('final-chain executes multiple B4 crafts then settles once at stage boundary', async () => {
    const final = makeFinal();
    await final.coordinator.execute([{ recipeId: 'b4', outputId: 'b4out', crafts: 2 }], context());
    assert.equal(final.settleCalls, 1);
});

test('reserve chain settles B2 once immediately before B3 transition', async () => {
    const calls = [];
    let b2Count = 0;
    let b3Count = 0;
    const finalCraft = {
        async craft(recipeId, quantity, _ctx, outputId) {
            if (recipeId === 'b2') {
                b2Count = 16;
                calls.push('craft-b2');
                return { actualCrafts: 16, stageContract: { stage: 'B2', logicalId: outputId, after: 16 } };
            }
            b3Count = 1;
            calls.push('craft-b3');
            return { actualCrafts: 1, stageContract: { stage: 'B3', logicalId: outputId, after: 1 } };
        },
        async settleStage({ stage }) { calls.push(`settle-${stage}`); return { settled: true, count: stage === 'B2' ? b2Count : b3Count, elapsedMs: 1 }; }
    };
    const inventoryState = {
        snapshot() { return { emptySlotCount: 10 }; },
        count(id) { return id === 'b2' ? b2Count : (id === 'b3' ? b3Count : 16); },
        allEnabled() { return true; },
        actualCrafts(data) { return data.actualCrafts; }
    };
    const reserve = new B5ReserveChainCoordinator({
        flows: {
            withdraw: { async withdraw() {} },
            deposit: { async deposit() {} }
        },
        b1Inventory: { async acquire() { return { ready: true, available: 16, basePerB2: 1, source: 'inventory' }; } },
        intermediate: { async ensureFreeIntermediateSlots() { return { snapshot: { emptySlotCount: 10 }, depositedB2Count: 0 }; } },
        inventoryState,
        inventoryCounter: { count(snapshot, id) { return id === 'b2' ? b2Count : Number(snapshot?.[id] || 0); } },
        progressTracker: { set() {} }, finalCraft, config: { quantityOptimization: { enabled: true, useAllForB2: true, useAllForB3: true } },
        logger: null, runStep: async (_c, _m, fn) => ({ data: await fn() }), childOptions: (_c, o={}) => o, quantityTrace() {}
    });
    const chain = { baseId: 'b1', b2Id: 'b2', b3Id: 'b3', b2RecipeId: 'b2', b3RecipeId: 'b3', b2Crafts: 16, b3Crafts: 1, b3InputPerCraft: 16, useAllForB2: true };
    await reserve.prepare(chain, context(), { deferIntermediateDeposit: true });
    assert.deepEqual(calls, ['craft-b2', 'settle-B2', 'craft-b3', 'settle-B3']);
});


test('reserve chain allows repeated B2 crafts without settling between same-stage mutations', async () => {
    const calls = [];
    let b2Count = 0;
    const finalCraft = {
        async craft(recipeId, quantity, _ctx, outputId) {
            if (recipeId === 'b2') {
                b2Count += 64;
                calls.push(`craft-b2-${b2Count}`);
                return { actualCrafts: 64, stageContract: { stage: 'B2', logicalId: outputId, after: b2Count } };
            }
            calls.push('craft-b3');
            return { actualCrafts: 8, stageContract: { stage: 'B3', logicalId: outputId, after: 8 } };
        },
        async settleStage({ stage }) { calls.push(`settle-${stage}`); return { settled: true, count: stage === 'B2' ? b2Count : 8, elapsedMs: 1 }; }
    };
    const inventoryState = {
        snapshot() { return { emptySlotCount: 10 }; },
        count(id) { return id === 'b2' ? b2Count : (id === 'b3' ? 0 : 64); },
        allEnabled(key) { return key === 'useAllForB2' || key === 'useAllForB3'; },
        actualCrafts(data) { return data.actualCrafts; }
    };
    const reserve = new B5ReserveChainCoordinator({
        flows: { withdraw: { async withdraw() {} }, deposit: { async deposit() {} } },
        b1Inventory: { async acquire() { return { ready: true, available: 128, basePerB2: 1, source: 'inventory' }; } },
        intermediate: { async ensureFreeIntermediateSlots() { return { snapshot: { emptySlotCount: 10 }, depositedB2Count: 0 }; } },
        inventoryState,
        inventoryCounter: { count(_snapshot, id) { return id === 'b2' ? b2Count : 0; } },
        progressTracker: { set() {} }, finalCraft, config: { quantityOptimization: { enabled: true, useAllForB2: true, useAllForB3: true } },
        logger: null, runStep: async (_c, _m, fn) => ({ data: await fn() }), childOptions: (_c, o={}) => o, quantityTrace() {}
    });
    const chain = { baseId: 'b1', b2Id: 'b2', b3Id: 'b3', b2RecipeId: 'b2', b3RecipeId: 'b3', b2Crafts: 128, b3Crafts: 8, b3InputPerCraft: 16, useAllForB2: true };
    await reserve.prepare(chain, context(), { deferIntermediateDeposit: true });
    assert.deepEqual(calls, ['craft-b2-64', 'craft-b2-128', 'settle-B2', 'craft-b3', 'settle-B3']);
});
