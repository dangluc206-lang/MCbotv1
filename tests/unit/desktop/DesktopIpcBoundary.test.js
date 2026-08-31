'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const DesktopApiContract = require('../../../src/desktop/contracts/DesktopApiContract');

test('Desktop IPC catalog is internally consistent', () => {
    assert.doesNotThrow(() => DesktopApiContract.assertCatalogIntegrity());
    for (const [channel, definition] of Object.entries(DesktopApiContract.CATALOG)) {
        assert.equal(definition.channel, channel);
        assert.ok(DesktopApiContract.PERMISSIONS.includes(definition.permission));
        assert.equal(definition.sender, 'EXACT_RENDERER_URL');
        assert.equal(definition.request, 'structured-clone-bounded');
        assert.equal(definition.response, DesktopApiContract.CONTRACT);
    }
});

test('Desktop IPC catalog fails closed when a channel definition is malformed', () => {
    assert.throws(
        () => DesktopApiContract.assertChannelDefinition('mcbot:test', {
            channel: 'mcbot:test',
            owner: 'desktop',
            permission: 'ROOT',
            sender: 'EXACT_RENDERER_URL',
            request: 'structured-clone-bounded',
            response: DesktopApiContract.CONTRACT
        }),
        { code: 'DESKTOP_IPC_CATALOG_PERMISSION' }
    );

    assert.throws(
        () => DesktopApiContract.assertChannelDefinition('mcbot:test', {
            channel: 'mcbot:other',
            owner: 'desktop',
            permission: 'READ',
            sender: 'EXACT_RENDERER_URL',
            request: 'structured-clone-bounded',
            response: DesktopApiContract.CONTRACT
        }),
        { code: 'DESKTOP_IPC_CATALOG_CHANNEL' }
    );

    assert.throws(
        () => DesktopApiContract.assertChannelDefinition('mcbot:test', {
            channel: 'mcbot:test',
            owner: 'desktop',
            permission: 'READ',
            sender: 'ANY_RENDERER',
            request: 'structured-clone-bounded',
            response: DesktopApiContract.CONTRACT
        }),
        { code: 'DESKTOP_IPC_CATALOG_SENDER' }
    );
});

test('Desktop IPC request validation uses the catalog definition as the execution boundary', () => {
    const definition = DesktopApiContract.validateRequest('mcbot:profiles:list', []);
    assert.equal(definition.permission, 'READ');
    assert.equal(definition.owner, 'fleet');
});

test('Desktop IPC request validation rejects unknown channels before any handler can be selected', () => {
    assert.throws(
        () => DesktopApiContract.validateRequest('mcbot:not-registered', []),
        { code: 'DESKTOP_IPC_UNKNOWN_CHANNEL' }
    );
});
