'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const BotContext = require('../../../src/bot/BotContext');
const BotState = require('../../../src/bot/BotState');
const SessionManager = require('../../../src/connection/SessionManager');
const ConnectionManager = require('../../../src/connection/ConnectionManager');
const ReconnectManager = require('../../../src/connection/ReconnectManager');
const createConnectionStateBinding = require('../../../src/bootstrap/createConnectionStateBinding');
const EventBus = require('../../../src/core/EventBus');
const FlowError = require('../../../src/shared/errors/FlowError');

const quietLogger = { info() {}, warn() {}, error() {}, debug() {} };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(predicate, timeoutMs = 250) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await wait(1);
    }
    assert.ok(predicate(), 'condition did not become true before timeout');
}
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}
function fakeClient() {
    const client = new EventEmitter();
    client.endCalls = 0;
    client.end = () => { client.endCalls += 1; };
    return client;
}
function createHarness({ connectionFactory, attemptCoordinator = null, maxAttempts = 5, delayMs = 1 } = {}) {
    const botId = 'bot-01';
    const context = new BotContext(botId);
    const state = new BotState();
    const eventBus = new EventBus();
    const manager = new ConnectionManager({
        botId,
        context,
        sessionManager: new SessionManager({ botId }),
        connectionFactory,
        profile: { enabled: true, username: 'BotA' },
        server: { host: 'example.invalid', port: 25565 },
        eventBus,
        attemptCoordinator,
        logger: quietLogger,
        readyTimeoutMs: 100
    });
    const reconnect = new ReconnectManager({
        botId,
        context,
        connectionManager: manager,
        eventBus,
        policy: { enabled: true, maxAttempts, baseDelayMs: delayMs, maxDelayMs: delayMs },
        logger: quietLogger
    });
    const binding = createConnectionStateBinding({ botId, state, eventBus, context });
    return { botId, context, state, eventBus, manager, reconnect, binding };
}
async function startHarness(h) {
    await h.binding.initialize();
    await h.reconnect.initialize();
    await h.reconnect.start();
}
async function cleanupHarness(h) {
    await h.reconnect.destroy();
    await h.binding.destroy();
    await h.manager.destroy();
}

test('retry branch treats retryable:false as terminal and never schedules a third create', async () => {
    let createCalls = 0;
    const scheduled = [];
    const h = createHarness({
        connectionFactory: {
            create() {
                createCalls += 1;
                if (createCalls === 1) throw new FlowError('transient', { code: 'TRANSIENT', retryable: true });
                throw new FlowError('permanent', { code: 'PERMANENT', retryable: false });
            }
        },
        maxAttempts: 10,
        delayMs: 1
    });
    h.eventBus.on('reconnect:scheduled', event => scheduled.push(event));
    await startHarness(h);
    assert.equal(await h.manager.start(), null);
    await eventually(() => createCalls >= 2);
    await wait(20);
    assert.equal(createCalls, 2);
    assert.equal(h.reconnect.timer, null);
    assert.equal(scheduled.length, 1, 'non-retryable retry failure must not emit another reconnect:scheduled');
    await cleanupHarness(h);
});

test('maxAttempts exhaustion is emitted exactly once through real ConnectionManager rejection', async () => {
    let createCalls = 0;
    const exhausted = [];
    const h = createHarness({
        connectionFactory: {
            create() {
                createCalls += 1;
                throw new FlowError(`retryable-${createCalls}`, { code: 'TRANSIENT', retryable: true });
            }
        },
        maxAttempts: 1,
        delayMs: 1
    });
    h.eventBus.on('reconnect:exhausted', event => exhausted.push(event));
    await startHarness(h);
    assert.equal(await h.manager.start(), null);
    await eventually(() => createCalls >= 2);
    await wait(20);
    assert.equal(createCalls, 2);
    assert.equal(exhausted.length, 1);
    assert.equal(h.reconnect.timer, null);
    assert.equal(exhausted[0].sourceAttemptEpoch, 2);
    await cleanupHarness(h);
});

