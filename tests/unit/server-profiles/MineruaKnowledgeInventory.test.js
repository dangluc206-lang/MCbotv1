'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildInventory, validateInventory } = require('../../../scripts/inspect-minerua-knowledge');
const root = path.resolve(__dirname, '../../..');

test('WP-101 inventory covers every command/GUI and maps B1-B5/storage without secrets', () => {
    const inventory = buildInventory();
    assert.deepEqual(validateInventory(inventory), []);
    const commands = require('../../../config/commands/commands.json');
    const windows = require('../../../config/gui/windows.json');
    assert.equal(inventory.facts.filter(f => f.category === 'command').length, Object.keys(commands).length);
    assert.equal(inventory.facts.filter(f => f.category === 'gui-identity').length, Object.keys(windows).length);
    assert.ok(inventory.facts.find(f => f.factId === 'tiers.b1-b5'));
    assert.ok(inventory.facts.find(f => f.factId === 'storage.sell'));
    assert.equal(inventory.safety.secretsCaptured, false);
});

test('WP-101 committed inventory is deterministic and extraction batches are bounded', () => {
    const committed = JSON.parse(fs.readFileSync(path.join(root, 'architecture/server-profiles/minerua-inventory.json'), 'utf8'));
    assert.deepEqual(validateInventory(committed), []);
    for (const id of ['WP-102', 'WP-103', 'WP-104']) {
        assert.ok(Array.isArray(committed.extractionBatches[id]));
        assert.ok(committed.extractionBatches[id].length >= 4 && committed.extractionBatches[id].length <= 12);
    }
    assert.ok(committed.conflictsAndUnknowns.some(item => item.status === 'UNKNOWN'));
});
