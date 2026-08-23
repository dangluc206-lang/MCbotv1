'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ReconnectManager = require('../../../src/connection/ReconnectManager');
const EventBus = require('../../../src/core/EventBus');

test('manual suspension blocks all automatic reconnect scheduling until explicitly resumed', async t => {
    const eventBus = new EventBus();
    const context = { has: () => false, getGeneration: () => 0 };
    const reconnect = new ReconnectManager({
        botId: 'bot-01',
        connectionManager: { context, async connect() { throw new Error('should not run'); } },
        context,
        eventBus,
        policy: { enabled: true, baseDelayMs: 60000, maxDelayMs: 60000 }
    });
    await reconnect.initialize();
    await reconnect.start();
    t.after(() => reconnect.destroy());
    reconnect.suspend('operator off');
    assert.equal(reconnect.schedule('server ended'), false);
    assert.equal(reconnect.timer, null);
    reconnect.resume('operator on');
    assert.equal(reconnect.schedule('server ended'), true);
    assert.ok(reconnect.timer);
    reconnect.suspend('operator off again');
    assert.equal(reconnect.timer, null);
});
