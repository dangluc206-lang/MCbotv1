'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CraftingOperation = require('../../../src/server-features/crafting/CraftingOperation');
const MineralConversionOperation = require('../../../src/server-features/minerals/MineralConversionOperation');
const SmeltingOperation = require('../../../src/server-features/smelting/SmeltingOperation');

function windowWith(size, entries = {}) {
    const slots = Array(size).fill(null);
    for (const [slot, item] of Object.entries(entries)) slots[Number(slot)] = item;
    return { slots };
}


function craftingContext() {
    return {
        require: () => ({
            currentWindow: null,
            waitForTicks: async () => {}
        })
    };
}

test('crafting enters /ks crafting menu through configured fixed slot before item-name matching', async () => {
    const clicks = [];
    const rootWindow = windowWith(27, { 16: { displayName: 'stylized crafting button' } });
    const craftingWindow = windowWith(54, { 10: { displayName: 'stylized recipe item' } });
    const quantityWindow = windowWith(45, { 3: { displayName: '64' } });
    const guiManager = {
        current: () => null,
        performAndWaitForOpen: async action => {
            await action();
            return { session: { window: rootWindow } };
        },
        clickAndWaitForTransition: async slot => {
            clicks.push(slot);
            return clicks.length === 1
                ? { window: craftingWindow }
                : { window: quantityWindow };
        },
        click: async slot => clicks.push(slot)
    };
    const operation = new CraftingOperation({
        commandService: { send: async () => ({ success: true }) },
        guiManager,
        context: craftingContext(),
        itemResolver: {
            matches: () => ({ matched: false })
        },
        recipeRegistry: {
            require: () => ({ output: 'out', menuItemId: 'recipe_b2', menuSlot: 10 })
        },
        quantityResolver: { resolve: () => 3 },
        resultVerifier: {
            before: () => ({}),
            after: () => ({ verified: true })
        },
        config: {
            commandKey: 'minerals',
            entryMenuItemId: 'menu_crafting',
            entrySlot: 16,
            guiTimeoutMs: 100,
            resultDelayMs: 0
        }
    });

    await operation.execute('recipe_b2', 64);
    assert.deepEqual(clicks, [16, 10, 3]);
});

test('mineral conversion enters /ks conversion menu through configured slot 10', async () => {
    const clicks = [];
    const rootWindow = windowWith(27, { 10: { displayName: 'stylized conversion button' } });
    const conversionWindow = windowWith(9, { 4: { logicalId: 'coal_block' } });
    const operation = new MineralConversionOperation({
        commandService: { send: async () => ({ success: true }) },
        guiManager: {
            current: () => null,
            performAndWaitForOpen: async action => {
                await action();
                return { session: { window: rootWindow } };
            },
            clickAndWaitForTransition: async slot => {
                clicks.push(slot);
                return { window: conversionWindow };
            },
            click: async slot => clicks.push(slot)
        },
        itemResolver: {
            matches: (item, logicalId) => ({ matched: item?.logicalId === logicalId })
        },
        config: {
            commandKey: 'minerals',
            conversionMenuItemId: 'menu_convert_blocks',
            conversionMenuSlot: 10,
            guiTimeoutMs: 100
        },
        conversionConfig: {
            menuSettleMs: 0,
            resultDelayMs: 0,
            resources: {
                coal: {
                    baseId: 'coal',
                    blockId: 'coal_block',
                    ratio: 9,
                    toBlockMenuItemId: 'coal_block',
                    toBaseMenuItemId: 'coal'
                }
            }
        }
    });

    const result = await operation.execute('coal', { direction: 'toBlock' });
    assert.equal(result.skipped, false);
    assert.deepEqual(clicks, [10, 4]);
});

test('smelting entered through /ks uses configured slot 12 before matching menu name', async () => {
    const clicks = [];
    const rootWindow = windowWith(27, { 12: { displayName: 'stylized smelting button' } });
    const smeltingWindow = windowWith(9, { 1: { displayName: 'raw iron', logicalId: 'raw_iron' } });
    const operation = new SmeltingOperation({
        commandService: { send: async () => ({ success: true }) },
        guiManager: {
            current: () => null,
            performAndWaitForOpen: async action => {
                await action();
                return { session: { window: rootWindow } };
            },
            clickAndWaitForTransition: async slot => {
                clicks.push(slot);
                return { window: smeltingWindow };
            },
            click: async slot => clicks.push(slot)
        },
        itemResolver: {
            matches: (item, logicalId) => ({ matched: item?.logicalId === logicalId })
        },
        config: {
            commandKey: 'smelting',
            mineralsCommandKey: 'minerals',
            mineralsMenuItemId: 'menu_smelting',
            mineralsMenuSlot: 12,
            actionSlot: 1,
            guiTimeoutMs: 100,
            resultDelayMs: 0,
            recipes: {
                raw_iron_to_iron: {
                    input: 'raw_iron',
                    output: 'iron_ingot',
                    menuItemId: 'smelt_iron'
                }
            }
        }
    });

    const result = await operation.execute('raw_iron_to_iron', { entry: 'minerals' });
    assert.equal(result.skipped, false);
    assert.deepEqual(clicks, [12, 1]);
});

