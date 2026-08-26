'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const DesktopApiContract = require('../../../src/desktop/contracts/DesktopApiContract');

const root = path.resolve(__dirname, '..', '..', '..');

test('DesktopApiContract exactly catalogs every registered request channel', () => {
    const main = fs.readFileSync(path.join(root, 'src/desktop/main.js'), 'utf8');
    const channels = [...main.matchAll(/safeHandle\('([^']+)'/g)].map(match => match[1]).sort();
    assert.deepEqual(Object.keys(DesktopApiContract.CATALOG).sort(), channels);
    assert.equal(new Set(channels).size, channels.length);
    for (const channel of channels) {
        const definition = DesktopApiContract.CATALOG[channel];
        assert.match(definition.owner, /^[a-z]+$/);
        assert.match(definition.permission, /^(READ|PATCH|DEVELOP|ADMIN)$/);
        assert.equal(definition.sender, 'EXACT_RENDERER_URL');
    }
});

test('DesktopApiContract fails closed for unknown, hostile or oversized input', () => {
    assert.throws(() => DesktopApiContract.validateRequest('mcbot:unknown', []), { code: 'DESKTOP_IPC_UNKNOWN_CHANNEL' });
    assert.throws(() => DesktopApiContract.validateRequest('mcbot:profiles:create', [{ constructor: 'bad' }]), { code: 'DESKTOP_IPC_INPUT_KEY' });
    assert.throws(() => DesktopApiContract.validateRequest('mcbot:profiles:create', [{ value: 'x'.repeat(65537) }]), { code: 'DESKTOP_IPC_INPUT_STRING_SIZE' });
    assert.throws(() => DesktopApiContract.validateRequest('mcbot:profiles:create', [{ value: Infinity }]), { code: 'DESKTOP_IPC_INPUT_NUMBER' });
});

test('DesktopApiContract envelopes are versioned and never expose stack', () => {
    assert.deepEqual(DesktopApiContract.success({ ok: true }), { contract: 'desktop-api-v1', success: true, data: { ok: true } });
    const error = Object.assign(new Error('failed'), { code: 'SYNTHETIC' });
    const envelope = DesktopApiContract.failure(error);
    assert.equal(envelope.contract, 'desktop-api-v1');
    assert.equal(envelope.error.code, 'SYNTHETIC');
    assert.equal(Object.hasOwn(envelope.error, 'stack'), false);
});
