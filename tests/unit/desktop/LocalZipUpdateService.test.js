'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const LocalZipUpdateService = require('../../../src/desktop/update/LocalZipUpdateService');

async function fixture({ currentVersion = '2.5.0', nextVersion = '2.5.1', manifest = {}, entries = null, nextDependencies = { mineflayer: '^4.37.1' }, serviceOptions = {} } = {}) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-local-update-'));
    const appRoot = path.join(root, 'app');
    const userDataRoot = path.join(root, 'user');
    const zipPath = path.join(root, 'update.zip');
    await fsp.mkdir(appRoot, { recursive: true });
    await fsp.writeFile(zipPath, 'fake zip');
    await fsp.writeFile(path.join(appRoot, 'package.json'), JSON.stringify({ name: 'mcbot-desktop', version: currentVersion, dependencies: { mineflayer: '^4.37.1' } }));
    const updateManifest = {
        schemaVersion: 1,
        product: 'mcbot-desktop',
        version: nextVersion,
        type: 'patch',
        fromVersion: currentVersion,
        dependenciesChanged: false,
        notes: ['Kiểm thử cập nhật ZIP'],
        ...manifest
    };
    const fileEntries = entries || [
        { relative: 'mcbot-update.json', directory: false, size: 200 },
        { relative: 'package.json', directory: false, size: 200 },
        { relative: 'src/example.js', directory: false, size: 20 }
    ];
    const zipScanner = async (_file, helpers) => {
        for (const entry of fileEntries) {
            const safe = helpers.safeRelative(entry.relative);
            if (!safe) { const error = new Error('unsafe'); error.code = 'LOCAL_UPDATE_UNSAFE_PATH'; throw error; }
            if (helpers.deniedEntry(safe)) { const error = new Error('denied'); error.code = 'LOCAL_UPDATE_DENIED_PATH'; throw error; }
        }
        return { entries: fileEntries, uncompressedBytes: fileEntries.reduce((sum, entry) => sum + (entry.size || 0), 0) };
    };
    const extractor = async (_file, { dir }) => {
        await fsp.mkdir(path.join(dir, 'src'), { recursive: true });
        await fsp.writeFile(path.join(dir, 'mcbot-update.json'), JSON.stringify(updateManifest));
        await fsp.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'mcbot-desktop', version: nextVersion, dependencies: nextDependencies }));
        await fsp.writeFile(path.join(dir, 'src', 'example.js'), 'module.exports = 2;\n');
    };
    const service = new LocalZipUpdateService({ currentVersion, applicationRoot: appRoot, userDataRoot, zipScanner, extractor, ...serviceOptions });
    return { root, appRoot, userDataRoot, zipPath, service };
}

test('LocalZipUpdateService stages a compatible patch and writes a safe install plan', async t => {
    const fx = await fixture();
    t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
    const status = await fx.service.inspect(fx.zipPath);
    assert.equal(status.phase, 'READY');
    assert.equal(status.selected.version, '2.5.1');
    assert.equal(status.selected.type, 'patch');
    assert.equal(status.selected.fileCount, 2);
    const prepared = await fx.service.prepareInstall({ parentPid: 1234, restartExe: null, configBackup: 'backup.json' });
    const plan = JSON.parse(await fsp.readFile(prepared.planPath, 'utf8'));
    assert.equal(plan.schemaVersion, 2);
    assert.equal(plan.fromVersion, '2.5.0');
    assert.equal(plan.toVersion, '2.5.1');
    assert.deepEqual(plan.files.sort(), ['package.json', 'src/example.js']);
    assert.equal(plan.fileIntegrity.length, 2);
    assert.deepEqual(plan.fileIntegrity.map(entry => entry.relative).sort(), ['package.json', 'src/example.js']);
    for (const entry of plan.fileIntegrity) {
        assert.ok(Number.isSafeInteger(entry.size) && entry.size > 0);
        assert.match(entry.digest, /^sha256:[a-f0-9]{64}$/);
    }
    assert.equal(plan.configBackup, 'backup.json');
    assert.ok(plan.backupRoot.startsWith(path.resolve(fx.userDataRoot)));
});

