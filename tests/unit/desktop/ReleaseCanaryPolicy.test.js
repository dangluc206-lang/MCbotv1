'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ReleaseCanaryPolicy = require('../../../src/desktop/update/ReleaseCanaryPolicy');

const healthy = { observedMs:900000, attempts:100, failures:1, criticalIncidents:0, integrityValid:true, rollbackReady:true };

test('XP-405 canary advances only 5 -> 25 -> 100 after bounded healthy observation', () => {
    const policy = new ReleaseCanaryPolicy();
    assert.deepEqual(ReleaseCanaryPolicy.STAGES, [5,25,100]);
    assert.equal(policy.decide({ stagePercent:5, ...healthy }).targetPercent, 25);
    assert.equal(policy.decide({ stagePercent:25, ...healthy }).targetPercent, 100);
    assert.equal(policy.decide({ stagePercent:100, ...healthy }).action, 'COMPLETE');
});

test('XP-405 integrity/rollback readiness fail closed and health regression orders rollback', () => {
    const policy = new ReleaseCanaryPolicy();
    assert.equal(policy.decide({ stagePercent:5, ...healthy, integrityValid:false }).action, 'BLOCK');
    assert.equal(policy.decide({ stagePercent:5, ...healthy, observedMs:10 }).action, 'HOLD');
    assert.equal(policy.decide({ stagePercent:25, ...healthy, criticalIncidents:1 }).action, 'ROLLBACK');
    assert.equal(policy.decide({ stagePercent:25, ...healthy, failures:3 }).action, 'ROLLBACK');
});
