'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Contract = require('../../../src/shared/contracts/OperatorErrorContract');

test('unknown errors fail safe and always carry a correlation id', () => {
    const value = Contract.create(new Error('token=not-for-output'));
    assert.equal(value.category, 'UNKNOWN');
    assert.equal(value.safeToRetry, false);
    assert.equal(value.retryClass, 'NONE');
    assert.ok(value.correlationId);
    assert.deepEqual(Contract.validate(value), { valid: true, errors: [] });
    assert.doesNotMatch(JSON.stringify(value), /not-for-output/);
});

test('storage failures expose catalog actions rather than raw callbacks', () => {
    const value = Contract.create({ code: 'STORAGE_PROTECTION_BLOCKED', message: 'Kho bị chặn.' });
    assert.equal(value.category, 'STORAGE');
    assert.equal(value.safeToRetry, false);
    assert.ok(value.allowedActions.includes('retry-storage-protection'));
    assert.throws(() => Contract.create(null, { code: 'STORAGE_FAILED', allowedActions: ['/kho sell'] }), /Unknown operator action/);
});
