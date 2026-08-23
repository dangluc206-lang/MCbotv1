'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CraftingOperation = require('../../../src/server-features/crafting/CraftingOperation');

function windowWith(id, size, entries = {}) {
    const slots = Array(size).fill(null);
    for (const [slot, item] of Object.entries(entries)) slots[Number(slot)] = item;
    return { id, title: `window-${id}`, slots };
}

test('crafting waits 15 ticks before quantity click, 10 ticks after, closes GUI, then verifies bot inventory only', async () => {
    const order = [];
    const rootWindow = windowWith(1, 27, { 16: { displayName: 'crafting' } });
    const craftingWindow = windowWith(2, 54, { 10: { displayName: 'recipe' } });
    const quantityWindow = windowWith(3, 45, { 20: { displayName: '64' } });

    const bot = {
        currentWindow: null,
        inventory: { slots: [] },
        waitForTicks: async ticks => order.push(`wait:${ticks}`),
        closeWindow: window => {
            order.push(`close:${window.id}`);
            if (bot.currentWindow === window) bot.currentWindow = null;
        }
    };

    let transition = 0;
    const guiManager = {
        context: { require: () => bot },
        current: () => null,
        describeCurrent: () => ({ windowId: bot.currentWindow?.id ?? null }),
        performAndWaitForOpen: async action => {
            await action();
            bot.currentWindow = rootWindow;
            return { session: { window: rootWindow } };
        },
        clickAndWaitForTransition: async slot => {
            order.push(`transition-click:${slot}`);
            transition += 1;
            const window = transition === 1 ? craftingWindow : quantityWindow;
            bot.currentWindow = window;
            return { window };
        },
        click: async slot => order.push(`quantity-click:${slot}`),
        syncCurrentWindow: () => null,
        closeCurrentWindow: async () => {
            const current = bot.currentWindow;
            if (current) bot.closeWindow(current);
            return true;
        }
    };

    const resultVerifier = {
        before: (_output, _inputs, options) => {
            order.push(`before:${options.inventorySource}`);
            return { countsBySource: { 'bot-inventory': 0 } };
        },
        arm: () => order.push('arm'),
        after: async (_output, _before, options) => {
            order.push(`verify:${options.inventorySource}:${bot.currentWindow ? 'gui-open' : 'gui-closed'}`);
            return { verified: true, before: 0, after: 64, verificationMode: 'output-snapshot-delta' };
        }
    };

    const operation = new CraftingOperation({
        commandService: { send: async () => ({ success: true }) },
        guiManager,
        context: { require: () => bot },
        itemResolver: {
            matches: (item, logicalId) => ({ matched: item?.displayName === logicalId })
        },
        recipeRegistry: {
            require: () => ({ output: 'refined_coal', menuItemId: 'recipe', menuSlot: 10, outputAmount: 1, inputs: { coal: 32 }, inputSource: 'storage' }),
            ids: () => ['refined_coal']
        },
        quantityResolver: { resolve: () => 20 },
        resultVerifier,
        config: {
            commandKey: 'minerals',
            entryMenuItemId: 'crafting',
            entrySlot: 16,
            guiTimeoutMs: 100,
            resultDelayMs: 0,
            preQuantityClickTicks: 15,
            postQuantityClickTicks: 10,
            openSettleMs: 0
        }
    });

    await operation.execute('refined_coal', 64);

    const pre = order.indexOf('wait:15');
    const click = order.indexOf('quantity-click:20');
    const post = order.indexOf('wait:10');
    const close = order.indexOf('close:3');
    const verify = order.indexOf('verify:bot-inventory:gui-closed');

    assert.ok(pre >= 0, order.join(' -> '));
    assert.ok(click > pre, order.join(' -> '));
    assert.ok(post > click, order.join(' -> '));
    assert.ok(close > post, order.join(' -> '));
    assert.ok(verify > close, order.join(' -> '));
    assert.ok(order.includes('before:bot-inventory'));
    assert.ok(order.includes('arm'));
});


