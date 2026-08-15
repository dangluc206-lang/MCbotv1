'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const EventBus = require('../../../../src/core/EventBus');
const ResourcePackAutoAcceptService = require('../../../../src/server-features/resource-pack/ResourcePackAutoAcceptService');

function createContext(client, generation = 1) {
    return {
        get: () => client,
        has: () => Boolean(client),
        getGeneration: () => generation
    };
}

test('accepts resource pack immediately and emits ready', async () => {
    const eventBus = new EventBus();
    const client = new EventEmitter();
    let accepted = 0;
    let ready = 0;
    client.acceptResourcePack = () => { accepted += 1; };
    const service = new ResourcePackAutoAcceptService({
        botId: 'bot-01',
        context: createContext(client, 7),
        eventBus,
        config: { enabled: true, autoAccept: true }
    });
    eventBus.on('resource-pack:ready', event => {
        if (event.botId === 'bot-01' && event.connectionGeneration === 7) ready += 1;
    });

    await service.initialize();
    eventBus.emit('connection:client-attached', { botId: 'bot-01', connectionGeneration: 7 });
    client.emit('resourcePack', 'https://example.invalid/pack.zip', 'hash');

    assert.equal(accepted, 1);
    assert.equal(ready, 1);
    await service.destroy();
});

test('cleans listener on connection end', async () => {
    const eventBus = new EventBus();
    const client = new EventEmitter();
    let accepted = 0;
    client.acceptResourcePack = () => { accepted += 1; };
    const service = new ResourcePackAutoAcceptService({
        botId: 'bot-01',
        context: createContext(client, 3),
        eventBus
    });

    await service.initialize();
    eventBus.emit('connection:client-attached', { botId: 'bot-01', connectionGeneration: 3 });
    eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 3 });
    client.emit('resourcePack', 'https://example.invalid/pack.zip', 'hash');

    assert.equal(accepted, 0);
    await service.destroy();
});
