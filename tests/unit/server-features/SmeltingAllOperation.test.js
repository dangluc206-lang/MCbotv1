'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const SmeltingOperation = require('../../../src/server-features/smelting/SmeltingOperation');

function windowWith(size, entries = {}) {
    const slots = Array(size).fill(null);
    for (const [slot, item] of Object.entries(entries)) slots[Number(slot)] = item;
    return { slots };
}

function config() {
    return {
        commandKey: 'smelting',
        mineralsCommandKey: 'minerals',
        mineralsMenuItemId: 'menu_smelting',
        mineralsMenuSlot: 12,
        guiTimeoutMs: 100,
        resultDelayMs: 0,
        recipes: {
            raw_iron_to_iron: { input: 'raw_iron', output: 'iron_ingot', menuItemId: 'smelt_iron' },
            raw_gold_to_gold: { input: 'raw_gold', output: 'gold_ingot', menuItemId: 'smelt_gold' }
        }
    };
}

test('direct /nung clicks the requested raw material and processes all stock of that material', async () => {
    const clicks = [];
    const smeltingWindow = windowWith(9, {
        2: { name: 'raw_iron', displayName: 'Raw Iron' },
        4: { name: 'raw_gold', displayName: 'Raw Gold' }
    });
    const operation = new SmeltingOperation({
        commandService: { send: async key => { assert.equal(key, 'smelting'); return { success: true }; } },
        guiManager: {
            current: () => null,
            performAndWaitForOpen: async action => { await action(); return { session: { window: smeltingWindow } }; },
            click: async slot => clicks.push(slot)
        },
        itemResolver: { matches: (item, id) => ({ matched: item?.name === id }) },
        config: config()
    });

    const result = await operation.execute('raw_iron_to_iron', { entry: 'direct' });
    assert.equal(result.allForInput, true);
    assert.equal(result.input, 'raw_iron');
    assert.equal(result.skipped, false);
    assert.deepEqual(clicks, [2]);
});

test('learned per-material fingerprint can follow raw gold when its GUI slot moves', async () => {
    const clicks = [];
    const smeltingWindow = windowWith(9, { 5: { name: 'raw_gold', displayName: 'Raw Gold' } });
    const operation = new SmeltingOperation({
        commandService: { send: async () => ({ success: true }) },
        guiManager: {
            current: () => null,
            performAndWaitForOpen: async action => { await action(); return { session: { window: smeltingWindow } }; },
            click: async slot => clicks.push(slot)
        },
        itemResolver: { matches: () => ({ matched: false }) },
        guiKnowledge: {
            resolveSlot: async (_session, options) => {
                assert.equal(options.roleId, 'smelting:raw_gold_to_gold');
                assert.equal(options.logicalItemId, 'raw_gold');
                return 5;
            }
        },
        config: config()
    });

    const result = await operation.execute('raw_gold_to_gold', { entry: 'direct' });
    assert.equal(result.allForInput, true);
    assert.equal(result.input, 'raw_gold');
    assert.deepEqual(clicks, [5]);
});

test('direct /nung closes an unrelated GUI before sending the command', async () => {
    const calls = [];
    let current = { active: true, window: { slots: [] } };
    const smeltingWindow = windowWith(9, {
        2: { name: 'raw_iron', displayName: 'Raw Iron' }
    });
    const cfg = { ...config(), commandOpenAttempts: 3, commandOpenRetryMs: 0, commandCloseSettleMs: 0, openSettleMs: 0 };
    const operation = new SmeltingOperation({
        commandService: {
            async send(key) {
                calls.push(`send:${key}`);
                assert.equal(current, null, '/nung must be sent only after the previous GUI is closed');
                return { success: true };
            }
        },
        guiManager: {
            current: () => current,
            async closeCurrentWindow() { calls.push('close'); current = null; return true; },
            performAndWaitForOpen: async action => { await action(); return { session: { window: smeltingWindow } }; },
            click: async slot => calls.push(`click:${slot}`)
        },
        itemResolver: { matches: (item, id) => ({ matched: item?.name === id }) },
        config: cfg
    });

    const result = await operation.execute('raw_iron_to_iron', { entry: 'direct' });
    assert.equal(result.skipped, false);
    assert.deepEqual(calls, ['close', 'send:smelting', 'click:2']);
});
