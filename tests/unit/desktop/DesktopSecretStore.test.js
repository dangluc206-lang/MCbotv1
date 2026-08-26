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

    assert.equal(store.status().state, 'NOT_CONFIGURED');
    assert.equal(store.status().encryptionAvailable, true);
    assert.deepEqual(store.status().keys, []);
    assert.deepEqual(store.set('DISCORD_TOKEN', 'secret-token'), { key: 'DISCORD_TOKEN', configured: true });
    assert.equal(store.get('DISCORD_TOKEN'), 'secret-token');
    const raw = fs.readFileSync(filePath, 'utf8');
    assert.equal(raw.includes('secret-token'), false);
    assert.equal(store.status().state, 'OK');
    assert.deepEqual(store.status().keys, ['DISCORD_TOKEN']);
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
    assert.equal(store.status().state, 'UNAVAILABLE');
    assert.throws(() => store.set('DISCORD_TOKEN', 'value'), /not available/i);
    assert.equal(store.get('DISCORD_TOKEN'), '');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('XP-016 distinguishes corrupt and decrypt-failed stores without leaking values', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-secret-state-'));
    const filePath = path.join(dir, 'secrets.json');
    fs.writeFileSync(filePath, '{broken json');
    const store = new DesktopSecretStore({ filePath, safeStorage: fakeSafeStorage() });
    assert.equal(store.status().state, 'CORRUPT');
    assert.equal(store.environment({ SAFE: '1' }).SAFE, '1');
    assert.throws(() => store.set('DISCORD_TOKEN', 'must-not-overwrite'), error => error.code === 'SECRET_STORE_CORRUPT');
    assert.equal(store.reset().removed, true);
    assert.equal(store.status().state, 'NOT_CONFIGURED');

    fs.writeFileSync(filePath, JSON.stringify({ DISCORD_TOKEN: Buffer.from('cannot-decrypt').toString('base64') }));
    const decryptFail = new DesktopSecretStore({ filePath, safeStorage: { ...fakeSafeStorage(), decryptString() { throw new Error('provider rejected ciphertext secret-canary'); } } });
    const status = decryptFail.status();
    assert.equal(status.state, 'DECRYPT_FAILED');
    assert.deepEqual(status.failedKeys, ['DISCORD_TOKEN']);
    assert.doesNotMatch(JSON.stringify(status), /secret-canary|cannot-decrypt/);
    assert.equal(decryptFail.get('DISCORD_TOKEN'), '');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('R1 hardening fails closed before parsing or decrypting an oversized secret store', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-secret-bounds-'));
    const filePath = path.join(dir, 'secrets.json');
    fs.writeFileSync(filePath, 'x'.repeat(DesktopSecretStore.MAX_SECRET_FILE_BYTES + 1));
    let decryptCalls = 0;
    const store = new DesktopSecretStore({ filePath, safeStorage: { ...fakeSafeStorage(), decryptString() { decryptCalls += 1; return 'never'; } } });
    const status = store.status();
    assert.equal(status.state, 'CORRUPT');
    assert.equal(status.code, 'SECRET_STORE_TOO_LARGE');
    assert.equal(decryptCalls, 0);
    assert.throws(() => store.set('DISCORD_TOKEN', 'must-not-overwrite'), error => error.code === 'SECRET_STORE_CORRUPT');
    fs.rmSync(dir, { recursive: true, force: true });
});
