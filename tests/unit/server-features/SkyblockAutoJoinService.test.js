'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventBus = require('../../../src/core/EventBus');
const BotContext = require('../../../src/bot/BotContext');
const SkyblockGateway = require('../../../src/server-features/skyblock/SkyblockAutoJoinService');

function waitFor(predicate, timeoutMs = 500) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const timer = setInterval(() => {
            if (predicate()) { clearInterval(timer); resolve(); return; }
            if (Date.now() - startedAt >= timeoutMs) { clearInterval(timer); reject(new Error('Timed out waiting for condition')); }
        }, 2);
    });
}

function create({ context = null, join = async () => ({ success: true, data: {} }), config = {} } = {}) {
    const eventBus = new EventBus();
    const calls = [];
    const service = new SkyblockGateway({
        botId: 'bot-01', context, eventBus,
        skyblock: { async join(target, options) { calls.push({ target, options }); return join(target, options, calls.length); } },
        config: {
            selection: 'sky1', delayMs: 0, spawnFallbackDelayMs: 0,
            retryDelayMs: 2, rejoinDelayMs: 2, recoveryPollMs: 1000,
            waitForResourcePack: false, ...config
        }
    });
    return { eventBus, calls, service };
}

async function destroy(service) { await service.destroy(); }

test('HUB login/spawn never enters Sky when no mode owns a target demand', async () => {
    const { eventBus, calls, service } = create();
    await service.initialize();
    eventBus.emit('connection:spawned', { botId: 'bot-01', connectionGeneration: 1 });
    eventBus.emit('server-login:succeeded', { botId: 'bot-01', connectionGeneration: 1 });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls.length, 0);
    assert.equal(service.status().target, null);
    assert.equal(service.status().location, 'HUB');
    await destroy(service);
});

test('mode demand enters its configured target and marks only that target ready', async () => {
    const { eventBus, calls, service } = create();
    await service.initialize();
    service.requireTarget('sky1', { owner: 'b5-craft' });
    eventBus.emit('connection:spawned', { botId: 'bot-01', connectionGeneration: 2 });
    await waitFor(() => calls.length === 1);
    assert.equal(calls[0].target, 'sky1');
    assert.equal(service.isGenerationReady(2, 'sky1'), true);
    assert.equal(service.isGenerationReady(2, 'sky2'), false);
    await destroy(service);
});

test('target is profile/mode data, so sky2 or skyOP is not forced through sky1', async () => {
    const { eventBus, calls, service } = create();
    await service.initialize();
    service.requireTarget('skyOP', { owner: 'b5-craft' });
    eventBus.emit('server-login:disabled', { botId: 'bot-01', connectionGeneration: 3 });
    await waitFor(() => calls.length === 1);
    assert.equal(calls[0].target, 'skyOP');
    assert.equal(service.status().readyTarget, 'skyOP');
    await destroy(service);
});

test('two concurrent primary modes cannot demand different Sky targets', async () => {
    const { service } = create();
    await service.initialize();
    service.requireTarget('sky1', { owner: 'mode-a' });
    assert.throws(() => service.requireTarget('sky2', { owner: 'mode-b' }), error => error?.code === 'SKY_TARGET_CONFLICT');
    assert.deepEqual(service.status().demandOwners, { 'mode-a': 'sky1' });
    await destroy(service);
});

test('releasing the final mode demand cancels a pending join', async () => {
    const { eventBus, calls, service } = create({ config: { spawnFallbackDelayMs: 40 } });
    await service.initialize();
    service.requireTarget('sky1', { owner: 'collector-b5' });
    eventBus.emit('connection:spawned', { botId: 'bot-01', connectionGeneration: 4 });
    assert.equal(service.status().pending?.target, 'sky1');
    service.releaseTarget('collector-b5');
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(calls.length, 0);
    assert.equal(service.status().pending, null);
    await destroy(service);
});

test('join failure retries without a max-attempt limit while demand remains', async () => {
    const events = [];
    const { eventBus, calls, service } = create({
        join: async (_target, _options, attempt) => attempt < 4 ? { success: false, message: 'restarting' } : { success: true, data: {} }
    });
    eventBus.on('skyblock:gateway:failed', event => events.push(event));
    await service.initialize();
    service.requireTarget('sky1', { owner: 'b5-craft' });
    eventBus.emit('connection:spawned', { botId: 'bot-01', connectionGeneration: 5 });
    await waitFor(() => calls.length === 4, 800);
    assert.equal(service.isGenerationReady(5, 'sky1'), true);
    assert.equal(events.length, 3);
    assert.equal(events.every(event => event.final === false), true);
    assert.deepEqual(events.map(event => event.attempt), [1, 2, 3]);
    await destroy(service);
});

