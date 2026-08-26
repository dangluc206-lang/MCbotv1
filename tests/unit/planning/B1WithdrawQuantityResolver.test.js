'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const B1WithdrawQuantityResolver = require('../../../src/planning/storage/B1WithdrawQuantityResolver');
const B1InventoryWithdrawalPlanner = require('../../../src/planning/storage/B1InventoryWithdrawalPlanner');

test('B1 withdrawal resolver uses the fewest exact numeric actions', () => {
    const resolver = new B1WithdrawQuantityResolver();
    assert.deepEqual(resolver.resolve(384), [256, 128]);
    assert.deepEqual(resolver.resolve(768), [512, 256]);
    assert.deepEqual(resolver.resolve(25), [16, 8, 1]);
    assert.deepEqual(resolver.resolve(0), []);
});

test('B1 withdrawal resolver uses only buttons proven present in the live GUI', () => {
    const resolver = new B1WithdrawQuantityResolver();
    assert.deepEqual(resolver.resolve(384, [64, 128, 256]), [256, 128]);
    assert.equal(resolver.resolve(3, [8, 16]), null);
});

test('inventory withdrawal planner reserves capacity for B2 output and safety floor', () => {
    const planner = new B1InventoryWithdrawalPlanner();
    const blocked = planner.compile({
        requestedAmount: 384,
        inventoryCount: 0,
        emptySlots: 7,
        outputAmount: 64,
        minimumFreeSlots: 2
    });
    assert.equal(blocked.reservedEmptySlots, 2);
    assert.equal(blocked.safeAdditionalCapacity, 320);
    assert.equal(blocked.safe, false);

    const safe = planner.compile({
        requestedAmount: 384,
        inventoryCount: 0,
        emptySlots: 7,
        inputMergeCapacity: 64,
        outputAmount: 64,
        minimumFreeSlots: 2
    });
    assert.equal(safe.safe, true);
});

test('inventory withdrawal planner accounts for existing B2 merge capacity', () => {
    const planner = new B1InventoryWithdrawalPlanner();
    const plan = planner.compile({
        requestedAmount: 128,
        emptySlots: 3,
        outputAmount: 32,
        outputMergeCapacity: 32,
        minimumFreeSlots: 1
    });
    assert.equal(plan.outputSlots, 0);
    assert.equal(plan.reservedEmptySlots, 1);
    assert.equal(plan.safe, true);
});

test('quantity resolver handles large B1 requirements without materializing subtotal action paths', () => {
    const resolver = new B1WithdrawQuantityResolver();
    const result = resolver.resolve(131072);
    assert.equal(result.length, 256);
    assert.equal(result.every(quantity => quantity === 512), true);
});
