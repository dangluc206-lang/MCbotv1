'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const DesktopSecretStore = require('../../../src/desktop/DesktopSecretStore');

function fakeSafeStorage(available = true) {
    return {
        isEncryptionAvailable: () => available,
        encryptString: value => Buffer.from(`enc:${value}`, 'utf8'),
        decryptString: buffer => String(buffer).replace(/^enc:/, '')
    };
}

test('DesktopSecretStore encrypts values, exposes only key status, merges environment and clears secrets', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-secret-store-'));
    const filePath = path.join(dir, 'secrets.json');
    const store = new DesktopSecretStore({ filePath, safeStorage: fakeSafeStorage() });

    assert.deepEqual(store.status(), { encryptionAvailable: true, keys: [] });
    assert.deepEqual(store.set('DISCORD_TOKEN', 'secret-token'), { key: 'DISCORD_TOKEN', configured: true });
    assert.equal(store.get('DISCORD_TOKEN'), 'secret-token');
    const raw = fs.readFileSync(filePath, 'utf8');
    assert.equal(raw.includes('secret-token'), false);
    assert.deepEqual(store.status(), { encryptionAvailable: true, keys: ['DISCORD_TOKEN'] });
    assert.deepEqual(store.environment({ NODE_ENV: 'test' }), { NODE_ENV: 'test', DISCORD_TOKEN: 'secret-token' });
    assert.deepEqual(store.clear('DISCORD_TOKEN'), { key: 'DISCORD_TOKEN', configured: false });
    assert.throws(() => store.set('NODE_OPTIONS', '--require bad.js'), /Unsupported desktop secret key/);
    assert.equal(store.get('DISCORD_TOKEN'), '');

    fs.rmSync(dir, { recursive: true, force: true });
});

test('DesktopSecretStore refuses writes when OS encryption is unavailable', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-secret-store-off-'));
    const store = new DesktopSecretStore({ filePath: path.join(dir, 'secrets.json'), safeStorage: fakeSafeStorage(false) });
    assert.equal(store.status().encryptionAvailable, false);
    assert.throws(() => store.set('DISCORD_TOKEN', 'value'), /not available/i);
    assert.equal(store.get('DISCORD_TOKEN'), '');
    fs.rmSync(dir, { recursive: true, force: true });
});
