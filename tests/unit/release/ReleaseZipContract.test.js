'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    REQUIRED_FILES,
    normalizeEntryName,
    validateEntryNames
} = require('../../../scripts/release-zip-contract');

function validNames(extra = []) {
    return [...REQUIRED_FILES, ...extra];
}

test('release ZIP contract accepts the complete critical source surface', () => {
    const report = validateEntryNames(validNames(['src/core/Application.js', 'config/app.json']));
    assert.equal(report.valid, true);
    assert.deepEqual(report.failures, []);
});

test('release ZIP contract rejects the exact packaging regression that omitted scripts/build helpers', () => {
    const names = validNames().filter(name => !name.startsWith('scripts/build/'));
    const report = validateEntryNames(names);
    assert.equal(report.valid, false);
    assert.deepEqual(
        report.failures.filter(item => item.code === 'ZIP_REQUIRED_FILE_MISSING').map(item => item.entry),
        [
            'scripts/build/DirectWindowsPackager.js',
            'scripts/build/ForgePackagingPolicy.js',
            'scripts/build/make-windows-installer.js',
            'scripts/build/package-windows-direct.js'
        ]
    );
});

test('release ZIP contract rejects secrets, runtime state, traversal and case collisions', () => {
    const report = validateEntryNames(validNames([
        '.env.local',
        'data/runtime/control/intents.json',
        'node_modules/mineflayer/index.js',
        '../escape.js',
        'SRC/index.js'
    ]));
    assert.equal(report.valid, false);
    assert.ok(report.failures.some(item => item.code === 'ZIP_FORBIDDEN_FILE' && item.entry === '.env.local'));
    assert.ok(report.failures.some(item => item.code === 'ZIP_FORBIDDEN_FILE' && item.entry === 'data/runtime/control/intents.json'));
    assert.ok(report.failures.some(item => item.code === 'ZIP_FORBIDDEN_FILE' && item.entry === 'node_modules/mineflayer/index.js'));
    assert.ok(report.failures.some(item => item.code === 'ZIP_ENTRY_UNSAFE' && item.entry === '../escape.js'));
    assert.ok(report.failures.some(item => item.code === 'ZIP_CASE_COLLISION' && item.entry === 'SRC/index.js'));
});

test('entry normalization accepts Windows separators only by canonicalizing them before policy checks', () => {
    assert.deepEqual(normalizeEntryName('scripts\\build\\DirectWindowsPackager.js'), {
        name: 'scripts/build/DirectWindowsPackager.js',
        directory: false
    });
});
