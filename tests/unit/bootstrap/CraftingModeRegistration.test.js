'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const createModeCatalog = require('../../../src/bootstrap/createModeCatalog');
const RuntimeModeRegistry = require('../../../src/modes/RuntimeModeRegistry');
const CapabilityRegistry = require('../../../src/core/registry/CapabilityRegistry');

function stubService() {
    const state = { enabled: false, paused: false };
    return {
        status: () => ({ ...state }),
        async enable() { state.enabled = true; state.paused = false; return { success: true }; },
        async disable() { state.enabled = false; return { success: true }; },
        async pause() { state.paused = true; return { success: true }; },
        async resume() { state.paused = false; return { success: true }; }
    };
}

test('bootstrap catalog registers generic crafting mode without b5Craft/collector aliases', () => {
    const catalog = createModeCatalog({ baseDir: path.resolve(__dirname, '../../..') });
    const crafting = catalog.require('crafting');
    assert.equal(crafting.id, 'crafting');
    assert.equal(crafting.serviceName, 'craftingMode');
    assert.equal(crafting.label, 'Chế tạo');
    assert.equal(catalog.has('b5-craft'), false);
    assert.equal(catalog.list().some(entry => entry.serviceName === 'b5CraftMode'), false);
    // G18: collector-b5 removed, no shim kept.
    assert.equal(catalog.has('collector-b5'), false);
    assert.equal(catalog.list().some(entry => entry.serviceName === 'collectorB5Mode'), false);
    assert.throws(() => catalog.require('collector-b5'), /not registered/i);
});

test('runtime resolves crafting mode to the generic service', () => {
    const catalog = createModeCatalog({ baseDir: path.resolve(__dirname, '../../..') });
    const capabilities = new CapabilityRegistry({ botId: 'bot-01' });
    for (const cap of catalog.require('crafting').requiredCapabilities) capabilities.register(cap, {});
    capabilities.seal();
    const craftingService = stubService();
    const registry = new RuntimeModeRegistry({
        botId: 'bot-01',
        catalog,
        capabilityRegistry: capabilities,
        services: { craftingMode: craftingService }
    });
    assert.equal(registry.require('crafting'), craftingService);
    assert.equal(registry.readiness('crafting').serviceBound, true);
    assert.deepEqual(registry.readiness('crafting').missingCapabilities, []);
});

test('registerBotServices binds CraftingModeService as craftingMode without b5CraftMode', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/bootstrap/registerBotServices.js'), 'utf8');
    assert.match(source, /CraftingModeService/);
    assert.match(source, /serviceName:\s*'craftingMode'|craftingMode:\s*craftingMode|services:\s*\{[^}]*craftingMode/);
    assert.equal(source.includes('b5CraftMode'), false);
    assert.equal(source.includes('b5-craft'), false);
});

test('registerBotServices wires the G14.2 procedure runtime and the G21 recorder to capability owners', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/bootstrap/registerBotServices.js'), 'utf8');
    // G14.2: operation procedure navigation runs through capability owners, never raw side effects.
    assert.match(source, /new CraftingProcedureRuntime\(\{\s*commandService,\s*guiManager,\s*navigator: craftingOperation\.navigator/);
    // G21: the recorder binds to live per-bot identity capabilities and is reachable
    // per-bot through both the runtime services map and the server-feature facade.
    assert.match(source, /new ProcedureRecordingRuntime\(\{\s*guiKnowledge,\s*itemResolver,/);
    assert.match(source, /sessionProvider: \(\) => guiManager\.current/);
    assert.match(source, /procedureRecording,/);
});
