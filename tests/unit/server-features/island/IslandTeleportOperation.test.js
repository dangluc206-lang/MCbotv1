'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventBus = require('../../../../src/core/EventBus');
const CancellationSource = require('../../../../src/shared/cancellation/CancellationSource');
const IslandTeleportOperation = require('../../../../src/server-features/island/IslandTeleportOperation');
const IslandService = require('../../../../src/server-features/island/IslandService');
const BotContext = require('../../../../src/bot/BotContext');
const CommandRegistry = require('../../../../src/commands/CommandRegistry');
const CommandResolver = require('../../../../src/commands/CommandResolver');
const CommandGuard = require('../../../../src/commands/CommandGuard');
const CommandExecutor = require('../../../../src/commands/CommandExecutor');
const CommandService = require('../../../../src/commands/CommandService');
const ConnectionStateView = require('../../../../src/modes/fishing/ConnectionStateView');
const Operation = require('../../../../src/operations/Operation');
const OperationManager = require('../../../../src/operations/OperationManager');
const OperationQueue = require('../../../../src/operations/OperationQueue');
const OperationLockPolicy = require('../../../../src/operations/OperationLockPolicy');
const OperationTimeoutPolicy = require('../../../../src/operations/OperationTimeoutPolicy');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

async function waitFor(predicate, label = 'condition', loops = 100) {
    for (let index = 0; index < loops; index += 1) {
        if (predicate()) return;
        await new Promise(resolve => setImmediate(resolve));
    }
    throw new Error(`Timed out waiting for ${label}`);
}

function harness({ generation = 2, connected = true, send = null, timeoutMs = 30 } = {}) {
    const eventBus = new EventBus();
    let currentGeneration = generation;
    let isConnected = connected;
    let sendCalls = 0;
    let position = { x: 0, y: 64, z: 0 };
    const operation = new IslandTeleportOperation({
        botId: 'bot-01',
        eventBus,
        connectionState: {
            generation: () => currentGeneration,
            isConnected: () => isConnected
        },
        commandService: {
            send: async (...args) => {
                sendCalls += 1;
                if (send) return send(...args);
                return { success: true };
            }
        },
        positionService: { current: () => ({ ...position }) },
        config: { commandKey: 'island', timeoutMs }
    });
    return {
        operation,
        service: new IslandService({ operation }),
        eventBus,
        setGeneration: value => { currentGeneration = value; },
        setConnected: value => { isConnected = value; },
        setPosition: value => { position = { ...value }; },
        sendCalls: () => sendCalls
    };
}

function emitTeleport(h, { botId = 'bot-01', connectionGeneration, generation, position = { x: 8, y: 70, z: 8 } } = {}) {
    h.eventBus.emit('movement:teleport', { botId, connectionGeneration, generation, position });
}

async function assertListenerCleanup(h, baseline = 0) {
    await new Promise(resolve => setImmediate(resolve));
    for (const name of ['movement:teleport', 'connection:client-attached', 'connection:spawned', 'connection:ended']) {
        assert.equal(h.eventBus.listenerCount(name), baseline, `${name} listener must be cleaned`);
    }
}

function realCommandHarness({ minimumIntervalMs = 60, timeoutMs = 250 } = {}) {
    const context = new BotContext('bot-01');
    const oldClient = { chatCalls: [], chat(command) { this.chatCalls.push(command); } };
    const newClient = { chatCalls: [], chat(command) { this.chatCalls.push(command); } };
    context.attach(oldClient);
    const eventBus = new EventBus();
    const guard = new CommandGuard({ context, minimumIntervalMs });
    guard.markSent();
    const resolver = new CommandResolver({ registry: new CommandRegistry({ island: '/is' }) });
    const executor = new CommandExecutor({ context, guard });
    const commandService = new CommandService({ botId: 'bot-01', resolver, executor });
    const operation = new IslandTeleportOperation({
        botId: 'bot-01',
        eventBus,
        connectionState: new ConnectionStateView({ context }),
        commandService,
        positionService: { current: () => ({ x: 0, y: 64, z: 0 }) },
        config: { commandKey: 'island', timeoutMs }
    });
    return {
        context,
        eventBus,
        operation,
        service: new IslandService({ operation }),
        oldClient,
        newClient,
        replaceClient() {
            context.detach(oldClient);
            context.attach(newClient);
        }
    };
}

async function waitLongerThanThrottle(milliseconds = 90) {
    await new Promise(resolve => setTimeout(resolve, milliseconds));
}

