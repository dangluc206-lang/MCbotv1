'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const MineralConversionOperation = require('../../../src/server-features/minerals/MineralConversionOperation');

function windowWith(size, entries = {}) {
    const slots = Array(size).fill(null);
    for (const [slot, item] of Object.entries(entries)) slots[Number(slot)] = item;
    return { slots };
}

test('mineral conversion closes an unrelated GUI before sending /ks', async () => {
    const calls = [];
    let current = { active: true, window: windowWith(9) };
    const rootWindow = windowWith(27, { 10: { name: 'menu_convert_blocks' } });
    const conversionWindow = windowWith(27, { 2: { name: 'iron_block' } });

    const operation = new MineralConversionOperation({
        commandService: {
            async send(key) {
                calls.push(`send:${key}`);
                assert.equal(current, null, '/ks must not be sent while /kho or another GUI is still open');
                return { success: true };
            }
        },
        guiManager: {
            current: () => current,
            async closeCurrentWindow() { calls.push('close'); current = null; return true; },
            performAndWaitForOpen: async action => {
                await action();
                return { session: { window: rootWindow } };
            },
            clickAndWaitForTransition: async slot => {
                calls.push(`transition:${slot}`);
                return { window: conversionWindow };
            },
            click: async slot => calls.push(`click:${slot}`)
        },
        itemResolver: { matches: (item, id) => ({ matched: item?.name === id }) },
        config: {
            commandKey: 'minerals', conversionMenuItemId: 'menu_convert_blocks', conversionMenuSlot: 10,
            guiTimeoutMs: 100, commandOpenAttempts: 3, commandOpenRetryMs: 0, commandCloseSettleMs: 0
        },
        conversionConfig: {
            menuSettleMs: 0, resultDelayMs: 0,
            resources: {
                iron_ingot: { baseId: 'iron_ingot', blockId: 'iron_block', ratio: 9 }
            }
        }
    });

    const result = await operation.execute('iron_ingot', { direction: 'toBlock' });
    assert.equal(result.skipped, false);
    assert.deepEqual(calls, ['close', 'send:minerals', 'transition:10', 'click:2']);
});

test('mineral conversion accepts an in-place GUI update instead of requiring a new window', async () => {
    const rootWindow = windowWith(27, { 10: { name: 'menu_convert_blocks' } });
    const conversionWindow = windowWith(27, { 2: { name: 'iron_block' } });
    let current = null;
    let transitionOptions = null;

    const operation = new MineralConversionOperation({
        commandService: { async send() { return { success: true }; } },
        guiManager: {
            current: () => current,
            async closeCurrentWindow() { current = null; return true; },
            performAndWaitForOpen: async action => {
                await action();
                current = { window: rootWindow };
                return { session: current };
            },
            clickAndWaitForTransition: async (slot, options) => {
                assert.equal(slot, 10);
                transitionOptions = options;
                // Same logical window/session can be updated in place by the server.
                current.window = conversionWindow;
                return current;
            },
            syncCurrentWindow: () => current,
            click: async slot => assert.equal(slot, 2)
        },
        itemResolver: { matches: (item, id) => ({ matched: item?.name === id }) },
        config: {
            commandKey: 'minerals', conversionMenuItemId: 'menu_convert_blocks', conversionMenuSlot: 10,
            guiTimeoutMs: 100, commandOpenAttempts: 3, commandOpenRetryMs: 0, commandCloseSettleMs: 0
        },
        conversionConfig: {
            menuSettleMs: 0, resultDelayMs: 0, menuTransitionAttempts: 3, menuTransitionRetryMs: 0,
            resources: {
                iron_ingot: { baseId: 'iron_ingot', blockId: 'iron_block', ratio: 9 }
            }
        }
    });

    const result = await operation.execute('iron_ingot', { direction: 'toBlock' });
    assert.equal(result.skipped, false);
    assert.equal(transitionOptions.requireNewWindow, false);
});

test('mineral conversion recovers when the transition event times out but currentWindow already contains the conversion menu', async () => {
    const calls = [];
    const rootWindow = windowWith(27, { 10: { name: 'menu_convert_blocks' } });
    const conversionWindow = windowWith(27, { 2: { name: 'iron_block' } });
    let current = null;

    const operation = new MineralConversionOperation({
        commandService: { async send() { calls.push('send'); return { success: true }; } },
        guiManager: {
            current: () => current,
            async closeCurrentWindow() { calls.push('close'); current = null; return true; },
            performAndWaitForOpen: async action => {
                await action();
                current = { window: rootWindow };
                return { session: current };
            },
            clickAndWaitForTransition: async () => {
                calls.push('transition');
                current = { window: conversionWindow, setSource() { calls.push('source'); } };
                throw new Error('transition event missed');
            },
            syncCurrentWindow: () => current,
            click: async slot => { calls.push(`click:${slot}`); }
        },
        itemResolver: { matches: (item, id) => ({ matched: item?.name === id }) },
        config: {
            commandKey: 'minerals', conversionMenuItemId: 'menu_convert_blocks', conversionMenuSlot: 10,
            guiTimeoutMs: 100, commandOpenAttempts: 3, commandOpenRetryMs: 0, commandCloseSettleMs: 0
        },
        conversionConfig: {
            menuSettleMs: 0, resultDelayMs: 0, menuTransitionAttempts: 3, menuTransitionRetryMs: 0,
            resources: {
                iron_ingot: { baseId: 'iron_ingot', blockId: 'iron_block', ratio: 9 }
            }
        }
    });

    const result = await operation.execute('iron_ingot', { direction: 'toBlock' });
    assert.equal(result.skipped, false);
    assert.deepEqual(calls, ['send', 'transition', 'source', 'click:2']);
});

test('mineral conversion reopens /ks and retries the menu click after a genuine transition miss', async () => {
    const calls = [];
    const rootWindow = windowWith(27, { 10: { name: 'menu_convert_blocks' } });
    const conversionWindow = windowWith(27, { 2: { name: 'iron_block' } });
    let current = null;
    let transitionAttempt = 0;

    const operation = new MineralConversionOperation({
        commandService: { async send() { calls.push('send'); return { success: true }; } },
        guiManager: {
            current: () => current,
            async closeCurrentWindow() { calls.push('close'); current = null; return true; },
            performAndWaitForOpen: async action => {
                await action();
                current = { window: rootWindow };
                return { session: current };
            },
            clickAndWaitForTransition: async () => {
                transitionAttempt += 1;
                calls.push(`transition:${transitionAttempt}`);
                if (transitionAttempt === 1) throw new Error('first click missed');
                current = { window: conversionWindow };
                return current;
            },
            syncCurrentWindow: () => current,
            click: async slot => calls.push(`click:${slot}`)
        },
        itemResolver: { matches: (item, id) => ({ matched: item?.name === id }) },
        config: {
            commandKey: 'minerals', conversionMenuItemId: 'menu_convert_blocks', conversionMenuSlot: 10,
            guiTimeoutMs: 100, commandOpenAttempts: 3, commandOpenRetryMs: 0, commandCloseSettleMs: 0
        },
        conversionConfig: {
            menuSettleMs: 0, resultDelayMs: 0, menuTransitionAttempts: 3, menuTransitionRetryMs: 0,
            resources: {
                iron_ingot: { baseId: 'iron_ingot', blockId: 'iron_block', ratio: 9 }
            }
        }
    });

    const result = await operation.execute('iron_ingot', { direction: 'toBlock' });
    assert.equal(result.skipped, false);
    assert.deepEqual(calls, ['send', 'transition:1', 'close', 'send', 'transition:2', 'click:2']);
});
