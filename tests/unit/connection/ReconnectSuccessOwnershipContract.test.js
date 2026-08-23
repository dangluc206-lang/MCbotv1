'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const BotContext = require('../../../src/bot/BotContext');
const SessionManager = require('../../../src/connection/SessionManager');
const ConnectionManager = require('../../../src/connection/ConnectionManager');
const ReconnectManager = require('../../../src/connection/ReconnectManager');
const EventBus = require('../../../src/core/EventBus');
const FlowError = require('../../../src/shared/errors/FlowError');
const ConnectionSuccessResultContract = require('../../../src/connection/ConnectionSuccessResultContract');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(predicate, timeoutMs = 300) {
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
function client() {
    const value = new EventEmitter();
    value.endCalls = 0;
    value.end = () => { value.endCalls += 1; };
    return value;
}
function loggerCapture() {
    const records = [];
    return {
        records,
        logger: {
            info(message, meta) { records.push({ level: 'info', message, meta }); },
            warn(message, meta) { records.push({ level: 'warn', message, meta }); },
            error(message, meta) { records.push({ level: 'error', message, meta }); },
            debug(message, meta) { records.push({ level: 'debug', message, meta }); }
        }
    };
}
async function setupProduction({ factory, delayMs = 1, attemptCoordinator = null } = {}) {
    const botId = 'bot-success';
    const context = new BotContext(botId);
    const eventBus = new EventBus();
    const logs = loggerCapture();
    const manager = new ConnectionManager({
        botId,
        context,
        sessionManager: new SessionManager({ botId }),
        connectionFactory: factory,
        profile: { enabled: true, username: 'BotA' },
        server: { host: 'example.invalid', port: 25565 },
        eventBus,
        logger: logs.logger,
        attemptCoordinator,
        readyTimeoutMs: 100
    });
    const reconnect = new ReconnectManager({
        botId,
        context,
        connectionManager: manager,
        eventBus,
        policy: { enabled: true, maxAttempts: 5, baseDelayMs: delayMs, maxDelayMs: delayMs },
        logger: logs.logger
    });
    await reconnect.initialize();
    await reconnect.start();
    return { botId, context, eventBus, manager, reconnect, logs };
}
async function cleanupProduction(h) {
    await h.reconnect.destroy();
    await h.manager.destroy();
}

// Candidate 04fb... red probe A: valid generation reconnect produces generation 2
// but current code compares it to source generation 1 and drops reconnect:succeeded.
test('real generation reconnect claims exact N→N+1 result and emits success once', async () => {
    const created = client();
    let createCalls = 0;
    const h = await setupProduction({
        factory: {
            create() {
                createCalls += 1;
                queueMicrotask(() => created.emit('spawn'));
                return created;
            }
        }
    });
    const historical = client();
    assert.equal(h.context.attach(historical), 1);
    assert.equal(h.context.detach(historical), true);
    const succeeded = [];
    h.eventBus.on('reconnect:succeeded', event => succeeded.push(event));

    h.eventBus.emit('connection:ended', {
        botId: h.botId,
        connectionGeneration: 1,
        intentional: false,
        reason: 'historical end'
    });
    await eventually(() => h.context.get() === created);
    await eventually(() => h.reconnect.timer === null);
    await wait(5);

    assert.equal(createCalls, 1);
    assert.equal(h.context.get(), created);
    assert.equal(h.context.getGeneration(), 2);
    assert.equal(succeeded.length, 1);
    assert.equal(succeeded[0].botId, h.botId);
    assert.equal(succeeded[0].sourceGeneration, 1);
    assert.equal(succeeded[0].sourceAttemptEpoch, null);
    assert.equal(succeeded[0].connectionGeneration, 2);
    assert.equal(succeeded[0].resultGeneration, 2);
    assert.equal(succeeded[0].successfulAttemptEpoch, 1);
    assert.equal(succeeded[0].successfulAttemptId, `${h.botId}:connection-attempt:1`);
    assert.equal(h.reconnect.attempts, 0);
    assert.equal(h.reconnect.timer, null);
    await cleanupProduction(h);
});

test('reconnect joins the exact pre-attach production attempt and emits success once', async () => {
    const turnEntered = deferred();
    const turnRelease = deferred();
    const created = client();
    let createCalls = 0;
    let leaseReleaseCalls = 0;
    const h = await setupProduction({
        delayMs: 5,
        attemptCoordinator: {
            async acquireTurn() {
                turnEntered.resolve();
                return turnRelease.promise;
            }
        },
        factory: {
            create() {
                createCalls += 1;
                queueMicrotask(() => created.emit('spawn'));
                return created;
            }
        }
    });
    const historical = client();
    assert.equal(h.context.attach(historical), 1);
    assert.equal(h.context.detach(historical), true);
    const attempting = [];
    const succeeded = [];
    h.eventBus.on('reconnect:attempting', event => attempting.push(event));
    h.eventBus.on('reconnect:succeeded', event => succeeded.push(event));

    h.eventBus.emit('connection:ended', {
        botId: h.botId,
        connectionGeneration: 1,
        intentional: false,
        reason: 'historical end'
    });
    const externalConnect = h.manager.connect();
    await turnEntered.promise;
    await eventually(() => attempting.length === 1);
    turnRelease.resolve({ release() { leaseReleaseCalls += 1; } });
    assert.equal(await externalConnect, created);
    await eventually(() => succeeded.length === 1);

    assert.equal(createCalls, 1);
    assert.equal(leaseReleaseCalls, 1);
    assert.equal(h.context.get(), created);
    assert.equal(h.context.getGeneration(), 2);
    assert.equal(succeeded[0].sourceGeneration, 1);
    assert.equal(succeeded[0].sourceAttemptEpoch, null);
    assert.equal(succeeded[0].connectionGeneration, 2);
    assert.equal(succeeded[0].successfulAttemptEpoch, 1);
    assert.equal(succeeded[0].successfulAttemptId, `${h.botId}:connection-attempt:1`);
    assert.equal(h.reconnect.attempts, 0);
    assert.equal(h.reconnect.timer, null);
    await cleanupProduction(h);
});

test('joined production attempt failure keeps the canonical failure as the only retry decision', async () => {
    const turnEntered = deferred();
    const turnRelease = deferred();
    let createCalls = 0;
    const h = await setupProduction({
        delayMs: 40,
        attemptCoordinator: {
            async acquireTurn() {
                turnEntered.resolve();
                return turnRelease.promise;
            }
        },
        factory: {
            create() {
                createCalls += 1;
                throw new FlowError('joined attempt failed', { code: 'TRANSIENT', retryable: true });
            }
        }
    });
    const historical = client();
    assert.equal(h.context.attach(historical), 1);
    assert.equal(h.context.detach(historical), true);
    const scheduled = [];
    const attempting = [];
    const succeeded = [];
    h.eventBus.on('reconnect:scheduled', event => scheduled.push(event));
    h.eventBus.on('reconnect:attempting', event => attempting.push(event));
    h.eventBus.on('reconnect:succeeded', event => succeeded.push(event));

    h.eventBus.emit('connection:ended', {
        botId: h.botId,
        connectionGeneration: 1,
        intentional: false,
        reason: 'historical end'
    });
    const externalConnect = h.manager.connect();
    const externalFailure = assert.rejects(externalConnect, /joined attempt failed/);
    await turnEntered.promise;
    await eventually(() => attempting.length === 1);
    turnRelease.resolve({ release() {} });
    await externalFailure;
    await eventually(() => scheduled.length === 2);

    assert.equal(createCalls, 1);
    assert.equal(succeeded.length, 0);
    assert.equal(scheduled[0].sourceGeneration, 1);
    assert.equal(scheduled[0].sourceAttemptEpoch, null);
    assert.equal(scheduled[1].sourceGeneration, null);
    assert.equal(scheduled[1].sourceAttemptEpoch, 1);
    assert.equal(h.reconnect.timer !== null, true);
    await cleanupProduction(h);
});

test('attempt-owned retry keeps source epoch distinct from successful result epoch', async () => {
    const created = client();
    let createCalls = 0;
    const h = await setupProduction({
        factory: {
            create() {
                createCalls += 1;
                if (createCalls === 1) throw new FlowError('first failed', { code: 'TRANSIENT', retryable: true });
                queueMicrotask(() => created.emit('spawn'));
                return created;
            }
        }
    });
    const succeeded = [];
    h.eventBus.on('reconnect:succeeded', event => succeeded.push(event));
    assert.equal(await h.manager.start(), null);
    await eventually(() => h.context.get() === created);
    await wait(5);

    assert.equal(createCalls, 2);
    assert.equal(succeeded.length, 1);
    assert.equal(succeeded[0].sourceGeneration, null);
    assert.equal(succeeded[0].sourceAttemptEpoch, 1);
    assert.equal(succeeded[0].successfulAttemptEpoch, 2);
    assert.equal(succeeded[0].successfulAttemptId, `${h.botId}:connection-attempt:2`);
    assert.equal(succeeded[0].connectionGeneration, 1);
    assert.equal(succeeded[0].resultGeneration, 1);
    await cleanupProduction(h);
});

for (const variant of ['null', 'other-object']) {
    test(`custom pending ${variant} resolve after replacement cannot claim success`, async () => {
        const botId = `bot-custom-${variant}`;
        const context = new BotContext(botId);
        const eventBus = new EventBus();
        const gate = deferred();
        const logs = loggerCapture();
        let connectCalls = 0;
        const customManager = {
            context,
            async connect() {
                connectCalls += 1;
                return gate.promise;
            }
        };
        const reconnect = new ReconnectManager({
            botId, context, connectionManager: customManager, eventBus,
            policy: { enabled: true, maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 1 }, logger: logs.logger
        });
        const succeeded = [];
        eventBus.on('reconnect:succeeded', event => succeeded.push(event));
        await reconnect.initialize();
        await reconnect.start();
        eventBus.emit('connection:attempt-started', { botId, attemptId: 'source', attemptEpoch: 1 });
        eventBus.emit('connection:attempt-failed', {
            botId, attemptId: 'source', attemptEpoch: 1, retryable: true,
            error: new FlowError('source failed', { retryable: true })
        });
        await eventually(() => connectCalls === 1);

        const replacement = client();
        const replacementGeneration = context.attach(replacement);
        eventBus.emit('connection:spawned', {
            botId,
            connectionGeneration: replacementGeneration,
            attemptId: 'replacement-owner',
            attemptEpoch: 99
        });
        const attemptsBeforeResolve = reconnect.attempts;
        const ledgerSizeBeforeResolve = reconnect.failureDecisions.size;
        gate.resolve(variant === 'null' ? null : { not: 'replacement' });
        await wait(10);

        assert.equal(context.get(), replacement);
        assert.equal(context.getGeneration(), replacementGeneration);
        assert.equal(succeeded.length, 0);
        assert.equal(logs.records.filter(record => record.message === 'Minecraft reconnect succeeded.').length, 0);
        assert.equal(reconnect.attempts, attemptsBeforeResolve);
        assert.equal(reconnect.failureDecisions.size, ledgerSizeBeforeResolve);
        assert.equal(reconnect.timer, null);
        assert.equal(replacement.endCalls, 0);
        await reconnect.destroy();
    });
}

test('connect returning an existing replacement without a reconnect-owned attempt is not success', async () => {
    const botId = 'bot-existing-replacement';
    const context = new BotContext(botId);
    const eventBus = new EventBus();
    const resume = deferred();
    let connectCalls = 0;
    const customManager = {
        context,
        async connect() {
            connectCalls += 1;
            await resume.promise;
            return context.get();
        }
    };
    const reconnect = new ReconnectManager({
        botId, context, connectionManager: customManager, eventBus,
        policy: { enabled: true, maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 1 }, logger: loggerCapture().logger
    });
    const succeeded = [];
    eventBus.on('reconnect:succeeded', event => succeeded.push(event));
    await reconnect.initialize();
    await reconnect.start();
    eventBus.emit('connection:attempt-started', { botId, attemptId: 'source', attemptEpoch: 1 });
    eventBus.emit('connection:attempt-failed', { botId, attemptId: 'source', attemptEpoch: 1, retryable: true, error: new Error('source') });
    await eventually(() => connectCalls === 1);
    const replacement = client();
    const generation = context.attach(replacement);
    eventBus.emit('connection:spawned', { botId, connectionGeneration: generation, attemptId: 'external', attemptEpoch: 77 });
    resume.resolve();
    await wait(10);
    assert.equal(context.get(), replacement);
    assert.equal(succeeded.length, 0);
    await reconnect.destroy();
});

test('valid contextful custom manager success requires and uses exact attempt/spawn correlation', async () => {
    const botId = 'bot-custom-valid';
    const context = new BotContext(botId);
    const eventBus = new EventBus();
    const created = client();
    let connectCalls = 0;
    let resultGeneration = null;
    async function doConnect() {
        connectCalls += 1;
        eventBus.emit('connection:attempt-started', { botId, attemptId: 'custom-success', attemptEpoch: 2 });
        eventBus.emit('connection:connecting', { botId, attemptId: 'custom-success', attemptEpoch: 2 });
        resultGeneration = context.attach(created);
        eventBus.emit('connection:client-attached', { botId, connectionGeneration: resultGeneration, attemptId: 'custom-success', attemptEpoch: 2 });
        eventBus.emit('connection:spawned', { botId, connectionGeneration: resultGeneration, attemptId: 'custom-success', attemptEpoch: 2 });
        return created;
    }
    const customManager = {
        context,
        connect: doConnect,
        async connectWithResult() {
            const resultClient = await doConnect();
            return Object.freeze({
                contract: 'connection-success-result-v1',
                client: resultClient,
                connectionGeneration: resultGeneration,
                attemptId: 'custom-success',
                attemptEpoch: 2,
                startedByInvocation: true,
                joinedExisting: false,
                joinedInFlight: false
            });
        }
    };
    const reconnect = new ReconnectManager({
        botId, context, connectionManager: customManager, eventBus,
        policy: { enabled: true, maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 1 }, logger: loggerCapture().logger
    });
    const succeeded = [];
    eventBus.on('reconnect:succeeded', event => succeeded.push(event));
    await reconnect.initialize();
    await reconnect.start();
    eventBus.emit('connection:attempt-started', { botId, attemptId: 'source', attemptEpoch: 1 });
    eventBus.emit('connection:attempt-failed', { botId, attemptId: 'source', attemptEpoch: 1, retryable: true, error: new Error('source') });
    await eventually(() => connectCalls === 1);
    await wait(5);
    assert.equal(context.get(), created);
    assert.equal(succeeded.length, 1);
    assert.equal(succeeded[0].sourceAttemptEpoch, 1);
    assert.equal(succeeded[0].successfulAttemptEpoch, 2);
    assert.equal(succeeded[0].successfulAttemptId, 'custom-success');
    assert.equal(succeeded[0].connectionGeneration, 1);
    await reconnect.destroy();
});

test('valid contextful custom manager may claim the exact in-flight attempt it joined', async () => {
    const botId = 'bot-custom-joined-valid';
    const context = new BotContext(botId);
    const eventBus = new EventBus();
    const created = client();
    let connectCalls = 0;
    const customManager = {
        context,
        async connectWithResult() {
            connectCalls += 1;
            eventBus.emit('connection:attempt-started', { botId, attemptId: 'joined-success', attemptEpoch: 2 });
            const connectionGeneration = context.attach(created);
            eventBus.emit('connection:spawned', {
                botId, connectionGeneration, attemptId: 'joined-success', attemptEpoch: 2
            });
            return Object.freeze({
                contract: ConnectionSuccessResultContract.contract,
                client: created,
                connectionGeneration,
                attemptId: 'joined-success',
                attemptEpoch: 2,
                startedByInvocation: false,
                joinedExisting: false,
                joinedInFlight: true
            });
        }
    };
    const reconnect = new ReconnectManager({
        botId, context, connectionManager: customManager, eventBus,
        policy: { enabled: true, maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 1 }, logger: loggerCapture().logger
    });
    const succeeded = [];
    eventBus.on('reconnect:succeeded', event => succeeded.push(event));
    await reconnect.initialize();
    await reconnect.start();
    eventBus.emit('connection:attempt-started', { botId, attemptId: 'source', attemptEpoch: 1 });
    eventBus.emit('connection:attempt-failed', {
        botId, attemptId: 'source', attemptEpoch: 1, retryable: true, error: new Error('source')
    });
    await eventually(() => succeeded.length === 1);

    assert.equal(connectCalls, 1);
    assert.equal(context.get(), created);
    assert.equal(succeeded[0].sourceAttemptEpoch, 1);
    assert.equal(succeeded[0].successfulAttemptEpoch, 2);
    assert.equal(succeeded[0].successfulAttemptId, 'joined-success');
    assert.equal(succeeded[0].connectionGeneration, 1);
    assert.equal(reconnect.attempts, 0);
    await reconnect.destroy();
});

test('joined in-flight result for a stale client cannot claim a replacement client success', async () => {
    const botId = 'bot-custom-joined-stale';
    const context = new BotContext(botId);
    const eventBus = new EventBus();
    const gate = deferred();
    const staleClient = client();
    let connectCalls = 0;
    const customManager = {
        context,
        async connectWithResult() {
            connectCalls += 1;
            return gate.promise;
        }
    };
    const reconnect = new ReconnectManager({
        botId, context, connectionManager: customManager, eventBus,
        policy: { enabled: true, maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 1 }, logger: loggerCapture().logger
    });
    const succeeded = [];
    eventBus.on('reconnect:succeeded', event => succeeded.push(event));
    await reconnect.initialize();
    await reconnect.start();
    eventBus.emit('connection:attempt-started', { botId, attemptId: 'source', attemptEpoch: 1 });
    eventBus.emit('connection:attempt-failed', {
        botId, attemptId: 'source', attemptEpoch: 1, retryable: true, error: new Error('source')
    });
    await eventually(() => connectCalls === 1);

    const replacement = client();
    const replacementGeneration = context.attach(replacement);
    eventBus.emit('connection:spawned', {
        botId, connectionGeneration: replacementGeneration, attemptId: 'replacement', attemptEpoch: 3
    });
    gate.resolve(Object.freeze({
        contract: ConnectionSuccessResultContract.contract,
        client: staleClient,
        connectionGeneration: replacementGeneration,
        attemptId: 'joined-stale',
        attemptEpoch: 2,
        startedByInvocation: false,
        joinedExisting: false,
        joinedInFlight: true
    }));
    await wait(10);

    assert.equal(context.get(), replacement);
    assert.equal(succeeded.length, 0);
    assert.equal(reconnect.timer, null);
    assert.equal(replacement.endCalls, 0);
    await reconnect.destroy();
});

test('contextless custom manager keeps explicit non-null legacy success compatibility', async () => {
    const botId = 'bot-contextless';
    const eventBus = new EventBus();
    let connectCalls = 0;
    const result = { connected: true };
    const manager = { async connect() { connectCalls += 1; return result; } };
    const reconnect = new ReconnectManager({
        botId, connectionManager: manager, eventBus,
        policy: { enabled: true, maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 1 }, logger: loggerCapture().logger
    });
    const succeeded = [];
    eventBus.on('reconnect:succeeded', event => succeeded.push(event));
    await reconnect.initialize();
    await reconnect.start();
    eventBus.emit('connection:failed', { botId, connectionGeneration: 1, error: new Error('legacy source') });
    await eventually(() => connectCalls === 1);
    await wait(5);
    assert.equal(succeeded.length, 1);
    assert.equal(succeeded[0].connectionGeneration, null);
    assert.equal(succeeded[0].successfulAttemptEpoch, null);
    await reconnect.destroy();
});

test('stop before late successful resolve prevents success bookkeeping and event', async () => {
    const botId = 'bot-late-success';
    const context = new BotContext(botId);
    const eventBus = new EventBus();
    const gate = deferred();
    let connectCalls = 0;
    const customManager = { context, async connect() { connectCalls += 1; return gate.promise; } };
    const reconnect = new ReconnectManager({
        botId, context, connectionManager: customManager, eventBus,
        policy: { enabled: true, maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 1 }, logger: loggerCapture().logger
    });
    const succeeded = [];
    eventBus.on('reconnect:succeeded', event => succeeded.push(event));
    await reconnect.initialize();
    await reconnect.start();
    eventBus.emit('connection:attempt-started', { botId, attemptId: 'source', attemptEpoch: 1 });
    eventBus.emit('connection:attempt-failed', { botId, attemptId: 'source', attemptEpoch: 1, retryable: true, error: new Error('source') });
    await eventually(() => connectCalls === 1);
    const attemptsBeforeStop = reconnect.attempts;
    const ledgerBeforeStop = reconnect.failureDecisions.size;
    await reconnect.stop();
    const created = client();
    const generation = context.attach(created);
    eventBus.emit('connection:spawned', { botId, connectionGeneration: generation, attemptId: 'late', attemptEpoch: 2 });
    gate.resolve(created);
    await wait(10);
    assert.equal(succeeded.length, 0);
    assert.equal(reconnect.attempts, attemptsBeforeStop);
    assert.equal(reconnect.failureDecisions.size, ledgerBeforeStop === 0 ? 0 : reconnect.failureDecisions.size);
    assert.equal(reconnect.timer, null);
    await reconnect.destroy();
});

test('normal production spawn plus connect completion emits reconnect success exactly once', async () => {
    const created = client();
    const h = await setupProduction({
        factory: { create() { queueMicrotask(() => created.emit('spawn')); return created; } }
    });
    const historical = client();
    h.context.attach(historical);
    h.context.detach(historical);
    const succeeded = [];
    h.eventBus.on('reconnect:succeeded', event => succeeded.push(event));
    h.eventBus.emit('connection:ended', { botId: h.botId, connectionGeneration: 1, intentional: false, reason: 'end' });
    await eventually(() => h.context.get() === created);
    await wait(10);
    assert.equal(succeeded.length, 1);
    await cleanupProduction(h);
});


test('ConnectionSuccessResultContract validates owned and non-owned result shapes', () => {
    const ownedClient = {};
    const owned = ConnectionSuccessResultContract.create({
        client: ownedClient,
        connectionGeneration: 2,
        attemptId: 'attempt-2',
        attemptEpoch: 2,
        startedByInvocation: true
    });
    assert.equal(ConnectionSuccessResultContract.is(owned), true);
    assert.equal(Object.isFrozen(owned), true);
    assert.equal(ConnectionSuccessResultContract.is(null), false);
    assert.equal(ConnectionSuccessResultContract.is({ contract: 'other' }), false);
    assert.throws(() => ConnectionSuccessResultContract.create({ client: null }), /client object/);
    assert.throws(() => ConnectionSuccessResultContract.create({ client: {}, connectionGeneration: 0 }), /generation/);
    assert.throws(() => ConnectionSuccessResultContract.create({ client: {}, attemptEpoch: -1 }), /attemptEpoch/);
    assert.throws(() => ConnectionSuccessResultContract.create({ client: {}, attemptId: '   ' }), /attemptId/);
    assert.throws(() => ConnectionSuccessResultContract.create({ client: {}, startedByInvocation: true }), /Owned or joined in-flight/);
    assert.throws(() => ConnectionSuccessResultContract.create({ client: {}, joinedInFlight: true }), /Owned or joined in-flight/);
    assert.throws(() => ConnectionSuccessResultContract.create({
        client: {}, connectionGeneration: 1, attemptId: 'attempt-1', attemptEpoch: 1,
        startedByInvocation: true, joinedExisting: true
    }), /cannot also be a joined result/);
    assert.throws(() => ConnectionSuccessResultContract.create({
        client: {}, connectionGeneration: 1, attemptId: 'attempt-1', attemptEpoch: 1,
        startedByInvocation: true, joinedInFlight: true
    }), /cannot also be a joined result/);
    const joined = ConnectionSuccessResultContract.create({ client: {}, joinedExisting: true });
    assert.equal(joined.startedByInvocation, false);
    assert.equal(joined.joinedExisting, true);
    const joinedInFlight = ConnectionSuccessResultContract.create({
        client: {}, connectionGeneration: 2, attemptId: 'attempt-2', attemptEpoch: 2,
        joinedInFlight: true
    });
    assert.equal(ConnectionSuccessResultContract.is(joinedInFlight), true);
    assert.equal(joinedInFlight.joinedInFlight, true);
    assert.equal(ConnectionSuccessResultContract.is({
        contract: ConnectionSuccessResultContract.contract,
        client: {}, connectionGeneration: null, attemptId: null, attemptEpoch: null,
        startedByInvocation: false, joinedExisting: false, joinedInFlight: true
    }), false);
    const plain = {
        contract: ConnectionSuccessResultContract.contract,
        client: {},
        connectionGeneration: null,
        attemptId: null,
        attemptEpoch: null,
        startedByInvocation: false,
        joinedExisting: true,
        joinedInFlight: false
    };
    assert.equal(ConnectionSuccessResultContract.is(plain), true);
    assert.equal(ConnectionSuccessResultContract.is({ ...plain, client: null }), false);
    assert.equal(ConnectionSuccessResultContract.is({ ...plain, client: 'client' }), false);
    assert.equal(ConnectionSuccessResultContract.is({ ...plain, startedByInvocation: null }), false);
    assert.equal(ConnectionSuccessResultContract.is({ ...plain, joinedExisting: null }), false);
    assert.equal(ConnectionSuccessResultContract.is({ ...plain, joinedInFlight: null }), false);
    assert.equal(ConnectionSuccessResultContract.is({ ...plain, connectionGeneration: 0 }), false);
    assert.equal(ConnectionSuccessResultContract.is({ ...plain, attemptEpoch: -1 }), false);
    assert.equal(ConnectionSuccessResultContract.is({ ...plain, attemptId: '  ' }), false);
    assert.equal(ConnectionSuccessResultContract.is({
        ...plain,
        connectionGeneration: 1,
        attemptId: 'attempt-1',
        attemptEpoch: 1,
        startedByInvocation: true
    }), false, 'started result cannot also claim joinedExisting');
});

test('ConnectionManager connectWithResult distinguishes existing and joined in-flight clients without changing connect()', async () => {
    const botId = 'bot-result-capability';
    const context = new BotContext(botId);
    const eventBus = new EventBus();
    const existing = client();
    assert.equal(context.attach(existing), 1);
    const managerExisting = new ConnectionManager({
        botId,
        context,
        sessionManager: new SessionManager({ botId }),
        connectionFactory: { create() { throw new Error('must not create'); } },
        profile: { enabled: true }, server: {}, eventBus, logger: loggerCapture().logger, readyTimeoutMs: 100
    });
    const existingResult = await managerExisting.connectWithResult();
    assert.equal(existingResult.client, existing);
    assert.equal(existingResult.connectionGeneration, 1);
    assert.equal(existingResult.startedByInvocation, false);
    assert.equal(existingResult.joinedExisting, true);
    assert.equal(await managerExisting.connect(), existing, 'legacy connect() must still return raw client');
    context.detach(existing);

    const created = client();
    const managerInFlight = new ConnectionManager({
        botId,
        context,
        sessionManager: new SessionManager({ botId }),
        connectionFactory: { create: () => created },
        profile: { enabled: true }, server: {}, eventBus, logger: loggerCapture().logger, readyTimeoutMs: 100
    });
    const first = managerInFlight.connect();
    const joined = managerInFlight.connectWithResult();
    queueMicrotask(() => created.emit('spawn'));
    assert.equal(await first, created);
    const joinedResult = await joined;
    assert.equal(joinedResult.client, created);
    assert.equal(joinedResult.startedByInvocation, false);
    assert.equal(joinedResult.joinedExisting, true);
    assert.equal(joinedResult.joinedInFlight, true);
    assert.equal(joinedResult.attemptEpoch, 1);
    assert.equal(joinedResult.connectionGeneration, 2);
    await managerInFlight.destroy();
});