test('IslandTeleportOperation verifies only teleport from the expected connection generation', async () => {
    const h = harness({ generation: 2 });
    const pending = h.operation.execute();
    await waitFor(() => h.eventBus.listenerCount('movement:teleport') === 1, 'island teleport waiter');
    emitTeleport(h, { connectionGeneration: 2 });
    const result = await pending;
    assert.equal(result.connectionGeneration, 2);
    assert.deepEqual(result.after, { x: 8, y: 70, z: 8 });
    await assertListenerCleanup(h);
});

test('IslandTeleportOperation ignores stale, foreign and generation-less teleport events', async () => {
    const h = harness({ generation: 2, timeoutMs: 100 });
    let settled = false;
    const pending = h.operation.execute().finally(() => { settled = true; });
    await waitFor(() => h.eventBus.listenerCount('movement:teleport') === 1, 'island teleport waiter');

    emitTeleport(h, { connectionGeneration: 1 });
    emitTeleport(h, { botId: 'bot-02', connectionGeneration: 2 });
    emitTeleport(h, {});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false, 'stale/foreign/missing generation must not verify /is');

    emitTeleport(h, { connectionGeneration: 2 });
    assert.equal((await pending).connectionGeneration, 2, 'canonical current-generation event verifies /is');
    await assertListenerCleanup(h);
});

test('IslandTeleportOperation fails stale generation when connection changes while command is pending', async () => {
    const command = deferred();
    const h = harness({ generation: 2, send: () => command.promise, timeoutMs: 100 });
    const pending = h.operation.execute();
    await waitFor(() => h.eventBus.listenerCount('movement:teleport') === 1, 'pre-command waiter');
    h.setGeneration(3);
    h.eventBus.emit('connection:client-attached', { botId: 'bot-01', connectionGeneration: 3 });
    command.resolve({ success: true });
    await assert.rejects(pending, error => error.code === 'ISLAND_STALE_GENERATION');
    await assertListenerCleanup(h);
});

test('IslandTeleportOperation fails immediately when current generation changes while waiter is pending', async () => {
    const h = harness({ generation: 2, timeoutMs: 500 });
    const pending = h.operation.execute();
    await waitFor(() => h.eventBus.listenerCount('movement:teleport') === 1, 'island teleport waiter');
    h.setGeneration(3);
    h.eventBus.emit('connection:spawned', { botId: 'bot-01', connectionGeneration: 3 });
    await assert.rejects(pending, error => error.code === 'ISLAND_STALE_GENERATION');
    await assertListenerCleanup(h);
});

test('IslandTeleportOperation command failure disposes the pre-bound waiter', async () => {
    const h = harness({ send: async () => { throw new Error('command transport failed'); }, timeoutMs: 500 });
    const unhandled = [];
    const onUnhandled = reason => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
        await assert.rejects(h.operation.execute(), error => error.code === 'ISLAND_TELEPORT_FAILED');
        await assertListenerCleanup(h);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(unhandled.length, 0, 'command failure must settle/observe the pre-bound waiter rejection');
    } finally {
        process.off('unhandledRejection', onUnhandled);
    }
});

test('IslandTeleportOperation cancellation before command does not send or attach listeners', async () => {
    const source = new CancellationSource();
    source.cancel('pause');
    const h = harness();
    await assert.rejects(h.operation.execute({ cancellationToken: source.token }), error => error.code === 'CANCELLED');
    assert.equal(h.sendCalls(), 0);
    await assertListenerCleanup(h);
});

test('IslandTeleportOperation cancellation while waiting cleans listener ownership', async () => {
    const source = new CancellationSource();
    const h = harness({ timeoutMs: 500 });
    const pending = h.operation.execute({ cancellationToken: source.token });
    await waitFor(() => h.eventBus.listenerCount('movement:teleport') === 1, 'island teleport waiter');
    source.cancel('disable');
    await assert.rejects(pending, error => error.code === 'CANCELLED');
    await assertListenerCleanup(h);
});

test('IslandTeleportOperation disconnect of the expected generation fails stale and cleans immediately', async () => {
    const h = harness({ timeoutMs: 500 });
    const pending = h.operation.execute();
    await waitFor(() => h.eventBus.listenerCount('movement:teleport') === 1, 'island teleport waiter');
    h.setConnected(false);
    h.eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 2 });
    await assert.rejects(pending, error => error.code === 'ISLAND_STALE_GENERATION');
    await assertListenerCleanup(h);
});

test('IslandTeleportOperation timeout is bounded and cleans every waiter resource', async () => {
    const h = harness({ timeoutMs: 12 });
    await assert.rejects(h.operation.execute(), error => error.code === 'ISLAND_TELEPORT_VERIFY_TIMEOUT');
    await assertListenerCleanup(h);
});

