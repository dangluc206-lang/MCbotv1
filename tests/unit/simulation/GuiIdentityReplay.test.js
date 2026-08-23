'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('../../fixtures/replay/gui-identity-minerua.json');
const GuiRegistry = require('../../../src/gui/GuiRegistry');
const TitleMatcher = require('../../../src/gui/detection/TitleMatcher');
const LayoutMatcher = require('../../../src/gui/detection/LayoutMatcher');
const GuiIdentityEngine = require('../../../src/gui/identity/GuiIdentityEngine');
const definitions = require('../../../config/gui/windows.json');
const config = require('../../../config/gui/identity.json');

test('replays captured MinerUA GUI identities deterministically', () => {
    const engine = new GuiIdentityEngine({
        registry: new GuiRegistry(definitions),
        titleMatcher: new TitleMatcher(),
        layoutMatcher: new LayoutMatcher(),
        fingerprintMatcher: { match: () => false },
        config
    });
    for (const entry of fixture.cases) {
        const result = engine.identify({ title: entry.title, type: 'minecraft:generic_9x6', slots: Array(entry.slotCount).fill(null) });
        assert.equal(result.id, entry.expected, entry.id);
    }
});
