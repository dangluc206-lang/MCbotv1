'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const EventBus = require('../../../src/core/EventBus');

test('EventBus supports runtime registration of generation-safe connection scoped events', () => {
    const bus = new EventBus();
    bus.registerEventScope('mode:mining:block-found', 'connection');
    let event = null;
    bus.on('mode:mining:block-found', value => { event = value; });
    assert.equal(bus.emit('mode:mining:block-found', { botId: 'bot-01', connectionGeneration: 4, block: 'diamond_ore' }), true);
    assert.equal(event.connectionGeneration, 4);
    assert.equal(event.block, 'diamond_ore');
    assert.equal(bus.emit('mode:mining:block-found', { botId: 'bot-01', block: 'diamond_ore' }), false);
    assert.equal(bus.scopeSnapshot().connectionScopedEvents.includes('mode:mining:block-found'), true);
});
