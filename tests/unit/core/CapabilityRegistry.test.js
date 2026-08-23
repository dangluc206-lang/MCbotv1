'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CapabilityRegistry = require('../../../src/core/registry/CapabilityRegistry');

test('CapabilityRegistry registers, resolves, reports missing requirements, and seals', () => {
    const movement = { name: 'movement' };
    const registry = new CapabilityRegistry({ botId: 'bot-01' });
    registry.register('movement', movement, { tags: ['core', 'navigation'] });
    registry.register('storage', { name: 'storage' });
    assert.equal(registry.require('movement'), movement);
    assert.deepEqual(registry.missing(['movement', 'crafting', 'storage']), ['crafting']);
    assert.throws(() => registry.assertAvailable(['movement', 'crafting'], 'mining'), error => {
        assert.equal(error.code, 'CAPABILITY_REQUIREMENTS_UNMET');
        assert.deepEqual(error.missingCapabilities, ['crafting']);
        return true;
    });
    registry.seal();
    assert.throws(() => registry.register('crafting', {}), /sealed/);
    assert.deepEqual(registry.snapshot().capabilities.map(item => item.id), ['movement', 'storage']);
});
