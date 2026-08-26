'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const OperatorErrorContract = require('../../../src/shared/contracts/OperatorErrorContract');

const root = path.resolve(__dirname, '..', '..', '..');
const matrix = JSON.parse(fs.readFileSync(path.join(root, 'architecture', 'fault-matrix', 'r1.json'), 'utf8'));

test('XP-403 R1 matrix declares state, safe actions, artifact and cleanup for every fault', () => {
    assert.equal(matrix.contract, 'r1-fault-matrix-v1');
    assert.ok(matrix.cases.length >= 10);
    for (const scenario of matrix.cases) {
        assert.ok(scenario.id);
        assert.ok(scenario.injection);
        assert.ok(scenario.expectedState);
        assert.ok(scenario.artifact);
        assert.ok(scenario.cleanupAssertion);
        assert.ok(fs.statSync(path.join(root, scenario.evidenceTest)).isFile(), scenario.evidenceTest);
        for (const action of scenario.allowedActions) assert.ok(OperatorErrorContract.ACTION_CATALOG[action], `${scenario.id}:${action}`);
    }
});

test('XP-403 R1 matrix covers every severe recovery subsystem completed in R1', () => {
    const classes = new Set(matrix.cases.map(scenario => scenario.faultClass));
    for (const required of ['COMMAND', 'GUI', 'INVENTORY', 'CONNECTION', 'MODE', 'STORAGE', 'PERSISTENCE', 'DESKTOP', 'FLEET', 'DIAGNOSTICS']) {
        assert.ok(classes.has(required), required);
    }
});
