'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ServerProfile = require('../../../src/server-profiles/ServerProfile');
const GuiRegistry = require('../../../src/gui/GuiRegistry');
const GuiIdentityEngine = require('../../../src/gui/identity/GuiIdentityEngine');
const TitleMatcher = require('../../../src/gui/detection/TitleMatcher');
const LayoutMatcher = require('../../../src/gui/detection/LayoutMatcher');
const SlotFingerprintMatcher = require('../../../src/gui/detection/SlotFingerprintMatcher');
const ItemRegistry = require('../../../src/items/ItemRegistry');
const ItemResolver = require('../../../src/items/ItemResolver');
const ItemNormalizer = require('../../../src/items/ItemNormalizer');
const ItemMatcher = require('../../../src/items/matching/ItemMatcher');
const Composite = require('../../../src/items/matching/CompositeItemMatcher');
const Material = require('../../../src/items/matching/MaterialMatcher');
const B5TraceRecorder = require('../../../src/server-features/crafting/b5/trace/B5TraceRecorder');

function resolverFor(items) {
    return new ItemResolver({
        registry: new ItemRegistry(items),
        matcher: new ItemMatcher({ normalizer: new ItemNormalizer(), composite: new Composite({ material: new Material() }) })
    });
}

test('WP-103 fake profile supplies distinct GUI and item identity without changing generic engines', () => {
    const profile = new ServerProfile({
        id: 'fake', revision: 'r-fake-gui', endpoint: { host: 'fake.test' },
        catalogs: {
            guiWindows: { storage: { title: { value: 'FAKE VAULT', exact: true }, layout: {} } },
            guiIdentity: { minimumConfidence: 0.62, minimumMargin: 0.08 },
            guiSlots: {},
            items: { vault_marker: { representations: { gui: { rules: [{ type: 'material', value: 'emerald' }] } } } }
        }, capabilities: { gui: true, items: true }
    });
    const itemResolver = resolverFor(profile.requireCatalog('items'));
    assert.equal(itemResolver.resolve({ name: 'emerald', count: 1 }, 'gui').id, 'vault_marker');
    const registry = new GuiRegistry(profile.requireCatalog('guiWindows'));
    const titleMatcher = new TitleMatcher();
    const layoutMatcher = new LayoutMatcher();
    const fingerprintMatcher = new SlotFingerprintMatcher({ itemResolver });
    const engine = new GuiIdentityEngine({ registry, titleMatcher, layoutMatcher, fingerprintMatcher, config: profile.requireCatalog('guiIdentity') });
    const identified = engine.identify({ title: 'FAKE VAULT', slots: [] });
    assert.equal(identified.accepted, true);
    assert.equal(identified.id, 'storage');
});

test('WP-103 profile facts are immutable per profile and profile revision is attached to B5 trace evidence', () => {
    const mutable = { marker: { representations: { inventory: { rules: [{ type: 'material', value: 'stone' }] } } } };
    const profile = new ServerProfile({ id: 'p', revision: 'r-profile-9', endpoint: { host: 'p.test' }, catalogs: { items: mutable } });
    mutable.marker.representations.inventory.rules[0].value = 'diamond';
    assert.equal(profile.requireCatalog('items').marker.representations.inventory.rules[0].value, 'stone');
    assert.throws(() => { profile.requireCatalog('items').marker = {}; }, TypeError);
    const trace = new B5TraceRecorder({ botId: 'bot-01', serverProfile: profile }).recordResult({ success: true, status: 'SUCCESS', data: {} });
    assert.equal(trace.serverProfileId, 'p');
    assert.equal(trace.serverProfileRevision, 'r-profile-9');
});
