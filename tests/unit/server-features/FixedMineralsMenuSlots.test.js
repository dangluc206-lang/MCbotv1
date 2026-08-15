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
