'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const BackupCatalogService = require('../../../src/desktop/backup/BackupCatalogService');

async function fixture(t) {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-backup-catalog-'));
    t.after(() => fs.rm(baseDir, { recursive: true, force: true }));
    await fs.mkdir(path.join(baseDir, 'config', 'nested'), { recursive: true });
    await fs.writeFile(path.join(baseDir, 'config', 'app.json'), '{"value":1}\n');
    await fs.writeFile(path.join(baseDir, 'config', 'nested', 'mode.json'), '{"enabled":true}\n');
    let id = 0;
    return { baseDir, service: new BackupCatalogService({ baseDir, appVersion: '2.7.0', idFactory: () => `uuid-${++id}` }) };
}

test('BackupCatalogService creates hashed manifest, previews and restores transactionally', async t => {
    const { baseDir, service } = await fixture(t);
    const created = await service.create({ reason: 'before-edit' });
    assert.equal(created.manifest.contract, 'mcbot-config-backup-v1');
    assert.equal(created.manifest.files.length, 2);
    await fs.writeFile(path.join(baseDir, 'config', 'app.json'), '{"value":2}\n');
    const preview = await service.previewRestore(created.id);
    assert.equal(preview.integrity, 'VALID');
    assert.equal(preview.changes.find(change => change.path === 'app.json').action, 'REPLACE');
    const restored = await service.restore(created.id, { verifyTarget: async () => {
        assert.equal(JSON.parse(await fs.readFile(path.join(baseDir, 'config', 'app.json'), 'utf8')).value, 1);
    } });
    assert.equal(restored.restored, created.id);
    assert.equal(JSON.parse(await fs.readFile(path.join(baseDir, 'config', 'app.json'), 'utf8')).value, 1);
});

test('BackupCatalogService detects tampering before restore', async t => {
    const { service } = await fixture(t);
    const created = await service.create();
    await fs.writeFile(path.join(created.path, 'files', 'app.json'), '{"tampered":true}\n');
    await assert.rejects(service.previewRestore(created.id), { code: 'CONFIG_BACKUP_INTEGRITY_FAILED' });
});

test('QA upgrade: retention deletes every catalog entry beyond the configured limit', async t => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-backup-retention-'));
    t.after(() => fs.rm(baseDir, { recursive:true, force:true }));
    await fs.mkdir(path.join(baseDir, 'config'), { recursive:true });
    await fs.writeFile(path.join(baseDir, 'config', 'app.json'), '{}\n');
    let id = 0; let now = 1_700_000_000_000;
    const service = new BackupCatalogService({ baseDir, maxCatalogEntries:2, now:() => now++, idFactory:() => `id-${++id}` });
    await service.create(); await service.create(); await service.create();
    const entries = await service.list({ limit:10 });
    assert.equal(entries.length, 2);
    assert.equal((await fs.readdir(path.join(baseDir, 'data/backups/catalog'))).length, 2);
});

test('QA upgrade: exact-tree restore previews/deletes later files and rollback restores them on verification failure', async t => {
    const { baseDir, service } = await fixture(t);
    const created = await service.create();
    const extra = path.join(baseDir, 'config', 'later.json');
    await fs.writeFile(extra, '{"later":true}\n');
    const preview = await service.previewRestore(created.id);
    assert.equal(preview.changes.find(change => change.path === 'later.json').action, 'DELETE');
    await assert.rejects(service.restore(created.id, { verifyTarget:async () => { throw new Error('verification fault'); } }), error => error.rollbackApplied === true);
    assert.equal(JSON.parse(await fs.readFile(extra, 'utf8')).later, true);
    await service.restore(created.id);
    await assert.rejects(fs.readFile(extra), { code:'ENOENT' });
});

test('QA upgrade: duplicate manifest paths are rejected before restore', async t => {
    const { service } = await fixture(t);
    const created = await service.create();
    const manifestPath = path.join(created.path, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.files.push({ ...manifest.files[0] });
    manifest.totalBytes += manifest.files[0].bytes;
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await assert.rejects(service.previewRestore(created.id), { code:'CONFIG_BACKUP_INTEGRITY_FAILED' });
});

test('QA upgrade: restoring an old backup protects its source from retention', async t => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-backup-old-restore-'));
    t.after(() => fs.rm(baseDir, { recursive:true, force:true }));
    await fs.mkdir(path.join(baseDir, 'config'), { recursive:true });
    await fs.writeFile(path.join(baseDir, 'config', 'app.json'), '{"version":1}\n');
    let id = 0; let now = 1_700_000_000_000;
    const service = new BackupCatalogService({ baseDir, maxCatalogEntries:2, now:() => now++, idFactory:() => `id-${++id}` });
    const old = await service.create();
    await fs.writeFile(path.join(baseDir, 'config', 'app.json'), '{"version":2}\n');
    await service.create();
    const restored = await service.restore(old.id);
    assert.equal(restored.restored, old.id);
    assert.equal(JSON.parse(await fs.readFile(path.join(baseDir, 'config', 'app.json'), 'utf8')).version, 1);
});

test('QA upgrade: backup manifest read is bounded before JSON parsing', async t => {
    const { service } = await fixture(t);
    const created = await service.create();
    await fs.writeFile(path.join(created.path, 'manifest.json'), ' '.repeat(1_048_577));
    await assert.rejects(service.previewRestore(created.id), { code:'CONFIG_BACKUP_MANIFEST_TOO_LARGE' });
});