test('IslandService goHome remains backward-compatible and maps cancellation result', async () => {
    const source = new CancellationSource();
    source.cancel('pause');
    const h = harness();
    const cancelled = await h.service.goHome({ cancellationToken: source.token });
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(cancelled.error.code, 'CANCELLED');

    const successHarness = harness();
    const pending = successHarness.service.goHome();
    await waitFor(() => successHarness.eventBus.listenerCount('movement:teleport') === 1, 'service teleport waiter');
    emitTeleport(successHarness, { connectionGeneration: 2 });
    assert.equal((await pending).success, true);
});

test('real /is command cancelled during CommandGuard throttle never chats on old or replacement client', async () => {
    const h = realCommandHarness();
    const source = new CancellationSource();
    const pending = h.service.goHome({ cancellationToken: source.token });
    await waitFor(() => h.eventBus.listenerCount('movement:teleport') === 1, 'real command island waiter');

    source.cancel('pause while command is throttled');
    h.replaceClient();
    const result = await pending;
    assert.equal(result.status, 'CANCELLED');

    await waitLongerThanThrottle();
    assert.equal(h.oldClient.chatCalls.length, 0);
    assert.equal(h.newClient.chatCalls.length, 0);
    await assertListenerCleanup({ eventBus: h.eventBus });
});

test('real /is command generation replacement during throttle fails stale and never chats on replacement client', async () => {
    const h = realCommandHarness();
    const pending = h.operation.execute();
    await waitFor(() => h.eventBus.listenerCount('movement:teleport') === 1, 'real command island waiter');

    h.replaceClient();
    h.eventBus.emit('connection:client-attached', { botId: 'bot-01', connectionGeneration: 2 });
    await assert.rejects(pending, error => error.code === 'ISLAND_STALE_GENERATION');

    await waitLongerThanThrottle();
    assert.equal(h.oldClient.chatCalls.length, 0);
    assert.equal(h.newClient.chatCalls.length, 0);
    await assertListenerCleanup({ eventBus: h.eventBus });
});

test('real /is waiter timeout cancels a throttled command before chat', async () => {
    const h = realCommandHarness({ minimumIntervalMs: 100, timeoutMs: 15 });
    await assert.rejects(h.operation.execute(), error => error.code === 'ISLAND_TELEPORT_VERIFY_TIMEOUT');

    await waitLongerThanThrottle(130);
    assert.equal(h.oldClient.chatCalls.length, 0);
    assert.equal(h.newClient.chatCalls.length, 0);
    await assertListenerCleanup({ eventBus: h.eventBus });
});


test('managed /is preserves generation captured before root queue and never sends on replacement client', async () => {
    const h = realCommandHarness({ minimumIntervalMs: 0, timeoutMs: 100 });
    let commandSendCalls = 0;
    const originalSend = h.operation.commandService.send.bind(h.operation.commandService);
    h.operation.commandService.send = (...args) => { commandSendCalls += 1; return originalSend(...args); };
    const operationManager = new OperationManager({
        botId: 'bot-01',
        queue: new OperationQueue({ maxPending: 8 }),
        lockPolicy: new OperationLockPolicy(),
        timeoutPolicy: new OperationTimeoutPolicy(),
        config: { defaultQueueWaitTimeoutMs: 200, defaultExecutionTimeoutMs: 200, shutdownDrainTimeoutMs: 100 }
    });
    const service = new IslandService({ operation: h.operation, operationManager, context: h.context });
    const blocker = deferred();
    const blockingRoot = operationManager.run(new Operation({ name: 'root-blocker', execute: () => blocker.promise }), { timeoutMs: 300 });
    await waitFor(() => operationManager.snapshot().running === 1, 'root blocker running');

    const pending = service.goHome(); // captures generation 1 before this root enters the queue
    await waitFor(() => operationManager.snapshot().pending === 1, '/is root pending in queue');
    h.replaceClient();
    assert.equal(h.context.getGeneration(), 2);
    blocker.resolve(true);
    await blockingRoot;

    const result = await pending;
    assert.equal(result.status, 'DISCONNECTED');
    assert.equal(result.error?.code, 'ISLAND_STALE_GENERATION');
    assert.equal(commandSendCalls, 0);
    assert.equal(h.oldClient.chatCalls.length, 0);
    assert.equal(h.newClient.chatCalls.length, 0);
    await assertListenerCleanup({ eventBus: h.eventBus });
    await operationManager.destroy();
});
