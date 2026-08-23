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

function makeWindow(craftingSlot) {
    const slots = Array(27).fill(null);
    slots[craftingSlot] = {
        name: 'crafting_table',
        displayName: '§aᴄʜế ᴛạᴏ',
        count: 1,
        lore: ['§7Mở menu chế tạo']
    };
    if (craftingSlot !== 16) slots[16] = { name: 'barrier', displayName: 'Khác', count: 1, lore: [] };
    return { title: 'Khoáng sản', type: 'generic', slots };
}

test('bootstrap slot learns item identity and later follows the item when its slot moves', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-gui-knowledge-'));
    try {
        const normalizer = new GuiStructureNormalizer({ itemNormalizer: new ItemNormalizer() });
        const store = new GuiObservationStore({ baseDir: directory, botId: 'bot-01' });
        const knowledge = new GuiKnowledgeRegistry({ botId: 'bot-01', normalizer, store });
        await knowledge.initialize();
        const source = { commandKey: 'minerals', command: '/ks', clicks: [], actions: [], source: 'operation' };

        const first = new GuiSession({ botId: 'bot-01', connectionGeneration: 1, window: makeWindow(16), source });
        assert.equal(await knowledge.resolveSlot(first, {
            source,
            roleId: 'menu_crafting',
            bootstrapSlot: 16
        }), 16);

        const moved = new GuiSession({ botId: 'bot-01', connectionGeneration: 1, window: makeWindow(20), source });
        assert.equal(await knowledge.resolveSlot(moved, {
            source,
            roleId: 'menu_crafting',
            bootstrapSlot: 16
        }), 20);

        const saved = await store.readRecord('ks');
        assert.equal(saved.learned.menu_crafting.bootstrapSlot, 16);
        assert.equal(saved.learned.menu_crafting.currentSlot, 20);
        assert.equal(saved.learned.menu_crafting.fingerprint.name, 'crafting_table');
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('operation actions create semantic route keys while Discord manual clicks keep slot routes', () => {
    const normalizer = new GuiStructureNormalizer({ itemNormalizer: new ItemNormalizer() });
    assert.equal(normalizer.routeKeyFor({ command: '/ks', clicks: [16], actions: ['menu_crafting'], source: 'operation' }), 'ks__menu_crafting');
    assert.equal(normalizer.routeKeyFor({ command: '/ks', clicks: [16], source: 'discord-gui' }), 'ks__slot-16');
});

test('semantic GUI data is persisted and can be restored into a fresh registry', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-gui-semantic-'));
    try {
        const normalizer = new GuiStructureNormalizer({ itemNormalizer: new ItemNormalizer() });
        const store = new GuiObservationStore({ baseDir: directory, botId: 'bot-01' });
        const source = { commandKey: 'personalVault2', command: '/pv 2', clicks: [], actions: [], source: 'operation' };
        const session = new GuiSession({ botId: 'bot-01', connectionGeneration: 1, window: { title: 'PV', type: 'generic', slots: [] }, source });
        const first = new GuiKnowledgeRegistry({ botId: 'bot-01', normalizer, store });
        await first.initialize();
        await first.observe(session, { source });
        await first.setSemantic(source, 'personalVault', { totals: { super_alloy: 7 }, items: [] });

        const second = new GuiKnowledgeRegistry({ botId: 'bot-01', normalizer, store });
        await second.initialize();
        assert.equal(second.getSemantic(source, 'personalVault').totals.super_alloy, 7);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('weak recipe fingerprint does not cross-classify /pv 2 without a strong custom identity', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-gui-global-item-'));
    try {
        const normalizer = new GuiStructureNormalizer({ itemNormalizer: new ItemNormalizer() });
        const store = new GuiObservationStore({ baseDir: directory, botId: 'bot-01' });
        const itemResolver = { resolve: () => null, matches: () => ({ matched: false }) };
        const knowledge = new GuiKnowledgeRegistry({ botId: 'bot-01', normalizer, store, itemResolver });
        await knowledge.initialize();
        const source = { commandKey: 'minerals', command: '/ks', clicks: [16], actions: ['menu_crafting'], source: 'operation' };
        const slots = Array(54).fill(null);
        slots[14] = { name: 'diamond', displayName: '§bKim cương tinh luyện', count: 1, lore: ['§7B2'] };
        const crafting = new GuiSession({ botId: 'bot-01', connectionGeneration: 1, window: { title: 'Craft', type: 'generic', slots }, source });
        await knowledge.learnSlot(crafting, {
            source,
            roleId: 'recipe:refined_diamond',
            slot: 14,
            logicalItemId: 'refined_diamond',
            context: 'crafting-menu',
            bootstrapSlot: 14
        });

        const vaultItem = { name: 'diamond', displayName: '§bKim cương tinh luyện', count: 32, lore: ['§7B2'] };
        assert.equal(knowledge.resolveLogicalId(vaultItem, 'personal-vault'), null);
        assert.equal(knowledge.matchesLogical(vaultItem, 'refined_diamond', 'personal-vault'), false);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('stored weak crafting bootstrap remains GUI knowledge and does not classify inventory/PV items', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-gui-stored-bootstrap-'));
    try {
        const normalizer = new GuiStructureNormalizer({ itemNormalizer: new ItemNormalizer() });
        const store = new GuiObservationStore({ baseDir: directory, botId: 'bot-01' });
        const slots = Array(54).fill(null);
        slots[14] = { name: 'diamond', displayName: 'Server B2 Diamond', count: 1, lore: [] };
        const session = new GuiSession({ botId: 'bot-01', connectionGeneration: 1, window: { title: 'Craft', type: 'generic', slots } });
        const normalized = normalizer.normalize(session);
        await store.upsert('ks__slot-16', normalized, {
            source: { commandKey: 'minerals', command: '/ks', clicks: [16], source: 'discord-gui' }
        });

        const knowledge = new GuiKnowledgeRegistry({
            botId: 'bot-01',
            normalizer,
            store,
            itemResolver: { resolve: () => null, matches: () => ({ matched: false }) },
            bootstrapMappings: [{
                recordKeys: ['ks__menu_crafting', 'ks__slot-16'],
                entries: [{ roleId: 'recipe:refined_diamond', logicalItemId: 'refined_diamond', bootstrapSlot: 14 }]
            }]
        });
        await knowledge.initialize();

        assert.equal(knowledge.resolveLogicalId({ name: 'diamond', displayName: 'Server B2 Diamond', count: 64, lore: [] }, 'inventory'), null);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('stale learned fingerprint self-heals from bootstrap slot and updates global item knowledge', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-gui-self-heal-'));
    try {
        const normalizer = new GuiStructureNormalizer({ itemNormalizer: new ItemNormalizer() });
        const store = new GuiObservationStore({ baseDir: directory, botId: 'bot-01' });
        const knowledge = new GuiKnowledgeRegistry({
            botId: 'bot-01', normalizer, store,
            itemResolver: { resolve: () => null, matches: () => ({ matched: false }) }
        });
        await knowledge.initialize();
        const source = { commandKey: 'minerals', command: '/ks', clicks: [16], actions: ['menu_crafting'], source: 'operation' };

        const oldSlots = Array(54).fill(null);
        oldSlots[13] = { name: 'lapis_lazuli', displayName: 'Old Lapis Recipe', count: 1, lore: [] };
        const oldSession = new GuiSession({ botId: 'bot-01', connectionGeneration: 1, window: { title: 'Craft', type: 'generic', slots: oldSlots }, source });
        await knowledge.learnSlot(oldSession, {
            source,
            roleId: 'recipe:refined_lapis',
            slot: 13,
            logicalItemId: 'refined_lapis',
            context: 'crafting-menu',
            bootstrapSlot: 13
        });

        const newSlots = Array(54).fill(null);
        newSlots[13] = { name: 'lapis_lazuli', displayName: 'New Lapis Recipe', count: 1, lore: ['changed'] };
        const newSession = new GuiSession({ botId: 'bot-01', connectionGeneration: 1, window: { title: 'Craft', type: 'generic', slots: newSlots }, source });
        assert.equal(await knowledge.resolveSlot(newSession, {
            source,
            roleId: 'recipe:refined_lapis',
            bootstrapSlot: 13,
            logicalItemId: 'refined_lapis',
            context: 'crafting-menu'
        }), 13);

        const saved = await store.readRecord('ks__menu_crafting');
        assert.equal(saved.learned['recipe:refined_lapis'].currentSlot, 13);
        assert.equal(saved.learned['recipe:refined_lapis'].fingerprint.displayName, 'New Lapis Recipe');
        assert.equal(saved.learned['recipe:refined_lapis'].relearnCount, 1);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('null bootstrap slot is not coerced into slot zero', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-gui-null-bootstrap-'));
    try {
        const normalizer = new GuiStructureNormalizer({ itemNormalizer: new ItemNormalizer() });
        const store = new GuiObservationStore({ baseDir: directory, botId: 'bot-01' });
        const knowledge = new GuiKnowledgeRegistry({
            botId: 'bot-01', normalizer, store,
            itemResolver: { resolve: () => null, matches: () => ({ matched: false }) }
        });
        await knowledge.initialize();
        const source = { commandKey: 'minerals', command: '/ks', clicks: [16], actions: ['menu_crafting'], source: 'operation' };
        const slots = Array(54).fill(null);
        slots[0] = { name: 'barrier', displayName: 'Decoration', count: 1, lore: [] };
        const session = new GuiSession({ botId: 'bot-01', connectionGeneration: 1, window: { title: 'Craft', type: 'generic', slots }, source });
        assert.equal(await knowledge.resolveSlot(session, {
            source,
            roleId: 'recipe:unknown',
            bootstrapSlot: null,
            logicalItemId: 'unknown',
            context: 'crafting-menu'
        }), -1);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('MMOItems identity learned from crafting GUI recognizes vanilla-looking inventory output', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-gui-mmoitems-'));
    try {
        const normalizer = new GuiStructureNormalizer({ itemNormalizer: new ItemNormalizer() });
        const store = new GuiObservationStore({ baseDir: directory, botId: 'bot-01' });
        const itemResolver = { resolve: () => null, matches: () => ({ matched: false }) };
        const knowledge = new GuiKnowledgeRegistry({ botId: 'bot-01', normalizer, store, itemResolver });
        await knowledge.initialize();
        const source = { commandKey: 'minerals', command: '/ks', clicks: [16], actions: ['menu_crafting'], source: 'operation' };
        const componentMap = new Map([['minecraft:custom_data', {
            type: 'compound',
            value: {
                MMOITEMS_ITEM_ID: { type: 'string', value: 'MMOITEMS_ITEM_ID:DADOTINHLUYEN' },
                id: { type: 'string', value: 'id:22' }
            }
        }]]);
        const slots = Array(54).fill(null);
        slots[12] = {
            name: 'redstone',
            displayName: '§cĐá đỏ tinh luyện',
            count: 1,
            lore: ['§7B2'],
            componentMap
        };
        const session = new GuiSession({ botId: 'bot-01', connectionGeneration: 1, window: { title: 'Craft', type: 'generic', slots }, source });
        await knowledge.learnSlot(session, {
            source,
            roleId: 'recipe:refined_redstone',
            slot: 12,
            logicalItemId: 'refined_redstone',
            context: 'crafting-menu',
            bootstrapSlot: 12
        });

        const inventoryOutput = {
            name: 'redstone',
            displayName: 'Redstone Dust',
            count: 15,
            lore: ['§7Nguyên liệu sử dụng để chế tạo'],
            componentMap
        };
        assert.equal(knowledge.matchesLogical(inventoryOutput, 'refined_redstone', 'inventory'), true);
        assert.equal(knowledge.resolveLogicalId(inventoryOutput, 'inventory'), 'refined_redstone');
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('legacy display-name fingerprint is upgraded with custom identity when GUI is observed again', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-gui-identity-upgrade-'));
    try {
        const normalizer = new GuiStructureNormalizer({ itemNormalizer: new ItemNormalizer() });
        const store = new GuiObservationStore({ baseDir: directory, botId: 'bot-01' });
        const itemResolver = { resolve: () => null, matches: () => ({ matched: false }) };
        const knowledge = new GuiKnowledgeRegistry({ botId: 'bot-01', normalizer, store, itemResolver });
        await knowledge.initialize();
        const source = { commandKey: 'minerals', command: '/ks', clicks: [16], actions: ['menu_crafting'], source: 'operation' };

        const oldSlots = Array(54).fill(null);
        oldSlots[12] = { name: 'redstone', displayName: '§cĐá đỏ tinh luyện', count: 1, lore: ['§7B2'] };
        await knowledge.learnSlot(new GuiSession({ botId: 'bot-01', connectionGeneration: 1, window: { title: 'Craft', type: 'generic', slots: oldSlots }, source }), {
            source,
            roleId: 'recipe:refined_redstone',
            slot: 12,
            logicalItemId: 'refined_redstone',
            context: 'crafting-menu',
            bootstrapSlot: 12
        });

        const componentMap = new Map([['minecraft:custom_data', {
            type: 'compound',
            value: {
                MMOITEMS_ITEM_ID: { type: 'string', value: 'MMOITEMS_ITEM_ID:DADOTINHLUYEN' },
                id: { type: 'string', value: 'id:22' }
            }
        }]]);
        const newSlots = Array(54).fill(null);
        newSlots[12] = { name: 'redstone', displayName: '§cĐá đỏ tinh luyện', count: 1, lore: ['§7B2'], componentMap };
        const current = new GuiSession({ botId: 'bot-01', connectionGeneration: 2, window: { title: 'Craft', type: 'generic', slots: newSlots }, source });
        assert.equal(await knowledge.resolveSlot(current, {
            source,
            roleId: 'recipe:refined_redstone',
            bootstrapSlot: 12,
            logicalItemId: 'refined_redstone',
            context: 'crafting-menu'
        }), 12);

        const saved = await store.readKnowledge();
        assert.deepEqual(saved.items.refined_redstone.fingerprint.identityComponents, [
            'MMOITEMS_ITEM_ID:DADOTINHLUYEN',
            'id:22'
        ]);
        assert.equal(knowledge.matchesLogical({
            name: 'redstone', displayName: 'Redstone Dust', count: 15, lore: [], componentMap
        }, 'refined_redstone', 'inventory'), true);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('legacy bare MMOItems knowledge matches canonical full inventory identity and upgrades on relearn', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-gui-mmoitems-legacy-bare-'));
    try {
        const normalizer = new GuiStructureNormalizer({ itemNormalizer: new ItemNormalizer() });
        const store = new GuiObservationStore({ baseDir: directory, botId: 'bot-01' });
        const itemResolver = { resolve: () => null, matches: () => ({ matched: false }) };
        const source = { commandKey: 'minerals', command: '/ks', clicks: [16], actions: ['menu_crafting'], source: 'operation' };

        await store.updateGlobalItem('refined_redstone', {
            logicalItemId: 'refined_redstone',
            fingerprint: {
                name: 'redstone', displayName: '', lore: [],
                identityComponents: ['DADOTINHLUYEN'], identityNbt: [], identityStructuralKeys: [], customModelData: null
            }
        });

        const knowledge = new GuiKnowledgeRegistry({ botId: 'bot-01', normalizer, store, itemResolver });
        await knowledge.initialize();
        const componentMap = new Map([['minecraft:custom_data', {
            type: 'compound',
            value: {
                MMOITEMS_ITEM_ID: { type: 'string', value: 'DADOTINHLUYEN' },
                id: { type: 'string', value: 'id:22' }
            }
        }]]);
        const inventoryOutput = { name: 'redstone', displayName: 'Redstone Dust', count: 15, lore: [], componentMap };
        assert.equal(knowledge.matchesLogical(inventoryOutput, 'refined_redstone', 'inventory'), true);

        const slots = Array(54).fill(null);
        slots[12] = { name: 'redstone', displayName: '§cĐá đỏ tinh luyện', count: 1, lore: ['§7B2'], componentMap };
        const session = new GuiSession({ botId: 'bot-01', connectionGeneration: 3, window: { title: 'Craft', type: 'generic', slots }, source });
        await knowledge.learnSlot(session, {
            source,
            roleId: 'recipe:refined_redstone',
            slot: 12,
            logicalItemId: 'refined_redstone',
            context: 'crafting-menu',
            bootstrapSlot: 12
        });
        const saved = await store.readKnowledge();
        assert.equal(saved.items.refined_redstone.fingerprint.identityComponents[0], 'MMOITEMS_ITEM_ID:DADOTINHLUYEN');
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('crafting recipe knowledge never resolves a GUI role from appended player inventory', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-gui-container-boundary-'));
    try {
        const normalizer = new GuiStructureNormalizer({ itemNormalizer: new ItemNormalizer() });
        const store = new GuiObservationStore({ baseDir: directory, botId: 'bot-01' });
        const itemResolver = { resolve: () => null, matches: () => ({ matched: false }) };
        const source = { commandKey: 'minerals', command: '/ks', clicks: [16], actions: ['menu_crafting'], source: 'operation' };
        const customData = new Map([['minecraft:custom_data', {
            type: 'compound',
            value: { MMOITEMS_ITEM_ID: { type: 'string', value: 'KHOISIEUDACUOI' } }
        }]]);
        const menuItem = { name: 'cobblestone', displayName: '§aKhối siêu đá cuội', count: 1, lore: [] };
        const inventoryOutput = { name: 'cobblestone', displayName: 'Cobblestone', count: 48, lore: [], componentMap: customData };
        const slots = Array(90).fill(null);
        slots[20] = menuItem;
        slots[89] = inventoryOutput;
        const window = { title: 'ᴄʜế ᴛạᴏ', type: 'minecraft:generic_9x6', slots, inventoryStart: 54, inventoryEnd: 90 };
        const session = new GuiSession({ botId: 'bot-01', connectionGeneration: 1, window, source });

        // Reproduce the persisted 2.6.5 corruption: the recipe role/global item
        // was learned from the real output sitting in player slot 89.
        const seed = new GuiKnowledgeRegistry({ botId: 'bot-01', normalizer, store, itemResolver });
        await seed.initialize();
        const observed = await seed.observe(session, { source });
        const badFingerprint = normalizer.fingerprintItem(inventoryOutput);
        await store.updateLearned(observed.key, 'recipe:super_cobblestone_block', {
            roleId: 'recipe:super_cobblestone_block',
            logicalItemId: 'super_cobblestone_block',
            context: 'crafting-menu',
            bootstrapSlot: 20,
            currentSlot: 89,
            fingerprint: badFingerprint,
            learnedAt: new Date().toISOString(),
            lastMatchedAt: new Date().toISOString(),
            relearnCount: 0
        });
        await store.updateGlobalItem('super_cobblestone_block', {
            logicalItemId: 'super_cobblestone_block',
            fingerprint: badFingerprint,
            fingerprints: [badFingerprint],
            learnedFrom: { route: observed.key, roleId: 'recipe:super_cobblestone_block', slot: 89 },
            learnedAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString()
        });

        const knowledge = new GuiKnowledgeRegistry({ botId: 'bot-01', normalizer, store, itemResolver });
        await knowledge.initialize();
        const resolved = await knowledge.resolveSlot(session, {
            source,
            roleId: 'recipe:super_cobblestone_block',
            bootstrapSlot: 20,
            logicalItemId: 'super_cobblestone_block',
            context: 'crafting-menu'
        });

        assert.equal(resolved, 20, 'player inventory slot 89 must never win GUI role resolution');
        const saved = await store.readRecord(observed.key);
        assert.equal(saved.learned['recipe:super_cobblestone_block'].currentSlot, 20);
        assert.equal(saved.learned['recipe:super_cobblestone_block'].bootstrapSlot, 20);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('learnSlot rejects player inventory coordinates appended to a GUI window', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-gui-learn-boundary-'));
    try {
        const normalizer = new GuiStructureNormalizer({ itemNormalizer: new ItemNormalizer() });
        const store = new GuiObservationStore({ baseDir: directory, botId: 'bot-01' });
        const knowledge = new GuiKnowledgeRegistry({ botId: 'bot-01', normalizer, store });
        await knowledge.initialize();
        const slots = Array(90).fill(null);
        slots[89] = { name: 'cobblestone', displayName: 'Cobblestone', count: 48, lore: [] };
        const session = new GuiSession({
            botId: 'bot-01', connectionGeneration: 1,
            window: { title: 'Craft', type: 'minecraft:generic_9x6', slots, inventoryStart: 54, inventoryEnd: 90 }
        });
        await assert.rejects(() => knowledge.learnSlot(session, {
            source: { command: '/ks', actions: ['menu_crafting'], source: 'operation' },
            roleId: 'recipe:bad',
            slot: 89,
            logicalItemId: 'bad',
            context: 'crafting-menu'
        }), /outside the container region/);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});


test('GUI resolver fallback records resolver exceptions without making slot matching fatal', () => {
    const normalizer = new GuiStructureNormalizer({ itemNormalizer: new ItemNormalizer() });
    const logs = [];
    const knowledge = new GuiKnowledgeRegistry({
        botId: 'bot-01',
        normalizer,
        store: {},
        itemResolver: {
            resolve() { throw Object.assign(new Error('resolver resolve failed'), { code: 'RESOLVE_FAIL' }); },
            matches() { throw Object.assign(new Error('resolver matches failed'), { code: 'MATCH_FAIL' }); }
        },
        logger: { debug: (message, meta) => logs.push({ message, meta }) }
    });
    assert.equal(knowledge.matchesLogical({ name: 'stone', displayName: 'Stone', lore: [] }, 'logical:test', 'inventory'), false);
    assert.ok(logs.length >= 2);
    assert.ok(logs.every(entry => /resolver fallback failed/i.test(entry.message)));
    assert.ok(logs.some(entry => entry.meta.error.code === 'RESOLVE_FAIL'));
    assert.ok(logs.some(entry => entry.meta.error.code === 'MATCH_FAIL'));
});
