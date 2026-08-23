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

test('waitFor adopts an already-visible currentWindow when gui:opened was missed', async () => {
    const bot = new EventEmitter();
    const { manager } = createManager(bot);
    const opened = window('already-open');
    bot.currentWindow = opened;

    const session = await manager.waitFor(null, 1, null, 1);

    assert.equal(session.window, opened);
    assert.equal(manager.current().window, opened);
    await manager.stop();
});

test('waitForFresh adopts an already-visible replacement currentWindow without inventing in-place freshness', async () => {
    const bot = new EventEmitter();
    const { manager } = createManager(bot);
    const before = window('before');
    const after = window('after');
    bot.currentWindow = before;
    const beforeSession = manager.open(before);
    bot.currentWindow = after;

    const session = await manager.waitForFresh(null, {
        afterSessionId: beforeSession.id,
        timeoutMs: 1,
        expectedGeneration: 1
    });

    assert.equal(session.window, after);
    assert.notEqual(session.id, beforeSession.id);
    await manager.stop();
});

test('performAndWaitForOpen returns the next GUI regardless of detector definition', async () => {
    const { manager } = createManager();
    const opened = window('ᴋʜᴏ ᴄʜứᴀ');

    const result = await manager.performAndWaitForOpen(async () => {
        manager.open(opened);
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
        // Simulate Mineflayer already exposing the real currentWindow while
        // the GuiManager/event bridge missed windowOpen entirely. The timeout
        // is intentionally shorter than the 25 ms polling fallback so only
        // synchronous post-action adoption can make this deterministic.
        bot.currentWindow = opened;
        return { success: true };
    }, {
        timeoutMs: 1,
        label: '/kho',
        source: { commandKey: 'storage', command: '/kho', clicks: [] }
    });

    assert.equal(result.session.window, opened);
    assert.equal(manager.current().window, opened);
    assert.equal(result.session.source.command, '/kho');
    await manager.stop();
});

test('performAndWaitForTransition adopts bot.currentWindow when gui:opened was missed', async () => {
    const bot = new EventEmitter();
    const { manager } = createManager(bot);
    const before = window('root');
    const after = window('child');
    bot.currentWindow = before;
    manager.open(before);

    const result = await manager.performAndWaitForTransition(async () => {
        // Mineflayer has already switched to the new container, but the
        // windowOpen/gui:opened bridge is intentionally absent. A 1 ms
        // timeout makes polling/timer-based recovery insufficient.
        bot.currentWindow = after;
        return { success: true };
    }, {
        timeoutMs: 1,
        label: 'submenu transition'
    });

    assert.equal(result.session.window, after);
    assert.equal(manager.current().window, after);
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

test('clickAndWaitForTransition adopts a replacement currentWindow when GUI open events are missed', async () => {
    const bot = new EventEmitter();
    const { manager } = createManager(bot);
    const before = window('root');
    const after = window('child');
    bot.currentWindow = before;
    manager.open(before);

    manager.clickExecutor.click = async () => {
        // Transport resolves after Mineflayer already moved to the new window,
        // while both windowOpen and gui:opened are intentionally absent.
        bot.currentWindow = after;
    };

    const session = await manager.clickAndWaitForTransition(1, {
        timeoutMs: 1,
        label: 'submenu click',
        requireNewWindow: true
    });

    assert.equal(session.window, after);
    assert.equal(manager.current().window, after);
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
