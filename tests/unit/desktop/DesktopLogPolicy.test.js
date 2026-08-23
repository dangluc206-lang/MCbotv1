'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const DesktopLogPolicy = require('../../../src/desktop/DesktopLogPolicy');

function record(message, level = 'info', meta = {}) {
    return { timestamp: new Date().toISOString(), level, scope: 'BotRuntime:bot-01', message, meta };
}

test('DesktopLogPolicy hides low-level repetitive GUI/storage traces but keeps warnings and operator summaries', () => {
    const policy = new DesktopLogPolicy();
    assert.equal(policy.project(record('KHO READ START', 'info')), null);
    assert.equal(policy.project(record('GUI CLICK OK', 'info')), null);
    assert.equal(policy.project(record('STEP OK', 'info')), null);
    assert.ok(policy.project(record('B5 thuần: đã chế và cất B5.', 'info', { botId: 'bot-01' })));
    assert.ok(policy.project(record('Server changed unexpectedly.', 'warn', { botId: 'bot-01' })));
    assert.ok(policy.project(record('A failure happened.', 'error', { botId: 'bot-01' })));
});

test('DesktopLogPolicy suppresses repeated visible records inside the repeat window', () => {
    let now = 1000;
    const policy = new DesktopLogPolicy({ repeatWindowMs: 15000, clock: () => now });
    const first = policy.project(record('Minecraft reconnect succeeded.', 'info', { botId: 'bot-01' }));
    assert.ok(first);
    now += 1000;
    assert.equal(policy.project(record('Minecraft reconnect succeeded.', 'info', { botId: 'bot-01' })), null);
    now += 16000;
    const next = policy.project(record('Minecraft reconnect succeeded.', 'info', { botId: 'bot-01' }));
    assert.equal(next.repeatCount, 1);
});

test('DesktopLogPolicy renders B5 waiting summaries compactly and does not merge different blockers', () => {
    let now = 1000;
    const policy = new DesktopLogPolicy({ repeatWindowMs: 15000, clock: () => now });
    const diamond = policy.project(record('B5 PURE: cycle is waiting for a concrete prerequisite.', 'info', { botId: 'bot-01', waitingReason: 'materials', blocker: { reason: 'waiting-for-complete-b2-batch', baseId: 'diamond' } }));
    assert.match(diamond.message, /diamond/);
    assert.match(diamond.message, /waiting-for-complete-b2-batch/);
    now += 100;
    const iron = policy.project(record('B5 PURE: cycle is waiting for a concrete prerequisite.', 'info', { botId: 'bot-01', waitingReason: 'materials', blocker: { reason: 'waiting-for-complete-b2-batch', baseId: 'iron_ingot' } }));
    assert.ok(iron, 'different B5 blocker/resource must remain visible');
});
