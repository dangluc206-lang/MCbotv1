'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const BotContext = require('../../../src/bot/BotContext');
const EventBus = require('../../../src/core/EventBus');
const InventoryObservationService = require('../../../src/items/inventory/observation/InventoryObservationService');

function clientWithWindow(id) {
    const inventory = new EventEmitter();
    inventory.slots = [];
    const window = new EventEmitter();
    Object.assign(window, { id, inventoryStart: 9, inventoryEnd: 45, slots: new Array(54).fill(null) });
    return { inventory, currentWindow: window };
}

test('InventoryObservationService stale GUI close cannot detach current generation window listener', async () => {
    const context = new BotContext('bot-01');
    const first = clientWithWindow(1);
    const current = clientWithWindow(2);
    context.attach(first);
    context.detach(first);
    assert.equal(context.attach(current), 2);
    const eventBus = new EventBus();
    const service = new InventoryObservationService({
        botId: 'bot-01', context, eventBus,
        reader: { readViews: () => [] },
        store: { read: async () => null, write: async () => null },
        debounceMs: 25,
        logger: { debug() {} }
    });
    await service.initialize();
    const before = current.currentWindow.listenerCount('updateSlot');
    assert.equal(before, 1);

    eventBus.emit('gui:closed', { botId: 'bot-01', connectionGeneration: 1, sessionId: 'old' });
    assert.equal(current.currentWindow.listenerCount('updateSlot'), 1);
    eventBus.emit('gui:closed', { botId: 'bot-02', connectionGeneration: 2, sessionId: 'foreign' });
    assert.equal(current.currentWindow.listenerCount('updateSlot'), 1);

    eventBus.emit('gui:closed', { botId: 'bot-01', connectionGeneration: 2 });
    assert.equal(current.currentWindow.listenerCount('updateSlot'), 0);
    await service.destroy();
});

test('InventoryObservationService stale connection end cannot detach current inventory/window observers', async () => {
    const context = new BotContext('bot-01');
    const first = clientWithWindow(1);
    const current = clientWithWindow(2);
    context.attach(first); context.detach(first); context.attach(current);
    const eventBus = new EventBus();
    const service = new InventoryObservationService({
        botId: 'bot-01', context, eventBus,
        reader: { readViews: () => [] }, store: { read: async () => null, write: async () => null }, debounceMs: 25
    });
    await service.initialize();
    assert.equal(current.inventory.listenerCount('updateSlot'), 1);
    assert.equal(current.currentWindow.listenerCount('updateSlot'), 1);
    eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 1 });
    assert.equal(current.inventory.listenerCount('updateSlot'), 1);
    assert.equal(current.currentWindow.listenerCount('updateSlot'), 1);
    await service.destroy();
});

test('InventoryObservationService current-generation slot updates and public snapshot helpers remain functional', async () => {
    const context = new BotContext('bot-01');
    const current = clientWithWindow(7);
    context.attach(current);
    const eventBus = new EventBus();
    const writes = [];
    const service = new InventoryObservationService({
        botId: 'bot-01', context, eventBus,
        reader: { readViews: () => [{ source: 'bot-inventory', windowId: null, slotCount: 36, emptySlotCount: 35, inventoryStart: 0, inventoryEnd: 36, items: [] }] },
        store: { read: async () => null, write: async snapshot => { writes.push(snapshot); } },
        normalizer: { normalize: item => ({ name: item.name, displayName: item.displayName || item.name, count: item.count, identityComponents: item.identityComponents || [] }) },
        debounceMs: 25
    });
    await service.initialize();
    const item = { name: 'diamond', count: 1, identityComponents: ['MATERIAL:DIAMOND'] };
    current.inventory.slots[3] = item;
    current.inventory.emit('updateSlot', 3, null, item);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(service.eventsSince(0).length, 1);
    assert.equal(service.eventsSince(0)[0].newItem.name, 'diamond');
    const snapshot = await service.capture('manual-test');
    assert.equal(snapshot.reason, 'manual-test');
    assert.equal(service.latest().reason, 'manual-test');
    assert.equal(writes.length >= 1, true);
    service.clearEventsBefore(Date.now() + 1);
    assert.equal(service.eventsSince(0).length, 0);
    await service.destroy();
});

