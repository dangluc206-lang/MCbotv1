'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const DesktopPreferenceStore = require('../../../src/desktop/DesktopPreferenceStore');

test('DesktopPreferenceStore loads defaults, persists normalized preferences and rejects unknown keys', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-desktop-pref-'));
    const filePath = path.join(dir, 'preferences.json');
    const store = new DesktopPreferenceStore({ filePath });

    assert.deepEqual(await store.load(), {
        closeToTray: true,
        notifyErrors: true,
        snapshotIntervalMs: 900,
        startBackendOnLaunch: true,
        preventSystemSleepWhileActive: true,
        launchAtLogin: false,
        windowBounds: null,
        windowMaximized: false,
        autoCheckUpdates: true,
        autoDownloadUpdates: false,
        autoInstallUpdatesWhenIdle: false,
        updateChannel: 'stable',
        updateRepository: 'dangluc206-lang/MCbotv1'
    });

    assert.equal((await store.set('snapshotIntervalMs', 50)).snapshotIntervalMs, 400);
    assert.equal((await store.update({ closeToTray: false, notifyErrors: false })).closeToTray, false);
    assert.equal(store.get('missing'), undefined);
    await assert.rejects(() => store.set('unknown', true), /Unknown desktop preference/);

    const reloaded = new DesktopPreferenceStore({ filePath });
    assert.deepEqual(await reloaded.load(), {
        closeToTray: false,
        notifyErrors: false,
        snapshotIntervalMs: 400,
        startBackendOnLaunch: true,
        preventSystemSleepWhileActive: true,
        launchAtLogin: false,
        windowBounds: null,
        windowMaximized: false,
        autoCheckUpdates: true,
        autoDownloadUpdates: false,
        autoInstallUpdatesWhenIdle: false,
        updateChannel: 'stable',
        updateRepository: 'dangluc206-lang/MCbotv1'
    });

    fs.rmSync(dir, { recursive: true, force: true });
});

test('DesktopPreferenceStore clamps large intervals while preserving other stored preferences', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-desktop-pref-limit-'));
    const filePath = path.join(dir, 'preferences.json');
    fs.writeFileSync(filePath, JSON.stringify({ snapshotIntervalMs: 90000, startBackendOnLaunch: false }));
    const store = new DesktopPreferenceStore({ filePath });
    const loaded = await store.load();
    assert.equal(loaded.snapshotIntervalMs, 5000);
    assert.equal(loaded.startBackendOnLaunch, false);
    assert.equal(loaded.updateChannel, 'stable');
    assert.equal(loaded.autoCheckUpdates, true);
    fs.rmSync(dir, { recursive: true, force: true });
});


test('DesktopPreferenceStore normalizes persisted window state for safe restore', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-desktop-window-pref-'));
    const filePath = path.join(dir, 'preferences.json');
    const store = new DesktopPreferenceStore({ filePath });
    const saved = await store.update({ windowBounds: { x: 10.4, y: 20.8, width: 600, height: 300 }, windowMaximized: true });
    assert.deepEqual(saved.windowBounds, { x: 10, y: 21, width: 1080, height: 700 });
    assert.equal(saved.windowMaximized, true);
    const cleared = await store.set('windowBounds', { x: 'bad' });
    assert.equal(cleared.windowBounds, null);
    fs.rmSync(dir, { recursive: true, force: true });
});


