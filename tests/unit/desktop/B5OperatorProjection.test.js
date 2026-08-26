'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const B5OperatorProjection = require('../../../src/desktop/b5/B5OperatorProjection');

test('B5OperatorProjection exposes exact immutable reserve and sell contract', () => {
    const output = B5OperatorProjection.projectBot({
        botId: 'bot-01', connectionGeneration: 8,
        modes: { b5Craft: { phase: 'WAITING_BLOCKED', enabled: true, details: {
            batchId: 'batch-1', batchProtectionCompleted: false,
            recovery: { safeState: 'CRAFT_NOT_STARTED', allowedActions: ['retry-storage-protection', 'inspect-diagnostic'] },
            protectionEpisode: { state: 'WAITING_BLOCKED', episodeId: 'episode-1', correlationId: 'incident-1', baselineDigest: 'abc', retainedRemainderItems: 63, remainingSellStacks: 2, blocker: { step: 'sell', backoffMs: 5000 } }
        } } }
    }, { now: 1234 });
    assert.equal(output.contract, 'b5-operator-presentation-v1');
    assert.equal(output.status, 'NEEDS_ACTION');
    assert.equal(output.sell.quantityPerAction, 64);
    assert.equal(output.sell.retainedRemainderItems, 63);
    assert.equal(output.reserve.requiredCoverage, 1.5);
    assert.equal(output.safeState, 'CRAFT_NOT_STARTED');
    assert.equal(output.etaLabel, 'Chưa đủ dữ liệu');
    assert.deepEqual(output.stages.map(entry => entry.id), ['FRESH_STORAGE','SMELT_RAW_IRON_GOLD','COMPACT_B1','LOCK_SELL_BASELINE','SELL_64_ONLY','VERIFY_RESERVE','CRAFT_B5']);
});

test('B5OperatorProjection exposes reserve-input progress and keeps total per-family remainders above 63', () => {
    const item = B5OperatorProjection.projectBot({
        botId: 'b5',
        modes: { b5Craft: { enabled: true, phase: 'STORAGE_PROTECTION_CONTINUE', details: {
            protectionEpisode: { state: 'WAITING_CONTINUE', baselineDigest: 'digest', lastProgress: {
                step: 'reserve-input-checkpoint', remainingSellStacks: 2481, retainedRemainderItems: 178,
                verifiedCoverage: 1.25,
                reserveShortages: [{ baseId: 'cobblestone', coverage: 1.25, missingBaseUnits: 4 }]
            } },
            recovery: { safeState: 'CRAFT_NOT_STARTED', allowedActions: [] }
        } } }
    });
    assert.equal(item.currentStage, 'VERIFY_RESERVE');
    assert.equal(item.sell.remainingStacks, 2481);
    assert.equal(item.sell.retainedRemainderItems, 178);
    assert.equal(item.sell.immutableBaselineDigest, 'digest');
    assert.equal(item.reserve.verifiedCoverage, 1.25);
    assert.deepEqual(item.reserve.pendingFamilies, [{ baseId: 'cobblestone', coverage: 1.25, missingBaseUnits: 4 }]);
});
