'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVersion, compareVersions, normalizeVersion } = require('../../../src/desktop/update/Version');

test('Version helper parses v-prefix and compares stable/prerelease versions', () => {
    assert.equal(normalizeVersion('v2.4.0'), '2.4.0');
    assert.equal(normalizeVersion('2.4.0-beta.2'), '2.4.0-beta.2');
    assert.equal(normalizeVersion('bad'), null);
    assert.equal(compareVersions('2.4.0', '2.3.9'), 1);
    assert.equal(compareVersions('2.4.0-beta.2', '2.4.0-beta.1'), 1);
    assert.equal(compareVersions('2.4.0', '2.4.0-beta.9'), 1);
    assert.equal(compareVersions('2.4.0', '2.4.0'), 0);
    assert.deepEqual(parseVersion('v3.1.2-rc.1').prerelease, ['rc', '1']);
});
