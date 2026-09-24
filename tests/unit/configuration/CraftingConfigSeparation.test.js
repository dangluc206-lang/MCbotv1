'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const groupSchemas = require('../../../src/configuration/schemas/group.schemas');
const ConfigSpecs = require('../../../src/configuration/ConfigSpecs');
const LiveConfigApplier = require('../../../src/desktop/use-cases/LiveConfigApplier');

const ROOT = path.resolve(__dirname, '../../..');

function loadJson(relative) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
}

function specFor(key) {
    return ConfigSpecs.find(entry => entry.key === key);
}

// Generic crafting config must not carry B5-only policy; B5 stays for compat consumers.
const B5_ONLY_KEYS = [
    'targetId',
    'timeoutMs',
    'inventorySafetyEmptySlots',
    'pvInventorySettleTimeoutMs',
    'pvInventorySettlePollMs',
    'quantityOptimization',
    'b3AllMinEmptySlots',
    'b1SupplyMode',
    'b2InputSource',
    'personalVaultBackpressure'
];

test('craftingMode file/schema stay generic: no postB5CooldownMs, no B5-only policy', () => {
    const crafting = loadJson(specFor('craftingMode').file);
    assert.equal('postB5CooldownMs' in crafting, false, 'generic crafting must not use postB5CooldownMs');
    for (const key of B5_ONLY_KEYS) {
        assert.equal(key in crafting, false, `generic crafting must not contain B5-only key: ${key}`);
    }
    const valid = groupSchemas.craftingMode(crafting);
    assert.equal(valid.valid, true, `current crafting.json must validate: ${valid.errors.join('; ')}`);

    const withLegacy = { ...crafting, postB5CooldownMs: 5 };
    const legacyRejected = groupSchemas.craftingMode(withLegacy);
    assert.equal(legacyRejected.valid, false);
    assert.match(legacyRejected.errors.join('\n'), /postB5CooldownMs/);

    for (const key of ['b2InputSource', 'targetId', 'quantityOptimization', 'personalVaultBackpressure']) {
        const candidate = { ...crafting, [key]: key === 'quantityOptimization' ? {} : 'x' };
        const rejected = groupSchemas.craftingMode(candidate);
        assert.equal(rejected.valid, false, `craftingMode schema must reject B5-only key: ${key}`);
    }
});

test('b5 compatibility config is preserved and still validates', () => {
    const spec = specFor('b5');
    assert.ok(spec, 'b5 spec must remain while compat consumers exist');
    const b5 = loadJson(spec.file);
    assert.equal(typeof b5.targetId, 'string');
    const valid = groupSchemas.b5(b5);
    assert.equal(valid.valid, true, `b5 must validate: ${valid.errors.join('; ')}`);
});

test('reload path keeps generic reconfigure separate from B5 rules boundary', async () => {
    const calls = [];
    const fakeMode = {
        reconfigure(value) { calls.push(['reconfigure', value]); },
        queueRulesConfig(value) { calls.push(['queueRulesConfig', value]); return { status: 'QUEUED' }; },
        status: () => ({ enabled: true })
    };
    const runtime = { getService: name => (name === 'craftingMode' ? fakeMode : null) };

    const generic = loadJson(specFor('craftingMode').file);
    assert.equal(await LiveConfigApplier.apply({ key: 'craftingMode', value: generic, runtimes: [runtime] }), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'reconfigure');

    calls.length = 0;
    const b5 = loadJson(specFor('b5').file);
    assert.equal(await LiveConfigApplier.apply({ key: 'b5', value: b5, runtimes: [runtime] }), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'queueRulesConfig');
});

test('bootstrap wires generic craftingMode without serverTimings/postB5 merge', () => {
    const botServices = fs.readFileSync(path.join(ROOT, 'src/bootstrap/registerBotServices.js'), 'utf8');
    assert.match(botServices, /configuration\.registry\.require\("craftingMode"\)/);
    assert.equal(botServices.includes('requireCatalog("serverTimings")'), false);
    assert.equal(botServices.includes('postB5CooldownMs'), false);
    const sharedServices = fs.readFileSync(path.join(ROOT, 'src/bootstrap/registerSharedServices.js'), 'utf8');
    assert.equal(sharedServices.includes('postB5CooldownMs'), false);
    assert.equal(sharedServices.includes('serverTimings'), false);
});
