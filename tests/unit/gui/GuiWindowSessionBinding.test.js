'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const BotContext = require('../../../src/bot/BotContext');
const EventBus = require('../../../src/core/EventBus');
const GuiWindowSessionBinding = require('../../../src/gui/GuiWindowSessionBinding');

function harness() {
    const context = new BotContext('bot-01');
    const eventBus = new EventBus();
    const calls = [];
    let session = null;
    const binding = new GuiWindowSessionBinding({
        botId: 'bot-01', context, eventBus,
        currentSession: () => session,
        onOpen(window, options) {
            calls.push(['open', window, options]);
            session = { connectionGeneration: options.connectionGeneration };
        },
        onClose() { calls.push(['close']); session = null; },
        onUpdate(sessionId) { calls.push(['update', sessionId]); }
    });
    return { context, eventBus, binding, calls, session: value => { session = value; } };
}

test('window binding ignores stale client events after a replacement generation', () => {
    const h = harness();
    const first = new EventEmitter();
    const second = new EventEmitter();
    h.context.attach(first);
    h.binding.initialize();
    first.emit('windowOpen', { id: 1 });
    assert.equal(h.calls.length, 1);

    h.context.detach(first);
    h.context.attach(second);
    h.binding.bind(second, h.context.getGeneration());
    first.emit('windowOpen', { id: 2 });
    second.emit('windowOpen', { id: 3 });
    assert.equal(h.calls.filter(call => call[0] === 'open').length, 2);
    assert.equal(h.calls.at(-1)[1].id, 3);
    h.binding.stop();
});

test('window update subscription is replaced and disposed deterministically', () => {
    const h = harness();
    const first = new EventEmitter();
    const second = new EventEmitter();
    h.binding.bindWindow(first, 'session-1');
    h.binding.bindWindow(second, 'session-2');
    first.emit('updateSlot');
    second.emit('updateSlot');
    assert.deepEqual(h.calls, [['update', 'session-2']]);
    h.binding.stop();
    second.emit('updateSlot');
    assert.equal(h.calls.length, 1);
});

test('connection end only closes the matching generation session', () => {
    const h = harness();
    const bot = new EventEmitter();
    h.context.attach(bot);
    const generation = h.context.getGeneration();
    h.session({ connectionGeneration: generation });
    h.binding.initialize();
    h.eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: generation - 1 });
    assert.equal(h.calls.length, 0);
    h.eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: generation });
    assert.deepEqual(h.calls, [['close']]);
    h.binding.stop();
});
