'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const EventBus = require('../../../src/core/EventBus');
const GuiState = require('../../../src/gui/GuiState');
const GuiManager = require('../../../src/gui/GuiManager');

test('GuiManager emits gui:updated from the Mineflayer window updateSlot event', async () => {
    const eventBus = new EventBus();
    const context = { getGeneration: () => 1, get: () => null };
    const manager = new GuiManager({
        botId: 'bot-01',
        context,
        state: new GuiState(),
        detector: { detect: () => ({ id: 'storage' }) },
        clickQueue: { destroy: async () => {} },
        clickGuard: {},
        clickExecutor: {},
        clickVerifier: {},
        eventBus
    });
    const window = new EventEmitter();
    window.title = 'Kho';
    window.type = 'generic';
    window.slots = [null];
    let updates = 0;
    const off = eventBus.on('gui:updated', event => {
        if (event.botId === 'bot-01') updates += 1;
    });

    manager.open(window);
    window.emit('updateSlot', 0, null, { name: 'coal' });
    assert.equal(updates, 1);
    off();
    await manager.stop();
});
