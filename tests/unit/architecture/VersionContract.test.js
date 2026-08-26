'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { check } = require('../../../scripts/check-version-contract');

test('product release and architecture schema have distinct named authorities', () => {
    const report = check();
    assert.equal(report.status, 'PASS', report.failures.join('\n'));
    assert.match(report.productVersion, /^\d+\.\d+\.\d+/);
    assert.ok(Number.isInteger(report.architectureSchemaVersion));
});
