'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CraftProgressTracker = require('../../../src/server-features/crafting/support/CraftProgressTracker');

function tracker(logs = []) {
    return new CraftProgressTracker({ logger: { info: message => logs.push(message) } });
}

test('progress tracker keeps the automation state machine without B5 vocabulary', () => {
    const logs = [];
    const progress = tracker(logs);
    assert.deepEqual({ ...progress.status(), updatedAt: null }, {
        running: false, state: 'IDLE', currentStep: null,
        remainingStages: null, remainingCrafts: null, updatedAt: null
    });
    progress.set({ running: true, state: 'CRAFTING_INTERMEDIATE', currentStep: { kind: 'B2/B3', id: 'b3' } });
    assert.equal(progress.status().state, 'CRAFTING_INTERMEDIATE');
    assert.ok(logs.some(message => message.includes('crafting intermediate')));
    assert.ok(!('priority' in progress.status()), 'no hard-coded priority may be stored on generic state');
    assert.ok(!JSON.stringify(progress.status()).includes('B5>'), 'no B5>B4>B3>B2 priority in generic state');
});

test('progress tracker syncs planner progress without hard-coded priority', () => {
    const progress = tracker();
    const value = progress.sync({
        progress: { state: 'READY', feasible: true, nextStep: { kind: 'PLAN', id: 'carbon' }, remainingStages: 3, remainingCrafts: 7 }
    }, 'carbon');
    assert.equal(value.state, 'READY');
    assert.equal(value.running, true);
    assert.equal(value.targetId, 'carbon');
    assert.deepEqual(value.currentStep, { kind: 'PLAN', id: 'carbon' });
    assert.equal(value.remainingStages, 3);
    assert.equal(value.remainingCrafts, 7);
    assert.ok(!('priority' in value), 'no hard-coded priority may be stored on generic state');
});

test('progress tracker emits compat activity logs for B-chain reserve work', () => {
    const logs = [];
    const progress = tracker(logs);
    progress.set({ running: true, state: 'CRAFTING_B2', currentStep: { kind: 'B2', id: 'b2' } });
    assert.ok(logs.some(message => message.includes('reserve input')));
    progress.set({ running: true, state: 'CRAFTING_B3', currentStep: { kind: 'B3', id: 'b3' } });
    assert.ok(logs.some(message => message.includes('reserve output')));
    assert.ok(!logs.some(message => message.startsWith('B5:')), 'generic labels must not use the B5: prefix');
});