test('returning from Sky to HUB on the same generation re-enters the demanded target', async () => {
    const { eventBus, calls, service } = create();
    await service.initialize();
    service.requireTarget('sky2', { owner: 'b5-craft' });
    eventBus.emit('connection:spawned', { botId: 'bot-01', connectionGeneration: 6 });
    await waitFor(() => calls.length === 1);
    assert.equal(service.isGenerationReady(6, 'sky2'), true);
    eventBus.emit('connection:login', { botId: 'bot-01', connectionGeneration: 6 });
    assert.equal(service.isGenerationReady(6, 'sky2'), false);
    await waitFor(() => calls.length === 2);
    assert.equal(calls[1].target, 'sky2');
    assert.equal(service.isGenerationReady(6, 'sky2'), true);
    await destroy(service);
});

test('resource-pack gating delays demanded join but does not create an Auto Join toggle', async () => {
    const { eventBus, calls, service } = create({ config: { waitForResourcePack: true } });
    await service.initialize();
    service.requireTarget('sky1', { owner: 'fishing' });
    eventBus.emit('connection:spawned', { botId: 'bot-01', connectionGeneration: 7 });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls.length, 0);
    eventBus.emit('resource-pack:ready', { botId: 'bot-01', connectionGeneration: 7 });
    await waitFor(() => calls.length === 1);
    assert.equal('enabled' in service.status().config, false);
    assert.equal('maxAttempts' in service.status().config, false);
    await destroy(service);
});

test('stale generation events cannot satisfy or cancel a newer demanded target', async () => {
    const context = new BotContext('bot-01');
    const first = {}; const second = {};
    context.attach(first); context.detach(first); assert.equal(context.attach(second), 2);
    const { eventBus, calls, service } = create({ context, config: { waitForResourcePack: true } });
    await service.initialize();
    service.requireTarget('sky1', { owner: 'collector-b5' });
    eventBus.emit('connection:spawned', { botId: 'bot-01', connectionGeneration: 2 });
    eventBus.emit('resource-pack:ready', { botId: 'bot-01', connectionGeneration: 1 });
    eventBus.emit('server-login:failed', { botId: 'bot-01', connectionGeneration: 1 });
    eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 1 });
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(calls.length, 0);
    eventBus.emit('resource-pack:ready', { botId: 'bot-01', connectionGeneration: 2 });
    await waitFor(() => calls.length === 1);
    assert.equal(calls[0].options.expectedGeneration, 2);
    await destroy(service);
});

test('manual HUB hold suppresses mode rejoin until a managed join is explicitly requested', async () => {
    const context = new BotContext('bot-01'); context.attach({});
    const { eventBus, calls, service } = create({ context });
    await service.initialize();
    service.requireTarget('sky1', { owner: 'b5-craft' });
    eventBus.emit('connection:spawned', { botId: 'bot-01', connectionGeneration: 1 });
    await waitFor(() => calls.length === 1);
    service.holdAtHub({ reason: 'operator' });
    eventBus.emit('connection:login', { botId: 'bot-01', connectionGeneration: 1 });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls.length, 1);
    service.requestJoinNow({ target: 'sky1', trigger: 'operator' });
    await waitFor(() => calls.length === 2);
    assert.equal(service.status().ready, true);
    await destroy(service);
});

test('mode demand survives disconnect and applies to the next connection generation', async () => {
    const context = new BotContext('bot-01');
    const first = {}; const second = {};
    context.attach(first);
    const { eventBus, calls, service } = create({ context });
    await service.initialize();
    service.requireTarget('sky2', { owner: 'collector-b5' });
    eventBus.emit('connection:spawned', { botId: 'bot-01', connectionGeneration: 1 });
    await waitFor(() => calls.length === 1);
    eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 1 });
    context.detach(first); context.attach(second);
    eventBus.emit('connection:spawned', { botId: 'bot-01', connectionGeneration: 2 });
    await waitFor(() => calls.length === 2);
    assert.equal(calls[1].target, 'sky2');
    assert.equal(service.isGenerationReady(2, 'sky2'), true);
    await destroy(service);
});
