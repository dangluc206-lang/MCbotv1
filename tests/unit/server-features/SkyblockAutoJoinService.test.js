'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventBus = require('../../../src/core/EventBus');
const SkyblockAutoJoinService = require('../../../src/server-features/skyblock/SkyblockAutoJoinService');

function waitFor(predicate, timeoutMs = 500) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const timer = setInterval(() => {
            if (predicate()) {
                clearInterval(timer);
                resolve();
                return;
            }
            if (Date.now() - startedAt >= timeoutMs) {
                clearInterval(timer);
                reject(new Error('Timed out waiting for condition'));
            }
        }, 2);
    });
}

test('login success replaces spawn fallback and runs once', async () => {
    const eventBus = new EventBus();
    const calls = [];
    const service = new SkyblockAutoJoinService({
        botId: 'bot-01', eventBus,
        skyblock: { async join(selectionId) { calls.push(selectionId); return { success: true, data: {} }; } },
        config: { enabled: true, selection: 'primary', delayMs: 0, spawnFallbackDelayMs: 100, maxAttempts: 1, retryDelayMs: 0 }
    });
    await service.initialize();
    eventBus.emit('connection:spawned', { botId: 'bot-01', connectionGeneration: 1 });
    eventBus.emit('server-login:succeeded', { botId: 'bot-01', connectionGeneration: 1 });
    await waitFor(() => calls.length === 1);
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.deepEqual(calls, ['primary']);
    await service.destroy();
});

test('spawn fallback runs when no server-login event arrives', async () => {
    const eventBus = new EventBus();
    let calls = 0;
    const service = new SkyblockAutoJoinService({
        botId: 'bot-01', eventBus,
        skyblock: { async join() { calls += 1; return { success: true, data: {} }; } },
        config: { enabled: true, delayMs: 0, spawnFallbackDelayMs: 0, maxAttempts: 1, retryDelayMs: 0 }
    });
    await service.initialize();
    eventBus.emit('connection:spawned', { botId: 'bot-01', connectionGeneration: 2 });
    await waitFor(() => calls === 1);
    await service.destroy();
});

test('server-login failure cancels pending spawn fallback', async () => {
    const eventBus = new EventBus();
    let calls = 0;
    const service = new SkyblockAutoJoinService({
        botId: 'bot-01', eventBus,
        skyblock: { async join() { calls += 1; return { success: true, data: {} }; } },
        config: { enabled: true, spawnFallbackDelayMs: 30, maxAttempts: 1, retryDelayMs: 0 }
    });
    await service.initialize();
    eventBus.emit('connection:spawned', { botId: 'bot-01', connectionGeneration: 3 });
    eventBus.emit('server-login:failed', { botId: 'bot-01', connectionGeneration: 3, error: new Error('bad login') });
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(calls, 0);
    await service.destroy();
});

test('waits for resource pack readiness when configured', async () => {
    const eventBus = new EventBus();
    let calls = 0;
    const service = new SkyblockAutoJoinService({
        botId: 'bot-01', eventBus,
        skyblock: { async join() { calls += 1; return { success: true, data: {} }; } },
        config: {
            enabled: true,
            delayMs: 0,
            spawnFallbackDelayMs: 0,
            maxAttempts: 1,
            retryDelayMs: 0,
            waitForResourcePack: true
        }
    });
    await service.initialize();
    eventBus.emit('connection:spawned', { botId: 'bot-01', connectionGeneration: 9 });
    eventBus.emit('server-login:succeeded', { botId: 'bot-01', connectionGeneration: 9 });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls, 0);

    eventBus.emit('resource-pack:ready', { botId: 'bot-01', connectionGeneration: 9 });
    await waitFor(() => calls === 1);
    await service.destroy();
});
