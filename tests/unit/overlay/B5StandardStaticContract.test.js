'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

test('B1 -> B2 contract exists at acquisition boundary', () => {
    const source = read('src/server-features/crafting/b5/B5B1InventoryCoordinator.js');
    assert.match(source, /stageContract\.requireInputReady/);
    assert.match(source, /stageContract\.handoff\(\{ from: 'B1', to: 'B2'/);
});

test('B2 -> B3 and B3 -> B4 use explicit stage handoff contract', () => {
    const source = read('src/server-features/crafting/b5/B5ReserveChainCoordinator.js');
    assert.match(source, /stage: 'B2'/);
    assert.match(source, /nextStage: 'B3'/);
    assert.match(source, /stage: 'B3'/);
    assert.match(source, /nextStage: 'B4'/);
    assert.doesNotMatch(source, /#waitForB2ToSettleBeforeB3/);
});

test('final chain owns B4/B5 settlement and handoff contract', () => {
    const source = read('src/server-features/crafting/b5/B5FinalCraftCoordinator.js');
    assert.match(source, /waitForSettledCount/);
    assert.match(source, /stageContract\.verifyOutput/);
    assert.match(source, /stageContract\.requireSettled/);
    assert.match(source, /nextStage/);
});

