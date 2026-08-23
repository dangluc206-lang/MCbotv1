'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LegacyModeAdapter = require('../../../src/modes/legacy/LegacyModeAdapter');
const RuntimeModeRegistry = require('../../../src/modes/RuntimeModeRegistry');

function fixture({ ready = true } = {}) {
    const calls = [];
    let generation = 7;
    const service = {
        async enable() { calls.push(['enable']); return { status: 'SUCCESS', action: 'enable' }; },
        async disable(reason) { calls.push(['disable', reason]); return { status: 'SUCCESS', action: 'disable' }; },
        async pause(reason) { calls.push(['pause', reason]); return { status: 'SUCCESS', action: 'pause' }; },
        async resume() { calls.push(['resume']); return { status: 'SUCCESS', action: 'resume' }; },
        status() { return { enabled: true, paused: false, phase: 'RUNNING' }; },
        reconfigure(value) { calls.push(['reconfigure', value]); return { applied: value }; },
        publicConfig() { return { enabled: true, nested: { value: 1 } }; }
    };
    const modeContext = {
        generation: () => generation,
        requireReadyCapabilities(ids, label) {
            calls.push(['ready', [...ids], label]);
            if (!ready) {
                const error = new Error('not ready');
                error.code = 'CAPABILITY_NOT_READY';
                throw error;
            }
            return {};
        }
    };
    return { service, modeContext, calls, setGeneration: value => { generation = value; } };
}

test('legacy adapter delegates lifecycle exactly once while gating enable/resume', async () => {
    const f = fixture();
    const adapter = new LegacyModeAdapter({ modeId: 'collector-b5', service: f.service, modeContext: f.modeContext, requiredCapabilities: ['storage', 'commands'] });
    assert.equal((await adapter.enable()).action, 'enable');
    assert.equal((await adapter.pause('p')).action, 'pause');
    assert.equal((await adapter.resume()).action, 'resume');
    assert.equal((await adapter.disable('d')).action, 'disable');
    assert.deepEqual(f.calls.map(x => x[0]), ['ready', 'enable', 'pause', 'ready', 'resume', 'disable']);
});

test('legacy adapter fails closed before delegate when a capability is not ready', async () => {
    const f = fixture({ ready: false });
    const adapter = new LegacyModeAdapter({ modeId: 'fishing', service: f.service, modeContext: f.modeContext, requiredCapabilities: ['movement'] });
    await assert.rejects(adapter.enable(), error => error.code === 'CAPABILITY_NOT_READY');
    await assert.rejects(adapter.resume(), error => error.code === 'CAPABILITY_NOT_READY');
    assert.equal(f.calls.some(call => call[0] === 'enable' || call[0] === 'resume'), false);
});

test('legacy adapter status preserves legacy fields and exposes generic generation evidence', () => {
    const f = fixture();
    const adapter = new LegacyModeAdapter({ modeId: 'fishing', service: f.service, modeContext: f.modeContext, requiredCapabilities: ['movement'] });
    f.setGeneration(12);
    const status = adapter.status();
    assert.equal(status.enabled, true);
    assert.equal(status.phase, 'RUNNING');
    assert.deepEqual(status.modeAdapter, {
        kind: 'legacy-strangler-v1', modeId: 'fishing', requiredCapabilities: ['movement'], connectionGeneration: 12
    });
    assert.equal(Object.isFrozen(status), true);
});

test('runtime mode registry can control a legacy adapter through the generic contract', async () => {
    const f = fixture();
    const adapter = new LegacyModeAdapter({ modeId: 'fishing', service: f.service, modeContext: f.modeContext, requiredCapabilities: ['movement'] });
    const definition = Object.freeze({ id: 'fishing', serviceName: 'fishingMode', requiredCapabilities: ['movement'] });
    const catalog = { list: () => [definition], require: id => { assert.equal(id, 'fishing'); return definition; } };
    const capabilityRegistry = { missing: () => [] };
    const registry = new RuntimeModeRegistry({ botId: 'bot-01', catalog, capabilityRegistry, services: { fishingMode: adapter } });
    assert.equal((await registry.transition('fishing', 'enable')).action, 'enable');
    assert.equal(registry.status('fishing').status.modeAdapter.kind, 'legacy-strangler-v1');
});


test('legacy adapter keeps compatibility config APIs at the public boundary', () => {
    const f = fixture();
    const adapter = new LegacyModeAdapter({ modeId: 'collector-b5', service: f.service, modeContext: f.modeContext, requiredCapabilities: ['storage'] });
    assert.deepEqual(adapter.reconfigure({ pollIntervalMs: 10 }), { applied: { pollIntervalMs: 10 } });
    const config = adapter.publicConfig();
    assert.deepEqual(config, { enabled: true, nested: { value: 1 } });
    assert.equal(Object.isFrozen(config), true);
    assert.equal(Object.isFrozen(config.nested), true);
    assert.deepEqual(f.calls.at(-1), ['reconfigure', { pollIntervalMs: 10 }]);
});
