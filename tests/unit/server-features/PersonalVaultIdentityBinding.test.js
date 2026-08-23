'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ItemNormalizer = require('../../../src/items/ItemNormalizer');
const GuiSession = require('../../../src/gui/GuiSession');
const GuiStructureNormalizer = require('../../../src/gui/observation/GuiStructureNormalizer');
const GuiObservationStore = require('../../../src/gui/observation/GuiObservationStore');
const GuiKnowledgeRegistry = require('../../../src/gui/knowledge/GuiKnowledgeRegistry');
const PersonalVaultReader = require('../../../src/server-features/personal-vault/PersonalVaultReader');
const PersonalVaultTransfer = require('../../../src/server-features/personal-vault/PersonalVaultTransfer');

function customData(id) {
    return new Map([['minecraft:custom_data', {
        type: 'compound',
        value: {
            MMOITEMS_ITEM_ID: { type: 'string', value: id },
            MATERIAL: { type: 'string', value: 'MATERIAL' }
        }
    }]]);
}

function b3VaultItem(count = 5) {
    return {
        name: 'diamond_block',
        displayName: '§bKhối kim cương tinh luyện',
        count,
        lore: [],
        componentMap: customData('KHOIKIMCUONGTINHLUYEN')
    };
}

function b3InventoryItem(count = 5) {
    return {
        name: 'diamond_block',
        displayName: 'Block of Diamond',
        count,
        lore: [],
        componentMap: customData('KHOIKIMCUONGTINHLUYEN')
    };
}

function fallbackResolver() {
    return {
        resolve(item) {
            return /Khối kim cương tinh luyện/i.test(String(item?.displayName || ''))
                ? { id: 'refined_diamond_block' }
                : null;
        },
        matches(item, logicalId) {
            return {
                matched: logicalId === 'refined_diamond_block'
                    && /Khối kim cương tinh luyện/i.test(String(item?.displayName || ''))
            };
        }
    };
}

async function setup() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-pv-binding-'));
    const normalizer = new GuiStructureNormalizer({ itemNormalizer: new ItemNormalizer() });
    const store = new GuiObservationStore({ baseDir: directory, botId: 'bot-01' });
    const knowledge = new GuiKnowledgeRegistry({
        botId: 'bot-01',
        normalizer,
        store,
        itemResolver: fallbackResolver()
    });
    await knowledge.initialize();
    return { directory, normalizer, store, knowledge };
}

