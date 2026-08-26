'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const RuntimeFailureArtifactRepository = require('../../../src/diagnostics/runtime/RuntimeFailureArtifactRepository');
const { encodeArtifactId } = RuntimeFailureArtifactRepository;

async function fixture(t, { maxFileMb = 1 } = {}) {
    const baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rfa-'));
    t.after(() => fsp.rm(baseDir, { recursive: true, force: true }));
    await fsp.mkdir(path.join(baseDir, 'config'), { recursive: true });
    await fsp.writeFile(path.join(baseDir, 'config', 'app.json'), `${JSON.stringify({
        diagnostics: {
            runtimeFailures: {
                enabled: true,
                directory: 'data/runtime/errors',
                maxFileMb,
                maxTotalMb: Math.max(4, maxFileMb),
                repeatWindowMs: 1000,
                retentionDays: 14,
                cleanupIntervalMs: 0
            }
        }
    }, null, 2)}\n`, 'utf8');
    return { baseDir, root: path.join(baseDir, 'data', 'runtime', 'errors') };
}

async function writeLast(root, botId, record, { mtimeMs = null } = {}) {
    const dir = path.join(root, botId);
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'last-error.json');
    await fsp.writeFile(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    if (mtimeMs != null) await fsp.utimes(file, mtimeMs / 1000, mtimeMs / 1000);
    return file;
}

test('repository reads real app.diagnostics.runtimeFailures layout and lists newest nested artifacts', async t => {
    const { baseDir, root } = await fixture(t);
    const now = Date.now();
    await writeLast(root, 'bot-01', {
        failureId: 'f-1', code: 'CRAFTING_OUTPUT_NOT_VERIFIED', occurredAt: '2026-08-24T10:00:00.000Z',
        canonicalError: { severity: 'ERROR', correlationId: 'c-1' }
    }, { mtimeMs: now - 5000 });
    await writeLast(root, 'bot-02', {
        failureId: 'f-2', code: 'GUI_OPEN_TIMEOUT', occurredAt: '2026-08-24T10:01:00.000Z',
        canonicalError: { severity: 'ERROR', correlationId: 'c-2' }
    }, { mtimeMs: now });

    const repository = new RuntimeFailureArtifactRepository({ baseDir });
    const result = repository.list({ limit: 10 });
    assert.equal(result.contract, 'runtime-failure-artifact-v1');
    assert.deepEqual(result.items.map(item => item.botId), ['bot-02', 'bot-01']);
    assert.equal(result.items[0].code, 'GUI_OPEN_TIMEOUT');
    assert.equal(result.items[0].severity, 'ERROR');
    assert.match(result.items[0].id, /^rfa1\./);
    assert.equal(result.warnings.length, 0);

    const filtered = repository.list({ botId: 'bot-01', limit: 10 });
    assert.deepEqual(filtered.items.map(item => item.botId), ['bot-01']);
});

test('opaque artifact IDs cannot be replaced with traversal, absolute paths or unknown suffixes', async t => {
    const { baseDir, root } = await fixture(t);
    await writeLast(root, 'bot-01', { code: 'GUI_OPEN_FAILED' });
    const repository = new RuntimeFailureArtifactRepository({ baseDir });
    for (const invalid of ['../secret.json', 'C:\\secret.json', '/tmp/secret.json', 'last-error.txt', 'rfa1.bad']) {
        assert.throws(() => repository.read(invalid), /artifact ID|Unsupported/);
    }
    assert.throws(() => encodeArtifactId('bot-01', 'errors.txt'), /Unsupported/);
});

test('read fail-softs corrupt JSON and list exposes corruption metadata', async t => {
    const { baseDir, root } = await fixture(t);
    const dir = path.join(root, 'bot-01');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'last-error.json'), '{broken', 'utf8');
    const repository = new RuntimeFailureArtifactRepository({ baseDir });
    const listed = repository.list();
    assert.equal(listed.items.length, 1);
    assert.equal(listed.items[0].corrupt, true);
    const read = repository.read(listed.items[0].id);
    assert.equal(read.record, null);
    assert.equal(read.warnings[0].code, 'RUNTIME_FAILURE_ARTIFACT_CORRUPT');
});

