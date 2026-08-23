'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const BotContext = require('../../../src/bot/BotContext');
const EventBus = require('../../../src/core/EventBus');
const CommandRegistry = require('../../../src/commands/CommandRegistry');
const CommandResolver = require('../../../src/commands/CommandResolver');
const CommandGuard = require('../../../src/commands/CommandGuard');
const CommandExecutor = require('../../../src/commands/CommandExecutor');
const CommandService = require('../../../src/commands/CommandService');
const CommandConfirmation = require('../../../src/commands/responses/CommandConfirmation');
const ResponseMatcher = require('../../../src/commands/responses/ResponseMatcher');
const CancellationSource = require('../../../src/shared/cancellation/CancellationSource');
const Operation = require('../../../src/operations/Operation');
const OperationManager = require('../../../src/operations/OperationManager');
const OperationQueue = require('../../../src/operations/OperationQueue');
const OperationLockPolicy = require('../../../src/operations/OperationLockPolicy');
const OperationTimeoutPolicy = require('../../../src/operations/OperationTimeoutPolicy');
const Status = require('../../../src/shared/result/Status');

function harness({ chat = null, minimumIntervalMs = 0 } = {}) {
    const eventBus = new EventBus();
    const context = new BotContext('bot-01');
    const client = {
        chatCalls: [],
        chat(value) {
            this.chatCalls.push(value);
            chat?.({ value, eventBus, context, client: this });
        }
    };
    context.attach(client);
    const resolver = new CommandResolver({ registry: new CommandRegistry({ ping: '/ping' }) });
    const guard = new CommandGuard({ context, minimumIntervalMs });
    const executor = new CommandExecutor({ context, guard });
    const confirmation = new CommandConfirmation({ eventBus, matcher: new ResponseMatcher(), context });
    const service = new CommandService({
        botId: 'bot-01', resolver, executor, confirmation,
        responseRules: { ping: [{ includes: 'pong' }] }
    });
    return { eventBus, context, client, guard, executor, confirmation, service };
}

test('CommandService pre-arms confirmation so synchronous bot.chat response is not missed', async () => {
    const h = harness({
        chat: ({ eventBus }) => eventBus.emit('command:message', {
            botId: 'bot-01', connectionGeneration: 1, message: 'pong immediately'
        })
    });
    const result = await h.service.send('ping', { expectedGeneration: 1, timeoutMs: 50 });
    assert.equal(result.success, true);
    assert.equal(result.data.confirmed.connectionGeneration, 1);
    assert.equal(h.client.chatCalls.length, 1);
    assert.equal(h.eventBus.listenerCount('command:message'), 0);
});

test('CommandConfirmation ignores stale, generation-less and foreign responses before accepting exact generation', async () => {
    const h = harness();
    const waiter = h.confirmation.arm({
        botId: 'bot-01', expectedGeneration: 1, rules: [{ includes: 'pong' }], timeoutMs: 100
    });
    let settled = false;
    waiter.promise.finally(() => { settled = true; });
    h.eventBus.emit('command:message', { botId: 'bot-01', connectionGeneration: 2, message: 'pong stale' });
    h.eventBus.emit('command:message', { botId: 'bot-01', message: 'pong missing-generation' });
    h.eventBus.emit('command:message', { botId: 'bot-02', connectionGeneration: 1, message: 'pong foreign' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    h.eventBus.emit('command:message', { botId: 'bot-01', connectionGeneration: 1, message: 'pong current' });
    const result = await waiter.promise;
    assert.equal(result.message, 'pong current');
});

test('matching connection end cancels confirmation while stale end does not', async () => {
    const h = harness();
    const staleSafe = h.confirmation.arm({ botId: 'bot-01', expectedGeneration: 1, rules: [{ includes: 'pong' }], timeoutMs: 100 });
    h.eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 2 });
    h.eventBus.emit('command:message', { botId: 'bot-01', connectionGeneration: 1, message: 'pong' });
    assert.equal((await staleSafe.promise).message, 'pong');

    const current = h.confirmation.arm({ botId: 'bot-01', expectedGeneration: 1, rules: [{ includes: 'pong' }], timeoutMs: 100 });
    h.eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 1 });
    await assert.rejects(current.promise, error => error.code === 'COMMAND_CONFIRM_DISCONNECTED');
});

test('CommandService preserves confirmation disconnect as DISCONNECTED instead of transport failure', async () => {
    const h = harness({
        chat: ({ eventBus }) => eventBus.emit('connection:ended', {
            botId: 'bot-01', connectionGeneration: 1
        })
    });

    const result = await h.service.send('ping', { expectedGeneration: 1, timeoutMs: 50 });

    assert.equal(result.success, false);
    assert.equal(result.status, Status.DISCONNECTED);
    assert.equal(result.error?.code, 'COMMAND_CONFIRM_DISCONNECTED');
});

test('confirmation timeout and parent cancellation cleanup all listeners', async () => {
    const h = harness();
    const timed = h.confirmation.arm({ botId: 'bot-01', expectedGeneration: 1, rules: [{ includes: 'pong' }], timeoutMs: 5 });
    await assert.rejects(timed.promise, error => error.code === 'TIMEOUT');
    assert.equal(h.eventBus.listenerCount('command:message'), 0);
    assert.equal(h.eventBus.listenerCount('connection:ended'), 0);

    const source = new CancellationSource();
    const cancelled = h.confirmation.arm({
        botId: 'bot-01', expectedGeneration: 1, rules: [{ includes: 'pong' }], timeoutMs: 100,
        cancellationToken: source.token
    });
    source.cancel('parent stopped');
    await assert.rejects(cancelled.promise, error => error.code === 'CANCELLED');
    assert.equal(h.eventBus.listenerCount('command:message'), 0);
    assert.equal(h.eventBus.listenerCount('connection:ended'), 0);
});

