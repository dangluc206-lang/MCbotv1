'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const BotContext = require('../../../src/bot/BotContext');
const BotState = require('../../../src/bot/BotState');
const SessionManager = require('../../../src/connection/SessionManager');
const ConnectionManager = require('../../../src/connection/ConnectionManager');
const ReconnectManager = require('../../../src/connection/ReconnectManager');
const RuntimeFailurePublisher = require('../../../src/diagnostics/runtime/RuntimeFailurePublisher');
const createConnectionStateBinding = require('../../../src/bootstrap/createConnectionStateBinding');
const EventBus = require('../../../src/core/EventBus');
const FlowError = require('../../../src/shared/errors/FlowError');

function logger() { return { info() {}, warn() {}, error() {}, debug() {} }; }
function fakeClient({ loadPlugin = null } = {}) {
    const client = new EventEmitter();
    client.endCalls = 0;
    client.end = () => { client.endCalls += 1; };
    if (loadPlugin) {
        client.loadPlugin = loadPlugin;
        client.hasPlugin = () => false;
    }
    return client;
}

async function setup({ connectionFactory, attemptCoordinator = null, delayMs = 50 } = {}) {
    const botId = 'bot-01';
    const context = new BotContext(botId);
    const state = new BotState();
    const eventBus = new EventBus();
    const manager = new ConnectionManager({
        botId, context, sessionManager: new SessionManager({ botId }), connectionFactory,
        profile: { enabled: true, username: 'BotA' }, server: { host: 'example.invalid', port: 25565 },
        eventBus, attemptCoordinator, logger: logger(), readyTimeoutMs: 100
    });
    const reconnect = new ReconnectManager({
        botId, context, connectionManager: manager, eventBus,
        policy: { enabled: true, maxAttempts: 3, baseDelayMs: delayMs, maxDelayMs: delayMs }, logger: logger()
    });
    const publisher = new RuntimeFailurePublisher({ botId, eventBus, connectionAggregationMs: 0, logger: logger() });
    const binding = createConnectionStateBinding({ botId, state, eventBus, context });
    await binding.initialize();
    await publisher.initialize();
    await reconnect.initialize();
    await reconnect.start();
    return { botId, context, state, eventBus, manager, reconnect, publisher, binding };
}

async function cleanup(h) {
    await h.reconnect.destroy();
    await h.publisher.destroy();
    await h.binding.destroy();
    await h.manager.destroy();
}

for (const scenario of [
    {
        name: 'attemptCoordinator.acquireTurn throws',
        stage: 'acquire-turn',
        build: () => ({
            connectionFactory: { create() { throw new Error('create must not run'); } },
            attemptCoordinator: { async acquireTurn() { throw new Error('gate failed'); } }
        })
    },
    {
        name: 'connectionFactory.create throws',
        stage: 'create-client',
        build: () => ({ connectionFactory: { create() { throw new Error('factory failed'); } } })
    },
    {
        name: 'client.loadPlugin throws before attach',
        stage: 'register-pathfinder',
        build: () => ({ connectionFactory: { create: () => fakeClient({ loadPlugin() { throw new Error('plugin load failed'); } }) } })
    }
]) {
    test(`pre-attach ${scenario.name} publishes one attempt failure/runtime failure and schedules retry`, async () => {
        const h = await setup({ ...scenario.build(), delayMs: 1000 });
        const attempts = [];
        const runtime = [];
        h.eventBus.on('connection:attempt-failed', event => attempts.push(event));
        h.eventBus.on('runtime:failure', event => runtime.push(event));
        const result = await h.manager.start();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(result, null);
        assert.equal(h.context.has(), false);
        assert.equal(attempts.length, 1);
        assert.equal(attempts[0].stage, scenario.stage);
        assert.ok(attempts[0].attemptId);
        assert.equal(Number.isInteger(attempts[0].attemptEpoch), true);
        assert.equal(runtime.length, 1);
        assert.equal(runtime[0].connectionGeneration, null);
        assert.equal(runtime[0].details.ownerScope, 'attempt');
        assert.notEqual(h.reconnect.timer, null);
        assert.equal(h.state.get().connectionState, 'RECONNECTING');
        await cleanup(h);
    });
}

test('pre-attach acquired lease is released exactly once and acquisition failure releases no fake lease', async () => {
    let releases = 0;
    const lease = { release() { releases += 1; } };
    const h = await setup({
        connectionFactory: { create() { throw new Error('factory failed'); } },
        attemptCoordinator: { async acquireTurn() { return lease; } },
        delayMs: 1000
    });
    await h.manager.start();
    assert.equal(releases, 1);
    await cleanup(h);

    let fakeReleases = 0;
    const h2 = await setup({
        connectionFactory: { create() { throw new Error('unreachable'); } },
        attemptCoordinator: { async acquireTurn() { fakeReleases += 0; throw new Error('acquire failed'); } },
        delayMs: 1000
    });
    await h2.manager.start();
    assert.equal(fakeReleases, 0);
    await cleanup(h2);
});

test('non-retryable pre-attach setup error is published but does not hot-loop', async () => {
    const h = await setup({
        connectionFactory: { create() { throw new FlowError('bad setup', { code: 'BAD_SETUP', retryable: false }); } },
        delayMs: 1
    });
    const runtime = [];
    h.eventBus.on('runtime:failure', event => runtime.push(event));
    await h.manager.start();
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(runtime.length, 1);
    assert.equal(h.reconnect.timer, null);
    assert.equal(h.reconnect.attempts, 0);
    await cleanup(h);
});

test('stale attempt failure after replacement attach cannot schedule retry, end replacement or lower state', async () => {
    const h = await setup({ connectionFactory: { create: () => fakeClient() }, delayMs: 50 });
    h.eventBus.emit('connection:attempt-started', { botId: h.botId, attemptId: 'old', attemptEpoch: 1 });
    h.eventBus.emit('connection:attempt-started', { botId: h.botId, attemptId: 'new', attemptEpoch: 2 });
    const replacement = fakeClient();
    h.context.attach(replacement);
    h.state.patch({ connectionState: 'CONNECTED', lastError: null });
    const delivered = h.eventBus.emit('connection:attempt-failed', {
        botId: h.botId, attemptId: 'old', attemptEpoch: 1, stage: 'create-client', retryable: true,
        error: new FlowError('old failed', { code: 'CONNECTION_ATTEMPT_FAILED' })
    });
    assert.equal(delivered, true);
    assert.equal(h.reconnect.timer, null);
    assert.equal(replacement.endCalls, 0);
    assert.equal(h.state.get().connectionState, 'CONNECTED');
    await cleanup(h);
});

test('retryable initial pre-attach failure is followed by a successful reconnect attach/spawn', async () => {
    let creates = 0;
    const client = fakeClient();
    const factory = {
        create() {
            creates += 1;
            if (creates === 1) throw new Error('first create failed');
            queueMicrotask(() => client.emit('spawn'));
            return client;
        }
    };
    const h = await setup({ connectionFactory: factory, delayMs: 1 });
    assert.equal(await h.manager.start(), null);
    const deadline = Date.now() + 300;
    while (!h.context.has() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 2));
    assert.equal(h.context.get(), client);
    assert.equal(h.context.getGeneration(), 1);
    assert.ok(creates >= 2);
    assert.equal(h.reconnect.timer, null);
    await cleanup(h);
});
