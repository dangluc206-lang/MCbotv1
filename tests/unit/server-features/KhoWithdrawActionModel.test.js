'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const KhoWithdrawOperation = require('../../../src/server-features/storage/KhoWithdrawOperation');

function config(overrides = {}) {
    return {
        commandKey: 'storage', guiTimeoutMs: 100, openSettleMs: 0,
        withdraw: {
            enabled: true,
            numericQuantities: [1, 8, 16, 64, 128, 256, 512],
            withdrawPatterns: ['(?:^|\\s)(?:rut|withdraw)(?:\\s|$)'],
            stackPatterns: ['1\\s*stack'],
            fullInventoryPatterns: ['full\\s*inventory'],
            detailTimeoutMs: 100, verifyAttempts: 2, verifyRetryMs: 1,
            unchangedConfirmationReads: 2, minimumOutputSlots: 2,
            allowStack: true, allowFillInventory: true, reuseQuantityGui: true,
            maxWithdrawalActions: 16, maxBatchClicks: 16,
            ...overrides
        }
    };
}

function harness({ required = 128, emptySlots = 10, quantities = [], stack = false, fill = false, reuse = false, initialCount = 0, applyClick = true, withdrawOverrides = {} } = {}) {
    let count = initialCount;
    let transitions = 0;
    let current = null;
    const slotDelta = new Map();
    const inventoryReader = {
        readBotInventory() {
            return { items: count > 0 ? [{ logicalId: 'coal', count, maxStackSize: 64 }] : [], emptySlotCount: emptySlots };
        }
    };
    const inventoryCounter = { count(snapshot, id) { return id === 'coal' ? Number(snapshot.items?.[0]?.count || 0) : 0; } };
    const storage = {
        async read() { return { success: true, data: { items: { coal: 10000 }, sources: { coal: { slot: 7 } } } }; }
    };
    const guiManager = {
        current: reuse ? () => current : undefined,
        async clickAndWaitForTransition() {
            transitions += 1;
            if (transitions % 2 === 1) {
                current = { active: true, window: { slots: [{ displayName: 'Rút' }], inventoryStart: 1 } };
                return current;
            }
            const slots = [];
            for (const quantity of quantities) {
                const slot = slots.length;
                slots.push({ displayName: `Rút ${quantity}` });
                slotDelta.set(slot, quantity);
            }
            if (stack) {
                const slot = slots.length;
                slots.push({ displayName: 'Rút 1 stack' });
                slotDelta.set(slot, 64);
            }
            if (fill) {
                const slot = slots.length;
                slots.push({ displayName: 'Rút full inventory' });
                slotDelta.set(slot, required);
            }
            current = { active: true, window: { slots, inventoryStart: slots.length } };
            return current;
        },
        async click(slot) { if (applyClick) count += slotDelta.get(slot) || 0; },
        describeCurrent() { return { title: 'withdraw' }; }
    };
    const operation = new KhoWithdrawOperation({
        storage, guiManager,
        context: { getGeneration: () => 3 },
        itemResolver: { resolve(item) { return { id: item.logicalId }; } },
        inventoryReader, inventoryCounter, config: config(withdrawOverrides)
    });
    return { operation, count: () => count, transitions: () => transitions };
}

test('STACK can satisfy B1 withdrawal when no numeric button is present', async () => {
    const { operation, count } = harness({ required: 128, stack: true });
    const result = await operation.execute('coal', { requiredAmount: 128, outputId: 'refined_coal', expectedOutputAmount: 2, expectedGeneration: 3 });
    assert.equal(result.success, true);
    assert.deepEqual(result.data.selectedActions, ['STACK', 'STACK']);
    assert.equal(result.data.actionBatches[0].count, 2);
    assert.equal(count(), 128);
});