test('crafting retries learned recipe lookup before failing a temporarily incomplete GUI', async () => {
    const clicks = [];
    const rootWindow = windowWith(27, { 16: { displayName: 'crafting' } });
    const craftingWindow = windowWith(54, { 13: { displayName: 'lapis recipe' } });
    const quantityWindow = windowWith(45, { 3: { displayName: '64' } });
    let recipeResolveCalls = 0;
    const operation = new CraftingOperation({
        commandService: { send: async () => ({ success: true }) },
        guiManager: {
            current: () => null,
            performAndWaitForOpen: async action => { await action(); return { session: { window: rootWindow } }; },
            clickAndWaitForTransition: async slot => {
                clicks.push(slot);
                return clicks.length === 1 ? { window: craftingWindow } : { window: quantityWindow };
            },
            click: async slot => clicks.push(slot)
        },
        context: craftingContext(),
        itemResolver: { matches: () => ({ matched: false }) },
        recipeRegistry: {
            require: () => ({ output: 'refined_lapis', menuItemId: 'refined_lapis', menuSlot: 13 }),
            ids: () => ['refined_lapis']
        },
        quantityResolver: { resolve: () => 3 },
        resultVerifier: { before: () => ({}), after: () => ({ verified: true }) },
        guiKnowledge: {
            learnBootstrapSlots: async () => ({}),
            resolveSlot: async (_session, options) => {
                if (options.roleId === 'menu_crafting') return 16;
                if (options.roleId === 'recipe:refined_lapis') {
                    recipeResolveCalls += 1;
                    return recipeResolveCalls === 1 ? -1 : 13;
                }
                if (options.roleId === 'quantity:64') return 3;
                return -1;
            }
        },
        config: {
            commandKey: 'minerals',
            entryMenuItemId: 'menu_crafting',
            entrySlot: 16,
            guiTimeoutMs: 100,
            resultDelayMs: 0,
            recipeLearnAttempts: 3,
            recipeLearnRetryMs: 1
        }
    });

    await operation.execute('refined_lapis', 64);
    assert.equal(recipeResolveCalls, 2);
    assert.deepEqual(clicks, [16, 13, 3]);
});

