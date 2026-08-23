'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const DiscordService = require('../../../src/discord/DiscordService');
const DiscordPanelManager = require('../../../src/discord/panels/DiscordPanelManager');

function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
}

function fakeDiscord(onClient) {
    class FakeREST {
        setToken() { return this; }
        async put() {}
    }
    class FakeClient extends EventEmitter {
        constructor() { super(); this.destroyed = false; onClient(this); }
        async login() { queueMicrotask(() => this.emit('ready', { user: { id: 'bot' } })); }
        destroy() { this.destroyed = true; }
    }
    return {
        REST: FakeREST,
        Client: FakeClient,
        Routes: { applicationCommands: id => `global:${id}`, applicationGuildCommands: (id, guild) => `guild:${id}:${guild}` },
        ApplicationCommandOptionType: { String: 3 },
        GatewayIntentBits: { Guilds: 1 },
        Events: { InteractionCreate: 'interactionCreate', ClientReady: 'ready', Error: 'error' }
    };
}

test('DiscordService stop drains an interaction accepted before listener removal before destroying client', async () => {
    const gate = deferred();
    let client;
    let started = false;
    const discord = fakeDiscord(value => { client = value; });
    const command = {
        definition: () => ({ name: 'drain-test' }),
        async execute() { started = true; await gate.promise; return true; }
    };
    const service = new DiscordService({
        discord,
        command,
        config: {
            enabled: true,
            tokenEnv: 'TOKEN',
            applicationIdEnv: 'APP_ID',
            readyTimeoutMs: 100,
            shutdownDrainMs: 1000
        },
        environment: { TOKEN: 'token', APP_ID: 'app' }
    });
    await service.start();
    client.emit('interactionCreate', { id: 'interaction-1' });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(started, true);

    let stopped = false;
    const stopping = service.stop().then(() => { stopped = true; });
    await Promise.resolve();
    assert.equal(client.listenerCount('interactionCreate'), 0, 'new interactions must be blocked before drain');
    assert.equal(client.destroyed, false, 'client must stay alive while accepted interaction drains');
    assert.equal(stopped, false);
    gate.resolve();
    await stopping;
    assert.equal(client.destroyed, true);
    assert.equal(stopped, true);
});

test('DiscordPanelManager stop waits for in-flight refresh, panel persistence and admin queue drains', async () => {
    const refreshGate = deferred();
    const order = [];
    const manager = Object.create(DiscordPanelManager.prototype);
    Object.assign(manager, {
        refreshTimer: null,
        refreshRunning: false,
        refreshPromise: null,
        remoteOnly: true,
        refreshControl: async () => { order.push('refresh'); await refreshGate.promise; },
        errorReporter: { async stop() { order.push('error-reporter'); } },
        store: { async drain() { order.push('panel-store'); } },
        botProfileAdmin: { async drain() { order.push('admin-store'); } },
        messages: { x: 1 }, channels: { x: 1 }, lastDigests: { x: 1 },
        client: {}, guild: {}, logger: null
    });

    const refreshing = manager.refreshAll(true);
    await Promise.resolve();
    let stopped = false;
    const stopping = manager.stop().then(() => { stopped = true; });
    await Promise.resolve();
    assert.equal(stopped, false);
    assert.deepEqual(order, ['refresh']);
    refreshGate.resolve();
    await Promise.all([refreshing, stopping]);
    assert.deepEqual(order, ['refresh', 'error-reporter', 'panel-store', 'admin-store']);
    assert.equal(manager.client, null);
    assert.equal(manager.guild, null);
});
