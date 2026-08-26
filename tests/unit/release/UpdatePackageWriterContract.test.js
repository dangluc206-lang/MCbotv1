'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('local update packager uses the built-in .NET ZIP API without PowerShell Archive module autoload', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../scripts/create-local-update-package.js'), 'utf8');
    assert.match(source, /System\.IO\.Compression\.ZipFile/);
    assert.match(source, /CreateFromDirectory/);
    assert.doesNotMatch(source, /`Compress-Archive\b/);
});

