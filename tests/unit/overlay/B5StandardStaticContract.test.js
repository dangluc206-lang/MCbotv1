'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const GENERIC_FINAL = require.resolve('../../../src/server-features/crafting/coordinators/CraftFinalCraftCoordinator');
const GENERIC_RESERVE = require.resolve('../../../src/server-features/crafting/coordinators/CraftReserveChainCoordinator');
const GENERIC_BASE = require.resolve('../../../src/server-features/crafting/coordinators/CraftBaseInventoryCoordinator');

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
    // E-FINAL: generic owns the implementation; the legacy B5 final-chain
    // reference file was deleted (dead - no runtime/test consumer remains).
    const source = read(GENERIC_FINAL);
    assert.match(source, /waitForSettledCount/);
    assert.match(source, /stageContract\.verifyOutput/);
    assert.match(source, /stageContract\.requireSettled/);
    assert.match(source, /nextStage/);
    assert.match(source, /CRAFT_FINAL_TARGET_REQUIRED/);
});

test('generic reserve/base coordinators own the stage handoff contract', () => {
    for (const resolved of [GENERIC_RESERVE, GENERIC_BASE]) {
        const source = read(resolved);
        assert.match(source, /stageContract/);
    }
});

