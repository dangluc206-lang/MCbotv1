'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ItemNormalizer = require('../../../src/items/ItemNormalizer');
const InventoryReader = require('../../../src/items/inventory/InventoryReader');
const InventoryScanner = require('../../../src/items/inventory/InventoryScanner');
const InventoryCounter = require('../../../src/items/inventory/InventoryCounter');

function customData() {
    return new Map([
        ['minecraft:custom_data', {
            type: 'compound',
            value: {
                MMOITEMS_ITEM_ID: { type: 'string', value: 'DADOTINHLUYEN' },
                id: { type: 'string', value: 'id:22' }
            }
        }]
    ]);
}

test('inventory snapshot keeps normalized MMOITEMS identity and does not persist raw Mineflayer item', () => {
    const raw = {
        name: 'redstone',
        count: 15,
        displayName: 'Redstone Dust',
        componentMap: customData()
    };
    const bot = {
        inventory: {
            slots: [null, raw],
            emptySlotCount: () => 1
        }
    };
    const reader = new InventoryReader({
        botId: 'bot-01',
        context: { require: () => bot },
        normalizer: new ItemNormalizer()
    });

    const snapshot = reader.read();
    assert.equal(snapshot.items.length, 1);
    assert.equal(snapshot.items[0].raw, undefined);
    assert.deepEqual(snapshot.items[0].identityComponents, [
        'MMOITEMS_ITEM_ID:DADOTINHLUYEN',
        'id:22'
    ]);
});

test('inventory scanner matches using normalized snapshot identity instead of raw fallback', () => {
    const snapshot = {
        items: [{
            slot: 1,
            name: 'redstone',
            count: 15,
            displayName: 'Redstone Dust',
            identityComponents: ['MMOITEMS_ITEM_ID:DADOTINHLUYEN', 'id:22'],
            identityNbt: [],
            customMetadataPresent: true,
            // Simulates the broken legacy raw clone: the component Map is gone.
            raw: { name: 'redstone', count: 15, componentMap: {} }
        }]
    };

    const scanner = new InventoryScanner({
        resolver: { matches: () => ({ matched: false }) },
        guiKnowledge: {
            matchesLogical(item, logicalId) {
                return logicalId === 'refined_redstone'
                    && item.identityComponents?.includes('MMOITEMS_ITEM_ID:DADOTINHLUYEN');
            }
        }
    });
    const counter = new InventoryCounter({ scanner });

    assert.equal(counter.count(snapshot, 'refined_redstone'), 15);
});

test('inventory reader prefers the player inventory section of currentWindow while a custom GUI is open', () => {
    const staleBotItem = {
        name: 'redstone',
        count: 5,
        displayName: 'Redstone Dust',
        componentMap: customData()
    };
    const freshWindowItem = {
        name: 'redstone',
        count: 15,
        displayName: 'Redstone Dust',
        componentMap: customData()
    };
    const windowSlots = Array(81).fill(null);
    windowSlots[45] = freshWindowItem;
    const bot = {
        currentWindow: {
            id: 7,
            inventoryStart: 45,
            inventoryEnd: 81,
            slots: windowSlots
        },
        inventory: {
            slots: [null, staleBotItem],
            emptySlotCount: () => 1
        }
    };
    const reader = new InventoryReader({
        botId: 'bot-01',
        context: { require: () => bot },
        normalizer: new ItemNormalizer()
    });

    const snapshot = reader.read();
    assert.equal(snapshot.source, 'current-window');
    assert.equal(snapshot.windowId, 7);
    assert.equal(snapshot.items.length, 1);
    assert.equal(snapshot.items[0].count, 15);
    assert.equal(snapshot.items[0].slot, 45);
    assert.equal(snapshot.items[0].playerSlot, 0);
    assert.deepEqual(snapshot.items[0].identityComponents, [
        'MMOITEMS_ITEM_ID:DADOTINHLUYEN',
        'id:22'
    ]);
});

test('inventory reader exposes both currentWindow and bot.inventory views while GUI is open', () => {
    const windowItem = {
        name: 'diamond_block',
        count: 1,
        displayName: 'Diamond Block',
        componentMap: new Map([['minecraft:custom_data', { type: 'compound', value: {
            MMOITEMS_ITEM_ID: { type: 'string', value: 'REFINED_DIAMOND_BLOCK' }
        }}]])
    };
    const botItem = {
        name: 'diamond_block',
        count: 2,
        displayName: 'Diamond Block',
        componentMap: new Map([['minecraft:custom_data', { type: 'compound', value: {
            MMOITEMS_ITEM_ID: { type: 'string', value: 'REFINED_DIAMOND_BLOCK' }
        }}]])
    };
    const slots = Array(81).fill(null);
    slots[45] = windowItem;
    const bot = {
        currentWindow: { id: 9, inventoryStart: 45, inventoryEnd: 81, slots },
        inventory: { slots: [null, botItem], emptySlotCount: () => 0 }
    };
    const reader = new InventoryReader({
        botId: 'bot-01',
        context: { require: () => bot },
        normalizer: new ItemNormalizer()
    });

    const views = reader.readViews();
    assert.equal(views.length, 2);
    assert.equal(views[0].source, 'current-window');
    assert.equal(views[0].items[0].count, 1);
    assert.equal(views[1].source, 'bot-inventory');
    assert.equal(views[1].items[0].count, 2);
});
