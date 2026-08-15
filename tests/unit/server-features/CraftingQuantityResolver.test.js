'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CraftingQuantityResolver = require('../../../src/server-features/crafting/CraftingQuantityResolver');

test('quantity resolver detects 1/64/ALL from the live GUI', () => {
    const resolver = new CraftingQuantityResolver({ quantitySlots: {} });
    const window = { slots: Array(9).fill(null) };
    window.slots[2] = { displayName: 'Chế tạo 1', lore: [] };
    window.slots[4] = { displayName: 'Chế tạo 64', lore: [] };
    window.slots[6] = { displayName: 'ALL - tất cả', lore: [] };

    assert.equal(resolver.resolve(1, window), 2);
    assert.equal(resolver.resolve(64, window), 4);
    assert.equal(resolver.resolve('ALL', window), 6);
    assert.equal(resolver.resolve('all', window), 6);
});


test('quantity resolver detects 64 from component text when displayName/lore are generic', () => {
    const resolver = new CraftingQuantityResolver({ quantitySlots: {} });
    const window = { slots: Array(9).fill(null), inventoryStart: 9 };
    window.slots[2] = { name: 'paper', count: 1, displayName: 'Chế tạo', components: { custom_name: { text: '1' } } };
    window.slots[4] = { name: 'paper', count: 1, displayName: 'Chế tạo', componentMap: new Map([['lore', { data: { text: 'Số lượng 64' } }]]) };
    window.slots[6] = { name: 'barrier', count: 1, displayName: 'Tất cả' };

    assert.equal(resolver.resolve(64, window), 4);
});

test('quantity resolver can use stack count 64 when the button text is generic', () => {
    const resolver = new CraftingQuantityResolver({ quantitySlots: {} });
    const window = { slots: Array(9).fill(null), inventoryStart: 9 };
    window.slots[2] = { name: 'lime_dye', count: 1, displayName: 'Một' };
    window.slots[4] = { name: 'paper', count: 64, displayName: 'Chế tạo' };
    window.slots[6] = { name: 'barrier', count: 1, displayName: 'ALL' };

    assert.equal(resolver.resolve(64, window), 4);
});


test('quantity resolver prefers live semantic text over stale configured slots', () => {
    const resolver = new CraftingQuantityResolver({ quantitySlots: { '1': 20, '64': 22 } });
    const window = { slots: Array(30).fill(null), inventoryStart: 27 };
    // Deliberately move the live buttons away from the configured bootstrap.
    window.slots[20] = { name: 'paper', count: 1, displayName: 'Chế tạo 64' };
    window.slots[22] = { name: 'paper', count: 1, displayName: 'Chế tạo 1' };

    assert.equal(resolver.resolve(1, window), 22);
    assert.equal(resolver.resolve(64, window), 20);
});

test('quantity resolver falls back to known server slots 20=1 and 22=64 when buttons have indistinguishable text', () => {
    const resolver = new CraftingQuantityResolver({ quantitySlots: { '1': 20, '64': 22 } });
    const window = { slots: Array(30).fill(null), inventoryStart: 27 };
    window.slots[20] = { name: 'paper', count: 1, displayName: 'Chế tạo' };
    window.slots[22] = { name: 'paper', count: 1, displayName: 'Chế tạo' };

    assert.equal(resolver.resolve(1, window), 20);
    assert.equal(resolver.resolve(64, window), 22);
});


test('quantity resolver falls back to known server slot 24 for ALL when semantic text is indistinguishable', () => {
    const resolver = new CraftingQuantityResolver({ quantitySlots: { '1': 20, '64': 22, 'ALL': 24 } });
    const window = { slots: Array(30).fill(null), inventoryStart: 27 };
    window.slots[20] = { name: 'paper', count: 1, displayName: 'Chế tạo' };
    window.slots[22] = { name: 'paper', count: 1, displayName: 'Chế tạo' };
    window.slots[24] = { name: 'paper', count: 1, displayName: 'Chế tạo' };

    assert.equal(resolver.resolve('ALL', window), 24);
});