test('crafting ALL uses dynamic quantity action and reports actual crafts from output delta', async () => {
    const order = [];
    const rootWindow = windowWith(11, 27, { 16: { displayName: 'crafting' } });
    const craftingWindow = windowWith(12, 54, { 10: { displayName: 'recipe' } });
    const quantityWindow = windowWith(13, 45, { 24: { displayName: 'ALL' } });
    const bot = {
        currentWindow: null,
        inventory: { slots: [] },
        waitForTicks: async ticks => order.push(`wait:${ticks}`),
        closeWindow: window => { if (bot.currentWindow === window) bot.currentWindow = null; }
    };
    let transition = 0;
    const guiManager = {
        context: { require: () => bot }, current: () => null, describeCurrent: () => ({}),
        performAndWaitForOpen: async action => { await action(); bot.currentWindow = rootWindow; return { session: { window: rootWindow } }; },
        clickAndWaitForTransition: async () => { transition += 1; const window = transition === 1 ? craftingWindow : quantityWindow; bot.currentWindow = window; return { window }; },
        click: async slot => order.push(`click:${slot}`), syncCurrentWindow: () => null,
        closeCurrentWindow: async () => { bot.currentWindow = null; return true; }
    };
    let afterOptions = null;
    const resultVerifier = {
        before: () => ({ count: 0, countsBySource: { 'bot-inventory': 0 }, views: [], inputCounts: {} }),
        arm() {},
        after: async (_output, _before, options) => {
            afterOptions = options;
            return { verified: true, before: 0, after: 144, delta: 144, verificationMode: 'output-snapshot-delta', inputEvidence: [], eventEvidence: { outputDelta: 0 } };
        }
    };
    const operation = new CraftingOperation({
        commandService: { send: async () => ({ success: true }) }, guiManager, context: { require: () => bot },
        itemResolver: { matches: (item, id) => ({ matched: item?.displayName === id }) },
        recipeRegistry: { require: () => ({ output: 'refined_coal_block', menuItemId: 'recipe', menuSlot: 10, outputAmount: 1, inputs: { refined_coal: 16 } }), ids: () => ['r'] },
        quantityResolver: { resolve: amount => amount === 'ALL' ? 24 : -1, describeCandidates: () => [] },
        resultVerifier,
        config: { commandKey: 'minerals', entryMenuItemId: 'crafting', entrySlot: 16, guiTimeoutMs: 100, resultDelayMs: 0, preQuantityClickTicks: 15, postQuantityClickTicks: 10, openSettleMs: 0 }
    });

    const result = await operation.execute('r', 'ALL');
    assert.equal(result.quantityAction, 'ALL');
    assert.equal(result.quantitySlot, 24);
    assert.equal(result.actualCrafts, 144);
    assert.equal(result.producedAmount, 144);
    assert.equal(afterOptions.expectedDelta, 1);
    assert.equal(afterOptions.inputRequirements.refined_coal.amount, 16);
    assert.ok(order.includes('click:24'));
});

test('failed verification after quantity click returns a non-retryable uncertain outcome with reconciliation baseline', async () => {
    const rootWindow = windowWith(21, 27, { 16: { displayName: 'crafting' } });
    const craftingWindow = windowWith(22, 54, { 10: { displayName: 'recipe' } });
    const quantityWindow = windowWith(23, 45, { 24: { displayName: 'ALL' } });
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
    const resultVerifier = {
        before: () => ({
            count: 0,
            countsBySource: { 'bot-inventory': 0 },
            views: [],
            inputCounts: { refined_coal: { count: 64, countsBySource: { 'bot-inventory': 64 } } }
        }),
        arm() {},
        after: async () => ({
            verified: false,
            before: 0,
            after: 0,
            delta: 0,
            attempt: 10,
            verificationMode: 'none',
            inputEvidence: [{ inputId: 'refined_coal', expected: 16, consumed: 0 }],
            eventEvidence: { outputDelta: 0, eventCount: 0, mmoCandidates: [] },
            snapshotMmoCandidates: [],
            syncEvidence: { timedOut: true }
        })
    };
    const operation = new CraftingOperation({
        commandService: { send: async () => ({ success: true }) }, guiManager, context: { require: () => bot },
        itemResolver: { matches: (item, id) => ({ matched: item?.displayName === id }) },
        recipeRegistry: { require: () => ({ output: 'refined_coal_block', menuItemId: 'recipe', menuSlot: 10, outputAmount: 1, inputs: { refined_coal: 16 } }), ids: () => ['r'] },
        quantityResolver: { resolve: amount => amount === 'ALL' ? 24 : -1, describeCandidates: () => [] },
        resultVerifier,
        config: { commandKey: 'minerals', entryMenuItemId: 'crafting', entrySlot: 16, guiTimeoutMs: 100, resultDelayMs: 0, preQuantityClickTicks: 15, postQuantityClickTicks: 10, openSettleMs: 0 }
    });

    await assert.rejects(
        () => operation.execute('r', 'ALL', {
            reconciliationBaseline: {
                inputs: { refined_coal: { source: 'inventory', count: 64 } }
            }
        }),
        error => {
            assert.equal(error.code, 'CRAFTING_OUTCOME_UNCERTAIN');
            assert.equal(error.retryable, false);
            assert.equal(error.details.outcome.requiresReconciliation, true);
            assert.equal(error.details.outcome.safeToBlindRetry, false);
            assert.equal(error.details.reconciliationBaseline.outputCountBefore, 0);
            assert.equal(error.details.reconciliationBaseline.inputCountsBefore.refined_coal, 64);
            assert.deepEqual(error.details.reconciliationBaseline.inputs.refined_coal, { source: 'inventory', count: 64 });
            return true;
        }
    );
});
