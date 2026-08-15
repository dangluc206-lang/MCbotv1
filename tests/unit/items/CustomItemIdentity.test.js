'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ItemNormalizer = require('../../../src/items/ItemNormalizer');

function customData(ids) {
    const value = {};
    for (const [key, id] of Object.entries(ids)) value[key] = { type: 'string', value: id };
    return new Map([
        ['minecraft:custom_data', { type: 'compound', value }]
    ]);
}

test('ItemNormalizer preserves MMOItems identity independently from vanilla carrier/display name', () => {
    const normalizer = new ItemNormalizer();
    const item = normalizer.normalize({
        name: 'redstone',
        count: 15,
        displayName: 'Redstone Dust',
        lore: ['§7Nguyên liệu sử dụng để chế tạo'],
        componentMap: customData({
            MMOITEMS_ITEM_ID: 'MMOITEMS_ITEM_ID:DADOTINHLUYEN',
            id: 'id:22'
        })
    });

    assert.equal(item.name, 'redstone');
    assert.equal(item.displayName, 'Redstone Dust');
    assert.deepEqual(item.identityComponents, [
        'MMOITEMS_ITEM_ID:DADOTINHLUYEN',
        'id:22'
    ]);
    assert.equal(item.customMetadataPresent, true);
});

test('ItemNormalizer accepts persisted probe shape with carrier/displayNameRaw/identityComponents', () => {
    const normalizer = new ItemNormalizer();
    const item = normalizer.normalize({
        slot: 1,
        carrier: 'redstone',
        count: 15,
        displayNameRaw: 'Redstone Dust',
        loreRaw: ['["§7Nguyên liệu sử dụng để chế tạo"]'],
        identityComponents: ['MMOITEMS_ITEM_ID:DADOTINHLUYEN', 'id:22'],
        identityNbt: []
    });
    assert.equal(item.name, 'redstone');
    assert.equal(item.displayName, 'Redstone Dust');
    assert.equal(item.identityComponents[0], 'MMOITEMS_ITEM_ID:DADOTINHLUYEN');
});

test('ItemNormalizer canonicalizes bare MMOITEMS component value with full key prefix', () => {
    const normalizer = new ItemNormalizer();
    const item = normalizer.normalize({
        name: 'redstone',
        count: 15,
        displayName: 'Redstone Dust',
        componentMap: customData({
            MMOITEMS_ITEM_ID: 'DADOTINHLUYEN',
            id: 'id:22'
        })
    });

    assert.deepEqual(item.identityComponents, [
        'MMOITEMS_ITEM_ID:DADOTINHLUYEN',
        'id:22'
    ]);
});
