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
            stackPatterns: ['1\\s*stack'], fullInventoryPatterns: ['full\\s*inventory'],
            detailTimeoutMs: 100, verifyAttempts: 2, verifyRetryMs: 1,
            unchangedConfirmationReads: 2, minimumOutputSlots: 2,
            ...overrides
        }
    };
}

function harness({
    logicalId = 'lapis_lazuli', initial = 0, stored = 10000,
    clickThrowsAfterApply = false, quantities = [128, 256],
    generationRef = { value: 3 }, emptySlots = 20,
    transitionDelayMs = 0, extraQuantityItems = [], workloadMetrics = null
} = {}) {
    let count = initial;
    let transition = 0;
    const slotQuantity = new Map();
    const inventoryReader = {
        readBotInventory() {
            return {
                items: count > 0 ? [{ logicalId, count, maxStackSize: 64 }] : [],
                emptySlotCount: emptySlots
            };
        }
    };
    const inventoryCounter = { count(snapshot, id) { return id === logicalId ? Number(snapshot.items?.[0]?.count || 0) : 0; } };
    const storage = {
        async read() {
            return { success: true, data: { items: { [logicalId]: stored }, sources: { [logicalId]: { slot: 7 } } } };
        }
    };
    const guiManager = {
        async clickAndWaitForTransition() {
            if (transitionDelayMs > 0) {
                await new Promise(resolve => setTimeout(resolve, transitionDelayMs));
            }
            transition += 1;
            if (transition % 2 === 1) {
                return { window: { slots: [{ displayName: 'Rút' }], inventoryStart: 1 } };
            }
            const slots = quantities.map((quantity, index) => {
                slotQuantity.set(index, quantity);
                return { displayName: `Rút ${quantity}` };
            });
            for (const item of extraQuantityItems) {
                const slot = slots.length;
                slots.push(item);
                if (Number.isInteger(item.withdrawQuantity)) slotQuantity.set(slot, item.withdrawQuantity);
            }
            return { window: { slots, inventoryStart: slots.length } };
        },
        async click(slot) {
            count += slotQuantity.get(slot) || 0;
            if (clickThrowsAfterApply) throw new Error('response lost after applied click');
        },
        describeCurrent() { return { title: 'withdraw quantity' }; }
    };
    const operation = new KhoWithdrawOperation({
        storage, guiManager,
        context: { getGeneration: () => generationRef.value },
        itemResolver: { resolve(item) { return { id: item.logicalId }; } },
        inventoryReader, inventoryCounter, config: config(), workloadMetrics
    });
    return { operation, count: () => count, transitions: () => transition };
}

test('withdrawal emits one aggregated metric instead of one diagnostic record per reconcile read', async () => {
    const records = [];
    const workloadMetrics = {
        measure: async (operation, action) => {
            const counters = {};
            const tracker = { increment(key, amount = 1) { counters[key] = Number(counters[key] || 0) + amount; } };
            const result = await action(tracker);
            records.push({ operation, counters, success: result.success });
            return result;
        }
    };
    const { operation } = harness({ quantities: [128], workloadMetrics });
    const result = await operation.execute('lapis_lazuli', { requiredAmount: 128, expectedGeneration: 3 });
    assert.equal(result.success, true);
    assert.deepEqual(records, [{
        operation: 'storage.withdraw', success: true,
        counters: { overviewOpenCount: 1, detailOpenCount: 1, quantityOpenCount: 1, clickCount: 1, reconcileReadCount: 1 }
    }]);
});

for (const logicalId of ['lapis_lazuli', 'gold_ingot']) {
    test(`withdraws and verifies generic B1 material ${logicalId}`, async () => {
        const { operation, count, transitions } = harness({ logicalId });
        const result = await operation.execute(logicalId, {
            requiredAmount: 384, outputId: logicalId === 'lapis_lazuli' ? 'refined_lapis' : 'refined_gold',
            expectedOutputAmount: 6, expectedGeneration: 3
        });
        assert.equal(result.success, true);
        assert.deepEqual(result.data.selectedActions, [256, 128]);
        assert.equal(result.data.actualDelta, 384);
        assert.equal(count(), 384);
        assert.equal(transitions(), 4, 'each exact action re-enters a fresh material route');
    });
}

test('applied withdrawal with lost click response reconciles inventory and never clicks twice', async () => {
    const { operation, count, transitions } = harness({ logicalId: 'iron_ingot', clickThrowsAfterApply: true, quantities: [128] });
    const result = await operation.execute('iron_ingot', {
        requiredAmount: 128, outputId: 'refined_iron', expectedOutputAmount: 2, expectedGeneration: 3
    });
    assert.equal(result.success, true);
    assert.equal(result.data.actions[0].reconciledAfterClickError, true);
    assert.equal(count(), 128);
    assert.equal(transitions(), 2);
});

