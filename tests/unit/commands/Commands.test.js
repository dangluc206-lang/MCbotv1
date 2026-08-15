'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const BotContext = require('../../../src/bot/BotContext');
const CommandRegistry = require('../../../src/commands/CommandRegistry');
const CommandResolver = require('../../../src/commands/CommandResolver');
const CommandGuard = require('../../../src/commands/CommandGuard');
const CommandExecutor = require('../../../src/commands/CommandExecutor');
const CommandService = require('../../../src/commands/CommandService');
const CancellationSource = require('../../../src/shared/cancellation/CancellationSource');

function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function client() {
    return {
        chatCalls: [],
        chat(value) { this.chatCalls.push(value); }
    };
}

test('only resolved configured command is sent', async () => {
    const messages = [];
    const context = new BotContext('a');
    context.attach({ chat: value => messages.push(value) });
    const resolver = new CommandResolver({ registry: new CommandRegistry({ home: '/is', sell: '/sell {item}' }) });
    const executor = new CommandExecutor({ context, guard: new CommandGuard({ context, minimumIntervalMs: 0 }) });
    await executor.execute(resolver.resolve('home'));
    await executor.execute(resolver.resolve('sell', { item: 'DIAMOND' }));
    assert.deepEqual(messages, ['/is', '/sell DIAMOND']);
});

test('sensitive command is sent but redacted from the executor result', async () => {
    const messages = [];
    const context = new BotContext('a');
    context.attach({ chat: value => messages.push(value) });
    const executor = new CommandExecutor({ context, guard: new CommandGuard({ context, minimumIntervalMs: 0 }) });
    const result = await executor.execute('/login top-secret', { sensitive: true });
    assert.deepEqual(messages, ['/login top-secret']);
    assert.equal(result.command, '[REDACTED]');
    assert.equal(result.sensitive, true);
});

test('CommandExecutor cancellation during throttle prevents send to old or replacement client', async () => {
    const context = new BotContext('bot-01');
    const oldClient = client();
    const newClient = client();
    context.attach(oldClient);
    const guard = new CommandGuard({ context, minimumIntervalMs: 60 });
    guard.markSent();
    const executor = new CommandExecutor({ context, guard });
    const source = new CancellationSource();

    const pending = executor.execute('/is', {
        cancellationToken: source.token,
        expectedGeneration: 1
    });
    await new Promise(resolve => setImmediate(resolve));
    source.cancel('pause');
    context.detach(oldClient);
    context.attach(newClient);

    await assert.rejects(pending, error => error.code === 'CANCELLED');
    await sleep(90);
    assert.equal(oldClient.chatCalls.length, 0);
    assert.equal(newClient.chatCalls.length, 0);
});

test('CommandExecutor rejects replacement generation after throttle without sending command', async () => {
    const context = new BotContext('bot-01');
    const oldClient = client();
    const newClient = client();
    context.attach(oldClient);
    const guard = new CommandGuard({ context, minimumIntervalMs: 60 });
    guard.markSent();
    const executor = new CommandExecutor({ context, guard });

    const pending = executor.execute('/is', { expectedGeneration: 1 });
    await new Promise(resolve => setImmediate(resolve));
    context.detach(oldClient);
    context.attach(newClient);

    await assert.rejects(pending, error => error.code === 'COMMAND_STALE_GENERATION');
    assert.equal(oldClient.chatCalls.length, 0);
    assert.equal(newClient.chatCalls.length, 0);
});

test('CommandService forwards cancellationToken and expectedGeneration to executor', async () => {
    const seen = [];
    const source = new CancellationSource();
    const service = new CommandService({
        botId: 'bot-01',
        resolver: new CommandResolver({ registry: new CommandRegistry({ island: '/is' }) }),
        executor: {
            execute: async (command, options) => {
                seen.push({ command, options });
                return { command, sentAt: Date.now() };
            }
        }
    });

    const result = await service.send('island', {
        confirm: false,
        cancellationToken: source.token,
        expectedGeneration: 7
    });
    assert.equal(result.success, true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].command, '/is');
    assert.equal(seen[0].options.cancellationToken, source.token);
    assert.equal(seen[0].options.expectedGeneration, 7);
});
