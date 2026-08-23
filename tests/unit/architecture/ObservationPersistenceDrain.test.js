'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const GuiKnowledgeRegistry = require('../../../src/gui/knowledge/GuiKnowledgeRegistry');
const GuiObservationService = require('../../../src/gui/observation/GuiObservationService');
const InventoryObservationService = require('../../../src/items/inventory/observation/InventoryObservationService');

function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
}

test('GuiKnowledgeRegistry stop waits for the observation store drain', async () => {
    const gate = deferred();
    let drainStarted = false;
    const registry = new GuiKnowledgeRegistry({
        botId: 'bot-01',
        normalizer: {},
        store: { drain: async () => { drainStarted = true; await gate.promise; } },
        itemResolver: null
    });
    let stopped = false;
    const stopping = registry.stop().then(() => { stopped = true; });
    await Promise.resolve();
    assert.equal(drainStarted, true);
    assert.equal(stopped, false);
    gate.resolve();
    await stopping;
    assert.equal(stopped, true);
});

test('GuiObservationService direct-store stop waits for pending persistence drain', async () => {
    const gate = deferred();
    const service = new GuiObservationService({
        botId: 'bot-01',
        eventBus: { on: () => () => {} },
        guiManager: { current: () => null },
        normalizer: {},
        store: { drain: () => gate.promise },
        debounceMs: 0
    });
    let stopped = false;
    const stopping = service.stop().then(() => { stopped = true; });
    await Promise.resolve();
    assert.equal(stopped, false);
    gate.resolve();
    await stopping;
    assert.equal(stopped, true);
});

test('InventoryObservationService stop waits for pending store writes after detaching listeners', async () => {
    const gate = deferred();
    let drained = false;
    const service = new InventoryObservationService({
        botId: 'bot-01',
        context: { get: () => null, getGeneration: () => 0 },
        eventBus: null,
        reader: { readViews: () => [] },
        store: { drain: async () => { await gate.promise; drained = true; }, read: async () => null },
        debounceMs: 25
    });
    let stopped = false;
    const stopping = service.stop().then(() => { stopped = true; });
    await Promise.resolve();
    assert.equal(stopped, false);
    assert.equal(service.timer, null);
    gate.resolve();
    await stopping;
    assert.equal(drained, true);
    assert.equal(stopped, true);
});
