'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const BotContext = require('../../../src/bot/BotContext');
const BotState = require('../../../src/bot/BotState');
const createConnectionStateBinding = require('../../../src/bootstrap/createConnectionStateBinding');

class RawEventBus {
    constructor() { this.emitter = new EventEmitter(); }
    on(name, listener) { this.emitter.on(name, listener); return () => this.emitter.off(name, listener); }
    emit(name, event) { this.emitter.emit(name, event); }
}

test('connection state binding ignores stale and generation-less login events for current generation', async () => {
    const context = new BotContext('bot-01');
    const oldClient = {};
    const currentClient = {};
    context.attach(oldClient);
    context.detach(oldClient);
    assert.equal(context.attach(currentClient), 2);
    const state = new BotState();
    state.patch({ connectionState: 'CONNECTED', lastError: null });
    const eventBus = new RawEventBus();
    const binding = createConnectionStateBinding({ botId: 'bot-01', state, eventBus, context });
    await binding.initialize();

    eventBus.emit('server-login:failed', { botId: 'bot-01', connectionGeneration: 1, error: { code: 'OLD' } });
    eventBus.emit('server-login:failed', { botId: 'bot-01', error: { code: 'GENLESS' } });
    eventBus.emit('server-login:failed', { botId: 'bot-02', connectionGeneration: 2, error: { code: 'FOREIGN' } });
    assert.equal(state.get().connectionState, 'CONNECTED');
    assert.equal(state.get().lastError, null);

    eventBus.emit('server-login:failed', { botId: 'bot-01', connectionGeneration: 2, error: { code: 'CURRENT' } });
    assert.equal(state.get().connectionState, 'AUTHENTICATION_FAILED');
    assert.equal(state.get().lastError.code, 'CURRENT');
    await binding.destroy();
});

test('connection state binding ignores stale ended event even after replacement client is detached', async () => {
    const context = new BotContext('bot-01');
    const first = {};
    const second = {};
    context.attach(first);
    context.detach(first);
    context.attach(second);
    context.detach(second);
    const state = new BotState();
    state.patch({ connectionState: 'CONNECTED' });
    const eventBus = new RawEventBus();
    const binding = createConnectionStateBinding({ botId: 'bot-01', state, eventBus, context });
    await binding.initialize();

    eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 1, reason: 'stale' });
    assert.equal(state.get().connectionState, 'CONNECTED');
    eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 2, reason: 'current ended' });
    assert.equal(state.get().connectionState, 'DISCONNECTED');
    await binding.destroy();
});
