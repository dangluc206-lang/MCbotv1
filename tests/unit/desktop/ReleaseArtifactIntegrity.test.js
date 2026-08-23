'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildIntegrityManifest, writeIntegrityFiles } = require('../../../scripts/release-artifact-integrity');

test('WP-402 release artifact manifest is deterministic SHA-256 evidence for exact bytes', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-integrity-'));
    t.after(() => fsp.rm(dir, { recursive: true, force: true }));
    const artifact = path.join(dir, 'update.zip');
    const bytes = Buffer.from('deterministic-update-bytes');
    await fsp.writeFile(artifact, bytes);
    const manifest = await buildIntegrityManifest(artifact, { metadata: { version: 'test' } });
    assert.equal(manifest.contract, 'release-artifact-integrity');
    assert.equal(manifest.version, 1);
    assert.equal(manifest.bytes, bytes.length);
    assert.equal(manifest.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
    const written = await writeIntegrityFiles(artifact);
    assert.match(await fsp.readFile(written.shaPath, 'utf8'), new RegExp(`^${manifest.sha256}  update\\.zip\\n$`));
    assert.equal(JSON.parse(await fsp.readFile(written.manifestPath, 'utf8')).sha256, manifest.sha256);
});
