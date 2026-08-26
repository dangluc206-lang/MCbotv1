'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const RuntimeMigrationPlanner = require('../../../src/desktop/update/RuntimeMigrationPlanner');
const RuntimeTransactionJournal = require('../../../src/desktop/update/RuntimeTransactionJournal');
const { compareVersions } = require('../../../src/desktop/update/RuntimeConfigMigrations');

test('migration planner selects only the open version interval in deterministic order', () => {
    const run = () => {};
    const planner = new RuntimeMigrationPlanner({ compareVersions });
    const result = planner.plan({
        fromVersion: '2.6.4', toVersion: '2.6.10',
        migrations: [{ target:'2.6.3', run }, { target:'2.6.5', run }, { target:'2.6.10', run }, { target:'2.6.11', run }]
    });
    assert.deepEqual(result.map(item => item.target), ['2.6.5', '2.6.10']);
    assert.throws(() => result.push({}), TypeError);
});

test('transaction journal assigns monotonic sequence and immutable entries', () => {
    const ledger = RuntimeTransactionJournal.create();
    const first = RuntimeTransactionJournal.append(ledger, { phase:'PREPARE' });
    const second = RuntimeTransactionJournal.append(ledger, { phase:'COMMIT' });
    assert.deepEqual([first.sequence, second.sequence], [1, 2]);
    assert.throws(() => { first.phase = 'MUTATED'; }, TypeError);
    assert.equal(RuntimeTransactionJournal.snapshot(ledger).length, 2);
});
