'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CrashMarkerStore, createDesktopFatalRecovery } = require('../../../src/desktop/DesktopFatalRecovery');

test('XP-015 fatal recovery writes a redacted marker, drains once and terminates', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-fatal-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const store = new CrashMarkerStore({ directory: root, clock: () => 1000 });
    const calls = [];
    const recovery = createDesktopFatalRecovery({ markerStore: store, drain: async () => calls.push('drain'), relaunch: () => calls.push('relaunch'), terminate: code => calls.push(['exit', code]), timeoutMs: 100 });
    await recovery.handle(new Error('token=fatal-secret'), 'unit-fatal');
    assert.deepEqual(calls, ['drain', 'relaunch', ['exit', 1]]);
    const marker = fs.readFileSync(path.join(root, 'latest.json'), 'utf8');
    assert.doesNotMatch(marker, /fatal-secret/);
    assert.equal(await recovery.handle(new Error('second'), 'unit-fatal'), false);
});

test('XP-015 repeated crash marker suppresses relaunch loops', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-fatal-loop-'));
    try {
        let now = 1000;
        const store = new CrashMarkerStore({ directory: root, clock: () => now });
        assert.equal(store.record(new Error('first'), 'fatal').relaunchAllowed, true);
        now += 10;
        assert.equal(store.record(new Error('second'), 'fatal').relaunchAllowed, false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