test('send failure after confirmation arm observes and disposes the waiter without orphan rejection', async () => {
    const eventBus = new EventBus();
    const context = new BotContext('bot-01');
    context.attach({ chat() {} });
    const confirmation = new CommandConfirmation({ eventBus, matcher: new ResponseMatcher(), context });
    const service = new CommandService({
        botId: 'bot-01',
        resolver: new CommandResolver({ registry: new CommandRegistry({ ping: '/ping' }) }),
        executor: { execute: async () => { throw new Error('transport failed'); } },
        confirmation,
        responseRules: { ping: [{ includes: 'pong' }] }
    });
    const unhandled = [];
    const onUnhandled = error => unhandled.push(error);
    process.on('unhandledRejection', onUnhandled);
    try {
        const result = await service.send('ping', { expectedGeneration: 1, timeoutMs: 50 });
        assert.equal(result.success, false);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(unhandled.length, 0);
        assert.equal(eventBus.listenerCount('command:message'), 0);
        assert.equal(eventBus.listenerCount('connection:ended'), 0);
    } finally {
        process.removeListener('unhandledRejection', onUnhandled);
    }
});

test('parent operation timeout during command throttle cancels pre-armed confirmation and never chats late', async () => {
    const h = harness({ minimumIntervalMs: 60 });
    h.guard.markSent();
    const manager = new OperationManager({
        botId: 'bot-01',
        queue: new OperationQueue({ maxPending: 4 }),
        lockPolicy: new OperationLockPolicy(),
        timeoutPolicy: new OperationTimeoutPolicy(),
        config: { defaultQueueWaitTimeoutMs: 50, defaultExecutionTimeoutMs: 100, shutdownDrainTimeoutMs: 50 }
    });
    const operation = new Operation({
        name: 'confirming-command',
        returnsResult: true,
        execute: context => h.service.send('ping', {
            expectedGeneration: 1,
            timeoutMs: 100,
            cancellationToken: context.cancellation.token
        })
    });
    const result = await manager.run(operation, { timeoutMs: 10, connectionGeneration: 1 });
    assert.equal(result.status, Status.TIMEOUT);
    await new Promise(resolve => setTimeout(resolve, 75));
    assert.equal(h.client.chatCalls.length, 0);
    assert.equal(h.eventBus.listenerCount('command:message'), 0);
    assert.equal(h.eventBus.listenerCount('connection:ended'), 0);
});

test('CommandConfirmation rejects invalid expectedGeneration and supports context-free confirmation', async () => {
    const eventBus = new EventBus();
    const confirmation = new CommandConfirmation({ eventBus, matcher: new ResponseMatcher(), context: null });
    assert.throws(() => confirmation.arm({ botId: 'bot-01', rules: [], expectedGeneration: 0 }), /positive integer/);
    const waiter = confirmation.arm({ botId: 'bot-01', rules: [{ includes: 'ok' }], timeoutMs: 100 });
    eventBus.emit('command:message', { botId: 'bot-01', connectionGeneration: 1, message: 'ok' });
    assert.equal((await waiter.promise).message, 'ok');
});

test('CommandService legacy confirmation.wait compatibility stays observed and preserves failure status branches', async () => {
    const resolver = { resolve: key => `/${key}` };
    const executor = { execute: async () => ({ command: '/legacy' }) };
    const confirmation = { wait: async () => ({ message: 'confirmed' }) };
    const service = new CommandService({ botId: 'bot-01', resolver, executor, confirmation, responseRules: { legacy: [{ includes: 'ok' }] } });
    const result = await service.send('legacy', { expectedGeneration: 1 });
    assert.equal(result.success, true);

    const cancelledService = new CommandService({
        botId: 'bot-01', resolver,
        executor: { execute: async () => { const error = new Error('cancel'); error.code = Status.CANCELLED; throw error; } },
        responseRules: {}
    });
    assert.equal((await cancelledService.send('cancelled', { confirm: false })).status, Status.CANCELLED);

    const staleService = new CommandService({
        botId: 'bot-01', resolver,
        executor: { execute: async () => { const error = new Error('stale'); error.code = 'COMMAND_STALE_GENERATION'; throw error; } },
        responseRules: {}
    });
    assert.equal((await staleService.send('stale', { confirm: false, expectedGeneration: 1 })).status, Status.DISCONNECTED);
});

test('CommandService preserves BOT_NOT_READY from the transport boundary instead of rewriting it as send failure', async () => {
    const resolver = { resolve: key => `/${key}` };
    const executor = {
        execute: async () => {
            const error = new Error('bot is not connected');
            error.code = 'BOT_NOT_READY';
            throw error;
        }
    };
    const service = new CommandService({ botId: 'bot-01', resolver, executor, responseRules: {} });

    const result = await service.send('ping', { confirm: false });
    assert.equal(result.success, false);
    assert.equal(result.status, Status.NOT_READY);
    assert.equal(result.error?.code, 'BOT_NOT_READY');
});
