'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const SnapshotRevisionGate = require('../../../src/desktop/SnapshotRevisionGate');

test('SnapshotRevisionGate accepts increasing revisions and rejects stale ones', () => {
    const gate = new SnapshotRevisionGate();
    const first = { stateRevision: 10, lifecycle: 'RUNNING' };
    const newer = { stateRevision: 11, lifecycle: 'STOPPING' };
    const stale = { stateRevision: 10, lifecycle: 'RUNNING' };

    assert.equal(gate.accept(first), true);
    assert.equal(gate.accept(newer), true);
    assert.equal(gate.accept(stale), false);
    assert.equal(gate.lastSnapshot, newer);
    assert.deepEqual(gate.status(), { lastRevision: 11 });
});

test('SnapshotRevisionGate treats duplicate revisions as idempotent', () => {
    const gate = new SnapshotRevisionGate();
    const snapshot = { stateRevision: 4, lifecycle: 'RUNNING' };

    assert.equal(gate.accept(snapshot), true);
    assert.equal(gate.accept({ ...snapshot }), false);
});

test('SnapshotRevisionGate has a compatibility path only before revisions exist', () => {
    const gate = new SnapshotRevisionGate();
    const legacy = { lifecycle: 'RUNNING' };
    const secondLegacy = { lifecycle: 'STOPPING' };

    assert.equal(gate.accept(legacy), true);
    assert.equal(gate.accept(secondLegacy), false);
});

test('SnapshotRevisionGate coalesces stale pulls to the freshest accepted snapshot', () => {
    const gate = new SnapshotRevisionGate();
    const current = { stateRevision: 7, lifecycle: 'RUNNING' };
    const stale = { stateRevision: 6, lifecycle: 'STOPPED' };

    assert.equal(gate.accept(current), true);
    assert.strictEqual(gate.coalesce(stale), current);
});
