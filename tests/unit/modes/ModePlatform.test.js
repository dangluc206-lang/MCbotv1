'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ModeCatalog = require('../../../src/modes/ModeCatalog');
const RuntimeModeRegistry = require('../../../src/modes/RuntimeModeRegistry');
const ModeControlService = require('../../../src/modes/ModeControlService');
const CapabilityRegistry = require('../../../src/core/registry/CapabilityRegistry');
const Result = require('../../../src/shared/result/Result');

function modeService(initial = {}) {
    const state = { enabled: Boolean(initial.enabled), paused: false };
    return {
        status: () => ({ ...state }),
        async enable() { state.enabled = true; state.paused = false; return Result.ok(this.status()); },
        async disable() { state.enabled = false; state.paused = false; return Result.ok(this.status()); },
        async pause() { state.paused = true; return Result.ok(this.status()); },
        async resume() { state.paused = false; return Result.ok(this.status()); }
    };
}

test('mode platform resolves generic definitions and switches primary modes without hard-coded names', async () => {
    const catalog = new ModeCatalog([
        { id: 'mining', serviceName: 'miningMode', requiredCapabilities: ['movement', 'mining'], requestedResources: ['primary-mode'] },
        { id: 'farming', serviceName: 'farmingMode', requiredCapabilities: ['movement'], requestedResources: ['primary-mode'] }
    ]).seal();
    const capabilities = new CapabilityRegistry({ botId: 'bot-01' });
    capabilities.register('movement', {}).register('mining', {}).seal();
    const mining = modeService();
    const farming = modeService({ enabled: true });
    const registry = new RuntimeModeRegistry({
        botId: 'bot-01', catalog, capabilityRegistry: capabilities,
        services: { miningMode: mining, farmingMode: farming }
    });
    const control = new ModeControlService({ botId: 'bot-01', registry });
    const started = await control.start('mining');
    assert.equal(started.success, true);
    assert.equal(mining.status().enabled, true);
    assert.equal(farming.status().enabled, false);
    assert.equal(registry.status('mining').readiness.ready, true);
});

test('mode platform blocks a mode when required capabilities are absent', async () => {
    const catalog = new ModeCatalog([{ id: 'mining', serviceName: 'miningMode', requiredCapabilities: ['movement', 'mining'] }]).seal();
    const capabilities = new CapabilityRegistry({ botId: 'bot-01' });
    capabilities.register('movement', {}).seal();
    const registry = new RuntimeModeRegistry({ botId: 'bot-01', catalog, capabilityRegistry: capabilities, services: { miningMode: modeService() } });
    const control = new ModeControlService({ botId: 'bot-01', registry });
    const result = await control.start('mining');
    assert.equal(result.success, false);
    assert.equal(result.status, 'NOT_READY');
    assert.deepEqual(registry.readiness('mining').missingCapabilities, ['mining']);
});

test('ModeControlService classifies thrown runtime/readiness failures without rewriting them as INVALID_INPUT', async () => {
    const catalog = new ModeCatalog([{ id: 'mining', serviceName: 'miningMode', requiredCapabilities: ['movement'] }]).seal();
    const capabilities = new CapabilityRegistry({ botId: 'bot-01' }).register('movement', {}).seal();
    const makeControl = code => {
        const service = modeService();
        service.enable = async () => {
            const error = new Error(code);
            error.code = code;
            throw error;
        };
        const registry = new RuntimeModeRegistry({
            botId: 'bot-01', catalog, capabilityRegistry: capabilities, services: { miningMode: service }
        });
        return new ModeControlService({ botId: 'bot-01', registry });
    };

    const notReady = await makeControl('CAPABILITY_NOT_READY').start('mining');
    assert.equal(notReady.status, 'NOT_READY');

    const disconnected = await makeControl('COMMAND_STALE_GENERATION').start('mining');
    assert.equal(disconnected.status, 'DISCONNECTED');

    const timeout = await makeControl('TIMEOUT').start('mining');
    assert.equal(timeout.status, 'TIMEOUT');
});

test('ModeControlService keeps invalid mode identifiers as INVALID_INPUT', async () => {
    const catalog = new ModeCatalog([]).seal();
    const capabilities = new CapabilityRegistry({ botId: 'bot-01' }).seal();
    const registry = new RuntimeModeRegistry({ botId: 'bot-01', catalog, capabilityRegistry: capabilities });
    const control = new ModeControlService({ botId: 'bot-01', registry });
    const result = await control.start('missing-mode');
    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'MODE_NOT_REGISTERED');
    assert.equal(result.status, 'INVALID_INPUT');
});