test('missing exact quantity button returns a specific wait result without clicking', async () => {
    const { operation, count } = harness({ quantities: [8, 16] });
    const result = await operation.execute('lapis_lazuli', {
        requiredAmount: 3, outputId: 'refined_lapis', expectedOutputAmount: 1, expectedGeneration: 3
    });
    assert.equal(result.success, false);
    assert.equal(result.status, 'NOT_READY');
    assert.equal(result.meta.code, 'KHO_WITHDRAW_QUANTITY_UNAVAILABLE');
    assert.equal(count(), 0);
});

test('existing inventory B1 reduces withdrawal and prevents accumulation across batches', async () => {
    const { operation, count } = harness({ logicalId: 'iron_ingot', initial: 64, quantities: [64] });
    const result = await operation.execute('iron_ingot', {
        requiredAmount: 128, outputId: 'refined_iron', expectedOutputAmount: 2, expectedGeneration: 3
    });
    assert.equal(result.success, true);
    assert.deepEqual(result.data.selectedActions, [64]);
    assert.equal(result.data.actualDelta, 64);
    assert.equal(count(), 128);
});

test('generation change after detail transition aborts before any withdrawal click', async () => {
    const generationRef = { value: 3 };
    const { operation, count } = harness({ generationRef });
    const original = operation.guiManager.clickAndWaitForTransition;
    operation.guiManager.clickAndWaitForTransition = async (...args) => {
        const result = await original(...args);
        generationRef.value = 4;
        return result;
    };
    await assert.rejects(
        operation.execute('lapis_lazuli', { requiredAmount: 128, expectedGeneration: 3 }),
        error => error?.code === 'KHO_WITHDRAW_STALE_GENERATION'
    );
    assert.equal(count(), 0);
});

test('slow GUI transitions are awaited and still resolve the exact numeric action', async () => {
    const { operation, count } = harness({ quantities: [128], transitionDelayMs: 5 });
    const result = await operation.execute('lapis_lazuli', {
        requiredAmount: 128, outputId: 'refined_lapis', expectedOutputAmount: 2,
        expectedGeneration: 3
    });
    assert.equal(result.success, true);
    assert.equal(count(), 128);
});

test('insufficient storage material is a specific wait state and does not click quantity', async () => {
    const { operation, count, transitions } = harness({ stored: 0, quantities: [128] });
    const result = await operation.execute('lapis_lazuli', {
        requiredAmount: 128, outputId: 'refined_lapis', expectedOutputAmount: 2,
        expectedGeneration: 3
    });
    assert.equal(result.success, false);
    assert.equal(result.status, 'NOT_READY');
    assert.equal(result.meta.code, 'KHO_WITHDRAW_MATERIAL_NOT_READY');
    assert.equal(count(), 0);
    assert.equal(transitions(), 0);
});

test('partial storage amount waits before opening material detail or issuing an oversized action', async () => {
    const { operation, count, transitions } = harness({ stored: 64, quantities: [128] });
    const result = await operation.execute('lapis_lazuli', {
        requiredAmount: 128, outputId: 'refined_lapis', expectedOutputAmount: 2,
        expectedGeneration: 3
    });
    assert.equal(result.success, false);
    assert.equal(result.status, 'NOT_READY');
    assert.equal(result.meta.code, 'KHO_WITHDRAW_MATERIAL_NOT_READY');
    assert.equal(result.meta.details.requiredRemaining, 128);
    assert.equal(count(), 0);
    assert.equal(transitions(), 0);
});

test('near-full inventory refuses withdrawal while reserving B2 output capacity', async () => {
    const { operation, count, transitions } = harness({ emptySlots: 2, quantities: [128] });
    const result = await operation.execute('lapis_lazuli', {
        requiredAmount: 128, outputId: 'refined_lapis', expectedOutputAmount: 2,
        expectedGeneration: 3
    });
    assert.equal(result.success, false);
    assert.equal(result.status, 'NOT_READY');
    assert.equal(result.meta.code, 'KHO_WITHDRAW_INVENTORY_CAPACITY');
    assert.equal(count(), 0);
    assert.equal(transitions(), 0);
});

test('stack and full-inventory buttons are never treated as numeric withdrawal actions', async () => {
    const { operation, count } = harness({
        quantities: [128],
        extraQuantityItems: [
            { displayName: 'Rút 1 stack' },
            { displayName: 'Rút đầy inventory' }
        ]
    });
    const result = await operation.execute('lapis_lazuli', {
        requiredAmount: 128, outputId: 'refined_lapis', expectedOutputAmount: 2,
        expectedGeneration: 3
    });
    assert.equal(result.success, true);
    assert.deepEqual(result.data.selectedActions, [128]);
    assert.equal(count(), 128);
});

test('localized numeric quantity text is recognized without relying on a fixed slot', async () => {
    const { operation, count } = harness({
        quantities: [],
        extraQuantityItems: [{ displayName: 'Rút 128 vật phẩm', withdrawQuantity: 128 }]
    });
    const result = await operation.execute('lapis_lazuli', {
        requiredAmount: 128, outputId: 'refined_lapis', expectedOutputAmount: 2,
        expectedGeneration: 3
    });
    assert.equal(result.success, true);
    assert.equal(count(), 128);
});
