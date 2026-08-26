'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CraftingOperation = require('../../../src/server-features/crafting/CraftingOperation');
const B5StorageFlow = require('../../../src/server-features/crafting/b5/flows/B5StorageFlow');
const Result = require('../../../src/shared/result/Result');

function windowWith(id, size, entries = {}) {
    const slots = Array(size).fill(null);
    for (const [slot, item] of Object.entries(entries)) slots[Number(slot)] = item;
    return { id, title: `window-${id}`, slots };
}

test('B5 may override stale recipe storage input source to inventory for B1->B2 verification', async () => {
    const rootWindow = windowWith(1, 27, { 16: { displayName: 'crafting' } });
    const craftingWindow = windowWith(2, 54, { 10: { displayName: 'recipe' } });
    const quantityWindow = windowWith(3, 45, { 24: { displayName: 'ALL' } });
    const bot = {
        currentWindow: null,
        inventory: { slots: [] },
        waitForTicks: async () => {},
        closeWindow: window => { if (bot.currentWindow === window) bot.currentWindow = null; }
    };
    let transition = 0;
    const guiManager = {
        context: { require: () => bot }, current: () => null, describeCurrent: () => ({}),
        performAndWaitForOpen: async action => { await action(); bot.currentWindow = rootWindow; return { session: { window: rootWindow } }; },
        clickAndWaitForTransition: async () => { transition += 1; const window = transition === 1 ? craftingWindow : quantityWindow; bot.currentWindow = window; return { window }; },
        click: async () => {}, syncCurrentWindow: () => null,
        closeCurrentWindow: async () => { bot.currentWindow = null; return true; }
    };
    let afterOptions = null;
    const resultVerifier = {
        before: () => ({
            count: 0,
            countsBySource: { 'bot-inventory': 0 },
            views: [],
            inputCounts: { coal: { count: 64, countsBySource: { 'bot-inventory': 64 } } }
        }),
        arm() {},
        after: async (_output, _before, options) => {
            afterOptions = options;
            return { verified: true, before: 0, after: 4, delta: 4, verificationMode: 'output-snapshot-delta', inputEvidence: [], eventEvidence: { outputDelta: 0 } };
        }
    };
    const operation = new CraftingOperation({
        commandService: { send: async () => ({ success: true }) }, guiManager, context: { require: () => bot },
        itemResolver: { matches: (item, id) => ({ matched: item?.displayName === id }) },
        recipeRegistry: {
            // Deliberately stale/wrong source: execution override must win.
            require: () => ({ output: 'refined_coal', menuItemId: 'recipe', menuSlot: 10, outputAmount: 1, inputs: { coal: 16 }, inputSource: 'storage' }),
            ids: () => ['refined_coal']
        },
        quantityResolver: { resolve: amount => amount === 'ALL' ? 24 : -1, describeCandidates: () => [] },
        resultVerifier,
        config: { commandKey: 'minerals', entryMenuItemId: 'crafting', entrySlot: 16, guiTimeoutMs: 100, resultDelayMs: 0, preQuantityClickTicks: 15, postQuantityClickTicks: 10, openSettleMs: 0 }
    });

    await operation.execute('refined_coal', 'ALL', { inputSourceOverrides: { coal: 'inventory' } });
    assert.equal(afterOptions.inputRequirements.coal.source, 'inventory');
    assert.equal(afterOptions.inputRequirements.coal.amount, 16);
});

test('B5StorageFlow finalizeBase closes the active material and compacts it before switching', async () => {
    const calls = [];
    const b1Materials = {
        storage: null,
        logger: null,
        async compact(baseId) { calls.push(`compact:${baseId}`); return Result.ok({ baseId, converted: true }); }
    };
    const flow = new B5StorageFlow({ b1Materials });
    flow.activeBaseId = 'coal';
    flow.activeGeneration = 7;
    flow.transfer = {
        async depositAll(baseId) { calls.push(`depositAll:${baseId}`); return { ready: true, moved: 64 }; }
    };

    const result = await flow.finalizeBase('coal', { expectedGeneration: 7 });
    assert.equal(result.success, true);
    assert.equal(result.data.ready, true);
    assert.deepEqual(calls, ['depositAll:coal', 'compact:coal']);
    assert.equal(flow.activeBaseId, null);
});