test('replacement client wins while an old retry attempt is pending at acquireTurn', async () => {
    let createCalls = 0;
    let acquireCalls = 0;
    const retryGate = deferred();
    const scheduled = [];
    const exhausted = [];
    const coordinator = {
        async acquireTurn() {
            acquireCalls += 1;
            if (acquireCalls === 1) return { release() { return true; } };
            return retryGate.promise;
        },
        cooldownForFailure() { return 0; }
    };
    const h = createHarness({
        connectionFactory: {
            create() {
                createCalls += 1;
                throw new FlowError('initial retryable', { code: 'TRANSIENT', retryable: true });
            }
        },
        attemptCoordinator: coordinator,
        maxAttempts: 5,
        delayMs: 1
    });
    // Reserve generation 1 so the replacement is generation 2 as in the acceptance case.
    const historical = fakeClient();
    h.context.attach(historical);
    h.context.detach(historical);
    h.eventBus.on('reconnect:scheduled', event => scheduled.push(event));
    h.eventBus.on('reconnect:exhausted', event => exhausted.push(event));
    await startHarness(h);
    assert.equal(await h.manager.start(), null);
    await eventually(() => acquireCalls >= 2);

    const replacement = fakeClient();
    const replacementGeneration = h.context.attach(replacement);
    assert.equal(replacementGeneration, 2);
    h.eventBus.emit('connection:spawned', {
        botId: h.botId,
        connectionGeneration: replacementGeneration,
        attemptId: 'replacement',
        attemptEpoch: 999
    });
    assert.equal(h.state.get().connectionState, 'CONNECTED');

    retryGate.reject(new FlowError('old acquire rejected', { code: 'OLD_ATTEMPT', retryable: true }));
    await wait(20);
    assert.equal(createCalls, 1, 'pending retry failed before create-client and must not create another attempt');
    assert.equal(h.reconnect.timer, null);
    assert.equal(replacement.endCalls, 0);
    assert.equal(h.context.get(), replacement);
    assert.equal(h.context.getGeneration(), 2);
    assert.equal(h.state.get().connectionState, 'CONNECTED');
    assert.equal(scheduled.length, 1, 'only the initial failure may schedule');
    assert.equal(exhausted.length, 0);
    await cleanupHarness(h);
});

test('state binding ignores stale reconnect and attempt events after replacement is CONNECTED', async () => {
    const h = createHarness({ connectionFactory: { create: () => fakeClient() }, delayMs: 1000 });
    await h.binding.initialize();
    // Establish a historical attempt owner while disconnected.
    h.eventBus.emit('connection:attempt-started', { botId: h.botId, attemptId: 'old', attemptEpoch: 1 });
    const historical = fakeClient();
    h.context.attach(historical);
    h.context.detach(historical);
    const replacement = fakeClient();
    assert.equal(h.context.attach(replacement), 2);
    h.eventBus.emit('connection:spawned', { botId: h.botId, connectionGeneration: 2, attemptId: 'new', attemptEpoch: 2 });
    assert.equal(h.state.get().connectionState, 'CONNECTED');
    const baselineError = h.state.get().lastError;

    const staleEvents = [
        ['reconnect:scheduled', { sourceGeneration: 1, sourceAttemptEpoch: null, reason: 'stale scheduled' }],
        ['reconnect:attempting', { sourceGeneration: 1, sourceAttemptEpoch: null, reason: 'stale attempting' }],
        ['reconnect:exhausted', { sourceGeneration: 1, sourceAttemptEpoch: null, reason: 'stale exhausted' }],
        ['reconnect:scheduled', { sourceGeneration: null, sourceAttemptEpoch: 1, reason: 'old attempt scheduled' }],
        ['reconnect:attempting', { sourceGeneration: null, sourceAttemptEpoch: 1, reason: 'old attempt attempting' }],
        ['reconnect:exhausted', { sourceGeneration: null, sourceAttemptEpoch: 1, reason: 'old attempt exhausted' }],
        ['connection:attempt-started', { attemptId: 'late-old', attemptEpoch: 1 }],
        ['connection:connecting', { attemptId: 'late-old', attemptEpoch: 1 }]
    ];
    for (const [name, payload] of staleEvents) {
        h.eventBus.emit(name, { botId: h.botId, ...payload });
        assert.equal(h.state.get().connectionState, 'CONNECTED', `${name} must not lower replacement state`);
        assert.equal(h.state.get().lastError, baselineError, `${name} must not overwrite replacement lastError`);
        assert.equal(h.context.get(), replacement);
        assert.equal(h.context.getGeneration(), 2);
    }
    await h.binding.destroy();
});

