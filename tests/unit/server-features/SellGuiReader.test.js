'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const SellGuiReader = require('../../../src/server-features/storage/SellGuiReader');

test('SellGuiReader ignores raw that is absent from configured sellable forms', () => {
    const resolver = {
        resolve(item) { return item?.logicalId ? { id: item.logicalId } : null; }
    };
    const reader = new SellGuiReader({
        itemResolver: resolver,
        config: {
            resourceAmountPatterns: ['amount\\s*[:：]?\\s*(?<value>[\\d.,]+)'],
            sell: { itemAliases: { iron_ingot: 'IRON_INGOT', iron_block: 'IRON_BLOCK' } }
        }
    });
    const window = {
        inventoryStart: 3,
        slots: [
            { logicalId: 'raw_iron', displayName: 'Raw Iron', lore: ['Amount: 999'] },
            { logicalId: 'iron_ingot', displayName: 'Iron', lore: ['Amount: 320'] },
            null
        ]
    };
    const result = reader.read(window);
    assert.equal(result.entries.raw_iron, undefined);
    assert.equal(result.entries.iron_ingot.logicalId, 'iron_ingot');
});

test('SellGuiReader ignores click instruction quantities and reads the real stored amount', () => {
    const resolver = {
        resolve(item) { return item?.logicalId ? { id: item.logicalId } : null; }
    };
    const reader = new SellGuiReader({
        itemResolver: resolver,
        config: {
            resourceAmountPatterns: ['(?:dang\\s*co|so\\s*luong|amount)\\s*[:：]?\\s*(?<value>[\\d.,]+)'],
            sell: { itemAliases: { gold_block: 'GOLD_BLOCK' } }
        }
    });
    const window = {
        inventoryStart: 2,
        slots: [
            {
                logicalId: 'gold_block',
                displayName: 'Gold Block',
                lore: ['Số lượng bán: 1', 'Chuột phải: bán 64', 'Đang có: 89.083']
            },
            null
        ]
    };

    const result = reader.read(window);
    assert.equal(result.entries.gold_block.amount, 89083);
    assert.equal(result.entries.gold_block.amountReliable, true);
});

test('SellGuiReader treats zero amount as unreliable because sell GUI may expose a non-stock zero', () => {
    const resolver = {
        resolve(item) { return item?.logicalId ? { id: item.logicalId } : null; }
    };
    const reader = new SellGuiReader({
        itemResolver: resolver,
        config: {
            resourceAmountPatterns: ['(?:dang\\s*co|so\\s*luong|amount)\\s*[:：]?\\s*(?<value>[\\d.,]+)'],
            sell: { itemAliases: { gold_block: 'GOLD_BLOCK' } }
        }
    });
    const window = {
        inventoryStart: 2,
        slots: [
            {
                logicalId: 'gold_block',
                displayName: 'Gold Block',
                lore: ['Đang có: 0', 'Chuột phải: bán 64']
            },
            null
        ]
    };

    const result = reader.read(window);
    assert.equal(result.entries.gold_block.amount, null);
    assert.equal(result.entries.gold_block.amountReliable, false);
});
