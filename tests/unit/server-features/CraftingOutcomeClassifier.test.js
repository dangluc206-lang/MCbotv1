'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CraftingOutcomeClassifier = require('../../../src/server-features/crafting/CraftingOutcomeClassifier');

test('verified crafting outcome never requests reconciliation', () => {
    const result = CraftingOutcomeClassifier.classify({ verified: true }, {
        recipeId: 'r', outputId: 'out', quantity: 1
    });
    assert.equal(result.state, 'VERIFIED');
    assert.equal(result.requiresReconciliation, false);
    assert.equal(result.safeToBlindRetry, false);
});

test('failed verifier after quantity click is uncertain even when no mirrored delta is visible', () => {
    const result = CraftingOutcomeClassifier.classify({
        verified: false,
        delta: 0,
        inputEvidence: [],
        snapshotMmoCandidates: [],
        eventEvidence: { outputDelta: 0, eventCount: 0, mmoCandidates: [] }
    }, { recipeId: 'r', outputId: 'out', quantity: 'ALL' });
    assert.equal(result.state, 'UNCERTAIN');
    assert.equal(result.requiresReconciliation, true);
    assert.equal(result.safeToBlindRetry, false);
    assert.equal(result.observedSideEffect, false);
});

test('unexpected MMOItems deltas and input consumption mark concrete side-effect evidence', () => {
    const result = CraftingOutcomeClassifier.classify({
        verified: false,
        delta: 0,
        inputEvidence: [{ inputId: 'b2', consumed: 16, source: 'bot-inventory' }],
        snapshotMmoCandidates: [{ identity: 'MMOITEMS_ITEM_ID:OTHER', delta: 2 }],
        eventEvidence: { outputDelta: 0, eventCount: 4, mmoCandidates: [] },
        syncEvidence: { timedOut: true }
    }, { recipeId: 'b3', outputId: 'b3', quantity: 'ALL' });
    assert.equal(result.observedSideEffect, true);
    assert.equal(result.inputConsumption[0].consumed, 16);
    assert.equal(result.unexpectedIdentityDeltas[0].identity, 'MMOITEMS_ITEM_ID:OTHER');
    assert.equal(result.syncTimedOut, true);
});
