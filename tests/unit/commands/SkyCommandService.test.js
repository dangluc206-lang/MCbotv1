'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const SkyCommandRegistry = require('../../../src/commands/sky/SkyCommandRegistry');
const SkyCommandService = require('../../../src/commands/sky/SkyCommandService');

const CONFIG = {
    sky1: {
        d: { command: '/d', label: 'Dungeon', description: '', enabled: true },
        autofarm: { command: '/autofarm {mode}', label: 'Auto Farm', description: '', enabled: true },
        off: { command: '/spawn', label: 'Off', description: '', enabled: false }
    },
    sky2: {
        spawn: { command: '/spawn', label: 'Spawn', description: '', enabled: true }
    }
};

test('SkyCommandRegistry keeps commands isolated per Sky and supports hot replacement', () => {
    const registry = new SkyCommandRegistry(CONFIG);
    assert.equal(registry.require('sky1', 'd').command, '/d');
    assert.equal(registry.get('sky2', 'd'), null);
    assert.deepEqual(registry.list('sky1', { enabledOnly: true }).map(entry => entry.id), ['autofarm', 'd']);
    registry.replace({ sky3: { warp: { command: '/warp mine', enabled: true } } });
    assert.equal(registry.get('sky1', 'd'), null);
    assert.equal(registry.require('sky3', 'warp').command, '/warp mine');
});

test('SkyCommandRegistry rejects credential and multiline commands', () => {
    assert.throws(() => new SkyCommandRegistry({ sky1: { login: { command: '/login secret' } } }), /authentication|password/);
    assert.throws(() => new SkyCommandRegistry({ sky1: { multi: { command: '/d\n/spawn' } } }), /one line/);
});

test('SkyCommandService sends only while bot is ready in the matching Sky', async () => {
    const calls = [];
    const state = { location: 'SKY', selection: 'sky1', ready: true };
    const service = new SkyCommandService({
        botId: 'bot-01',
        context: { getGeneration: () => 7 },
        slashCommandService: { async send(command, options) { calls.push({ command, options }); return { command }; } },
        skyblockReadiness: { status: () => ({ ...state }) },
        config: CONFIG
    });

    const ok = await service.send('autofarm', { args: { mode: 'on' }, expectedGeneration: 7 });
    assert.equal(ok.success, true);
    assert.equal(calls[0].command, '/autofarm on');
    assert.equal(calls[0].options.expectedGeneration, 7);

    state.location = 'HUB'; state.ready = false;
    const hub = await service.send('d');
    assert.equal(hub.success, false);
    assert.equal(hub.status, 'NOT_READY');
    assert.equal(calls.length, 1);

    state.location = 'SKY'; state.ready = true; state.selection = 'sky2';
    const wrong = await service.send('d', { skyId: 'sky1' });
    assert.equal(wrong.success, false);
    assert.equal(calls.length, 1);
});

test('SkyCommandService reconfigure applies new registrations without restart', async () => {
    const calls = [];
    const service = new SkyCommandService({
        botId: 'bot-01', context: {},
        slashCommandService: { async send(command) { calls.push(command); return { command }; } },
        skyblockReadiness: { status: () => ({ location: 'SKY', selection: 'sky1', ready: true }) },
        config: { sky1: {} }
    });
    service.reconfigure({ sky1: { warp: { command: '/warp mine', enabled: true } } });
    const result = await service.send('warp');
    assert.equal(result.success, true);
    assert.deepEqual(calls, ['/warp mine']);
});

test('SkyCommandService preserves BOT_NOT_READY status from SlashCommandService', async () => {
    const error = Object.assign(new Error('Bot is not connected.'), { code: 'BOT_NOT_READY' });
    const service = new SkyCommandService({
        botId: 'bot-01',
        context: {},
        slashCommandService: { async send() { throw error; } },
        skyblockReadiness: { status: () => ({ location: 'SKY', selection: 'sky1', ready: true }) },
        config: CONFIG
    });

    const result = await service.send('d');
    assert.equal(result.success, false);
    assert.equal(result.status, 'NOT_READY');
    assert.equal(result.error?.code, 'BOT_NOT_READY');
});
