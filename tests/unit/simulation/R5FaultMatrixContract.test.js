'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..', '..');
const matrix = JSON.parse(fs.readFileSync(path.join(root, 'architecture/fault-matrix/r5.json'), 'utf8'));

test('XP-403 R5 matrix covers light through heavy faults with executable evidence', () => {
    assert.equal(matrix.contract, 'r5-fault-matrix-v1');
    assert.ok(matrix.cases.length >= 15);
    const severities = new Set(); const classes = new Set();
    for (const item of matrix.cases) {
        severities.add(item.severity); classes.add(item.faultClass);
        assert.ok(item.expectedState && item.safeOutcome);
        assert.equal(fs.statSync(path.join(root, item.evidenceTest)).isFile(), true, item.id);
    }
    assert.deepEqual([...severities].sort(), ['HEAVY','LIGHT','MEDIUM']);
    for (const required of ['COMMAND','GUI','INVENTORY','CONNECTION','MODE','STORAGE','PERSISTENCE','DESKTOP','FLEET','DIAGNOSTICS','SECURITY','CONFIG','RELEASE']) assert.ok(classes.has(required), required);
});
