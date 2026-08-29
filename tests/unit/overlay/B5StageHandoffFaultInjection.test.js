'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const B5InventoryState = require('../../../src/server-features/crafting/b5/support/B5InventoryState');
const B5FinalCraftCoordinator = require('../../../src/server-features/crafting/b5/B5FinalCraftCoordinator');

function ctx() { return { cancellation: { token: { throwIfCancelled() {} } }, connectionGeneration: 7, trace: null }; }

function makeInventoryState(sequence, unrelatedSequence = []) {
    let i = 0;
    const reader = {
        readViews() {
            const b2 = sequence[Math.min(i, sequence.length - 1)];
            const other = unrelatedSequence.length ? unrelatedSequence[Math.min(i, unrelatedSequence.length - 1)] : 0;
            i += 1;
            return [
                { source: 'bot-inventory', items: [{ logicalId: 'b2', count: b2 }], emptySlotCount: 5 },
                { source: 'personal-vault-2', items: [{ logicalId: 'b2', count: other }], emptySlotCount: 20 }
            ];
        },
        readBotInventory() {
            const b2 = sequence[Math.min(i, sequence.length - 1)];
            i += 1;
            return { source: 'bot-inventory', items: [{ logicalId: 'b2', count: b2 }], emptySlotCount: 5 };
        }
    };
    const counter = { count(snapshot, logicalId) { return logicalId === 'b2' ? Number(snapshot?.items?.[0]?.count || 0) : 0; } };
    return new B5InventoryState({ inventoryReader: reader, inventoryCounter: counter, config: { stageSettlementTimeoutMs: 200, stageSettlementPollMs: 5, stageSettlementQuietMs: 5, stageSettlementStablePasses: 2 } });
}

test('settlement ignores unrelated PV2 changes when scoped to bot inventory', async () => {
    const state = makeInventoryState([8, 8, 8], [1, 2, 999]);
    const result = await state.waitForSettledCount('b2', 8, null, { source: 'bot-inventory', timeoutMs: 100, pollMs: 5, quietMs: 5, stablePasses: 2 });
    assert.equal(result.settled, true);
    assert.equal(result.count, 8);
});

test('final B4 stage settlement happens once after all repeated crafts', async () => {
    let settleCalls = 0;
    let crafts = 0;
    const inventoryState = {
        count() { return crafts; },
        countFromSource() { return crafts; },
        maxCraftable() { return 1; },
        actualCrafts(data) { return data.actualCrafts; },
        allEnabled() { return false; },
        async waitForIncrease(_id, before) { return before; },
        async waitForSettledCount(_id, min) { settleCalls += 1; return { settled: true, count: min, elapsedMs: 1, stablePasses: 2, quietForMs: 10 }; }
    };
    const final = new B5FinalCraftCoordinator({
        recipeRegistry: { require() { return { output: 'b4out', outputAmount: 1, inputs: {} }; } },
        inventoryState, progressTracker: { set() {}, advance() {} },
        withdrawFlow: { async withdraw() {} },
        craftFlow: { async craft() { crafts += 1; return { actualCrafts: 1, verification: { before: crafts - 1, after: crafts } }; } },
        config: { targetId: 'b5out' }, runStep: async (_c, _m, fn) => ({ data: await fn() }), childOptions: (_c, o={}) => o, quantityTrace() {}
    });
    await final.execute([{ recipeId: 'b4', outputId: 'b4out', crafts: 4 }], ctx());
    assert.equal(crafts, 4);
    assert.equal(settleCalls, 1);
});

test('stage timeout blocks handoff after output is verified', async () => {
    let settleCalls = 0;
    let crafts = 0;
    const inventoryState = {
        count() { return crafts; }, countFromSource() { return crafts; }, maxCraftable() { return 1; }, actualCrafts(data) { return data.actualCrafts; },
        allEnabled() { return false; }, async waitForIncrease(_id, before) { return before; },
        async waitForSettledCount(_id, min) { settleCalls += 1; return { settled: false, timedOut: true, count: min, stablePasses: 1, quietForMs: 1, elapsedMs: 200 }; }
    };
    const final = new B5FinalCraftCoordinator({
        recipeRegistry: { require() { return { output: 'b4out', outputAmount: 1, inputs: {} }; } },
        inventoryState, progressTracker: { set() {}, advance() {} }, withdrawFlow: { async withdraw() {} },
        craftFlow: { async craft() { crafts += 1; return { actualCrafts: 1, verification: { before: crafts - 1, after: crafts } }; } },
        config: { targetId: 'b5out' }, runStep: async (_c, _m, fn) => ({ data: await fn() }), childOptions: (_c, o={}) => o, quantityTrace() {}
    });
    await assert.rejects(final.execute([{ recipeId: 'b4', outputId: 'b4out', crafts: 1 }], ctx()), /did not settle/);
    assert.equal(crafts, 1);
    assert.equal(settleCalls, 1);
});