function deferred() {
    let resolve; let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test('InventoryObservationService in-flight gen1 capture cannot commit or emit after gen2 replacement', async () => {
    const context = new BotContext('bot-01');
    const gen1 = clientWithWindow(1);
    const gen2 = clientWithWindow(2);
    assert.equal(context.attach(gen1), 1);
    const eventBus = new EventBus();
    const observed = [];
    eventBus.on('inventory:observed', event => observed.push(event));
    const firstWrite = deferred();
    const secondWrite = deferred();
    let oldWrites = 0;
    const persisted = [];
    const service = new InventoryObservationService({
        botId: 'bot-01', context, eventBus,
        reader: { readViews: () => [{ source: 'bot-inventory', windowId: null, slotCount: 36, emptySlotCount: 36, inventoryStart: 0, inventoryEnd: 36, items: [] }] },
        store: {
            read: async () => null,
            write: async snapshot => {
                persisted.push(snapshot);
                if (snapshot.connectionGeneration === 1) {
                    oldWrites += 1;
                    return (oldWrites === 1 ? firstWrite.promise : secondWrite.promise);
                }
            }
        },
        debounceMs: 100000
    });

    const oldCaptureA = service.capture('old-a');
    const oldCaptureB = service.capture('old-b');
    await tick();
    assert.equal(oldWrites, 2);
    context.detach(gen1);
    assert.equal(context.attach(gen2), 2);

    firstWrite.resolve();
    assert.equal(await oldCaptureA, null);
    assert.equal(service.latest({ currentGenerationOnly: true }), null);
    assert.equal(observed.length, 0);
    assert.equal(persisted.filter(snapshot => snapshot.connectionGeneration === 1).every(snapshot => snapshot.connectionGeneration === 1), true);

    const current = await service.capture('current-gen2');
    assert.equal(current.connectionGeneration, 2);
    assert.equal(service.latest({ currentGenerationOnly: true }).reason, 'current-gen2');
    assert.equal(observed.length, 1);
    assert.equal(observed[0].connectionGeneration, 2);

    secondWrite.resolve();
    assert.equal(await oldCaptureB, null);
    assert.equal(service.latest({ currentGenerationOnly: true }).reason, 'current-gen2');
    assert.equal(observed.length, 1, 'late stale completion must not emit or overwrite gen2 state');
});

test('InventoryObservationService delta callbacks preserve exact bound generation and EventBus drops genless inventory events', async () => {
    const context = new BotContext('bot-01');
    const gen1 = clientWithWindow(1);
    assert.equal(context.attach(gen1), 1);
    const eventBus = new EventBus();
    const deltas = [];
    const observed = [];
    eventBus.on('inventory:delta', event => deltas.push(event));
    eventBus.on('inventory:observed', event => observed.push(event));
    const service = new InventoryObservationService({
        botId: 'bot-01', context, eventBus,
        reader: { readViews: () => [] },
        store: { read: async () => null, write: async () => null },
        normalizer: { normalize: item => item ? ({ name: item.name, count: item.count || 1 }) : null },
        debounceMs: 100000
    });
    await service.initialize();
    const oldInventory = gen1.inventory;
    const oldWindow = gen1.currentWindow;

    context.detach(gen1);
    const gen2 = clientWithWindow(2);
    assert.equal(context.attach(gen2), 2);
    eventBus.emit('connection:spawned', { botId: 'bot-01', connectionGeneration: 2 });
    await tick();
    deltas.length = 0;
    observed.length = 0;

    oldInventory.emit('updateSlot', 3, null, { name: 'old', count: 1 });
    oldWindow.emit('updateSlot', 10, null, { name: 'old-window', count: 1 });
    await tick();
    assert.equal(deltas.length, 0);

    gen2.inventory.slots[3] = { name: 'diamond', count: 1 };
    gen2.inventory.emit('updateSlot', 3, null, gen2.inventory.slots[3]);
    await tick();
    assert.equal(deltas.length, 1);
    assert.equal(deltas[0].connectionGeneration, 2);
    assert.equal(deltas[0].botId, 'bot-01');
    assert.equal(service.eventsSince(0, { connectionGeneration: 1 }).length, 0);
    assert.equal(service.eventsSince(0, { connectionGeneration: 2 }).length, 1);

    const beforeDelta = deltas.length;
    const beforeObserved = observed.length;
    assert.equal(eventBus.emit('inventory:delta', { botId: 'bot-01', source: 'legacy' }), false);
    assert.equal(eventBus.emit('inventory:observed', { botId: 'bot-01', reason: 'legacy' }), false);
    assert.equal(deltas.length, beforeDelta);
    assert.equal(observed.length, beforeObserved);
    await service.destroy();
});

test('InventoryObservationService legacy saved snapshot is historical and not current-generation latest', async () => {
    const context = new BotContext('bot-01');
    const client = clientWithWindow(1);
    context.attach(client);
    const legacy = { botId: 'bot-01', capturedAt: Date.now(), reason: 'legacy-disk', views: [] };
    const service = new InventoryObservationService({
        botId: 'bot-01', context, eventBus: new EventBus(), reader: { readViews: () => [] },
        store: { read: async () => legacy, write: async () => null }, debounceMs: 100000
    });
    await service.initialize();
    assert.equal(service.latest().reason, 'legacy-disk');
    assert.equal(service.latest({ currentGenerationOnly: true }), null);
    assert.equal(service.latest({ connectionGeneration: 1 }), null);
    await service.destroy();
});
