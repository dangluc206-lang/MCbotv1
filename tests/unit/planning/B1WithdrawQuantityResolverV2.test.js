'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const B1WithdrawQuantityResolver = require('../../../src/planning/storage/B1WithdrawQuantityResolver');
const B1InventoryWithdrawalPlanner = require('../../../src/planning/storage/B1InventoryWithdrawalPlanner');

const ACTION = B1WithdrawQuantityResolver.ACTION;

test('legacy numeric resolver remains exact without amount-indexed DP', () => {
    const resolver = new B1WithdrawQuantityResolver();
    assert.deepEqual(resolver.resolve(384), [256, 128]);
    assert.deepEqual(resolver.resolve(25), [16, 8, 1]);
    assert.equal(resolver.resolve(3, [8, 16]), null);
    const large = resolver.resolve(131072);
    assert.equal(large.length, 256);
    assert.equal(large.every(value => value === 512), true);
});

test('bounded fallback repairs a non-canonical greedy dead end', () => {
    const resolver = new B1WithdrawQuantityResolver({ numericQuantities: [4, 3] });
    assert.deepEqual(resolver.resolve(6, [4, 3]), [3, 3]);
});

test('withdrawal plan supports STACK and batches repeated clicks', () => {
    const resolver = new B1WithdrawQuantityResolver({ numericQuantities: [128], maxWithdrawalActions: 8 });
    const plan = resolver.resolvePlan(192, {
        numericSlots: new Map(),
        stackSlot: 11,
        stackSize: 64,
        fillInventorySlot: null
    });
    assert.equal(plan.actionCount, 3);
    assert.deepEqual(plan.batches, [{ kind: ACTION.STACK, amount: 64, quantity: null, count: 3, slot: 11 }]);
});

test('FILL_INVENTORY is used only when its verified capacity equals the remaining target', () => {
    const resolver = new B1WithdrawQuantityResolver({ maxWithdrawalActions: 8 });
    const exact = resolver.resolvePlan(128, {
        numericSlots: new Map(),
        stackSlot: null,
        fillInventorySlot: 12,
        fillInventoryAmount: 128
    });
    assert.equal(exact.actionCount, 1);
    assert.equal(exact.batches[0].kind, ACTION.FILL_INVENTORY);

    const unsafe = resolver.resolvePlan(64, {
        numericSlots: new Map(),
        stackSlot: null,
        fillInventorySlot: 12,
        fillInventoryAmount: 128
    });
    assert.equal(unsafe, null);
});

test('maxWithdrawalActions rejects plans that would exceed click budget', () => {
    const resolver = new B1WithdrawQuantityResolver({ numericQuantities: [64], maxWithdrawalActions: 2 });
    assert.equal(resolver.resolvePlan(192, { numericSlots: new Map([[64, 3]]) }), null);
});

test('inventory planner exposes a safe FILL_INVENTORY amount only at exact capacity boundary', () => {
    const planner = new B1InventoryWithdrawalPlanner();
    const exact = planner.compile({ requestedAmount: 128, emptySlots: 4, outputAmount: 2, minimumFreeSlots: 2 });
    assert.equal(exact.safe, true);
    assert.equal(exact.safeAdditionalCapacity, 128);
    assert.equal(exact.fillInventoryAmount, 128);

    const smaller = planner.compile({ requestedAmount: 64, emptySlots: 4, outputAmount: 2, minimumFreeSlots: 2 });
    assert.equal(smaller.safe, true);
    assert.equal(smaller.fillInventoryAmount, 0);
});
