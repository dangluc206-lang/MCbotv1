'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const BotContext = require('../../../src/bot/BotContext');
const BotState = require('../../../src/bot/BotState');
const BotRuntime = require('../../../src/bot/BotRuntime');
const SessionManager = require('../../../src/connection/SessionManager');
const ConnectionManager = require('../../../src/connection/ConnectionManager');
const ReconnectManager = require('../../../src/connection/ReconnectManager');
const EventBus = require('../../../src/core/EventBus');

function fakeClient() {
    const bot = new EventEmitter();
    bot.endReason = null;
    bot.end = reason => { bot.endReason = reason; bot.emit('end', reason); };
    return bot;
}

function noopLogger() { return { info() {}, warn() {}, error() {}, debug() {} }; }

// I3: a reconnect timer that fires after ConnectionManager.stop() must not
// resurrect the client. Verifies L-1 (shutdown reconnect race).
test('shutdown reconnect race: timer firing after stop cannot attach a client', async () => {
    const botId = 'shutdown-race';
    const context = new BotContext(botId);
    const eventBus = new EventBus();
    const client = fakeClient();
    const manager = new ConnectionManager({
        botId, context,
        sessionManager: new SessionManager({ botId }),
        connectionFactory: { create: () => client },
        profile: { enabled: true }, server: {}, eventBus,
        logger: noopLogger(), readyTimeoutMs: 50
    });
    assert.equal(manager.isAcceptingConnections(), true);
    await manager.stop();
    assert.equal(manager.isAcceptingConnections(), false);
    await assert.rejects(() => manager.connect(), /stopped|CONNECTION_STOPPED/i);
    assert.equal(context.has(), false);
    await manager.destroy();
});

// I3: explicit CONNECTED intent path lifts the latch via allowConnections().
test('allowConnections lifts the offline latch for the explicit intent path', async () => {
    const botId = 'allow-conn';
    const context = new BotContext(botId);
    const eventBus = new EventBus();
    const client = fakeClient();
    const manager = new ConnectionManager({
        botId, context,
        sessionManager: new SessionManager({ botId }),
        connectionFactory: { create: () => client },
        profile: { enabled: true }, server: {}, eventBus,
        logger: noopLogger(), readyTimeoutMs: 50
    });
    await manager.stop();
    manager.allowConnections('Durable intent requests connection.');
    const pending = manager.connect();
    queueMicrotask(() => client.emit('spawn'));
    assert.equal(await pending, client);
    assert.equal(context.has(), true);
    await manager.destroy();
});

// I3: ReconnectManager fails closed when the owner latched offline.
test('reconnect manager does not attempt while the connection owner is latched offline', async () => {
    const botId = 'reconnect-latch';
    const context = new BotContext(botId);
    const eventBus = new EventBus();
    let attempts = 0;
    const connectionManager = {
        context,
        async connect() { attempts += 1; return {}; },
        isAcceptingConnections: () => false
    };
    const reconnect = new ReconnectManager({
        botId, connectionManager, context, eventBus,
        policy: { enabled: true, maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
        logger: noopLogger()
    });
    await reconnect.initialize();
    await reconnect.start();
    eventBus.emit('connection:failed', { botId, connectionGeneration: 1, error: new Error('kick') });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(attempts, 0);
    assert.equal(reconnect.timer, null);
    await reconnect.destroy();
});

// I5: BotRuntime.stop() patches STOPPING before lifecycle completion.
test('bot runtime marks STOPPING before lifecycle stop completes', async () => {
    const seen = [];
    const lifecycle = {
        async initialize() {},
        async start() {},
        async stop() {
            seen.push('lifecycle-stop');
            await new Promise(resolve => setTimeout(resolve, 1));
        },
        async destroy() {}
    };
    const state = new BotState();
    const runtime = new BotRuntime({ identity: { botId: 'stop-gate' }, context: {}, state, lifecycleCoordinator: lifecycle });
    const stopping = runtime.stop();
    assert.equal(state.get().lifecycleState, 'STOPPING');
    await stopping;
    assert.equal(state.get().lifecycleState, 'STOPPED');
    assert.deepEqual(seen, ['lifecycle-stop']);
});

// L-6 characterization: duplicate signals for the same owner collapse to one decision.
test('reconnect ledger records one decision per owner across duplicate signals', async () => {
    const botId = 'ledger-bot';
    const context = new BotContext(botId);
    // Generation 1 with no attached client: actionable failure while disconnected.
    const seed = fakeClient();
    context.attach(seed);
    context.detach(seed);
    const eventBus = new EventBus();
    const reconnect = new ReconnectManager({
        botId,
        connectionManager: { context, async connect() { return {}; } },
        context, eventBus,
        policy: { enabled: true, maxAttempts: 3, baseDelayMs: 50, maxDelayMs: 50 },
        logger: noopLogger()
    });
    await reconnect.initialize();
    await reconnect.start();
    const failure = { botId, connectionGeneration: 1, error: new Error('kick') };
    eventBus.emit('connection:failed', failure);
    eventBus.emit('connection:failed', failure);
    eventBus.emit('connection:ended', { botId, connectionGeneration: 1, intentional: false, reason: 'kick' });
    assert.notEqual(reconnect.timer, null);
    assert.equal(reconnect.failureDecisions.size, 1);
    await reconnect.destroy();
});
