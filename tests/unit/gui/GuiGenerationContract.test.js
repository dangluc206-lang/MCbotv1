'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const BotContext = require('../../../src/bot/BotContext');
const EventBus = require('../../../src/core/EventBus');
const GuiState = require('../../../src/gui/GuiState');
const GuiManager = require('../../../src/gui/GuiManager');
const ClickQueue = require('../../../src/gui/click/ClickQueue');
const ClickGuard = require('../../../src/gui/click/ClickGuard');
const ClickExecutor = require('../../../src/gui/click/ClickExecutor');
const ClickVerifier = require('../../../src/gui/click/ClickVerifier');
const SlotValidator = require('../../../src/gui/slots/SlotValidator');
const CancellationSource = require('../../../src/shared/cancellation/CancellationSource');

function deferred() {
    let resolve;
    const promise = new Promise(res => { resolve = res; });
    return { promise, resolve };
}

function client() {
    const value = new EventEmitter();
    value.currentWindow = null;
    value.clickCalls = [];
    value.clickWindow = async (...args) => { value.clickCalls.push(args); };
    return value;
}

function win(id = 1) {
    const value = new EventEmitter();
    value.id = id;
    value.title = `window-${id}`;
    value.type = 'generic';
    value.slots = [{ name: 'paper' }, null];
    return value;
}

function harness() {
    const context = new BotContext('bot-01');
    const oldClient = client();
    context.attach(oldClient);
    const eventBus = new EventBus();
    const clickQueue = new ClickQueue({ maxPending: 8 });
    const clickGuard = new ClickGuard({ context, slotValidator: new SlotValidator() });
    const clickExecutor = new ClickExecutor({ context });
    const clickVerifier = new ClickVerifier({ eventBus, context });
    const manager = new GuiManager({
        botId: 'bot-01', context, state: new GuiState(), detector: { detect: () => null },
        clickQueue, clickGuard, clickExecutor, clickVerifier, eventBus
    });
    const window = win(1);
    oldClient.currentWindow = window;
    const session = manager.open(window, { client: oldClient, connectionGeneration: 1 });
    return { context, oldClient, eventBus, clickQueue, clickVerifier, manager, window, session };
}

test('queued click cancelled before execution never reaches old or replacement client', async () => {
    const h = harness();
    const blocker = deferred();
    const blocked = h.clickQueue.enqueue(() => blocker.promise, { id: 'blocker' });
    await new Promise(resolve => setImmediate(resolve));
    const source = new CancellationSource();
    const pending = h.manager.click(0, { cancellationToken: source.token, expectedGeneration: 1 });
    await new Promise(resolve => setImmediate(resolve));
    source.cancel('cancel pending click');

    const replacement = client();
    replacement.currentWindow = win(2);
    h.context.detach(h.oldClient);
    h.context.attach(replacement);
    blocker.resolve();

    await blocked;
    await assert.rejects(pending, error => error.code === 'CANCELLED');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.oldClient.clickCalls.length, 0);
    assert.equal(replacement.clickCalls.length, 0);
});

test('queued click from an old generation cannot transfer to replacement client', async () => {
    const h = harness();
    const blocker = deferred();
    const blocked = h.clickQueue.enqueue(() => blocker.promise, { id: 'blocker' });
    await new Promise(resolve => setImmediate(resolve));
    const pending = h.manager.click(0, { expectedGeneration: 1 });
    await new Promise(resolve => setImmediate(resolve));

    const replacement = client();
    replacement.currentWindow = win(2);
    h.context.detach(h.oldClient);
    h.context.attach(replacement);
    blocker.resolve();
    await blocked;

    await assert.rejects(pending);
    assert.equal(h.oldClient.clickCalls.length, 0);
    assert.equal(replacement.clickCalls.length, 0);
});

test('ClickVerifier ignores stale and generation-less GUI events before exact generation update', async () => {
    const h = harness();
    const waiter = h.clickVerifier.arm({ botId: 'bot-01', session: h.session, expectedGeneration: 1, timeoutMs: 100 });
    let settled = false;
    waiter.promise.finally(() => { settled = true; });
    h.eventBus.emit('gui:updated', { botId: 'bot-01', connectionGeneration: 2, sessionId: h.session.id });
    h.eventBus.emit('gui:updated', { botId: 'bot-01', sessionId: h.session.id });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    h.eventBus.emit('gui:updated', { botId: 'bot-01', connectionGeneration: 1, sessionId: h.session.id });
    assert.equal(await waiter.promise, true);
});

test('stale connection end does not cancel click verification but matching end does', async () => {
    const h = harness();
    const first = h.clickVerifier.arm({ botId: 'bot-01', session: h.session, expectedGeneration: 1, timeoutMs: 100 });
    h.eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 2 });
    h.eventBus.emit('gui:updated', { botId: 'bot-01', connectionGeneration: 1, sessionId: h.session.id });
    assert.equal(await first.promise, true);

    const second = h.clickVerifier.arm({ botId: 'bot-01', session: h.session, expectedGeneration: 1, timeoutMs: 100 });
    h.eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 1 });
    await assert.rejects(second.promise, error => error.code === 'GUI_CLICK_DISCONNECTED');
});

test('GuiManager canonical GUI events contain connectionGeneration and never legacy generation', () => {
    const h = harness();
    let updated;
    h.eventBus.on('gui:updated', event => { updated = event; });
    h.manager.update(h.session.id);
    assert.equal(updated.connectionGeneration, 1);
    assert.equal(Object.hasOwn(updated, 'generation'), false);
    assert.equal(typeof updated.eventId, 'string');
    assert.equal(updated.eventType, 'gui:updated');
});
