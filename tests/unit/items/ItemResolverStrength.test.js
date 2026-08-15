'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ItemRegistry = require('../../../src/items/ItemRegistry');
const ItemNormalizer = require('../../../src/items/ItemNormalizer');
const ItemResolver = require('../../../src/items/ItemResolver');
const ItemMatcher = require('../../../src/items/matching/ItemMatcher');
const CompositeItemMatcher = require('../../../src/items/matching/CompositeItemMatcher');
const MaterialMatcher = require('../../../src/items/matching/MaterialMatcher');
const IdentityMatcher = require('../../../src/items/matching/IdentityMatcher');

test('resolver prefers MMOItems identity over an earlier vanilla carrier match', () => {
    const registry = new ItemRegistry({
        cobblestone: { representations: { default: { rules: [{ type: 'material', value: 'cobblestone' }] } } },
        super_cobblestone: { representations: {
            default: { rules: [{ type: 'material', value: 'cobblestone' }] },
            inventory: { rules: [{ type: 'identity', value: 'MMOITEMS_ITEM_ID:SIEUDACUOI' }] },
            'personal-vault': { rules: [{ type: 'identity', value: 'MMOITEMS_ITEM_ID:SIEUDACUOI' }] }
        } }
    });
    const normalizer = new ItemNormalizer();
    const matcher = new ItemMatcher({ normalizer, composite: new CompositeItemMatcher({ material: new MaterialMatcher(), identity: new IdentityMatcher() }) });
    const resolver = new ItemResolver({ registry, matcher });
    const raw = { name: 'cobblestone', count: 64, identityComponents: ['MMOITEMS_ITEM_ID:SIEUDACUOI'], customMetadataPresent: true };
    assert.equal(resolver.resolve(raw, 'inventory').id, 'super_cobblestone');
    assert.equal(resolver.resolve(raw, 'personal-vault').id, 'super_cobblestone');
});
