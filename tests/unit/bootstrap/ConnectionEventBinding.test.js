'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const BotContext = require('../../../src/bot/BotContext');
const createConnectionEventBinding = require('../../../src/bootstrap/createConnectionEventBinding');

class RawEventBus {
    constructor() { this.emitter = new EventEmitter(); }
    on(name, listener) { this.emitter.on(name, listener); return () => this.emitter.off(name, listener); }
    emit(name, event) { this.emitter.emit(name, event); }
    listenerCount(name) { return this.emitter.listenerCount(name); }
}

function client(x) {
    const value = new EventEmitter();
    value.entity = { position: { x, y: 70, z: x + 1 } };
    return value;
}

test('connection event binding emits canonical detached events only for the exact current client and generation', async () => {
    const context = new BotContext('bot-01');
    const eventBus = new RawEventBus();
    const first = client(1);
    const second = client(10);
    context.attach(first);
    const binding = createConnectionEventBinding({ botId: 'bot-01', context, eventBus });
    const observed = [];
    for (const name of ['command:message', 'movement:position', 'movement:teleport', 'player:death']) {
        eventBus.on(name, event => observed.push({ name, event }));
    }
    await binding.initialize();
    eventBus.emit('connection:spawned', { botId: 'bot-01', connectionGeneration: 1 });

    first.emit('messagestr', 'hello');
    first.emit('move');
    first.emit('forcedMove');
    first.emit('death');
    assert.deepEqual(observed.map(entry => entry.name), [
        'command:message', 'movement:position', 'movement:teleport', 'player:death'
    ]);
    assert.equal(observed.every(entry => entry.event.connectionGeneration === 1), true);
    assert.deepEqual(observed[1].event.position, { x: 1, y: 70, z: 2 });
    first.entity.position.x = 999;
    assert.equal(observed[1].event.position.x, 1);

    context.detach(first);
    context.attach(second);
    first.emit('move');
    assert.equal(observed.length, 4, 'stale raw callback must be ignored before replacement binding');
    eventBus.emit('connection:spawned', { botId: 'bot-01', connectionGeneration: 2 });
    assert.equal(first.listenerCount('messagestr'), 0);
    assert.equal(first.listenerCount('move'), 0);
    assert.equal(first.listenerCount('forcedMove'), 0);
    assert.equal(first.listenerCount('death'), 0);
    second.emit('move');
    assert.equal(observed.at(-1).event.connectionGeneration, 2);

    eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 1 });
    assert.equal(second.listenerCount('move'), 1, 'stale end must not detach replacement listeners');
    eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 2 });
    assert.equal(second.listenerCount('move'), 0);
    await binding.destroy();
});

test('connection event binding is idempotent and cleans EventBus and raw-client listeners', async () => {
    const context = new BotContext('bot-01');
    const eventBus = new RawEventBus();
    const current = client(1);
    context.attach(current);
    const binding = createConnectionEventBinding({ botId: 'bot-01', context, eventBus });
    await binding.initialize();
    await binding.initialize();
    assert.equal(eventBus.listenerCount('connection:spawned'), 1);
    assert.equal(eventBus.listenerCount('connection:ended'), 1);
    eventBus.emit('connection:spawned', { botId: 'bot-01' });
    assert.equal(current.listenerCount('move'), 0, 'generation-less spawn must fail closed');
    eventBus.emit('connection:spawned', { botId: 'bot-01', connectionGeneration: 1 });
    assert.equal(current.listenerCount('move'), 1);
    await binding.stop();
    assert.equal(current.listenerCount('move'), 0);
    assert.equal(eventBus.listenerCount('connection:spawned'), 0);
    assert.equal(eventBus.listenerCount('connection:ended'), 0);
    await binding.destroy();
});