test('valid latest attempt and reconnect owner events still mutate state while disconnected', async () => {
    const h = createHarness({ connectionFactory: { create: () => fakeClient() }, delayMs: 1000 });
    await h.binding.initialize();
    h.eventBus.emit('connection:attempt-started', { botId: h.botId, attemptId: 'current', attemptEpoch: 1 });
    assert.equal(h.state.get().connectionState, 'CONNECTING');
    h.eventBus.emit('connection:connecting', { botId: h.botId, attemptId: 'current', attemptEpoch: 1 });
    assert.equal(h.state.get().connectionState, 'CONNECTING');
    h.eventBus.emit('reconnect:scheduled', { botId: h.botId, sourceAttemptEpoch: 1, sourceGeneration: null, reason: 'retry' });
    assert.equal(h.state.get().connectionState, 'RECONNECTING');
    h.eventBus.emit('reconnect:attempting', { botId: h.botId, sourceAttemptEpoch: 1, sourceGeneration: null });
    assert.equal(h.state.get().connectionState, 'CONNECTING');
    h.eventBus.emit('reconnect:exhausted', { botId: h.botId, sourceAttemptEpoch: 1, sourceGeneration: null, reason: 'done' });
    assert.equal(h.state.get().connectionState, 'FAILED');
    assert.equal(h.state.get().lastError, 'done');
    await h.binding.destroy();
});

test('explicit custom-manager fallback honors retryable flag and replacement ownership', async () => {
    const botId = 'bot-custom';
    const context = new BotContext(botId);
    const eventBus = new EventBus();
    let mode = 'retryable';
    let connectCalls = 0;
    const customManager = {
        context,
        async connect() {
            connectCalls += 1;
            if (mode === 'retryable') throw new FlowError('custom retryable', { code: 'CUSTOM_RETRY', retryable: true });
            if (mode === 'permanent') throw new FlowError('custom permanent', { code: 'CUSTOM_PERM', retryable: false });
            await mode.promise;
            return null;
        }
    };
    const reconnect = new ReconnectManager({
        botId, context, connectionManager: customManager, eventBus,
        policy: { enabled: true, maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 1 }, logger: quietLogger
    });
    await reconnect.initialize();
    await reconnect.start();
    eventBus.emit('connection:attempt-started', { botId, attemptId: 'source', attemptEpoch: 1 });
    eventBus.emit('connection:attempt-failed', {
        botId, attemptId: 'source', attemptEpoch: 1, retryable: true,
        error: new FlowError('source failed', { retryable: true })
    });
    await eventually(() => connectCalls >= 1);
    assert.notEqual(reconnect.timer, null, 'retryable custom error without canonical event should use fallback exactly once');
    await reconnect.destroy();

    const context2 = new BotContext(`${botId}-2`);
    const eventBus2 = new EventBus();
    let permanentCalls = 0;
    const permanentManager = { context: context2, async connect() { permanentCalls += 1; throw new FlowError('permanent', { retryable: false }); } };
    const reconnect2 = new ReconnectManager({
        botId: `${botId}-2`, context: context2, connectionManager: permanentManager, eventBus: eventBus2,
        policy: { enabled: true, maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 1 }, logger: quietLogger
    });
    await reconnect2.initialize();
    await reconnect2.start();
    eventBus2.emit('connection:attempt-started', { botId: `${botId}-2`, attemptId: 'source', attemptEpoch: 1 });
    eventBus2.emit('connection:attempt-failed', {
        botId: `${botId}-2`, attemptId: 'source', attemptEpoch: 1, retryable: true,
        error: new FlowError('source failed', { retryable: true })
    });
    await eventually(() => permanentCalls >= 1);
    await wait(10);
    assert.equal(reconnect2.timer, null, 'non-retryable custom fallback must be terminal');
    assert.equal(permanentCalls, 1);
    await reconnect2.destroy();
});

test('stop clears reconnect ownership/listeners and late custom rejection cannot reschedule', async () => {
    const botId = 'bot-stop';
    const context = new BotContext(botId);
    const eventBus = new EventBus();
    const late = deferred();
    let connectCalls = 0;
    const customManager = { context, async connect() { connectCalls += 1; return late.promise; } };
    const reconnect = new ReconnectManager({
        botId, context, connectionManager: customManager, eventBus,
        policy: { enabled: true, maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 1 }, logger: quietLogger
    });
    const baselineAttemptListeners = eventBus.emitter.listenerCount('connection:attempt-failed');
    await reconnect.initialize();
    await reconnect.start();
    eventBus.emit('connection:attempt-started', { botId, attemptId: 'source', attemptEpoch: 1 });
    eventBus.emit('connection:attempt-failed', {
        botId, attemptId: 'source', attemptEpoch: 1, retryable: true,
        error: new FlowError('source', { retryable: true })
    });
    await eventually(() => connectCalls === 1);
    await reconnect.stop();
    assert.equal(reconnect.timer, null);
    assert.equal(eventBus.emitter.listenerCount('connection:attempt-failed'), baselineAttemptListeners);
    late.reject(new FlowError('late', { retryable: true }));
    await wait(10);
    assert.equal(reconnect.timer, null);
    assert.equal(connectCalls, 1);
    await reconnect.destroy();
});
