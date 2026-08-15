'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ItemNormalizer = require('../../../src/items/ItemNormalizer');
const GuiStructureNormalizer = require('../../../src/gui/observation/GuiStructureNormalizer');
const GuiObservationStore = require('../../../src/gui/observation/GuiObservationStore');
const GuiKnowledgeRegistry = require('../../../src/gui/knowledge/GuiKnowledgeRegistry');
const InventoryScanner = require('../../../src/items/inventory/InventoryScanner');
const InventoryCounter = require('../../../src/items/inventory/InventoryCounter');
const CraftingResultVerifier = require('../../../src/server-features/crafting/CraftingResultVerifier');

function item(count) {
    return {
        slot: 1,
        carrier: 'redstone',
        name: 'redstone',
        count,
        displayNameRaw: 'Redstone Dust',
        identityComponents: ['MMOITEMS_ITEM_ID:DADOTINHLUYEN', 'id:22'],
        identityNbt: []
    };
}

test('craft verifier learns the full MMOITEMS identity from a positive inventory delta', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-craft-output-identity-'));
    try {
        const normalizer = new GuiStructureNormalizer({ itemNormalizer: new ItemNormalizer() });
        const store = new GuiObservationStore({ baseDir: directory, botId: 'bot-01' });
        const resolver = { resolve: () => null, matches: () => ({ matched: false }) };
        const guiKnowledge = new GuiKnowledgeRegistry({ botId: 'bot-01', normalizer, store, itemResolver: resolver });
        await guiKnowledge.initialize();

        const scanner = new InventoryScanner({ resolver, guiKnowledge });
        const inventoryCounter = new InventoryCounter({ scanner });
        const snapshots = [
            { items: [item(5)] },
            { items: [item(15)] }
        ];
        const inventoryReader = { read: () => snapshots.shift() || { items: [item(15)] } };
        const verifier = new CraftingResultVerifier({ inventoryReader, inventoryCounter, guiKnowledge });

        const before = verifier.before('refined_redstone');
        assert.equal(before.count, 0);
        const after = await verifier.after('refined_redstone', before, { attempts: 1, retryMs: 0 });

        assert.equal(after.verified, true);
        assert.equal(after.before, 5);
        assert.equal(after.after, 15);
        assert.equal(after.delta, 10);
        assert.equal(after.learnedIdentity, 'MMOITEMS_ITEM_ID:DADOTINHLUYEN');

        const saved = await store.readKnowledge();
        assert.equal(saved.items.refined_redstone.fingerprint.identityComponents[0], 'MMOITEMS_ITEM_ID:DADOTINHLUYEN');
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('craft verifier can select the expected custom output when more than one MMO item increases', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-craft-output-expected-delta-'));
    try {
        const normalizer = new GuiStructureNormalizer({ itemNormalizer: new ItemNormalizer() });
        const store = new GuiObservationStore({ baseDir: directory, botId: 'bot-01' });
        const resolver = { resolve: () => null, matches: () => ({ matched: false }) };
        const guiKnowledge = new GuiKnowledgeRegistry({ botId: 'bot-01', normalizer, store, itemResolver: resolver });
        await guiKnowledge.initialize();

        const scanner = new InventoryScanner({ resolver, guiKnowledge });
        const inventoryCounter = new InventoryCounter({ scanner });
        const make = (identity, count, slot) => ({
            slot,
            name: 'redstone',
            count,
            displayName: 'Redstone Dust',
            identityComponents: [identity],
            identityNbt: []
        });
        const beforeSnapshot = {
            source: 'current-window',
            items: [
                make('MMOITEMS_ITEM_ID:OUTPUT', 0, 45),
                make('MMOITEMS_ITEM_ID:PICKUP', 1, 46)
            ]
        };
        const afterSnapshot = {
            source: 'current-window',
            items: [
                make('MMOITEMS_ITEM_ID:OUTPUT', 64, 45),
                make('MMOITEMS_ITEM_ID:PICKUP', 3, 46)
            ]
        };
        const inventoryReader = { read: (() => {
            const snapshots = [beforeSnapshot, afterSnapshot];
            return () => snapshots.shift() || afterSnapshot;
        })() };
        const verifier = new CraftingResultVerifier({ inventoryReader, inventoryCounter, guiKnowledge });

        const before = verifier.before('refined_output');
        const after = await verifier.after('refined_output', before, {
            attempts: 1,
            retryMs: 0,
            expectedDelta: 64
        });

        assert.equal(after.verified, true);
        assert.equal(after.learnedIdentity, 'MMOITEMS_ITEM_ID:OUTPUT');
        assert.equal(after.delta, 64);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('craft verifier accepts bot.inventory when currentWindow inventory remains stale after craft', async () => {
    const resolver = { matches: () => ({ matched: false }) };
    const scanner = new InventoryScanner({
        resolver,
        guiKnowledge: {
            matchesLogical(item, logicalId) {
                return logicalId === 'refined_diamond_block'
                    && item.identityComponents?.includes('MMOITEMS_ITEM_ID:REFINED_DIAMOND_BLOCK');
            }
        }
    });
    const inventoryCounter = new InventoryCounter({ scanner });
    const make = (count, source) => ({
        source,
        items: [{
            slot: 1,
            name: 'diamond_block',
            count,
            displayName: 'Diamond Block',
            identityComponents: ['MMOITEMS_ITEM_ID:REFINED_DIAMOND_BLOCK'],
            identityNbt: []
        }]
    });

    const reads = [
        [make(1, 'current-window'), make(1, 'bot-inventory')],
        [make(1, 'current-window'), make(2, 'bot-inventory')]
    ];
    const inventoryReader = {
        readViews: () => reads.shift() || [make(1, 'current-window'), make(2, 'bot-inventory')],
        read: () => make(1, 'current-window')
    };
    const verifier = new CraftingResultVerifier({ inventoryReader, inventoryCounter });

    const before = verifier.before('refined_diamond_block');
    assert.equal(before.count, 1);
    const after = await verifier.after('refined_diamond_block', before, { attempts: 1, retryMs: 0 });

    assert.equal(after.verified, true);
    assert.equal(after.before, 1);
    assert.equal(after.after, 2);
    assert.equal(after.delta, 1);
    assert.deepEqual(after.beforeCountsBySource, { 'current-window': 1, 'bot-inventory': 1 });
    assert.deepEqual(after.countsBySource, { 'current-window': 1, 'bot-inventory': 2 });
});


test('craft verifier learns an unknown B2 MMOItems output from post-click inventory events when /kho supplies the B1 input', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-craft-event-learn-b2-'));
    try {
        const normalizer = new GuiStructureNormalizer({ itemNormalizer: new ItemNormalizer() });
        const store = new GuiObservationStore({ baseDir: directory, botId: 'bot-01' });
        const resolver = { resolve: () => null, matches: () => ({ matched: false }) };
        const guiKnowledge = new GuiKnowledgeRegistry({ botId: 'bot-01', normalizer, store, itemResolver: resolver });
        await guiKnowledge.initialize();

        const scanner = new InventoryScanner({ resolver, guiKnowledge });
        const inventoryCounter = new InventoryCounter({ scanner });
        const stale = { source: 'bot-inventory', items: [] };
        const inventoryReader = {
            readViews: () => [stale],
            read: () => stale
        };
        const outputItem = {
            slot: 9,
            name: 'diamond',
            carrier: 'diamond',
            count: 64,
            displayName: 'Diamond',
            identityComponents: ['MMOITEMS_ITEM_ID:KIMCUONGTINHLUYEN'],
            identityNbt: []
        };
        const inventoryObservation = {
            eventsSince: () => [{
                at: Date.now(),
                source: 'bot-inventory',
                slot: 9,
                oldItem: null,
                newItem: outputItem
            }]
        };
        const verifier = new CraftingResultVerifier({
            inventoryReader,
            inventoryCounter,
            guiKnowledge,
            inventoryObservation
        });

        const before = verifier.before('refined_diamond', ['diamond']);
        verifier.arm(before);
        const after = await verifier.after('refined_diamond', before, {
            attempts: 1,
            retryMs: 0,
            expectedDelta: 64,
            inputRequirements: {
                diamond: { amount: 2048, source: 'storage' }
            }
        });

        assert.equal(after.verified, true);
        assert.equal(after.verificationMode, 'output-event-delta');
        assert.equal(after.eventEvidence.outputDelta, 64);
        assert.equal(after.learnedIdentity, 'MMOITEMS_ITEM_ID:KIMCUONGTINHLUYEN');
        assert.equal(after.inputEvidence[0].ignored, true);
        assert.equal(after.inputEvidence[0].source, 'storage');

        const saved = await store.readKnowledge();
        assert.equal(
            saved.items.refined_diamond.fingerprint.identityComponents[0],
            'MMOITEMS_ITEM_ID:KIMCUONGTINHLUYEN'
        );
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('bot-inventory verification mode ignores current-window snapshots and events after quantity GUI close', async () => {
    const resolver = { matches: () => ({ matched: false }) };
    const scanner = new InventoryScanner({ resolver, guiKnowledge: null });
    const inventoryCounter = new InventoryCounter({ scanner });
    const emptyBot = { source: 'bot-inventory', items: [] };
    const inventoryReader = {
        readBotInventory: () => emptyBot,
        readViews: () => [{
            source: 'current-window',
            items: [{
                slot: 72,
                name: 'coal',
                count: 64,
                identityComponents: ['MMOITEMS_ITEM_ID:THANTINHLUYEN'],
                identityNbt: []
            }]
        }, emptyBot],
        read: () => emptyBot
    };
    const inventoryObservation = {
        eventsSince: () => [{
            at: Date.now(),
            source: 'current-window',
            slot: 72,
            oldItem: null,
            newItem: {
                name: 'coal',
                count: 64,
                identityComponents: ['MMOITEMS_ITEM_ID:THANTINHLUYEN'],
                identityNbt: []
            }
        }]
    };
    const verifier = new CraftingResultVerifier({ inventoryReader, inventoryCounter, inventoryObservation });

    const before = verifier.before('refined_coal', [], { inventorySource: 'bot-inventory' });
    verifier.arm(before);
    const after = await verifier.after('refined_coal', before, {
        attempts: 1,
        retryMs: 0,
        expectedDelta: 64,
        inventorySource: 'bot-inventory'
    });

    assert.equal(after.verified, false);
    assert.deepEqual(after.countsBySource, { 'bot-inventory': 0 });
    assert.equal(after.eventEvidence.eventCount, 0);
    assert.equal(after.inventorySource, 'bot-inventory');
});
