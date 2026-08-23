'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { handleSquirrelLifecycle } = require('../../../src/desktop/update/SquirrelLifecycle');

test('SquirrelLifecycle handles install/update shortcut events before normal startup', () => {
    const calls = [];
    const app = { quit() { calls.push(['quit']); } };
    const spawnImpl = (command, args, options) => { calls.push(['spawn', command, args, options]); return { unref() { calls.push(['unref']); } }; };
    const setTimeoutImpl = callback => { callback(); return { unref() {} }; };
    const execPath = 'C:\\Users\\x\\AppData\\Local\\mcbot_desktop\\app-2.4.0\\MCbot.exe';
    const handled = handleSquirrelLifecycle({ app, argv: [execPath, '--squirrel-updated'], execPath, spawnImpl, platform: 'win32', setTimeoutImpl });
    assert.equal(handled, true);
    assert.equal(calls[0][0], 'spawn');
    assert.equal(path.win32.basename(calls[0][1]).toLowerCase(), 'update.exe');
    assert.deepEqual(calls[0][2], ['--createShortcut', 'MCbot.exe']);
    assert.ok(calls.some(entry => entry[0] === 'quit'));
});

test('SquirrelLifecycle ignores normal launches and non-Windows platforms', () => {
    const app = { quit() { throw new Error('should not quit'); } };
    assert.equal(handleSquirrelLifecycle({ app, argv: ['MCbot.exe'], platform: 'win32' }), false);
    assert.equal(handleSquirrelLifecycle({ app, argv: ['MCbot.exe', '--squirrel-updated'], platform: 'linux' }), false);
});
