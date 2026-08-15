'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const DiscordService = require('../../../src/discord/DiscordService');

test('registers the guild command, connects and destroys the Discord client', async () => {
    const calls = [];
    let clientInstance = null;

    class FakeREST {
        constructor(options) { calls.push(['rest:new', options]); }
        setToken(token) { calls.push(['rest:token', token]); return this; }
        async put(route, payload) { calls.push(['rest:put', route, payload]); }
    }

    class FakeClient extends EventEmitter {
        constructor(options) {
            super();
            this.options = options;
            this.destroyed = false;
            clientInstance = this;
        }
        async login(token) {
            calls.push(['client:login', token]);
            queueMicrotask(() => this.emit('ready', { user: { id: 'discord-bot' } }));
            return token;
        }
        destroy() { this.destroyed = true; }
    }

    const discord = {
        REST: FakeREST,
        Client: FakeClient,
        Routes: {
            applicationGuildCommands: (applicationId, guildId) => `guild:${applicationId}:${guildId}`,
            applicationCommands: applicationId => `global:${applicationId}`
        },
        ApplicationCommandOptionType: { String: 3 },
        GatewayIntentBits: { Guilds: 1 },
        Events: { InteractionCreate: 'interactionCreate', ClientReady: 'ready', Error: 'error' }
    };
    const command = {
        definition: type => ({ name: 'gui', optionType: type }),
        execute: async () => true
    };
    const service = new DiscordService({
        discord,
        command,
        environment: {
            DISCORD_TOKEN: 'test-token',
            DISCORD_APPLICATION_ID: 'app-id',
            DISCORD_GUILD_ID: 'guild-id'
        },
        config: {
            enabled: true,
            tokenEnv: 'DISCORD_TOKEN',
            applicationIdEnv: 'DISCORD_APPLICATION_ID',
            guildIdEnv: 'DISCORD_GUILD_ID',
            readyTimeoutMs: 100,
            commandName: 'gui'
        }
    });

    await service.initialize();
    await service.start();

    assert.equal(calls.some(call => call[0] === 'rest:put' && call[1] === 'guild:app-id:guild-id'), true);
    assert.equal(calls.some(call => call[0] === 'client:login'), true);
    assert.equal(clientInstance.listenerCount('interactionCreate'), 1);

    await service.destroy();
    assert.equal(clientInstance.destroyed, true);
    assert.equal(clientInstance.listenerCount('interactionCreate'), 0);
});

test('does not load discord.js when disabled', async () => {
    const service = new DiscordService({
        command: {},
        config: { enabled: false }
    });
    await service.initialize();
    await service.start();
    await service.destroy();
});
