'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runDesktopShutdownSequence } = require('../../../src/desktop/DesktopShutdownSequence');

test('desktop shutdown drains final preference persistence before stopping backend', async () => {
    const order = [];
    const result = await runDesktopShutdownSequence({
        cleanupSchedulers: () => { order.push('cleanup'); },
        persistWindowState: async () => { order.push('persist'); },
        drainPreferences: async () => { order.push('drain'); },
        stopController: async () => { order.push('stop'); }
    });
    assert.deepEqual(order, ['cleanup', 'persist', 'drain', 'stop']);
    assert.equal(result.success, true);
    assert.deepEqual(result.completed, ['cleanup-schedulers', 'persist-window-state', 'drain-preferences', 'stop-controller']);
});

test('desktop shutdown preserves best-effort progression and reports failed steps', async () => {
    const order = [];
    const failures = [];
    await runDesktopShutdownSequence({
        cleanupSchedulers: () => { order.push('cleanup'); },
        persistWindowState: async () => { order.push('persist'); throw Object.assign(new Error('persist failed'), { code: 'EIO' }); },
        drainPreferences: async () => { order.push('drain'); },
        stopController: async () => { order.push('stop'); throw new Error('stop failed'); },
        reportFailure: (error, source) => failures.push({ source, message: error.message })
    });
    assert.deepEqual(order, ['cleanup', 'persist', 'drain', 'stop']);
    assert.deepEqual(failures, [
        { source: 'shutdown-window-state-persist', message: 'persist failed' },
        { source: 'application-quit-stop', message: 'stop failed' }
    ]);
});

test('desktop main routes tray/update quits through before-quit and owns only one tray instance', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/desktop/main.js'), 'utf8');
    assert.match(source, /Thoát hoàn toàn', click: \(\) => app\.quit\(\)/);
    assert.doesNotMatch(source, /Thoát hoàn toàn[^\n]+quitting\s*=\s*true/);
    assert.match(source, /app\.on\('before-quit',[\s\S]*runDesktopShutdownSequence\(/);
    assert.match(source, /drainPreferences:\s*\(\) => preferenceStore\?\.drain\?\.\(\)/);
    assert.match(source, /persistWindowState:\s*\(\) => persistWindowStateNow\(\)/);
    assert.equal((source.match(/new Tray\(trayIcon\)/g) || []).length, 1, 'desktop must create only one owned tray instance');
    assert.equal((source.match(/quitting\s*=\s*true/g) || []).length, 1, 'only before-quit may mark final quit ownership');
});

test('desktop local ZIP handoff rolls back prepared state and restores a previously running backend when helper launch fails', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/desktop/main.js'), 'utf8');
    const prepareIndex = source.indexOf('const prepared = await localUpdateService.prepareInstall');
    const cancelIndex = source.indexOf('await localUpdateService.cancelPreparedInstall(prepared.planPath)');
    const restoreIndex = source.indexOf("reportDesktopFailure(startError, 'local-update-backend-restore')");
    const quitIndex = source.indexOf('setTimeout(() => app.quit(), 200)', prepareIndex);
    assert.ok(prepareIndex >= 0);
    assert.ok(cancelIndex > prepareIndex, 'failed helper handoff must cancel the owned prepared plan');
    assert.ok(restoreIndex > cancelIndex, 'backend restore must be attempted after prepared-state rollback');
    assert.ok(quitIndex > restoreIndex, 'quit scheduling must remain after the successful handoff path');
    assert.match(source, /const wasRunning = controller\?\.lifecycle === 'RUNNING'/);
});