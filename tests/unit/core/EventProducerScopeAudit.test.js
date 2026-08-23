'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scopeFor, CONNECTION_SCOPED_EVENTS } = require('../../../src/core/events/EventScopeRegistry');

const ROOT = path.resolve(__dirname, '../../..');
const EXPECTED = Object.freeze({
    'command:message':'connection',
    'connection:attempt-failed':'bot', 'connection:attempt-started':'bot',
    'connection:client-attached':'connection', 'connection:connecting':'bot', 'connection:disabled':'bot',
    'connection:ended':'connection', 'connection:error':'connection', 'connection:failed':'connection',
    'connection:kicked':'connection', 'connection:login':'connection', 'connection:spawned':'connection',
    'fishing:packet-observation':'connection',
    'gui:closed':'connection', 'gui:opened':'connection', 'gui:updated':'connection',
    'inventory:delta':'connection', 'inventory:observed':'connection',
    'mode:collector-b5:config-updated':'bot', 'mode:collector-b5:cycle-completed':'bot', 'mode:collector-b5:error':'bot',
    'mode:collector-b5:paused':'bot', 'mode:collector-b5:resumed':'bot', 'mode:fishing:catch':'connection',
    'movement:position':'connection', 'movement:teleport':'connection', 'player:death':'connection',
    'reconnect:attempting':'bot', 'reconnect:cancelled':'bot', 'reconnect:exhausted':'bot', 'reconnect:resumed':'bot', 'reconnect:scheduled':'bot', 'reconnect:succeeded':'bot', 'reconnect:suspended':'bot',
    'resource-pack:accepted':'connection', 'resource-pack:disabled':'connection', 'resource-pack:failed':'connection',
    'resource-pack:ready':'connection', 'resource-pack:requested':'connection', 'runtime:failure':'bot',
    'server-login:disabled':'connection', 'server-login:failed':'connection', 'server-login:started':'connection', 'server-login:succeeded':'connection',
    'skyblock:gateway:attempting':'connection', 'skyblock:gateway:failed':'connection', 'skyblock:gateway:scheduled':'connection',
    'skyblock:gateway:succeeded':'connection'
});

function jsFiles(directory, result = []) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) jsFiles(full, result);
        else if (entry.isFile() && entry.name.endsWith('.js')) result.push(full);
    }
    return result;
}

function internalEventNames() {
    const names = new Set();
    const pattern = /(?:this\.)?eventBus(?:\?)?\.(?:emit|on|once)\(\s*['"]([^'"]+)['"]/g;
    for (const file of jsFiles(path.join(ROOT, 'src'))) {
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(pattern)) names.add(match[1]);
    }
    return [...names].sort();
}

function emittedEventNames() {
    const names = new Set();
    const pattern = /(?:this\.)?eventBus(?:\?)?\.emit\(\s*['"]([^'"]+)['"]/g;
    for (const file of jsFiles(path.join(ROOT, 'src'))) {
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(pattern)) names.add(match[1]);
    }
    return names;
}

test('every literal internal EventBus event has an explicit audited bot/connection scope decision', () => {
    const names = internalEventNames();
    assert.deepEqual(names, Object.keys(EXPECTED).sort(), 'update the explicit audit table when an internal event is added/removed');
    for (const [eventName, expectedScope] of Object.entries(EXPECTED)) {
        assert.equal(scopeFor(eventName), expectedScope, eventName);
    }
});

test('every registered connection-scoped event has a runtime producer covered by the source audit', () => {
    const emitted = emittedEventNames();
    const missing = CONNECTION_SCOPED_EVENTS.filter(eventName => !emitted.has(eventName));
    assert.deepEqual(missing, []);
});

test('key connection-owned producers use canonical connectionGeneration and no live generation alias', () => {
    const files = [
        'src/bootstrap/createConnectionEventBinding.js',
        'src/items/inventory/observation/InventoryObservationService.js',
        'src/modes/fishing/FishingModeService.js',
        'src/modes/fishing/ConnectionPacketObserver.js'
    ];
    for (const relative of files) {
        const source = fs.readFileSync(path.join(ROOT, relative), 'utf8');
        assert.match(source, /connectionGeneration/, `${relative} must carry canonical connectionGeneration`);
        assert.doesNotMatch(source, /eventBus(?:\?)?\.emit\([^;]*\bgeneration\s*:/s, `${relative} must not emit legacy generation`);
    }
});