test('reader ignores partial temp file and bounded journal tail skips corrupt/partial entries', async t => {
    const { baseDir, root } = await fixture(t);
    const dir = path.join(root, 'bot-01');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'last-error.json.123.partial.tmp'), '{partial', 'utf8');
    await writeLast(root, 'bot-01', { code: 'COMMAND_SEND_FAILED', failureId: 'last' });
    const journal = [
        JSON.stringify({ failureId: 'a', code: 'COMMAND_SEND_FAILED' }),
        '{corrupt}',
        JSON.stringify({ failureId: 'b', code: 'GUI_OPEN_FAILED' })
    ].join('\n') + '\n{"failureId":"partial"';
    await fsp.writeFile(path.join(dir, 'errors.jsonl'), journal, 'utf8');

    const repository = new RuntimeFailureArtifactRepository({ baseDir });
    assert.equal(repository.list().items.length, 1);
    const tail = repository.tail({ botId: 'bot-01', limit: 20 });
    assert.deepEqual(tail.entries.map(entry => entry.failureId), ['a', 'b']);
    assert.ok(tail.warnings.some(item => item.code === 'RUNTIME_FAILURE_JOURNAL_CORRUPT_ENTRY'));
    assert.ok(tail.warnings.some(item => item.code === 'RUNTIME_FAILURE_JOURNAL_PARTIAL_LINE'));
});

test('large last-error artifact is rejected before read', async t => {
    const { baseDir, root } = await fixture(t, { maxFileMb: 0.001 });
    const dir = path.join(root, 'bot-01');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'last-error.json'), JSON.stringify({ code: 'GUI_OPEN_FAILED', payload: 'x'.repeat(4096) }), 'utf8');
    const repository = new RuntimeFailureArtifactRepository({ baseDir });
    const listed = repository.list();
    assert.equal(listed.items.length, 0);
    assert.ok(listed.warnings.some(item => item.code === 'RUNTIME_FAILURE_ARTIFACT_LIST_SKIPPED'));
    assert.throws(() => repository.read(encodeArtifactId('bot-01')), /exceeds read limit/);
});

test('symlink artifact and symlink bot directory are never followed', async t => {
    const { baseDir, root } = await fixture(t);
    const outside = path.join(baseDir, 'outside.json');
    await fsp.writeFile(outside, JSON.stringify({ secret: 'nope' }), 'utf8');
    await fsp.mkdir(root, { recursive: true });

    const botDir = path.join(root, 'bot-01');
    await fsp.mkdir(botDir, { recursive: true });
    try {
        await fsp.symlink(outside, path.join(botDir, 'last-error.json'));
    } catch (error) {
        if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) return t.skip(`symlink unavailable: ${error.code}`);
        throw error;
    }
    const repository = new RuntimeFailureArtifactRepository({ baseDir });
    assert.equal(repository.list().items.length, 0);
    assert.throws(() => repository.read(encodeArtifactId('bot-01')), /non-symlink/);

    await fsp.rm(botDir, { recursive: true, force: true });
    await fsp.symlink(path.dirname(outside), botDir, 'dir');
    const listed = repository.list();
    assert.equal(listed.items.length, 0);
    assert.ok(listed.warnings.some(item => item.code === 'RUNTIME_FAILURE_BOT_DIRECTORY_UNSAFE'));
});

test('list applies limit before metadata hydration so old corrupt artifacts do not add I/O warnings', async t => {
    const { baseDir, root } = await fixture(t);
    const now = Date.now();
    const oldDir = path.join(root, 'bot-01');
    await fsp.mkdir(oldDir, { recursive: true });
    const oldFile = path.join(oldDir, 'last-error.json');
    await fsp.writeFile(oldFile, '{broken', 'utf8');
    await fsp.utimes(oldFile, (now - 10000) / 1000, (now - 10000) / 1000);
    await writeLast(root, 'bot-02', { failureId: 'new', code: 'GUI_OPEN_FAILED' }, { mtimeMs: now });
    const repository = new RuntimeFailureArtifactRepository({ baseDir });
    const result = repository.list({ limit: 1 });
    assert.deepEqual(result.items.map(item => item.botId), ['bot-02']);
    assert.equal(result.warnings.some(item => item.code === 'RUNTIME_FAILURE_ARTIFACT_CORRUPT'), false);
});
