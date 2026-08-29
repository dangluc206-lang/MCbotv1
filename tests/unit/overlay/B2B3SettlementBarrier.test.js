'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const B5InventoryState = require('../../../src/server-features/crafting/b5/support/B5InventoryState');

function makeState(sequenceOrFn, config = {}) {
    let index = 0;
    const reader = {
        readBotInventory() {
            const count = typeof sequenceOrFn === 'function'
                ? sequenceOrFn(index++)
                : sequenceOrFn[Math.min(index++, sequenceOrFn.length - 1)];
            return { source: 'bot-inventory', items: [{ logicalId: 'b2', count }], emptySlotCount: 10 };
        }
    };
    const counter = {
        count(snapshot, logicalId) {
            return logicalId === 'b2' ? Number(snapshot?.items?.[0]?.count || 0) : 0;
        }
    };
    return new B5InventoryState({ inventoryReader: reader, inventoryCounter: counter, config });
}

test('waitForSettledCount waits for relevant B2 count to stop changing', async () => {
    const state = makeState([77, 141, 153, 153, 153], {
        b2B3SettlementBarrierTimeoutMs: 400,
        b2B3SettlementBarrierPollMs: 10,
        b2B3SettlementBarrierQuietMs: 15,
        b2B3SettlementBarrierStablePasses: 2
    });
    const result = await state.waitForSettledCount('b2', 153, null);
    assert.equal(result.settled, true);
    assert.equal(result.count, 153);
    assert.ok(result.stablePasses >= 2);
    assert.ok(result.quietForMs >= 15);
});

test('waitForSettledCount times out when relevant B2 keeps changing', async () => {
    const state = makeState(index => 77 + (index * 3), {
        b2B3SettlementBarrierTimeoutMs: 70,
        b2B3SettlementBarrierPollMs: 10,
        b2B3SettlementBarrierQuietMs: 20,
        b2B3SettlementBarrierStablePasses: 2
    });
    const result = await state.waitForSettledCount('b2', 90, null);
    assert.equal(result.settled, false);
    assert.equal(result.timedOut, true);
    assert.ok(result.count >= 90);
});


test('B2->B3 transition is enforced by the shared stage gate', () => {
    const fs = require('node:fs');
    const reserve = fs.readFileSync(require.resolve('../../../src/server-features/crafting/b5/B5ReserveChainCoordinator'), 'utf8');
    const finalCraft = fs.readFileSync(require.resolve('../../../src/server-features/crafting/b5/B5FinalCraftCoordinator'), 'utf8');
    assert.match(reserve, /stage: 'B2'/);
    assert.match(reserve, /nextStage: 'B3'/);
    assert.match(reserve, /stage: 'B3'/);
    assert.match(reserve, /nextStage: 'B4'/);
    assert.match(finalCraft, /waitForSettledCount/);
    assert.match(finalCraft, /stageContract\.requireSettled/);
});

