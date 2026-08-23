'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventBus = require('../../../src/core/EventBus');
const { scopeFor } = require('../../../src/core/events/EventScopeRegistry');


test('runtime EventBus fail-closes malformed connection-scoped events before fan-out', () => {
    const bus = new EventBus();
    const seen = [];
    bus.on('connection:ended', event => seen.push(event));

    assert.equal(bus.emit('connection:ended', { botId: 'bot-01' }), false);
    assert.equal(bus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 0 }), false);
    assert.equal(bus.emit('connection:ended', { connectionGeneration: 2 }), false);
    assert.equal(seen.length, 0);

    assert.equal(bus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 2 }), true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].connectionGeneration, 2);

    assert.equal(bus.emit('connection:ended', { botId: 'bot-01', synthetic: true }, { scope: 'bot' }), true);
    assert.equal(seen.length, 2);
    assert.equal(seen[1].connectionGeneration, null);
    assert.equal(bus.emit('gui:closed', { botId: 'bot-01' }, { scope: 'bot' }), false, 'undeclared scope override is rejected');
});

test('runtime EventBus enforces connection scope even with a custom eventFactory', () => {
    let factoryCalls = 0;
    const bus = new EventBus({
        eventFactory(eventType, payload, options) {
            factoryCalls += 1;
            return Object.freeze({ eventType, ...payload, scopeSeen: options.scope });
        }
    });
    let deliveries = 0;
    bus.on('gui:closed', () => { deliveries += 1; });

    assert.equal(bus.emit('gui:closed', { botId: 'bot-01' }), false);
    assert.equal(factoryCalls, 0);
    assert.equal(deliveries, 0);

    assert.equal(bus.emit('gui:closed', { botId: 'bot-01', connectionGeneration: 3, sessionId: 'gui-1' }), true);
    assert.equal(factoryCalls, 1);
    assert.equal(deliveries, 1);
});

test('event scope registry is an explicit allowlist rather than a connection prefix rule', () => {
    assert.equal(scopeFor('connection:ended'), 'connection');
    assert.equal(scopeFor('gui:closed'), 'connection');
    assert.equal(scopeFor('connection:connecting'), 'bot');
    assert.equal(scopeFor('connection:disabled'), 'bot');
    assert.equal(scopeFor('connection:made-up-legacy-event'), 'bot');
});

test('EventBus uses a finite listener bound suitable for the permanent runtime architecture', () => {
    const bus = new EventBus();
    assert.equal(bus.emitter.getMaxListeners(), 64);
    for (let index = 0; index < 24; index += 1) bus.on('connection:ended', () => {});
    assert.equal(bus.listenerCount('connection:ended'), 24);
    assert.equal(Number.isFinite(bus.emitter.getMaxListeners()), true);
    assert.ok(bus.emitter.getMaxListeners() >= 24);
});

test('connection-scoped EventBus rejects every non-plain payload before eventFactory and fan-out', () => {
    let factoryCalls = 0;
    const bus = new EventBus({
        eventFactory(eventType, payload, options) {
            factoryCalls += 1;
            return Object.freeze({ eventType, ...payload, scopeSeen: options.scope });
        }
    });
    let delivered = 0;
    bus.on('connection:ended', () => { delivered += 1; });

    for (const payload of [null, undefined, 'x', 42, true, [], () => {}]) {
        assert.equal(bus.emit('connection:ended', payload), false);
    }
    assert.equal(factoryCalls, 0);
    assert.equal(delivered, 0);

    assert.equal(bus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 2 }), true);
    assert.equal(factoryCalls, 1);
    assert.equal(delivered, 1);
});

test('connection-scoped EventBus requires canonical botId and positive integer connectionGeneration', () => {
    const bus = new EventBus();
    let delivered = 0;
    bus.on('command:message', () => { delivered += 1; });
    const invalid = [
        { botId: '', connectionGeneration: 1, message: 'x' },
        { botId: 'bot-01', connectionGeneration: 0, message: 'x' },
        { botId: 'bot-01', connectionGeneration: -1, message: 'x' },
        { botId: 'bot-01', connectionGeneration: Number.NaN, message: 'x' },
        { botId: 'bot-01', connectionGeneration: '1', message: 'x' },
        { botId: 'bot-01', connectionGeneration: null, message: 'x' },
        { botId: 'bot-01', generation: 1, message: 'legacy-alias' }
    ];
    for (const payload of invalid) assert.equal(bus.emit('command:message', payload), false);
    assert.equal(delivered, 0);
    assert.equal(bus.emit('command:message', { botId: 'bot-01', connectionGeneration: 1, message: 'ok' }), true);
    assert.equal(delivered, 1);
});

test('scope registry classifies command, inventory and fishing catch events as connection-owned', () => {
    for (const eventName of ['command:message', 'inventory:observed', 'inventory:delta', 'mode:fishing:catch']) {
        assert.equal(scopeFor(eventName), 'connection', eventName);
    }
});
