'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const DurableIntentStore = require('../../../src/recovery/DurableIntentStore');

async function tempRoot(t, prefix = 'mcbot-intent-') {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return root;
}

async function openStore(t, options = {}) {
    const baseDir = options.baseDir || await tempRoot(t);
    const store = new DurableIntentStore({
        baseDir,
        file: 'runtime/control/intents.json',
        clock: () => Date.parse('2026-08-16T01:02:03.000Z'),
        ...options
    });
    await store.initialize();
    await store.start();
    t.after(() => store.destroy());
    return { store, baseDir };
}

function activeIntent(source = 'test') {
    return {
        desiredConnection: 'CONNECTED',
        desiredMode: 'collector-b5',
        modeState: 'ACTIVE',
        source
    };
}

test('persists only canonical desired state, redacts source secrets, and reloads reordered JSON', async t => {
    const { store, baseDir } = await openStore(t);
    const saved = await store.setIntent('bot-01', activeIntent('token=super-secret operator'));
    assert.equal(saved.revision, 1);
    assert.equal(saved.source.includes('super-secret'), false);
    assert.match(saved.source, /\[REDACTED\]/);
    assert.equal(Object.isFrozen(saved), true);

    const file = path.join(baseDir, 'runtime/control/intents.json');
    const disk = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.deepEqual(Object.keys(disk.intents['bot-01']).sort(), [
        'botId', 'desiredConnection', 'desiredMode', 'modeState', 'revision', 'source', 'updatedAt'
    ]);
    assert.equal(JSON.stringify(disk).includes('super-secret'), false);
    assert.equal(JSON.stringify(disk).includes('command'), false);
    assert.equal(JSON.stringify(disk).includes('click'), false);

    const reorderedIntent = Object.fromEntries(Object.entries(disk.intents['bot-01']).reverse());
    const reorderedDocument = {
        intents: { 'bot-01': reorderedIntent },
        updatedAt: disk.updatedAt,
        revision: disk.revision,
        version: disk.version
    };
    await fs.writeFile(file, `${JSON.stringify(reorderedDocument, null, 2)}\n`, 'utf8');
    const reloaded = new DurableIntentStore({ baseDir, file: 'runtime/control/intents.json' });
    await reloaded.initialize();
    assert.deepEqual(reloaded.get('bot-01'), saved);
    await reloaded.destroy();
});

