'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const BotRegistry = require('../../../src/bot/BotRegistry');

test('BotRegistry listener failure does not rollback mutation or block later listeners', () => {
    const logs = [];
    const registry = new BotRegistry({ logger: { warn: (message, meta) => logs.push({ message, meta }) } });
    const observed = [];
    registry.onChange(() => { throw new Error('listener failed token=FAKE-ONLY'); });
    registry.onChange(change => observed.push(change));
    const runtime = { botId: 'bot-01' };
    assert.equal(registry.register(runtime), runtime);
    assert.equal(registry.get('bot-01'), runtime);
    assert.equal(observed.length, 1);
    assert.equal(logs.length, 1);
    assert.equal(JSON.stringify(logs).includes('FAKE-ONLY'), false, 'listener diagnostic is sanitized');
    assert.equal(registry.remove('bot-01'), true);
    assert.equal(registry.has('bot-01'), false);
    assert.equal(observed.length, 2);
});

test('BotRegistry remove expectedRuntime guard and change unsubscribe remain deterministic', () => {
    const registry = new BotRegistry();
    let calls = 0;
    const off = registry.onChange(() => { calls += 1; });
    const runtime = registry.register({ botId: 'bot-01' });
    assert.equal(registry.remove('bot-01', {}), false);
    assert.equal(registry.has('bot-01'), true);
    off();
    assert.equal(registry.remove('bot-01', runtime), true);
    assert.equal(calls, 1);
});