test('LocalZipUpdateService rejects an older/wrong-base patch and runtime dependency changes', async t => {
    const older = await fixture({ nextVersion: '2.4.9' });
    t.after(() => fs.rmSync(older.root, { recursive: true, force: true }));
    await assert.rejects(older.service.inspect(older.zipPath), error => error?.code === 'LOCAL_UPDATE_NOT_NEWER');

    const wrongBase = await fixture({ manifest: { fromVersion: '2.4.2' } });
    t.after(() => fs.rmSync(wrongBase.root, { recursive: true, force: true }));
    await assert.rejects(wrongBase.service.inspect(wrongBase.zipPath), error => error?.code === 'LOCAL_UPDATE_WRONG_BASE');

    const deps = await fixture({ nextDependencies: { mineflayer: '^4.37.1', extra: '1.0.0' } });
    t.after(() => fs.rmSync(deps.root, { recursive: true, force: true }));
    await assert.rejects(deps.service.inspect(deps.zipPath), error => error?.code === 'LOCAL_UPDATE_DEPENDENCIES_CHANGED');
});

test('LocalZipUpdateService rejects protected user/runtime paths before extraction', async t => {
    for (const relative of ['.env', '.env.example', 'out/generated/app.js', 'data/runtime/state.json', 'data/logs/x.log', 'config/modes/custom/private.json', '../escape.js']) {
        const fx = await fixture({ entries: [
            { relative: 'mcbot-update.json', directory: false, size: 20 },
            { relative: 'package.json', directory: false, size: 20 },
            { relative, directory: false, size: 20 }
        ] });
        t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
        await assert.rejects(fx.service.inspect(fx.zipPath), error => ['LOCAL_UPDATE_DENIED_PATH', 'LOCAL_UPDATE_UNSAFE_PATH'].includes(error?.code));
    }
});

test('LocalZipUpdateService allows deletion manifest for generated out root but still forbids ZIP out entries', async t => {
    const fx = await fixture({ manifest: { delete: ['out'] } });
    t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
    const status = await fx.service.inspect(fx.zipPath);
    assert.equal(status.phase, 'READY');
    const prepared = await fx.service.prepareInstall({ parentPid: 1234, restartExe: null });
    const plan = JSON.parse(await fsp.readFile(prepared.planPath, 'utf8'));
    assert.deepEqual(plan.delete, ['out']);

    const forbidden = await fixture({ entries: [
        { relative: 'mcbot-update.json', directory: false, size: 20 },
        { relative: 'package.json', directory: false, size: 20 },
        { relative: 'out/generated/app.js', directory: false, size: 20 }
    ] });
    t.after(() => fs.rmSync(forbidden.root, { recursive: true, force: true }));
    await assert.rejects(forbidden.service.inspect(forbidden.zipPath), error => error?.code === 'LOCAL_UPDATE_DENIED_PATH');
});

test('LocalZipUpdateService rejects every delete manifest path outside exact generated out root', async t => {
    for (const relative of ['src/a.js', 'package.json', 'RULES.md', 'config/storage/kho.json', 'data/runtime', '.env', 'config/modes/custom', 'out/generated']) {
        const fx = await fixture({ manifest: { delete: [relative] } });
        t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
        await assert.rejects(fx.service.inspect(fx.zipPath), error => error?.code === 'LOCAL_UPDATE_DELETE_PATH');
    }
});

test('LocalZipUpdateService rejects normalized duplicate delete aliases before prepare', async t => {
    const fx = await fixture({ manifest: { delete: ['out', './out'] } });
    t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
    await assert.rejects(fx.service.inspect(fx.zipPath), error => error?.code === 'LOCAL_UPDATE_DELETE_PATH');
});


test('LocalZipUpdateService records cleanup failure without replacing the primary update result', async t => {
    const warnings = [];
    const fx = await fixture({
        serviceOptions: {
            removePath: async () => { const error = new Error('cleanup denied'); error.code = 'EACCES'; throw error; },
            logger: { warn: (message, meta) => warnings.push({ message, meta }) }
        }
    });
    t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
    const ready = await fx.service.inspect(fx.zipPath);
    assert.equal(ready.phase, 'READY');
    const cleared = await fx.service.clear();
    assert.equal(cleared.phase, 'IDLE');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].message, /cleanup failed/i);
    assert.equal(warnings[0].meta.reason, 'clear-staging');
    assert.equal(warnings[0].meta.error.code, 'EACCES');
});


