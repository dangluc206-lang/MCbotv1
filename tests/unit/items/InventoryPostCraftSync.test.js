'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ItemNormalizer = require('../../../src/items/ItemNormalizer');
const InventoryReader = require('../../../src/items/inventory/InventoryReader');
const InventorySyncService = require('../../../src/items/inventory/sync/InventorySyncService');

function view(items, source = 'bot-inventory') {
    return { source, items, windowId: null };
}

test('post-craft sync waits ticks and retries until expected MMOItems identity is visible', async () => {
    let reads = 0;
    let ticks = 0;
    const reader = {
        readViews() {
            reads += 1;
            if (reads < 2) return [view([{ slot: 1, count: 64, identityComponents: [], identityNbt: [] }])];
            return [view([{ slot: 1, count: 64, identityComponents: ['MMOITEMS_ITEM_ID:THANTINHLUYEN'], identityNbt: [] }])];
        }
    };
    const bot = { async waitForTicks(count) { ticks += count; } };
    const sync = new InventorySyncService({
        botId: 'bot-01',
        context: { require: () => bot },
        reader,
        observation: { eventsSince: () => [], capture: async () => null },
        config: { minTicks: 2, pollTicks: 1, quietMs: 0, timeoutMs: 500, stablePasses: 1, debugMetadata: false }
    });

    const result = await sync.waitForStable({
        since: Date.now(),
        beforeViews: [view([])],
        expectedIdentity: 'MMOITEMS_ITEM_ID:THANTINHLUYEN',
        expectedDelta: 64,
        reason: 'craft:refined_coal'
    });

    assert.equal(result.metadataReady, true);
    assert.equal(result.afterIdentityCount, 64);
    assert.ok(reads >= 2);
    assert.ok(ticks >= 3);
});

test('InventoryReader metadata debug shows raw NBT state and normalized identities', () => {
    const records = [];
    const logger = { info(message, meta) { records.push({ message, meta }); } };
    const item = {
        name: 'coal',
        count: 64,
        nbt: undefined,
        components: undefined,
        componentMap: undefined,
        identityComponents: ['MMOITEMS_ITEM_ID:THANTINHLUYEN'],
        customMetadataPresent: true
    };
    const bot = {
        currentWindow: null,
        inventory: { slots: [item], emptySlotCount: () => 35 }
    };
    const reader = new InventoryReader({
        botId: 'bot-01',
        context: { require: () => bot },
        normalizer: new ItemNormalizer(),
        logger
    });

    reader.readViews({ debugMetadataReason: 'craft:refined_coal:test', debugMaxItems: 4 });
    assert.equal(records.length, 1);
    const sample = records[0].meta;
    assert.equal(sample.nbtState, 'undefined');
    assert.deepEqual(sample.identityComponents, ['MMOITEMS_ITEM_ID:THANTINHLUYEN']);
    assert.equal(sample.customMetadataPresent, true);
});
