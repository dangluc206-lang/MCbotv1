'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Application = require('../../../src/core/Application');
const LifecycleCoordinator = require('../../../src/core/LifecycleCoordinator');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function createRegistry(runtime) {
    return {
        list: () => [runtime],
        require: () => runtime,
        register: value => value
    };
}

test('backend core becomes ready before Discord and Minecraft runtime waits for Discord readiness', async () => {
    const events = [];
    const discordReady = deferred();
    const core = {
        name: 'CoreService',
        async initialize() { events.push('core:init'); },
        async start() { events.push('core:start'); },
        async stop() { events.push('core:stop'); },
        async destroy() { events.push('core:destroy'); }
    };
    const discord = {
        name: 'DiscordService',
        async initialize() { events.push('discord:init'); },
        async start() {
            events.push('discord:start');
            await discordReady.promise;
            events.push('discord:ready');
        },
        async stop() { events.push('discord:stop'); },
        async destroy() { events.push('discord:destroy'); }
    };
    const runtime = {
        botId: 'bot-01',
        async initialize() { events.push('bot:init'); },
        async start() { events.push('bot:start'); },
        async stop() { events.push('bot:stop'); },
        async destroy() { events.push('bot:destroy'); }
    };
    const lifecycle = new LifecycleCoordinator([core]);
    const application = new Application({
        botRegistry: createRegistry(runtime),
        loggerFactory: { create: () => ({ warn() {}, error() {} }) },
        lifecycleCoordinator: lifecycle,
        backendReadyLogger: { info(message) { events.push(`desktop:${message}`); } }
    });
    application.addPreRuntimeService(discord);

    await application.initialize();
    const startPromise = application.start();
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(events.slice(-3), [
        'core:start',
        'desktop:MCbot Desktop backend started.',
        'discord:start'
    ]);
    assert.equal(events.includes('bot:start'), false, 'Minecraft runtime must not start before Discord ClientReady');

    discordReady.resolve();
    await startPromise;
    assert.ok(events.indexOf('desktop:MCbot Desktop backend started.') < events.indexOf('discord:ready'));
    assert.ok(events.indexOf('discord:ready') < events.indexOf('bot:start'));
});

test('shutdown reverses dependency order: bot then Discord then backend core', async () => {
    const events = [];
    const core = {
        name: 'CoreService',
        async initialize() {}, async start() {},
        async stop() { events.push('core:stop'); },
        async destroy() { events.push('core:destroy'); }
    };
    const discord = {
        async initialize() {}, async start() {},
        async stop() { events.push('discord:stop'); },
        async destroy() { events.push('discord:destroy'); }
    };
    const runtime = {
        botId: 'bot-01',
        async initialize() {}, async start() {},
        async stop() { events.push('bot:stop'); },
        async destroy() { events.push('bot:destroy'); }
    };
    const application = new Application({
        botRegistry: createRegistry(runtime),
        loggerFactory: { create: () => ({ warn() {}, error() {} }) },
        lifecycleCoordinator: new LifecycleCoordinator([core])
    });
    application.addPreRuntimeService(discord);
    await application.initialize();
    await application.start();

    await application.stop();
    assert.deepEqual(events.slice(0, 3), ['bot:stop', 'discord:stop', 'core:stop']);

    events.length = 0;
    await application.destroy();
    assert.ok(events.indexOf('bot:destroy') < events.indexOf('discord:destroy'));
    assert.ok(events.indexOf('discord:destroy') < events.indexOf('core:destroy'));
});
