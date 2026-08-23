'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const BotContext = require('../../../src/bot/BotContext');
const EventBus = require('../../../src/core/EventBus');
const Result = require('../../../src/shared/result/Result');
const ServerLoginService = require('../../../src/server-features/authentication/ServerLoginService');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

test('ServerLoginService ignores stale ended and keeps the current generation login attempt alive', async () => {
    const context = new BotContext('bot-01');
    const first = {};
    const second = {};
    context.attach(first);
    const eventBus = new EventBus();
    const sends = [];
    const currentGate = deferred();
    const commandService = {
        async send(_key, options) {
            sends.push(options);
            if (options.expectedGeneration === 1) {
                return new Promise(resolve => options.cancellationToken.onCancelled(() => resolve(Result.cancelled())));
            }
            return currentGate.promise;
        }
    };
    const succeeded = [];
    eventBus.on('server-login:succeeded', event => succeeded.push(event.connectionGeneration));
    const service = new ServerLoginService({
        botId: 'bot-01', context, eventBus, commandService,
        password: 'FAKE_TEST_PASSWORD',
        config: { enabled: true, commandKey: 'login', delayMs: 0, timeoutMs: 100, confirm: false },
        logger: { info() {}, error() {} }
    });
    await service.initialize();
    eventBus.emit('connection:spawned', { botId: 'bot-01', connectionGeneration: 1 });
    await new Promise(resolve => setImmediate(resolve));

    context.detach(first);
    assert.equal(context.attach(second), 2);
    eventBus.emit('connection:spawned', { botId: 'bot-01', connectionGeneration: 2 });
    await new Promise(resolve => setImmediate(resolve));
    const currentSend = sends.find(entry => entry.expectedGeneration === 2);
    assert.ok(currentSend);
    assert.equal(currentSend.cancellationToken.isCancelled, false);

    eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 1 });
    assert.equal(currentSend.cancellationToken.isCancelled, false);
    currentGate.resolve(Result.ok({ confirmed: false }));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(succeeded, [2]);
    await service.destroy();
});

test('ServerLoginService does not emit old generation failure after client replacement', async () => {
    const context = new BotContext('bot-01');
    const oldClient = {};
    const replacement = {};
    context.attach(oldClient);
    const eventBus = new EventBus();
    const oldCommand = deferred();
    const failed = [];
    eventBus.on('server-login:failed', event => failed.push(event.connectionGeneration));
    const service = new ServerLoginService({
        botId: 'bot-01', context, eventBus,
        commandService: { send: async () => oldCommand.promise },
        password: 'FAKE_TEST_PASSWORD',
        config: { enabled: true, commandKey: 'login', delayMs: 0, timeoutMs: 100, confirm: false },
        logger: { info() {}, error() {} }
    });
    await service.initialize();
    eventBus.emit('connection:spawned', { botId: 'bot-01', connectionGeneration: 1 });
    await new Promise(resolve => setImmediate(resolve));

    context.detach(oldClient);
    assert.equal(context.attach(replacement), 2);
    oldCommand.reject(new Error('old command rejected after replacement'));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(failed, []);
    await service.destroy();
});
