'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const GuiRegistry = require('../../../src/gui/GuiRegistry');
const TitleMatcher = require('../../../src/gui/detection/TitleMatcher');
const LayoutMatcher = require('../../../src/gui/detection/LayoutMatcher');
const GuiIdentityEngine = require('../../../src/gui/identity/GuiIdentityEngine');
const definitions = require('../../../config/gui/windows.json');
const config = require('../../../config/gui/identity.json');

function engine(customDefinitions = definitions) {
    return new GuiIdentityEngine({
        registry: new GuiRegistry(customDefinitions),
        titleMatcher: new TitleMatcher(),
        layoutMatcher: new LayoutMatcher(),
        fingerprintMatcher: { match: () => false },
        config
    });
}

function window(title, slotCount = 90) {
    return { title, type: 'minecraft:generic_9x6', slots: Array(slotCount).fill(null) };
}

test('GUI Identity V2 distinguishes MinerUA /kho from /pv 2 even though both titles contain kho', () => {
    const detector = engine();
    const storage = detector.identify(window('ᴋʜᴏ ᴄʜứᴀ ▮▮▮▮▯▯▯▯'));
    const pv2 = detector.identify(window('ᴋʜᴏ đồ #2'));
    assert.equal(storage.id, 'storage');
    assert.ok(storage.confidence >= 0.7);
    assert.equal(pv2.id, 'personalVault2');
    assert.ok(pv2.confidence >= 0.7);
});

test('command context cannot override a strong conflicting /pv 2 identity', () => {
    const result = engine().identify(window('ᴋʜᴏ đồ #2'), {
        expectedId: 'storage',
        source: { commandKey: 'storage', command: '/kho', guiId: 'storage' }
    });
    assert.equal(result.id, 'personalVault2');
    assert.equal(result.accepted, true);
    assert.notEqual(result.id, 'storage');
});

test('command context plus real semantic storage evidence can identify a title-changed /kho', () => {
    const result = engine().identify(window('Container tùy chỉnh'), {
        expectedId: 'storage',
        source: { commandKey: 'storage', command: '/kho', guiId: 'storage' },
        semanticEvidence: [{ candidateId: 'storage', signal: 'storage-capacity-indicator', matched: true, weight: 0.42 }]
    });
    assert.equal(result.id, 'storage');
    assert.ok(result.confidence >= 0.58);
    assert.ok(result.evidence.some(entry => entry.signal === 'storage-capacity-indicator'));
});

test('identity engine rejects ambiguous definitions instead of accepting registry order', () => {
    const detector = engine({
        a: { title: { regex: 'same' } },
        b: { title: { regex: 'same' } }
    });
    const result = detector.identify(window('same'));
    assert.equal(result.id, null);
    assert.equal(result.ambiguous, true);
    assert.equal(result.reason, 'AMBIGUOUS');
});

test('GUI Identity V2 identifies the exact stylized MinerUA /ks minerals title from runtime logs', () => {
    const result = engine().identify(window('ᴋʜᴏáɴɢ ѕảɴ', 63), {
        expectedId: 'minerals',
        source: { commandKey: 'minerals', command: '/ks', guiId: 'minerals' }
    });
    assert.equal(result.id, 'minerals');
    assert.equal(result.accepted, true);
    assert.ok(result.confidence >= config.expectedMinimumConfidence);
});


test('GUI Identity V2 recognizes production small-caps crafting, quantity and smelting titles through shared title normalization', () => {
    const detector = engine();
    const crafting = detector.identify(window('ᴄʜế ᴛạᴏ'), { expectedId: 'crafting' });
    const quantity = detector.identify(window('ѕố ʟượɴɢ'), { expectedId: 'craftingQuantity' });
    const smelting = detector.identify(window('ɴᴜɴɢ'), { expectedId: 'smelting' });
    assert.equal(crafting.id, 'crafting');
    assert.equal(quantity.id, 'craftingQuantity');
    assert.equal(smelting.id, 'smelting');
    assert.equal(crafting.accepted, true);
    assert.equal(quantity.accepted, true);
    assert.equal(smelting.accepted, true);
});

test('GUI Identity V2 identifies MinerUA mineral conversion title instead of retrying /ks', () => {
    const result = engine().identify(window('éᴘ ᴘʜôɪ ᴛʜàɴʜ ᴋʜốɪ', 54), {
        expectedId: 'mineralConversion',
        source: { commandKey: 'minerals', command: '/ks', guiId: 'mineralConversion' }
    });
    assert.equal(result.id, 'mineralConversion');
    assert.equal(result.accepted, true);
    assert.ok(result.confidence >= config.expectedMinimumConfidence);
});

test('GUI Identity V2 strongly separates full MinerUA smelting title from /ks minerals root', () => {
    const detector = engine();
    const smelting = detector.identify(window('ɴᴜɴɢ ᴋʜᴏáɴɢ ѕảɴ', 45), {
        expectedId: 'smelting',
        source: { commandKey: 'smelting', command: '/nung', guiId: 'smelting' }
    });
    assert.equal(smelting.id, 'smelting');
    assert.equal(smelting.accepted, true);
    assert.equal(smelting.ambiguous, false);
    const minerals = detector.identify(window('ᴋʜᴏáɴɢ ѕảɴ', 63), { expectedId: 'minerals' });
    assert.equal(minerals.id, 'minerals');
});
