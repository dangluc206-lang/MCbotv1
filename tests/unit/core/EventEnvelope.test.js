'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createEventEnvelope,
    normalizeConnectionGeneration
} = require('../../../src/core/events/EventEnvelope');

test('EventEnvelope creates deterministic detached canonical connection metadata', () => {
    let sequence = 0;
    const payload = {
        botId: 'bot-01',
        generation: 7,
        operationId: 'op-1',
        correlationId: 'corr-1',
        position: { x: 1, y: 2, z: 3 },
        nested: { value: 'before' },
        failureId: 'failure-1'
    };
    const event = createEventEnvelope('movement:teleport', payload, {
        scope: 'connection',
        clock: () => 1234,
        idFactory: () => `event-${++sequence}`
    });

    assert.equal(event.eventId, 'event-1');
    assert.equal(event.eventType, 'movement:teleport');
    assert.equal(event.emittedAt, 1234);
    assert.equal(event.botId, 'bot-01');
    assert.equal(event.connectionGeneration, 7);
    assert.equal(event.operationId, 'op-1');
    assert.equal(event.correlationId, 'corr-1');
    assert.equal(event.failureId, 'failure-1');
    assert.equal(Object.hasOwn(event, 'generation'), false);
    assert.deepEqual(event.position, { x: 1, y: 2, z: 3 });
    assert.equal(Object.isFrozen(event), true);
    assert.equal(Object.isFrozen(event.nested), true);

    payload.nested.value = 'after';
    payload.position.x = 99;
    assert.equal(event.nested.value, 'before');
    assert.equal(event.position.x, 1);
});

test('EventEnvelope generates a unique eventId per emit', () => {
    let sequence = 0;
    const options = { clock: () => 1, idFactory: () => `id-${++sequence}` };
    const first = createEventEnvelope('mode:test', { botId: 'bot-01' }, options);
    const second = createEventEnvelope('mode:test', { botId: 'bot-01' }, options);
    assert.notEqual(first.eventId, second.eventId);
});

test('connection-scoped EventEnvelope rejects missing or invalid generation', () => {
    assert.throws(() => createEventEnvelope('connection:spawned', { botId: 'bot-01' }, { scope: 'connection' }), /connectionGeneration/);
    assert.throws(() => createEventEnvelope('connection:spawned', { botId: 'bot-01', connectionGeneration: 0 }, { scope: 'connection' }), /connectionGeneration/);
});

test('bot-scoped EventEnvelope keeps a null generation instead of inventing one', () => {
    const event = createEventEnvelope('mode:test', { botId: 'bot-01', value: 1 }, { scope: 'bot' });
    assert.equal(event.connectionGeneration, null);
});

test('EventEnvelope never exposes raw client/window/packet references', () => {
    const raw = { marker: 'raw' };
    const event = createEventEnvelope('diagnostic:test', {
        botId: 'bot-01',
        client: raw,
        _client: raw,
        bot: raw,
        window: raw,
        packet: raw,
        details: { ok: true }
    });
    for (const key of ['client', '_client', 'bot', 'window', 'packet']) assert.equal(Object.hasOwn(event, key), false);
    assert.deepEqual(event.details, { ok: true });
});

test('legacy generation is accepted only by the normalizer boundary', () => {
    assert.equal(normalizeConnectionGeneration({ connectionGeneration: 8, generation: 2 }), 8);
    assert.equal(normalizeConnectionGeneration({ generation: 6 }), 6);
    assert.equal(normalizeConnectionGeneration({}), null);
    assert.equal(normalizeConnectionGeneration({ generation: 0 }), null);
});

test('EventEnvelope detaches cyclic Error metadata without exposing mutable references', () => {
    const error = new Error('cycle');
    error.code = 'CYCLIC_ERROR';
    error.details = { label: 'safe' };
    error.details.error = error;
    const event = createEventEnvelope('diagnostic:error', { botId: 'bot-01', error });
    assert.equal(event.error.code, 'CYCLIC_ERROR');
    assert.equal(event.error.details.label, 'safe');
    assert.equal(event.error.details.error, event.error);
    error.details.label = 'mutated';
    assert.equal(event.error.details.label, 'safe');
});
