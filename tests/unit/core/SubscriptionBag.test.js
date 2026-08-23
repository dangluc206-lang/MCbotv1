'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const SubscriptionBag = require('../../../src/core/events/SubscriptionBag');

test('SubscriptionBag owns listeners and cleanup in reverse order', async () => {
    const emitter = new EventEmitter();
    const bag = new SubscriptionBag();
    const calls = [];
    bag.listen(emitter, 'ping', () => calls.push('event'));
    bag.add(() => calls.push('first'));
    bag.add(() => calls.push('second'));
    emitter.emit('ping');
    assert.equal(bag.size(), 3);
    const failures = await bag.close();
    assert.deepEqual(failures, []);
    emitter.emit('ping');
    assert.deepEqual(calls, ['event', 'second', 'first']);
    assert.equal(bag.size(), 0);
});
