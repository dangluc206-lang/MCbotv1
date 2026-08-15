'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const EventBus = require('../../../src/core/EventBus');
const GuiState = require('../../../src/gui/GuiState');
const GuiManager = require('../../../src/gui/GuiManager');

function createManager(bot = null) {
    const eventBus = new EventBus();
    const state = new GuiState();
    const manager = new GuiManager({
        botId: 'bot-01',
        context: { getGeneration: () => 1, get: () => bot },
        state,
        detector: { detect: () => null },
        clickQueue: { enqueue: task => task(), destroy: async () => {} },
        clickGuard: { assert() {} },
        clickExecutor: { async click() {} },
        clickVerifier: { verify: async () => true },
        eventBus
    });
    return { manager, state };
}

function window(title = 'anything') {
    const value = new EventEmitter();
    value.title = title;
    value.type = 'generic';
    value.slots = [null, { name: 'paper' }];
    return value;
}

test('performAndWaitForOpen returns the next GUI regardless of detector definition', async () => {
    const { manager } = createManager();
    const opened = window('ᴋʜᴏ ᴄʜứᴀ');

    const result = await manager.performAndWaitForOpen(async () => {
        setImmediate(() => manager.open(opened));
        return { success: true };
    }, {
        timeoutMs: 100,
        label: '/kho',
        source: { commandKey: 'storage', command: '/kho', clicks: [] }
    });

    assert.equal(result.session.window, opened);
    assert.equal(result.session.definitionId, null);
    assert.equal(result.session.source.command, '/kho');
    await manager.stop();
});

test('clickAndWaitForTransition accepts an in-place update without title matching', async () => {
    const { manager } = createManager();
    const currentWindow = window('/ks');
    manager.open(currentWindow);

    manager.clickExecutor.click = async () => {
        setImmediate(() => currentWindow.emit('updateSlot', 1, null, { name: 'coal_block' }));
    };

    const session = await manager.clickAndWaitForTransition(1, {
        timeoutMs: 100,
        label: 'conversion menu click'
    });

    assert.equal(session.window, currentWindow);
    assert.equal(session.id, manager.current().id);
    await manager.stop();
});


test('performAndWaitForOpen adopts bot.currentWindow when gui:opened was missed', async () => {
    const bot = new EventEmitter();
    bot.currentWindow = null;
    const { manager } = createManager(bot);
    const opened = window('kho');

    const result = await manager.performAndWaitForOpen(async () => {
        setTimeout(() => {
            // Simulate Mineflayer having the real currentWindow while the
            // GuiManager/event bridge missed windowOpen entirely.
            bot.currentWindow = opened;
        }, 10);
        return { success: true };
    }, {
        timeoutMs: 150,
        label: '/kho',
        source: { commandKey: 'storage', command: '/kho', clicks: [] }
    });

    assert.equal(result.session.window, opened);
    assert.equal(manager.current().window, opened);
    assert.equal(result.session.source.command, '/kho');
    await manager.stop();
});

test('performAndWaitForOpen can adopt raw Mineflayer windowOpen without internal bridge', async () => {
    const bot = new EventEmitter();
    bot.currentWindow = null;
    const { manager } = createManager(bot);
    const opened = window('pv');

    const result = await manager.performAndWaitForOpen(async () => {
        setImmediate(() => {
            bot.currentWindow = opened;
            bot.emit('windowOpen', opened);
        });
        return { success: true };
    }, {
        timeoutMs: 150,
        label: '/pv 2'
    });

    assert.equal(result.session.window, opened);
    assert.equal(manager.current().window, opened);
    await manager.stop();
});

test('clickAndWaitForTransition requireNewWindow ignores old-window slot updates', async () => {
    const { manager } = createManager();
    const rootWindow = window('/ks');
    const craftingWindow = window('crafting');
    manager.open(rootWindow);

    manager.clickExecutor.click = async () => {
        setImmediate(() => rootWindow.emit('updateSlot', 16, null, { name: 'paper' }));
        setTimeout(() => manager.open(craftingWindow), 10);
    };

    const session = await manager.clickAndWaitForTransition(16, {
        timeoutMs: 150,
        label: 'crafting menu click',
        requireNewWindow: true
    });

    assert.equal(session.window, craftingWindow);
    assert.notEqual(session.window, rootWindow);
    await manager.stop();
});
