'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const helper = require('../../../src/desktop/update/local-update-helper');

test('local update helper replaces staged files, backs up originals, and can rollback', async t => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-update-helper-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const targetRoot = path.join(root, 'target');
    const stageRoot = path.join(root, 'stage');
    const backupRoot = path.join(root, 'backup');
    await fsp.mkdir(path.join(targetRoot, 'src'), { recursive: true });
    await fsp.mkdir(path.join(stageRoot, 'src'), { recursive: true });
    await fsp.writeFile(path.join(targetRoot, 'src', 'a.js'), 'old');
    await fsp.writeFile(path.join(stageRoot, 'src', 'a.js'), 'new');
    const plan = { targetRoot, stageRoot, backupRoot };
    const journal = [];
    await helper.applyFile(plan, 'src/a.js', journal);
    assert.equal(await fsp.readFile(path.join(targetRoot, 'src', 'a.js'), 'utf8'), 'new');
    assert.equal(await fsp.readFile(path.join(backupRoot, 'src', 'a.js'), 'utf8'), 'old');
    assert.equal((await helper.rollback(plan, journal)).length, 0);
    assert.equal(await fsp.readFile(path.join(targetRoot, 'src', 'a.js'), 'utf8'), 'old');
});

test('local update helper refuses path traversal', () => {
    assert.equal(helper.safeRelative('../x'), null);
    assert.equal(helper.safeRelative('C:\\x'), null);
    assert.throws(() => helper.resolveInside('/tmp/root', '../x'), /Unsafe update path/);
});

test('local update helper transactionally deletes generated out directory and rollback restores it', async t => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-update-helper-out-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const targetRoot = path.join(root, 'target');
    const stageRoot = path.join(root, 'stage');
    const backupRoot = path.join(root, 'backup');
    await fsp.mkdir(path.join(targetRoot, 'out', 'desktop', 'resources'), { recursive: true });
    await fsp.writeFile(path.join(targetRoot, 'out', 'desktop', 'resources', 'app.asar'), 'generated-artifact');
    const plan = { targetRoot, stageRoot, backupRoot };
    const journal = [];

    await helper.applyDelete(plan, 'out', journal);
    await assert.rejects(fsp.stat(path.join(targetRoot, 'out')), error => error?.code === 'ENOENT');
    assert.equal(await fsp.readFile(path.join(backupRoot, 'out', 'desktop', 'resources', 'app.asar'), 'utf8'), 'generated-artifact');
    assert.deepEqual(journal, [{ relative: 'out', existed: true, kind: 'directory' }]);

    assert.deepEqual(await helper.rollback(plan, journal), []);
    assert.equal(await fsp.readFile(path.join(targetRoot, 'out', 'desktop', 'resources', 'app.asar'), 'utf8'), 'generated-artifact');
});

test('local update helper refuses every deletion outside exact generated root out', async t => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-update-helper-dir-delete-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const targetRoot = path.join(root, 'target');
    const backupRoot = path.join(root, 'backup');
    await fsp.mkdir(path.join(targetRoot, 'src'), { recursive: true });
    await fsp.writeFile(path.join(targetRoot, 'src', 'a.js'), 'keep-me');
    await assert.rejects(
        helper.applyDelete({ targetRoot, backupRoot }, 'src', []),
        error => error?.code === 'LOCAL_UPDATE_DELETE_PATH'
    );
    assert.equal((await fsp.stat(path.join(targetRoot, 'src'))).isDirectory(), true);
    assert.equal(await fsp.readFile(path.join(targetRoot, 'src', 'a.js'), 'utf8'), 'keep-me');
});

test('local update helper rejects direct arbitrary file deletion before mutation', async t => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-update-helper-file-delete-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const targetRoot = path.join(root, 'target');
    const backupRoot = path.join(root, 'backup');
    await fsp.mkdir(path.join(targetRoot, 'src'), { recursive: true });
    const target = path.join(targetRoot, 'src', 'a.js');
    await fsp.writeFile(target, 'operator-code');
    await assert.rejects(
        helper.applyDelete({ targetRoot, backupRoot }, 'src/a.js', []),
        error => error?.code === 'LOCAL_UPDATE_DELETE_PATH'
    );
    assert.equal(await fsp.readFile(target, 'utf8'), 'operator-code');
});

test('local update helper validates tampered plans, duplicate deletes, and write/delete overlap before apply', () => {
    assert.throws(
        () => helper.validatePlan({ files: [], delete: ['src/a.js'] }),
        error => error?.code === 'LOCAL_UPDATE_DELETE_PATH'
    );
    assert.throws(
        () => helper.validatePlan({ files: [], delete: ['out', './out'] }),
        error => error?.code === 'LOCAL_UPDATE_PLAN_DUPLICATE'
    );
    assert.throws(
        () => helper.validatePlan({ files: ['out/generated/app.js'], delete: ['out'] }),
        error => error?.code === 'LOCAL_UPDATE_PLAN_OVERLAP'
    );
    assert.equal(helper.validatePlan({ files: ['package.json'], delete: ['out'] }), true);
});


test('local update helper rejects a staged file changed after inspection before any target mutation', async t => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-update-helper-integrity-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const targetRoot = path.join(root, 'target');
    const stageRoot = path.join(root, 'stage');
    const backupRoot = path.join(root, 'backup');
    await fsp.mkdir(path.join(targetRoot, 'src'), { recursive: true });
    await fsp.mkdir(path.join(stageRoot, 'src'), { recursive: true });
    const target = path.join(targetRoot, 'src', 'a.js');
    const staged = path.join(stageRoot, 'src', 'a.js');
    await fsp.writeFile(target, 'operator-code');
    const trusted = Buffer.from('trusted-stage');
    await fsp.writeFile(staged, trusted);
    const plan = {
        schemaVersion: 2,
        targetRoot,
        stageRoot,
        backupRoot,
        files: ['src/a.js'],
        delete: [],
        fileIntegrity: [{
            relative: 'src/a.js',
            size: trusted.length,
            digest: `sha256:${crypto.createHash('sha256').update(trusted).digest('hex')}`
        }]
    };
    await fsp.writeFile(staged, 'tampered!!!!!');
    await assert.rejects(
        () => helper.verifyStagedFiles(plan),
        error => error?.code === 'LOCAL_UPDATE_STAGED_INTEGRITY_MISMATCH'
    );
    assert.equal(await fsp.readFile(target, 'utf8'), 'operator-code');
    await assert.rejects(fsp.stat(backupRoot), error => error?.code === 'ENOENT');
});

test('local update helper main preflights staged integrity before opening the target mutation journal', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/desktop/update/local-update-helper.js'), 'utf8');
    const verifyIndex = source.indexOf('await verifyStagedFiles(plan);');
    const journalIndex = source.indexOf('const journal = []');
    assert.ok(verifyIndex >= 0);
    assert.ok(journalIndex > verifyIndex, 'staged integrity preflight must run before target mutation journal/apply');
    assert.match(source, /plan\.schemaVersion !== 2/);
});