test('LocalZipUpdateService freezes staged file integrity at inspect time so later staging tamper cannot rewrite the plan baseline', async t => {
    const fx = await fixture();
    t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
    await fx.service.inspect(fx.zipPath);
    const prepared = await fx.service.prepareInstall({ parentPid: 1234, restartExe: null });
    const plan = JSON.parse(await fsp.readFile(prepared.planPath, 'utf8'));
    const entry = plan.fileIntegrity.find(item => item.relative === 'src/example.js');
    assert.ok(entry);
    const originalDigest = entry.digest;
    await fsp.writeFile(path.join(plan.stageRoot, 'src', 'example.js'), 'module.exports = 999;\n');
    const persisted = JSON.parse(await fsp.readFile(prepared.planPath, 'utf8'));
    assert.equal(persisted.fileIntegrity.find(item => item.relative === 'src/example.js').digest, originalDigest);
});

test('LocalZipUpdateService allows only one prepareInstall transaction for a READY staged update', async t => {
    const fx = await fixture();
    t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
    await fx.service.inspect(fx.zipPath);
    const settled = await Promise.allSettled([
        fx.service.prepareInstall({ parentPid: 1111, restartExe: null }),
        fx.service.prepareInstall({ parentPid: 2222, restartExe: null })
    ]);
    assert.equal(settled.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(settled.filter(item => item.status === 'rejected').length, 1);
    assert.equal(fx.service.status().phase, 'INSTALL_PENDING');
});

test('LocalZipUpdateService can cancel a prepared-but-not-launched install and return to READY', async t => {
    const fx = await fixture();
    t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
    await fx.service.inspect(fx.zipPath);
    const prepared = await fx.service.prepareInstall({ parentPid: 1234, restartExe: null });
    assert.equal(fx.service.status().phase, 'INSTALL_PENDING');
    assert.equal(fs.existsSync(prepared.planPath), true);
    const status = await fx.service.cancelPreparedInstall(prepared.planPath);
    assert.equal(status.phase, 'READY');
    assert.equal(status.selected.version, '2.5.1');
    assert.equal(fs.existsSync(prepared.planPath), false);
    assert.equal(fs.existsSync(prepared.backupRoot), false);
    const retry = await fx.service.prepareInstall({ parentPid: 5678, restartExe: null });
    assert.equal(fx.service.status().phase, 'INSTALL_PENDING');
    assert.notEqual(retry.planPath, prepared.planPath);
});

test('LocalZipUpdateService refuses cancellation with a plan outside the owned prepared transaction', async t => {
    const fx = await fixture();
    t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
    await fx.service.inspect(fx.zipPath);
    const prepared = await fx.service.prepareInstall({ parentPid: 1234, restartExe: null });
    await assert.rejects(
        () => fx.service.cancelPreparedInstall(path.join(fx.root, 'other-plan.json')),
        error => error?.code === 'LOCAL_UPDATE_INSTALL_PLAN_MISMATCH'
    );
    assert.equal(fx.service.status().phase, 'INSTALL_PENDING');
    assert.equal(fs.existsSync(prepared.planPath), true);
});

test('LocalZipUpdateService serializes concurrent inspect transactions', async t => {
    const fx = await fixture();
    t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
    const settled = await Promise.allSettled([
        fx.service.inspect(fx.zipPath),
        fx.service.inspect(fx.zipPath)
    ]);
    assert.equal(settled.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(settled.filter(item => item.status === 'rejected').length, 1);
    assert.equal(fx.service.status().phase, 'READY');
});

test('LocalZipUpdateService refuses clear after helper handoff has an INSTALL_PENDING staged transaction', async t => {
    const fx = await fixture();
    t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
    await fx.service.inspect(fx.zipPath);
    const prepared = await fx.service.prepareInstall({ parentPid: 1234, restartExe: null });
    const plan = JSON.parse(await fsp.readFile(prepared.planPath, 'utf8'));
    assert.equal(fs.existsSync(path.join(plan.stageRoot, 'src', 'example.js')), true);
    await assert.rejects(
        () => fx.service.clear(),
        error => error?.code === 'LOCAL_UPDATE_INSTALL_BUSY'
    );
    assert.equal(fx.service.status().phase, 'INSTALL_PENDING');
    assert.equal(fs.existsSync(path.join(plan.stageRoot, 'src', 'example.js')), true);
});
