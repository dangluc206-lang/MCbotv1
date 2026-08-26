'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CapabilityInstaller = require('../../../src/bootstrap/installers/CapabilityInstaller');
const RuntimePlatformInstaller = require('../../../src/bootstrap/installers/RuntimePlatformInstaller');
const LifecycleInstaller = require('../../../src/bootstrap/installers/LifecycleInstaller');

test('capability installer registers only present providers then seals exactly once', () => {
    const calls = [];
    const registry = { register:(...args) => calls.push(args), seal:() => calls.push(['seal']) };
    new CapabilityInstaller({ registry }).install({ a:{}, absent:null }, { a:{ version:'1.0.0' } });
    assert.deepEqual(calls.map(call => call[0]), ['a', 'seal']);
    assert.equal(calls[0][2].version, '1.0.0');
});

test('runtime platform probes preserve connection, readiness and operation semantics', () => {
    const probes = new Map();
    const healthRegistry = { register:(id, probe, options) => probes.set(id, { probe, options }) };
    new RuntimePlatformInstaller({
        healthRegistry, context:{ has:() => false },
        modeRegistry:{ status:() => ({ modes:[{ definition:{ id:'x' }, readiness:{ ready:false, missingCapabilities:['gui'], serviceBound:true } }] }) },
        operationManager:{ snapshot:() => ({ closed:false, active:1, pending:2, running:1 }) }
    }).install();
    assert.equal(probes.get('connection').probe().state, 'UNKNOWN');
    assert.equal(probes.get('mode-readiness').probe().state, 'UNHEALTHY');
    assert.equal(probes.get('mode-readiness').options.critical, true);
    assert.equal(probes.get('operations').probe().details.pending, 2);
});

test('lifecycle installer keeps required order, skips absent optionals and appends custom modes', () => {
    const a = { name:'a' }, b = { name:'b' }, c = { name:'c' };
    assert.deepEqual(LifecycleInstaller.collect([a], [null, b], { custom:c }), [a, b, c]);
});
