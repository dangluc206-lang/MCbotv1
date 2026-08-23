'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B5TraceRecorder = require('../../../src/server-features/crafting/b5/trace/B5TraceRecorder');

test('B5 trace recorder keeps a compact replayable cycle summary', () => {
    const recorder = new B5TraceRecorder({ botId: 'bot-01', historyLimit: 10 });
    const record = recorder.recordResult({
        success: true,
        status: 'SUCCESS',
        data: {
            productive: false,
            completedNewB5: false,
            blockingReasons: [{ reason: 'waiting-for-complete-b2-batch', baseId: 'diamond' }],
            actionSummary: { waiting: 1 },
            plan: { version: 2, snapshotDigest: 'abc', state: 'WAITING_MATERIALS', decision: { kind: 'B2/B3', resource: 'diamond' }, blockers: [], replayInput: { amount: 1, fullPlan: { targetId: 'b5', feasible: false, missing: {}, steps: [] }, chains: [], progress: { targetId: 'b5', amount: 1, feasible: false, nextStep: { kind: 'B2/B3', id: 'diamond' } } } }
        },
        meta: {
            operationId: 'bot-01:4', connectionGeneration: 3,
            trace: [{ step: 'prepare-b1', action: 'ensure B1', resource: 'diamond', attempt: 1, status: 'ok', elapsedMs: 12 }]
        }
    });
    assert.equal(record.traceId, 'bot-01:b5:1');
    assert.equal(record.steps.length, 1);
    assert.equal(record.steps[0].step, 'prepare-b1');
    assert.equal(recorder.latest().plan.snapshotDigest, 'abc');
    assert.equal(recorder.latestReplayFixture().version, 1);
    assert.equal(recorder.latestReplayFixture().expected.decisionKind, 'B2/B3');
});