test('crafting with real GUI knowledge clicks recipe container slot, never matching MMOItems output in player slot 89', async () => {
    const fs = require('node:fs/promises');
    const os = require('node:os');
    const path = require('node:path');
    const ItemNormalizer = require('../../../src/items/ItemNormalizer');
    const GuiStructureNormalizer = require('../../../src/gui/observation/GuiStructureNormalizer');
    const GuiObservationStore = require('../../../src/gui/observation/GuiObservationStore');
    const GuiKnowledgeRegistry = require('../../../src/gui/knowledge/GuiKnowledgeRegistry');

    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-craft-container-boundary-'));
    try {
        const normalizer = new GuiStructureNormalizer({ itemNormalizer: new ItemNormalizer() });
        const store = new GuiObservationStore({ baseDir: directory, botId: 'bot-01' });
        const itemResolver = { resolve: () => null, matches: () => ({ matched: false }) };
        const knowledge = new GuiKnowledgeRegistry({ botId: 'bot-01', normalizer, store, itemResolver });
        await knowledge.initialize();

        const componentMap = new Map([['minecraft:custom_data', {
            type: 'compound', value: { MMOITEMS_ITEM_ID: { type: 'string', value: 'KHOISIEUDACUOI' } }
        }]]);
        const inventoryOutput = { name: 'cobblestone', displayName: 'Cobblestone', count: 48, lore: [], componentMap };
        await knowledge.learnLogicalItem('super_cobblestone_block', inventoryOutput, { source: 'preexisting-pv-or-inventory' });

        const rootSlots = Array(63).fill(null);
        rootSlots[16] = { name: 'smithing_table', displayName: 'Crafting', count: 1, lore: [] };
        const craftSlots = Array(90).fill(null);
        craftSlots[20] = { name: 'cobblestone', displayName: 'Khối siêu đá cuội', count: 1, lore: [] };
        craftSlots[89] = inventoryOutput;
        const quantitySlots = Array(90).fill(null);
        quantitySlots[24] = { name: 'paper', displayName: 'ALL', count: 1, lore: [] };

        const rootSession = { active: true, window: { id: 1, title: 'KS', slots: rootSlots, inventoryStart: 27, inventoryEnd: 63 } };
        const craftingSession = { active: true, window: { id: 2, title: 'Craft', slots: craftSlots, inventoryStart: 54, inventoryEnd: 90 } };
        const quantitySession = { active: true, window: { id: 3, title: 'Quantity', slots: quantitySlots, inventoryStart: 54, inventoryEnd: 90 } };
        const clicks = [];
        let transitions = 0;
        const guiManager = {
            current: () => null,
            performAndWaitForOpen: async action => { await action(); return { session: rootSession }; },
            clickAndWaitForTransition: async slot => {
                clicks.push(slot);
                transitions += 1;
                return transitions === 1 ? craftingSession : quantitySession;
            },
            click: async slot => clicks.push(slot),
            describeCurrent: () => null
        };

        const operation = new CraftingOperation({
            commandService: { send: async () => ({ success: true }) },
            guiManager,
            context: { require: () => ({ currentWindow: null, waitForTicks: async () => {} }) },
            itemResolver,
            recipeRegistry: {
                require: () => ({
                    output: 'super_cobblestone_block', outputAmount: 1,
                    menuItemId: 'super_cobblestone_block', menuSlot: 20,
                    inputs: { super_cobblestone: 16 }
                }),
                ids: () => ['super_cobblestone_block']
            },
            quantityResolver: { resolve: () => 24, describeCandidates: () => [] },
            resultVerifier: {
                before: () => ({ countsBySource: { 'bot-inventory': 48 } }),
                after: async () => ({ verified: true, delta: 1, before: 48, after: 49 })
            },
            guiKnowledge: knowledge,
            config: {
                commandKey: 'minerals', mineralsGuiId: 'minerals', guiId: 'crafting', quantityGuiId: 'craftingQuantity',
                entryMenuItemId: 'menu_crafting', entrySlot: 16,
                quantitySlots: { ALL: 24 }, guiTimeoutMs: 100, resultDelayMs: 0,
                preQuantityClickTicks: 0, postQuantityClickTicks: 0
            }
        });

        const result = await operation.execute('super_cobblestone_block', 'ALL');
        assert.equal(result.recipeSlot, 20);
        assert.deepEqual(clicks, [16, 20, 24]);
        assert.ok(!clicks.includes(89));
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('crafting configured recipe slot wins a stale learned fingerprint when the live bootstrap item matches', async () => {
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

    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-recipe-bootstrap-authority-'));
    try {
        const registry = new ItemRegistry({
            super_cobblestone: {
                representations: {
                    default: { rules: [{ type: 'name', value: 'Siêu đá cuội' }] },
                    inventory: { rules: [{ type: 'identity', value: 'MMOITEMS_ITEM_ID:SIEUDACUOI' }] }
                }
            },
            super_cobblestone_block: {
                representations: {
                    default: { rules: [{ type: 'name', value: 'Khối siêu đá cuội' }] },
                    inventory: { rules: [{ type: 'identity', value: 'MMOITEMS_ITEM_ID:KHOISIEUDACUOI' }] }
                }
            }
        });
        const itemNormalizer = new ItemNormalizer();
        const itemResolver = new ItemResolver({
            registry,
            matcher: new ItemMatcher({
                normalizer: itemNormalizer,
                composite: new CompositeItemMatcher({ name: new NameMatcher(), identity: new IdentityMatcher() })
            })
        });
        const store = new GuiObservationStore({ baseDir: directory, botId: 'bot-01' });
        const knowledge = new GuiKnowledgeRegistry({
            botId: 'bot-01',
            normalizer: new GuiStructureNormalizer({ itemNormalizer }),
            store,
            itemResolver
        });
        await knowledge.initialize();

        const slots = Array(90).fill(null);
        slots[10] = {
            name: 'cobblestone', displayName: 'Siêu đá cuội', count: 1,
            identityComponents: ['MMOITEMS_ITEM_ID:SIEUDACUOI', 'MATERIAL'], identityNbt: []
        };
        slots[20] = { name: 'cobblestone', displayName: 'Khối siêu đá cuội', count: 1, identityComponents: [], identityNbt: [] };
        const session = { active: true, window: { id: 4, title: 'Craft', slots, inventoryStart: 54, inventoryEnd: 90 } };
        const source = { commandKey: 'minerals', command: '/ks', guiId: 'crafting', clicks: [16], actions: ['menu_crafting'], source: 'operation' };

        // Simulate the stale 2.6.6 route binding which points the B3 role at B2 slot 10.
        await knowledge.learnSlot(session, {
            source,
            roleId: 'recipe:super_cobblestone_block',
            slot: 10,
            logicalItemId: 'super_cobblestone_block',
            context: 'crafting-menu',
            bootstrapSlot: 20
        });

        const resolved = await knowledge.resolveSlot(session, {
            source,
            roleId: 'recipe:super_cobblestone_block',
            bootstrapSlot: 20,
            logicalItemId: 'super_cobblestone_block',
            context: 'crafting-menu'
        });

        assert.equal(resolved, 20);
        const record = knowledge.getBySource(source);
        assert.equal(record.learned['recipe:super_cobblestone_block'].currentSlot, 20);
        assert.equal(knowledge.getStrongIdentity('super_cobblestone_block'), 'MMOITEMS_ITEM_ID:KHOISIEUDACUOI');
        assert.equal(knowledge.getStrongIdentity('super_cobblestone'), 'MMOITEMS_ITEM_ID:SIEUDACUOI');
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
