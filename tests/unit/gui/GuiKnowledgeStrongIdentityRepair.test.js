'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ItemRegistry = require('../../../src/items/ItemRegistry');
const ItemNormalizer = require('../../../src/items/ItemNormalizer');
const ItemResolver = require('../../../src/items/ItemResolver');
const ItemMatcher = require('../../../src/items/matching/ItemMatcher');
const CompositeItemMatcher = require('../../../src/items/matching/CompositeItemMatcher');
const NameMatcher = require('../../../src/items/matching/NameMatcher');
const IdentityMatcher = require('../../../src/items/matching/IdentityMatcher');
const GuiStructureNormalizer = require('../../../src/gui/observation/GuiStructureNormalizer');
const GuiObservationStore = require('../../../src/gui/observation/GuiObservationStore');
const GuiKnowledgeRegistry = require('../../../src/gui/knowledge/GuiKnowledgeRegistry');

function resolver() {
    const registry = new ItemRegistry({
        super_cobblestone: {
            representations: {
                default: { rules: [{ type: 'name', value: 'Siêu đá cuội' }] },
                inventory: { rules: [{ type: 'identity', value: 'MMOITEMS_ITEM_ID:SIEUDACUOI' }] },
                'personal-vault': { rules: [{ type: 'identity', value: 'MMOITEMS_ITEM_ID:SIEUDACUOI' }] }
            }
        },
        smelt_iron: { representations: { default: { rules: [{ type: 'name', value: 'Sắt' }] } } }
    });
    const normalizer = new ItemNormalizer();
    const composite = new CompositeItemMatcher({ name: new NameMatcher(), identity: new IdentityMatcher() });
    return { normalizer, itemResolver: new ItemResolver({ registry, matcher: new ItemMatcher({ normalizer, composite }) }) };
}

test('configured strong identity is available before any runtime observation', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-configured-identity-first-use-'));
    try {
        const { normalizer, itemResolver } = resolver();
        const store = new GuiObservationStore({ baseDir, botId: 'bot-01' });
        const knowledge = new GuiKnowledgeRegistry({
            botId: 'bot-01', normalizer: new GuiStructureNormalizer({ itemNormalizer: normalizer }), store, itemResolver
        });
        await knowledge.initialize();
        assert.equal(knowledge.getConfiguredStrongIdentity('super_cobblestone'), 'MMOITEMS_ITEM_ID:SIEUDACUOI');
        assert.equal(knowledge.getStrongIdentity('super_cobblestone'), 'MMOITEMS_ITEM_ID:SIEUDACUOI');
        assert.equal(knowledge.getLogicalBinding('super_cobblestone'), null, 'no runtime binding should be required for fixed identity');
    } finally {
        await fs.rm(baseDir, { recursive: true, force: true });
    }
});

test('startup repairs a corrupted strong MMOItems binding and strong config wins future resolution', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-identity-repair-'));
    try {
        const botDir = path.join(baseDir, 'bot-01');
        await fs.mkdir(botDir, { recursive: true });
        const badFingerprint = {
            name: 'cobblestone', displayName: 'Cobblestone', lore: [],
            identityComponents: ['MMOITEMS_ITEM_ID:SIEUDACUOI', 'MATERIAL'], identityNbt: [],
            identityStructuralKeys: ['custom_data'], customModelData: null
        };
        await fs.writeFile(path.join(botDir, 'knowledge.json'), JSON.stringify({ version: 1, items: {
            smelt_iron: { logicalItemId: 'smelt_iron', fingerprint: badFingerprint, fingerprints: [badFingerprint], learnedFrom: { source: 'personal-vault-read' } }
        } }, null, 2));

        const { normalizer, itemResolver } = resolver();
        const store = new GuiObservationStore({ baseDir, botId: 'bot-01' });
        const knowledge = new GuiKnowledgeRegistry({
            botId: 'bot-01', normalizer: new GuiStructureNormalizer({ itemNormalizer: normalizer }), store, itemResolver
        });
        await knowledge.initialize();

        const raw = { name: 'cobblestone', displayName: 'Cobblestone', count: 3, identityComponents: ['MMOITEMS_ITEM_ID:SIEUDACUOI', 'MATERIAL'], customMetadataPresent: true };
        assert.equal(knowledge.resolveLogicalId(raw, 'personal-vault'), 'super_cobblestone');
        assert.equal(knowledge.matchesLogical(raw, 'super_cobblestone', 'inventory'), true);
        assert.equal(knowledge.matchesLogical(raw, 'smelt_iron', 'inventory'), false);
        assert.equal(knowledge.getStrongIdentity('super_cobblestone'), 'MMOITEMS_ITEM_ID:SIEUDACUOI');

        const saved = await store.readKnowledge();
        assert.equal(saved.items.smelt_iron, undefined);
        assert.equal(saved.items.super_cobblestone.fingerprint.identityComponents.includes('MMOITEMS_ITEM_ID:SIEUDACUOI'), true);
    } finally {
        await fs.rm(baseDir, { recursive: true, force: true });
    }
});

