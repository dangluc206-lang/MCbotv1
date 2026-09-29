'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const GENERIC_FINAL = require.resolve('../../../src/server-features/crafting/coordinators/CraftFinalCraftCoordinator');
const LEGACY_FINAL = require.resolve('../../../src/server-features/crafting/b5/B5FinalCraftCoordinator');

function read(resolved) { return fs.readFileSync(resolved, 'utf8'); }

test('B1 -> B2 contract exists at acquisition boundary', () => {
    const source = read(require.resolve('../../../src/server-features/crafting/b5/B5B1InventoryCoordinator'));
    assert.match(source, /stageContract\.requireInputReady/);
    assert.match(source, /stageContract\.handoff\(\{ from: 'B1', to: 'B2'/);
});

test('B2 -> B3 and B3 -> B4 use explicit stage handoff contract', () => {
    const source = read(require.resolve('../../../src/server-features/crafting/b5/B5ReserveChainCoordinator'));
    assert.match(source, /stage: 'B2'/);
    assert.match(source, /nextStage: 'B3'/);
    assert.match(source, /stage: 'B3'/);
    assert.match(source, /nextStage: 'B4'/);
    assert.doesNotMatch(source, /#waitForB2ToSettleBeforeB3/);
});

test('final chain owns B4/B5 settlement and handoff contract', () => {
    // Generic owns the implementation; legacy is kept as a behavior-identical
    // reference until its last runtime/test consumer migrates (Slice 6 final).
    for (const source of [read(GENERIC_FINAL), read(LEGACY_FINAL)]) {
        assert.match(source, /waitForSettledCount/);
        assert.match(source, /stageContract\.verifyOutput/);
        assert.match(source, /stageContract\.requireSettled/);
        assert.match(source, /nextStage/);
        assert.match(source, /CRAFT_FINAL_TARGET_REQUIRED/);
    }
});