test('FILL_INVENTORY is accepted only at exact safe capacity boundary', async () => {
    const { operation, count } = harness({ required: 128, emptySlots: 4, fill: true });
    const result = await operation.execute('coal', { requiredAmount: 128, outputId: 'refined_coal', expectedOutputAmount: 2, expectedGeneration: 3 });
    assert.equal(result.success, true);
    assert.deepEqual(result.data.selectedActions, ['FILL_INVENTORY']);
    assert.equal(count(), 128);
});

test('quantity GUI is reused for a repeated STACK batch when server keeps it open', async () => {
    const { operation, transitions } = harness({ required: 128, stack: true, reuse: true });
    const result = await operation.execute('coal', { requiredAmount: 128, outputId: 'refined_coal', expectedOutputAmount: 2, expectedGeneration: 3 });
    assert.equal(result.success, true);
    assert.equal(transitions(), 2, 'overview/detail/quantity route is opened once for the whole two-click batch');
});


test('invalid and disabled requests fail before GUI side effects', async () => {
    const invalidHarness = harness();
    const invalid = await invalidHarness.operation.execute('coal', { requiredAmount: -1, expectedGeneration: 3 });
    assert.equal(invalid.success, false);
    assert.equal(invalid.status, 'INVALID_INPUT');
    assert.equal(invalidHarness.transitions(), 0);

    const disabledHarness = harness({ withdrawOverrides: { enabled: false } });
    const disabled = await disabledHarness.operation.execute('coal', { requiredAmount: 64, expectedGeneration: 3 });
    assert.equal(disabled.success, false);
    assert.equal(disabled.meta?.code, 'KHO_WITHDRAW_DISABLED');
    assert.equal(disabledHarness.transitions(), 0);
});

test('already satisfied inventory skips /kho entirely', async () => {
    const { operation, transitions } = harness({ required: 64, initialCount: 64 });
    const result = await operation.execute('coal', { requiredAmount: 64, expectedGeneration: 3 });
    assert.equal(result.success, true);
    assert.equal(result.data.withdrawalRequired, false);
    assert.equal(result.data.actualDelta, 0);
    assert.equal(transitions(), 0);
});

test('inventory output reservation blocks unsafe withdrawal before GUI open', async () => {
    const { operation, transitions } = harness({ required: 128, emptySlots: 1, stack: true });
    const result = await operation.execute('coal', {
        requiredAmount: 128,
        outputId: 'refined_coal',
        expectedOutputAmount: 64,
        minimumFreeSlots: 2,
        expectedGeneration: 3
    });
    assert.equal(result.success, false);
    assert.equal(result.meta?.code, 'KHO_WITHDRAW_INVENTORY_CAPACITY');
    assert.equal(transitions(), 0);
});

test('action budget fails closed when remaining B1 needs too many clicks', async () => {
    const { operation } = harness({ required: 128, stack: true, withdrawOverrides: { maxWithdrawalActions: 1 } });
    const result = await operation.execute('coal', {
        requiredAmount: 128,
        outputId: 'refined_coal',
        expectedOutputAmount: 2,
        expectedGeneration: 3
    });
    assert.equal(result.success, false);
    assert.match(String(result.meta?.code || ''), /KHO_WITHDRAW_(?:QUANTITY_UNAVAILABLE|ACTION_LIMIT)/);
});

test('unchanged inventory after click is not accepted as a successful withdrawal', async () => {
    const { operation } = harness({ required: 64, stack: true, applyClick: false });
    const result = await operation.execute('coal', {
        requiredAmount: 64,
        outputId: 'refined_coal',
        expectedOutputAmount: 1,
        expectedGeneration: 3
    });
    assert.equal(result.success, false);
    assert.equal(result.meta?.code, 'KHO_WITHDRAW_NOT_VERIFIED');
});

test('stale connection generation aborts before storage navigation', async () => {
    const { operation, transitions } = harness({ required: 64, stack: true });
    await assert.rejects(
        operation.execute('coal', { requiredAmount: 64, expectedGeneration: 2 }),
        error => error?.code === 'KHO_WITHDRAW_STALE_GENERATION'
    );
    assert.equal(transitions(), 0);
});
