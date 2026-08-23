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
        context: { require: () => bot, get: () => bot, has: () => true, getGeneration: () => 1 },
        reader,
        observation: { eventsSince: () => [], capture: async () => null },
        config: { minTicks: 2, pollTicks: 1, quietMs: 0, timeoutMs: 500, stablePasses: 1, debugMetadata: false }
    });

    const result = await sync.waitForStable({
        since: Date.now(),
        beforeViews: [view([])],
        expectedIdentity: 'MMOITEMS_ITEM_ID:THANTINHLUYEN',
        expectedDelta: 64,
        reason: 'craft:refined_coal',
        expectedGeneration: 1
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
        context: { require: () => bot, get: () => bot, has: () => true, getGeneration: () => 1 },
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

test('post-craft sync rejects replacement during in-flight tick wait and never reads evidence as the new generation', async () => {
    const BotContext = require('../../../src/bot/BotContext');
    const context = new BotContext('bot-01');
    const oldClient = {
        async waitForTicks() {
            context.detach(oldClient);
            context.attach(newClient);
        }
    };
    const newClient = { async waitForTicks() {} };
    context.attach(oldClient);
    let reads = 0;
    const sync = new InventorySyncService({
        botId: 'bot-01', context,
        reader: { readViews: () => { reads += 1; return [view([])]; } },
        observation: { eventsSince: () => [] },
        config: { minTicks: 1, pollTicks: 0, pollMs: 0, quietMs: 0, timeoutMs: 20, stablePasses: 1 }
    });
    await assert.rejects(
        sync.waitForStable({ since: Date.now(), beforeViews: [view([])], expectedGeneration: 1 }),
        error => error.code === 'INVENTORY_SYNC_STALE_GENERATION'
    );
    assert.equal(context.getGeneration(), 2);
    assert.equal(reads, 0, 'old-generation sync must stop before reading evidence after replacement');
});