test('DesktopPreferenceStore normalizes update channel/repository preferences', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-desktop-update-pref-'));
    const filePath = path.join(dir, 'preferences.json');
    const store = new DesktopPreferenceStore({ filePath });
    await store.load();
    const saved = await store.update({ updateChannel: 'beta', updateRepository: 'example/project', autoDownloadUpdates: true, autoInstallUpdatesWhenIdle: true });
    assert.equal(saved.updateChannel, 'beta');
    assert.equal(saved.updateRepository, 'dangluc206-lang/MCbotv1');
    assert.equal(saved.autoDownloadUpdates, true);
    assert.equal(saved.autoInstallUpdatesWhenIdle, true);
    await fs.promises.writeFile(filePath, JSON.stringify({ updateChannel: 'nightly', updateRepository: 'bad repo' }));
    const reloaded = new DesktopPreferenceStore({ filePath });
    const normalized = await reloaded.load();
    assert.equal(normalized.updateChannel, 'stable');
    assert.equal(normalized.updateRepository, 'dangluc206-lang/MCbotv1');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('DesktopPreferenceStore serializes concurrent mutations and uses unique atomic temp files', async () => {
    const fsp = require('node:fs/promises');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-desktop-pref-order-'));
    const filePath = path.join(dir, 'preferences.json');
    let releaseFirstWrite;
    let markFirstWriteStarted;
    const firstWriteStarted = new Promise(resolve => { markFirstWriteStarted = resolve; });
    const firstWriteGate = new Promise(resolve => { releaseFirstWrite = resolve; });
    const writes = [];
    let ids = 0;
    const fsImpl = {
        ...fsp,
        async writeFile(file, body, options) {
            writes.push({ file, body });
            if (writes.length === 1) {
                markFirstWriteStarted();
                await firstWriteGate;
            }
            return fsp.writeFile(file, body, options);
        }
    };
    const store = new DesktopPreferenceStore({ filePath, fsImpl, idFactory: () => `id-${++ids}` });
    await store.load();

    const first = store.set('closeToTray', false);
    await firstWriteStarted;
    const second = store.set('notifyErrors', false);

    assert.equal(store.get('closeToTray'), true, 'uncommitted mutation must not leak into the committed snapshot');
    assert.equal(store.get('notifyErrors'), true);
    releaseFirstWrite();

    const firstResult = await first;
    const secondResult = await second;
    assert.equal(firstResult.closeToTray, false);
    assert.equal(firstResult.notifyErrors, true, 'first Promise must resolve to its own committed state');
    assert.equal(secondResult.closeToTray, false);
    assert.equal(secondResult.notifyErrors, false);
    assert.equal(new Set(writes.map(entry => entry.file)).size, 2, 'each atomic write must own a distinct temp path');
    assert.match(path.basename(writes[0].file), /\.id-1\.tmp$/);
    assert.match(path.basename(writes[1].file), /\.id-2\.tmp$/);
    const persisted = JSON.parse(await fsp.readFile(filePath, 'utf8'));
    assert.equal(persisted.closeToTray, false);
    assert.equal(persisted.notifyErrors, false);
    await store.drain();
    fs.rmSync(dir, { recursive: true, force: true });
});

test('DesktopPreferenceStore keeps committed state unchanged after a failed write and recovers its queue', async () => {
    const fsp = require('node:fs/promises');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-desktop-pref-recover-'));
    const filePath = path.join(dir, 'preferences.json');
    let failRename = true;
    const fsImpl = {
        ...fsp,
        async rename(source, target) {
            if (failRename) {
                failRename = false;
                const error = new Error('synthetic rename failure');
                error.code = 'EIO';
                throw error;
            }
            return fsp.rename(source, target);
        }
    };
    let ids = 0;
    const store = new DesktopPreferenceStore({ filePath, fsImpl, idFactory: () => `recover-${++ids}` });
    await store.load();

    await assert.rejects(() => store.set('closeToTray', false), error => error?.code === 'EIO');
    assert.equal(store.get('closeToTray'), true, 'failed persistence must not mutate committed in-memory state');

    const recovered = await store.set('notifyErrors', false);
    assert.equal(recovered.closeToTray, true);
    assert.equal(recovered.notifyErrors, false);
    const persisted = JSON.parse(await fsp.readFile(filePath, 'utf8'));
    assert.equal(persisted.closeToTray, true);
    assert.equal(persisted.notifyErrors, false);
    await store.drain();
    fs.rmSync(dir, { recursive: true, force: true });
});
