'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const discord = require('discord.js');
const EventBus = require('../../../src/core/EventBus');
const DiscordPanelManager = require('../../../src/discord/panels/DiscordPanelManager');

class FakeChannel {
    constructor(id, name) {
        this.id = id;
        this.name = name;
        this.sent = [];
        this._messages = new Map();
        this.messages = {
            fetch: async arg => {
                if (typeof arg === 'string') {
                    const message = this._messages.get(arg);
                    if (!message) throw new Error('not found');
                    return message;
                }
                return new Map(this._messages);
            }
        };
    }
    isTextBased() { return true; }
    async send(payload) {
        const id = `m${this.sent.length + 1}`;
        const message = {
            id,
            author: { id: 'discord-bot' },
            embeds: payload.embeds.map(embed => embed.toJSON()),
            payload,
            edit: async next => {
                message.payload = next;
                message.embeds = next.embeds.map(embed => embed.toJSON());
                return message;
            }
        };
        this.sent.push(message);
        this._messages.set(id, message);
        return message;
    }
}

function makeRuntime() {
    const eventBus = new EventBus();
    let paused = false;
    let enabled = false;
    let connectCalls = 0;
    const mode = {
        status() {
            return {
                enabled,
                paused,
                phase: enabled ? (paused ? 'PAUSED' : 'COLLECTING') : 'OFF',
                position: { x: 1, y: 64, z: 3 }
            };
        },
        publicConfig() {
            return {
                pickupLocation: { x: 1, y: 64, z: 3 },
                craftLoopDelayMs: 250,
                pollIntervalMs: 15000,
                reanchorRadius: 2.5
            };
        },
        async enable() { enabled = true; paused = false; return { success: true, data: this.status() }; },
        async pause() { paused = true; return { success: true, data: this.status() }; },
        async resume() { paused = false; return { success: true, data: this.status() }; },
        reconfigure() {}
    };
    const bot = {
        heldItem: { displayName: 'Diamond', count: 2 },
        inventory: { slots: { 45: { displayName: 'Shield', count: 1 } } },
        health: 18,
        food: 17,
        entity: { position: { x: 1.25, y: 64, z: 3.75 } }
    };
    const services = {
        eventBus,
        collectorB5Mode: mode,
        connectionManager: { async connect() { connectCalls += 1; } },
        serverFeatureFacade: {
            skyblock: () => ({ join: async () => ({ success: true }) }),
            island: () => ({ goHome: async () => ({ success: true }) })
        }
    };
    return {
        botId: 'bot-01',
        context: { get: () => bot, has: () => true },
        requireService: name => services[name],
        getService: name => services[name] || null,
        get connectCalls() { return connectCalls; }
    };
}

test('auto-renders control/config panels and exposes exactly six requested control buttons', async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-panel-'));
    const control = new FakeChannel('c1', 'bot-control');
    const configChannel = new FakeChannel('c2', 'bot-config');
    const errors = new FakeChannel('c3', 'bot-errors');
    const channels = new Map([[control.id, control], [configChannel.id, configChannel], [errors.id, errors]]);
    const guild = {
        id: 'g1',
        channels: {
            fetch: async () => channels,
            create: async () => { throw new Error('unexpected create'); }
        }
    };
    const runtime = makeRuntime();
    const manager = new DiscordPanelManager({
        config: {
            defaultBotId: 'bot-01',
            panels: {
                enabled: true,
                botId: 'bot-01',
                refreshIntervalMs: 999999,
                storePath: 'data/runtime/discord/panels.json',
                autoCreateChannels: true,
                channels: {
                    control: { name: 'bot-control' },
                    config: { name: 'bot-config' },
                    errors: { name: 'bot-errors' }
                }
            }
        },
        botRegistry: { list: () => [runtime], require: () => runtime, onChange: () => () => {} },
        allowedUserIds: ['100'],
        configuration: {
            service: {},
            registry: {
                require(name) {
                    if (name === 'app') return { diagnostics: { runtimeFailures: { enabled: true, repeatWindowMs: 1000 } } };
                    if (name === 'fishingMode') return { areas: [] };
                    throw new Error(`Unexpected config group: ${name}`);
                }
            }
        },
        environment: {},
        baseDir: temp
    });
    const client = {
        user: { id: 'discord-bot' },
        guilds: { fetch: async () => guild },
        channels: { fetch: async id => channels.get(id) }
    };

    await manager.start({ client, discord, guildId: 'g1' });
    assert.equal(control.sent.length, 1);
    assert.equal(configChannel.sent.length, 1);
    const payload = control.sent[0].payload;
    const labels = payload.components.flatMap(row => row.toJSON().components.map(component => component.label));
    assert.deepEqual(labels, ['Join Server', 'Sky thủ công', 'Mode', 'Dừng', 'Chạy tiếp', 'Về đảo']);
    const embed = payload.embeds[0].toJSON();
    assert.match(embed.fields.find(field => field.name === 'Tay trái').value, /Shield/);
    assert.match(embed.fields.find(field => field.name === 'Tay phải').value, /Diamond/);
    assert.match(embed.fields.find(field => field.name === 'Máu').value, /18\/20/);

    await manager.stop();
    await fs.rm(temp, { recursive: true, force: true });
});
