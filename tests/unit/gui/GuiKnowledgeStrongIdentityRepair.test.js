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
