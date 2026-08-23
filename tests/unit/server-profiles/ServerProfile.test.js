'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ServerProfile = require('../../../src/server-profiles/ServerProfile');
const ServerProfileRegistry = require('../../../src/server-profiles/ServerProfileRegistry');
const createServerProfileRegistry = require('../../../src/server-profiles/createServerProfileRegistry');

test('ServerProfile is immutable, secret-free by construction input, and exposes semantic catalogs/bindings', () => {
    const profile = new ServerProfile({ id: 'p', revision: 'r-1', endpoint: { host: 'example.test', port: 25565 }, catalogs: { commands: 'cmd-catalog' }, bindings: { join: 'join-binding' }, capabilities: { commands: true } });
    assert.equal(profile.requireCatalog('commands'), 'cmd-catalog');
    assert.equal(profile.requireBinding('join'), 'join-binding');
    assert.equal(profile.requireCapability('commands'), true);
    assert.throws(() => profile.requireCapability('storage'), error => error.code === 'SERVER_PROFILE_NOT_READY' && error.details.missing === 'capability:storage');
    assert.equal(Object.isFrozen(profile), true);
});

test('ServerProfileRegistry fails closed for missing profile and does not share mutable profile state', () => {
    const registry = new ServerProfileRegistry();
    const a = registry.register(new ServerProfile({ id: 'a', revision: 'r-a', endpoint: { host: 'a.test', port: 1 } }));
    registry.seal();
    assert.equal(registry.require('a'), a);
    assert.throws(() => registry.require('missing'), error => error.code === 'SERVER_PROFILE_NOT_READY');
    assert.throws(() => registry.register(a), /sealed/);
});

test('compat registry preserves current endpoint selection and produces deterministic revision', () => {
    const config = { defaultProfile: 'default', defaults: { auth: 'offline', version: '1.21.1' }, profiles: { default: { host: 'mc.minerua.com', port: 25565 } } };
    const one = createServerProfileRegistry(config).require('default');
    const two = createServerProfileRegistry(JSON.parse(JSON.stringify(config))).require('default');
    assert.deepEqual(one.endpoint, { auth: 'offline', version: '1.21.1', host: 'mc.minerua.com', port: 25565 });
    assert.equal(one.revision, two.revision);
    assert.match(one.revision, /^r-[a-f0-9]{12}$/);
    assert.doesNotMatch(JSON.stringify(one.descriptor()), /password|token/i);
});
