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

test('bootstrap catalog registers generic crafting mode without b5Craft alias', () => {
    const catalog = createModeCatalog({ baseDir: path.resolve(__dirname, '../../..') });
    const crafting = catalog.require('crafting');
    assert.equal(crafting.id, 'crafting');
    assert.equal(crafting.serviceName, 'craftingMode');
    assert.equal(crafting.label, 'Chế tạo');
    assert.equal(catalog.has('b5-craft'), false);
    assert.equal(catalog.list().some(entry => entry.serviceName === 'b5CraftMode'), false);
    const collector = catalog.require('collector-b5');
    assert.equal(collector.serviceName, 'collectorB5Mode');
    assert.equal(collector.id, 'collector-b5');
});

test('runtime resolves crafting mode to the generic service, not collector legacy', () => {
    const catalog = createModeCatalog({ baseDir: path.resolve(__dirname, '../../..') });
    const capabilities = new CapabilityRegistry({ botId: 'bot-01' });
    for (const cap of catalog.require('crafting').requiredCapabilities) capabilities.register(cap, {});
    for (const cap of catalog.require('collector-b5').requiredCapabilities) {
        if (!capabilities.has(cap)) capabilities.register(cap, {});
    }
    capabilities.seal();
    const craftingService = stubService();
    const collectorService = stubService();
    const registry = new RuntimeModeRegistry({
        botId: 'bot-01',
        catalog,
        capabilityRegistry: capabilities,
        services: { craftingMode: craftingService, collectorB5Mode: collectorService }
    });
    assert.equal(registry.require('crafting'), craftingService);
    assert.equal(registry.require('collector-b5'), collectorService);
    assert.notEqual(registry.require('crafting'), registry.require('collector-b5'));
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
