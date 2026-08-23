'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventBus = require('../../../src/core/EventBus');
const GuiObservationService = require('../../../src/gui/observation/GuiObservationService');

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

test('GuiObservationService never captures current generation under stale GUI event provenance', async () => {
    const eventBus = new EventBus();
    const session = { id: 'session-2', active: true, connectionGeneration: 2, window: { slots: [] }, source: null };
    let current = session;
    const writes = [];
    const service = new GuiObservationService({
        botId: 'bot-01', eventBus,
        guiManager: { current: () => current },
        normalizer: {
            normalize: observed => ({ sessionId: observed.id }),
            keyFor: () => 'key',
            legacyKeyFor: () => 'key'
        },
        store: { upsert: async (...args) => { writes.push(args); return { changed: true }; } },
        debounceMs: 5,
        logger: { error() {}, debug() {} }
    });
    await service.initialize();

    eventBus.emit('gui:updated', { botId: 'bot-01', connectionGeneration: 1, sessionId: 'session-1' });
    await delay(15);
    assert.equal(writes.length, 0);

    eventBus.emit('gui:updated', { botId: 'bot-01', connectionGeneration: 2, sessionId: 'session-2' });
    await delay(15);
    assert.equal(writes.length, 1);

    current = { id: 'session-3', active: true, connectionGeneration: 3, window: { slots: [] } };
    eventBus.emit('gui:updated', { botId: 'bot-01', connectionGeneration: 2, sessionId: 'session-2' });
    await delay(15);
    assert.equal(writes.length, 1);
    await service.destroy();
});
