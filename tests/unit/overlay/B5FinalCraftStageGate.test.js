'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const B5FinalCraftCoordinator = require('../../../src/server-features/crafting/b5/B5FinalCraftCoordinator');
const B5StageContract = require('../../../src/server-features/crafting/b5/support/B5StageContract');

class InventoryStateMock {
    constructor(sequence) { this.sequence = [...sequence]; this.index = 0; }
    count() { return this.sequence[Math.min(this.index++, this.sequence.length - 1)]; }
    countFromSource() { return this.sequence[Math.min(this.index, this.sequence.length - 1)]; }
    async waitForSettledCount(_id, minimumCount) {
        const counts = [];
        while (this.index < this.sequence.length) counts.push(this.sequence[this.index++]);
        const final = counts.length ? counts[counts.length - 1] : minimumCount;
        if (final < minimumCount) return { settled: false, timedOut: true, count: final };
        return { settled: true, timedOut: false, count: final, stablePasses: 2, quietForMs: 100, elapsedMs: 10 };
    }
    actualCrafts(data, quantity) { return Number(data?.actualCrafts || (quantity === 1 ? 1 : 0)); }
    maxCraftable() { return 1; }
    allEnabled() { return false; }
}

function coordinator(inv, craftData = { actualCrafts: 1 }) {
    const recipeRegistry = { require() { return { output: 'b4', outputAmount: 1, inputs: {} }; } };
    const progressTracker = { set() {}, advance() {} };
    const runStep = async (_ctx, _meta, fn) => ({ data: await fn() });
    const craftFlow = { async craft() { return { actualCrafts: craftData.actualCrafts }; } };
    return new B5FinalCraftCoordinator({ recipeRegistry, inventoryState: inv, progressTracker, withdrawFlow: {}, craftFlow, config: { targetId: 'b5', stageSettlementTimeoutMs: 200 }, runStep, childOptions: () => ({}), quantityTrace: () => {}, verificationService: new B5StageContract() });
}

test('craft verifies the output delta for any generic stage before returning', async () => {
    const inv = new InventoryStateMock([10, 11, 11, 11]);
    const c = coordinator(inv);
    const ctx = { connectionGeneration: 7, cancellation: { token: { throwIfCancelled() {} } }, trace: [] };
    const data = await c.craft('r', 1, ctx, 'b4', { stage: 'INTERMEDIATE', nextStage: 'TARGET' });
    assert.equal(data.stageContract.stage, 'INTERMEDIATE');
    // Per-craft crafts only verify the output; settlement happens once at the
    // stage boundary (see B5StageHandoffBoundary).
    assert.equal(data.stageContract.settled, false);
    assert.equal(data.actualCrafts, 1);
});

test('craft gate fails closed when relevant output never reaches expected count', async () => {
    const inv = new InventoryStateMock([10, 10, 10]);
    const c = coordinator(inv);
    const ctx = { connectionGeneration: 7, cancellation: { token: { throwIfCancelled() {} } }, trace: [] };
    await assert.rejects(() => c.craft('r', 1, ctx, 'b4', { stage: 'INTERMEDIATE', nextStage: 'TARGET' }), /output was not verified|did not settle/);
});

test('stage gate rejects stale generation handoff', async () => {
    const inv = new InventoryStateMock([10, 11, 11, 11]);
    const c = coordinator(inv);
    const ctx = { connectionGeneration: 8, cancellation: { token: { throwIfCancelled() {} } }, trace: [] };
    await assert.rejects(() => c.craft('r', 1, ctx, 'b4', { stage: 'INTERMEDIATE', nextStage: 'TARGET', expectedGeneration: 7 }), /generation/);
});