test('weak recipe bootstrap fingerprint cannot classify a vanilla-looking inventory item', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-weak-cross-context-'));
    try {
        const normalizer = new ItemNormalizer();
        const guiNormalizer = new GuiStructureNormalizer({ itemNormalizer: normalizer });
        const store = new GuiObservationStore({ baseDir, botId: 'bot-01' });
        await store.updateGlobalItem('tungsten', {
            logicalItemId: 'tungsten',
            fingerprint: { name: 'netherite_scrap', displayName: 'Netherite Scrap', lore: [], identityComponents: [], identityNbt: [], identityStructuralKeys: [], customModelData: null },
            fingerprints: [{ name: 'netherite_scrap', displayName: 'Netherite Scrap', lore: [], identityComponents: [], identityNbt: [], identityStructuralKeys: [], customModelData: null }],
            learnedFrom: { storedBootstrap: true }
        });
        const knowledge = new GuiKnowledgeRegistry({ botId: 'bot-01', normalizer: guiNormalizer, store });
        await knowledge.initialize();
        const vanilla = { name: 'netherite_scrap', displayName: 'Netherite Scrap', count: 3 };
        assert.equal(knowledge.resolveLogicalId(vanilla, 'inventory'), null);
        assert.equal(knowledge.matchesLogical(vanilla, 'tungsten', 'inventory'), false);
    } finally {
        await fs.rm(baseDir, { recursive: true, force: true });
    }
});

test('runtime learning cannot move a configured strong MMOItems identity to another logical item', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-runtime-identity-guard-'));
    try {
        const { normalizer, itemResolver } = resolver();
        const store = new GuiObservationStore({ baseDir, botId: 'bot-01' });
        const knowledge = new GuiKnowledgeRegistry({
            botId: 'bot-01',
            normalizer: new GuiStructureNormalizer({ itemNormalizer: normalizer }),
            store,
            itemResolver
        });
        await knowledge.initialize();

        const raw = {
            name: 'cobblestone',
            displayName: 'Cobblestone',
            count: 26,
            identityComponents: ['MMOITEMS_ITEM_ID:SIEUDACUOI', 'MATERIAL'],
            identityNbt: [],
            customMetadataPresent: true
        };

        await knowledge.learnLogicalItem('smelt_iron', raw, {
            source: 'craft-output-normalized-inventory-delta',
            roleId: 'output:smelt_iron',
            context: 'inventory'
        });

        assert.equal(knowledge.getStrongIdentity('super_cobblestone'), 'MMOITEMS_ITEM_ID:SIEUDACUOI');
        assert.equal(knowledge.getStrongIdentity('smelt_iron'), null);
        assert.equal(knowledge.resolveLogicalId(raw, 'inventory'), 'super_cobblestone');

        const saved = await store.readKnowledge();
        assert.equal(saved.items.smelt_iron, undefined);
        assert.equal(saved.items.super_cobblestone.fingerprint.identityComponents.includes('MMOITEMS_ITEM_ID:SIEUDACUOI'), true);
    } finally {
        await fs.rm(baseDir, { recursive: true, force: true });
    }
});

test('learn-once strong identity policy locks tungsten ownership after the first trusted strong observation', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-learn-once-identity-'));
    try {
        const registry = new ItemRegistry({
            tungsten: {
                metadata: { strongIdentityPolicy: 'learn' },
                representations: { default: { rules: [{ type: 'name', value: 'Tungsten' }] } }
            },
            other: {
                representations: { default: { rules: [{ type: 'name', value: 'Other' }] } }
            }
        });
        const normalizer = new ItemNormalizer();
        const composite = new CompositeItemMatcher({ name: new NameMatcher(), identity: new IdentityMatcher() });
        const itemResolver = new ItemResolver({ registry, matcher: new ItemMatcher({ normalizer, composite }) });
        const store = new GuiObservationStore({ baseDir, botId: 'bot-01' });
        const knowledge = new GuiKnowledgeRegistry({
            botId: 'bot-01',
            normalizer: new GuiStructureNormalizer({ itemNormalizer: normalizer }),
            store,
            itemResolver
        });
        await knowledge.initialize();

        const tungsten = {
            name: 'netherite_scrap', displayName: 'Tungsten', count: 1,
            identityComponents: ['MMOITEMS_ITEM_ID:TUNGSTEN_REAL', 'MATERIAL'],
            identityNbt: [], customMetadataPresent: true
        };
        const conflicting = {
            name: 'netherite_scrap', displayName: 'Tungsten', count: 1,
            identityComponents: ['MMOITEMS_ITEM_ID:DIFFERENT', 'MATERIAL'],
            identityNbt: [], customMetadataPresent: true
        };

        await knowledge.learnLogicalItem('tungsten', tungsten, { source: 'craft-output-delta', context: 'inventory' });
        assert.equal(knowledge.getStrongIdentity('tungsten'), 'MMOITEMS_ITEM_ID:TUNGSTEN_REAL');

        await knowledge.learnLogicalItem('other', tungsten, { source: 'bad-verifier-delta', context: 'inventory' });
        assert.equal(knowledge.getStrongIdentity('other'), null);
        assert.equal(knowledge.getStrongIdentity('tungsten'), 'MMOITEMS_ITEM_ID:TUNGSTEN_REAL');

        await knowledge.learnLogicalItem('tungsten', conflicting, { source: 'conflicting-observation', context: 'inventory' });
        assert.equal(knowledge.getStrongIdentity('tungsten'), 'MMOITEMS_ITEM_ID:TUNGSTEN_REAL');
    } finally {
        await fs.rm(baseDir, { recursive: true, force: true });
    }
});