test('PV fallback recognition persists MMOItems binding for vanilla-looking inventory item', async () => {
    const { directory, store, knowledge } = await setup();
    try {
        const reader = new PersonalVaultReader({ itemResolver: fallbackResolver(), guiKnowledge: knowledge, storageSlots: 54 });
        const slots = Array(90).fill(null);
        slots[10] = b3VaultItem(5);
        const snapshot = await reader.readAndLearn({ slots }, { source: 'test-pv-read' });

        assert.equal(snapshot.count('refined_diamond_block'), 5);
        assert.equal(knowledge.matchesLogical(b3InventoryItem(5), 'refined_diamond_block', 'inventory'), true);
        assert.equal(knowledge.resolveLogicalId(b3InventoryItem(5), 'inventory'), 'refined_diamond_block');
        const normalizedRuntimeItem = {
            name: 'diamond_block', type: 91, count: 5, metadata: 0, displayName: 'Block of Diamond', lore: [],
            identityComponents: ['MMOITEMS_ITEM_ID:KHOIKIMCUONGTINHLUYEN', 'MATERIAL'],
            identityNbt: [], identityStructuralKeys: ['custom_data'], customMetadataPresent: true, nbt: {}
        };
        assert.equal(knowledge.matchesLogical(normalizedRuntimeItem, 'refined_diamond_block', 'inventory'), true);
        assert.equal(knowledge.resolveLogicalId(normalizedRuntimeItem, 'inventory'), 'refined_diamond_block');

        const saved = await store.readKnowledge();
        assert.equal(
            saved.items.refined_diamond_block.fingerprint.identityComponents[0],
            'MMOITEMS_ITEM_ID:KHOIKIMCUONGTINHLUYEN'
        );
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});


test('PV read upgrades an already-matching weak logical binding with live MMOItems identity', async () => {
    const { directory, knowledge } = await setup();
    try {
        await knowledge.learnLogicalItem('refined_diamond_block', {
            name: 'diamond_block', displayName: 'Khối kim cương tinh luyện', count: 1, lore: []
        }, { source: 'legacy-name-only' });

        const reader = new PersonalVaultReader({ itemResolver: fallbackResolver(), guiKnowledge: knowledge, storageSlots: 54 });
        const slots = Array(90).fill(null);
        slots[10] = b3VaultItem(5);
        const snapshot = await reader.readAndLearn({ slots }, { source: 'pv-upgrade' });

        assert.equal(snapshot.count('refined_diamond_block'), 5);
        assert.equal(knowledge.getStrongIdentity('refined_diamond_block'), 'MMOITEMS_ITEM_ID:KHOIKIMCUONGTINHLUYEN');
        assert.equal(knowledge.matchesLogical(b3InventoryItem(), 'refined_diamond_block', 'inventory'), true);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('PV shift-click learns strong logical identity before moving the item', async () => {
    const { directory, knowledge } = await setup();
    try {
        const slots = Array(90).fill(null);
        slots[10] = b3VaultItem(5);
        const session = new GuiSession({
            botId: 'bot-01', connectionGeneration: 1,
            window: { title: 'PV', type: 'generic', slots }
        });
        const clicks = [];
        const transfer = new PersonalVaultTransfer({
            guiManager: {
                current: () => session,
                click: async (slot, options) => clicks.push({ slot, options })
            },
            itemResolver: fallbackResolver(),
            guiKnowledge: knowledge,
            storageSlots: 54
        });

        const token = { throwIfCancelled() {} };
        const result = await transfer.transferToInventory('refined_diamond_block', {
            maxStacks: 1,
            cancellationToken: token,
            expectedGeneration: 1,
            operationId: 'op-pv',
            correlationId: 'corr-pv'
        });
        assert.equal(result.movedStacks, 1);
        assert.equal(clicks[0].slot, 10);
        assert.equal(clicks[0].options.cancellationToken, token);
        assert.equal(clicks[0].options.expectedGeneration, 1);
        assert.equal(clicks[0].options.operationId, 'op-pv');
        assert.equal(clicks[0].options.correlationId, 'corr-pv');
        assert.equal(knowledge.matchesLogical(b3InventoryItem(), 'refined_diamond_block', 'inventory'), true);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('startup migrates old PV semantic slot mapping into strong MMOItems binding', async () => {
    const { directory, normalizer, store } = await setup();
    try {
        const source = { commandKey: 'personalVault2', command: '/pv 2', clicks: [], actions: [], source: 'operation' };
        const slots = Array(90).fill(null);
        slots[10] = b3VaultItem(5);
        const session = new GuiSession({ botId: 'bot-01', connectionGeneration: 1, window: { title: 'PV', type: 'generic', slots }, source });
        const normalized = normalizer.normalize(session);
        await store.upsert('pv-2', normalized, { source });
        await store.updateSemantic('pv-2', 'personalVault', {
            capturedAt: Date.now(),
            data: {
                items: [{ slot: 10, logicalId: 'refined_diamond_block', count: 5, rawName: 'diamond_block' }],
                totals: { refined_diamond_block: 5 }
            }
        });

        const fresh = new GuiKnowledgeRegistry({
            botId: 'bot-01',
            normalizer,
            store,
            itemResolver: { resolve: () => null, matches: () => ({ matched: false }) }
        });
        await fresh.initialize();

        assert.equal(fresh.resolveLogicalId(b3InventoryItem(), 'inventory'), 'refined_diamond_block');
        const binding = fresh.getLogicalBinding('refined_diamond_block');
        assert.equal(binding.fingerprint.identityComponents[0], 'MMOITEMS_ITEM_ID:KHOIKIMCUONGTINHLUYEN');
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('strong MMOItems binding replaces weak display-name bootstrap alias', async () => {
    const { directory, knowledge } = await setup();
    try {
        await knowledge.learnLogicalItem('refined_diamond_block', {
            name: 'diamond_block', displayName: 'Khối kim cương tinh luyện', count: 1, lore: []
        }, { source: 'weak-bootstrap' });
        await knowledge.learnLogicalItem('refined_diamond_block', b3VaultItem(), { source: 'pv-confirmed' });

        const binding = knowledge.getLogicalBinding('refined_diamond_block');
        assert.equal(binding.fingerprints.length, 1);
        assert.equal(binding.fingerprint.identityComponents[0], 'MMOITEMS_ITEM_ID:KHOIKIMCUONGTINHLUYEN');
        assert.equal(knowledge.matchesLogical({
            name: 'diamond_block', displayName: 'Khối kim cương tinh luyện', count: 64, lore: []
        }, 'refined_diamond_block', 'inventory'), true, 'fallback resolver may still recognize configured server label');
        assert.equal(knowledge.matchesLogical({
            name: 'diamond_block', displayName: 'Block of Diamond', count: 64, lore: []
        }, 'refined_diamond_block', 'inventory'), false, 'plain vanilla item without MMOItems identity must not match');
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