test('serializes concurrent mutations and enforces optimistic revisions', async t => {
    const { store } = await openStore(t, { enabled: false });
    const writes = Array.from({ length: 8 }, (_, index) => store.patchIntent('bot-01', {
        desiredConnection: 'CONNECTED',
        desiredMode: 'fishing',
        modeState: index % 2 ? 'ACTIVE' : 'PAUSED',
        source: `writer-${index}`
    }));
    const values = await Promise.all(writes);
    assert.deepEqual(values.map(value => value.revision), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(store.snapshot().revision, 8);
    assert.equal(store.get('bot-01').source, 'writer-7');

    await assert.rejects(
        store.patchIntent('bot-01', { modeState: 'PAUSED' }, { expectedRevision: 3 }),
        error => error.code === 'INTENT_REVISION_CONFLICT'
    );
    const revision = store.get('bot-01').revision;
    assert.equal(await store.remove('missing-bot'), false);
    await assert.rejects(store.remove('bot-01', { expectedRevision: revision - 1 }), error => error.code === 'INTENT_REVISION_CONFLICT');
    assert.equal(await store.remove('bot-01', { expectedRevision: revision }), true);
    assert.equal(store.get('bot-01'), null);
});

test('rejects invalid paths, bot ids, state combinations, and unknown fields', async t => {
    const baseDir = await tempRoot(t);
    for (const file of ['', '../intent.json', 'a/../intent.json', '/tmp/intent.json', 'C:\\intent.json']) {
        assert.throws(() => new DurableIntentStore({ baseDir, file }), /safe relative path/);
    }
    const { store } = await openStore(t, { baseDir, enabled: false });
    await assert.rejects(store.setIntent('!', activeIntent()), /botId is invalid/);
    await assert.rejects(store.setIntent('bot-01', { ...activeIntent(), extra: true }), /Unknown intent key/);
    await assert.rejects(store.setIntent('bot-01', { ...activeIntent(), desiredConnection: 'MAYBE' }), /desiredConnection is invalid/);
    await assert.rejects(store.setIntent('bot-01', { ...activeIntent(), desiredMode: 'mining' }), /desiredMode is invalid/);
    await assert.rejects(store.setIntent('bot-01', { ...activeIntent(), modeState: 'STOPPED' }), /modeState is invalid/);
    await assert.rejects(store.setIntent('bot-01', {
        desiredConnection: 'DISCONNECTED', desiredMode: 'fishing', modeState: 'ACTIVE'
    }), /cannot request a mode while disconnected/);
    await assert.rejects(store.patchIntent('bot-01', null), /patch must be an object/);
});

test('fails closed for corrupt, oversized, non-file, and symlink-backed snapshots', async t => {
    const corruptRoot = await tempRoot(t, 'mcbot-intent-corrupt-');
    await fs.mkdir(path.join(corruptRoot, 'runtime/control'), { recursive: true });
    await fs.writeFile(path.join(corruptRoot, 'runtime/control/intents.json'), '{', 'utf8');
    await assert.rejects(
        new DurableIntentStore({ baseDir: corruptRoot, file: 'runtime/control/intents.json' }).initialize(),
        SyntaxError
    );

    const largeRoot = await tempRoot(t, 'mcbot-intent-large-');
    await fs.mkdir(path.join(largeRoot, 'runtime/control'), { recursive: true });
    await fs.writeFile(path.join(largeRoot, 'runtime/control/intents.json'), 'x'.repeat(1025), 'utf8');
    await assert.rejects(
        new DurableIntentStore({ baseDir: largeRoot, file: 'runtime/control/intents.json', maxBytes: 1024 }).initialize(),
        /exceeds 1024 bytes/
    );

    const directoryRoot = await tempRoot(t, 'mcbot-intent-directory-');
    await fs.mkdir(path.join(directoryRoot, 'runtime/control/intents.json'), { recursive: true });
    await assert.rejects(
        new DurableIntentStore({ baseDir: directoryRoot, file: 'runtime/control/intents.json' }).initialize(),
        /regular file/
    );

    const linkRoot = await tempRoot(t, 'mcbot-intent-link-');
    const target = path.join(linkRoot, 'target');
    await fs.mkdir(target);
    await fs.symlink(target, path.join(linkRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(
        new DurableIntentStore({ baseDir: linkRoot, file: 'linked/intents.json' }).initialize(),
        /real directory/
    );
});

test('keeps the previous memory and disk snapshot when a bounded write fails', async t => {
    const { store, baseDir } = await openStore(t, { maxBytes: 1024 });
    const file = path.join(baseDir, 'runtime/control/intents.json');
    let observedFailure = false;
    for (let index = 0; index < 20; index += 1) {
        const before = store.snapshot();
        const beforeDisk = before.revision > 0 ? await fs.readFile(file, 'utf8') : null;
        try {
            await store.setIntent(`bot-${String(index).padStart(2, '0')}`, activeIntent('x'.repeat(128)));
        } catch (error) {
            assert.match(error.message, /exceeds 1024 bytes/);
            assert.deepEqual(store.snapshot(), before);
            assert.equal(await fs.readFile(file, 'utf8'), beforeDisk);
            observedFailure = true;
            break;
        }
    }
    assert.equal(observedFailure, true);
});

test('supports disabled in-memory operation without creating runtime files', async t => {
    const { store, baseDir } = await openStore(t, { enabled: false });
    await store.setIntent('bot-01', activeIntent());
    assert.equal(store.get('bot-01').desiredMode, 'collector-b5');
    await assert.rejects(fs.access(path.join(baseDir, 'runtime/control/intents.json')), error => error.code === 'ENOENT');
    await store.stop();
    await store.start();
    assert.equal(store.snapshot().revision, 1);
});
