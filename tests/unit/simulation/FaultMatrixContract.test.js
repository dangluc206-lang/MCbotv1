'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const VirtualClock = require('../../../src/simulation/VirtualClock');
const RuntimeReplayHarness = require('../../../src/simulation/RuntimeReplayHarness');
const SafetyReplayRuntime = require('../../../src/simulation/SafetyReplayRuntime');
const ReconciliationBarrier = require('../../../src/shared/reconciliation/ReconciliationBarrier');
const TaskSupervisor = require('../../../src/core/TaskSupervisor');
const { runScenario } = require('../../../scripts/replay-scenario');
const path = require('node:path');

const CLICK_RESPONSE_LOST_FIXTURE = path.resolve(__dirname, '../../fixtures/replay/click-response-lost.json');

async function runClickResponseLost() {
    const clock = new VirtualClock({ startMs: 1000 });
    const harness = new RuntimeReplayHarness({ clock });
    const runtime = new SafetyReplayRuntime({ botId: 'fault-bot', clock }).install(harness);
    const replay = await harness.replay([
        { id: 'attach', atMs: 0, kind: 'action', name: 'connection.attach', payload: { clientId: 'client-a' } },
        { id: 'open', atMs: 0, kind: 'action', name: 'gui.open', payload: { windowId: 'ks', slotCount: 54 } },
        {
            id: 'click', atMs: 1, kind: 'action', name: 'gui.click',
            payload: { slot: 12, operation: 'craft.quantity.click', path: 'window:ks/slot:12' },
            expect: { status: 'rejected', errorCode: 'RESPONSE_LOST' }
        }
    ], {
        faults: [{
            id: 'click-applied-response-lost',
            match: { operation: 'craft.quantity.click', path: 'window:ks/slot:12' },
            effect: { type: 'after-error', code: 'RESPONSE_LOST', message: 'server response lost after click' }
        }]
    });
    const snapshot = runtime.snapshot();
    await harness.dispose();
    return { replay, snapshot };
}

test('WP-401 after-error is path/operation-aware and preserves the real side effect before response loss', async () => {
    const first = await runClickResponseLost();
    const second = await runClickResponseLost();
    assert.deepEqual(second, first);
    assert.deepEqual(first.snapshot.sideEffects.map(effect => [effect.type, effect.slot, effect.windowId]), [
        ['click', 12, 'ks']
    ]);
    const fault = first.replay.timeline.find(entry => entry.kind === 'fault');
    assert.equal(fault.data.selector.operation, 'craft.quantity.click');
    assert.equal(fault.data.selector.path, 'window:ks/slot:12');
});

test('WP-401 JSON fault fixture is byte-for-byte deterministic and records applied click evidence', async () => {
    const first = await runScenario(CLICK_RESPONSE_LOST_FIXTURE);
    const second = await runScenario(CLICK_RESPONSE_LOST_FIXTURE);
    assert.deepEqual(second, first);
    assert.equal(first.runtime.sideEffects.filter(effect => effect.type === 'click').length, 1);
    assert.equal(first.replay.timeline.find(entry => entry.entryId === 'click' && entry.kind === 'action').error.code, 'RESPONSE_LOST');
});

test('WP-401 before-error blocks the selected filesystem mutation without global call-count coupling', async () => {
    const clock = new VirtualClock();
    const harness = new RuntimeReplayHarness({ clock });
    const mutations = [];
    harness.registerAction('filesystem.mutate', payload => {
        mutations.push([payload.operation, payload.path]);
        return { applied: true };
    });
    const replay = await harness.replay([
        {
            id: 'rename-config', atMs: 0, kind: 'action', name: 'filesystem.mutate',
            payload: { operation: 'rename', path: 'config/bots/bot-01.json' },
            expect: { status: 'rejected', errorCode: 'EACCES' }
        },
        {
            id: 'copy-safety', atMs: 1, kind: 'action', name: 'filesystem.mutate',
            payload: { operation: 'copy', path: 'config/bots/bot-01.json' }
        }
    ], {
        faults: [{
            id: 'rename-only',
            match: { operation: 'rename', path: 'config/bots/bot-01.json' },
            effect: { type: 'before-error', code: 'EACCES' }
        }]
    });
    assert.deepEqual(mutations, [['copy', 'config/bots/bot-01.json']]);
    assert.equal(replay.faults[0].remaining, 0);
    await harness.dispose();
});

test('WP-401 resolve-wrong and read-transient provide deterministic observation faults without executing copied decisions', async () => {
    const clock = new VirtualClock();
    const harness = new RuntimeReplayHarness({ clock });
    let reads = 0;
    harness.registerAction('storage.read', payload => {
        reads += 1;
        return { material: payload.path, count: 128, fresh: true };
    });
    const replay = await harness.replay([
        { id: 'transient', atMs: 0, kind: 'action', name: 'storage.read', payload: { operation: 'read', path: 'iron_block' } },
        { id: 'wrong', atMs: 1, kind: 'action', name: 'storage.read', payload: { operation: 'read', path: 'gold_block' } },
        { id: 'real', atMs: 2, kind: 'action', name: 'storage.read', payload: { operation: 'read', path: 'diamond_block' } }
    ], {
        faults: [
            {
                id: 'transient-iron', match: { operation: 'read', path: 'iron_block' },
                effect: { type: 'read-transient', value: { state: 'TRANSIENT', fresh: false } }
            },
            {
                id: 'wrong-gold', match: { operation: 'read', path: 'gold_block' },
                effect: { type: 'resolve-wrong', value: { material: 'gold_block', count: 0, fresh: true } }
            }
        ]
    });
    assert.equal(reads, 2, 'transient read bypasses adapter; resolve-wrong executes adapter then replaces observation');
    assert.deepEqual(replay.timeline.find(entry => entry.entryId === 'transient' && entry.kind === 'action').data, { state: 'TRANSIENT', fresh: false });
    assert.deepEqual(replay.timeline.find(entry => entry.entryId === 'wrong' && entry.kind === 'action').data, { material: 'gold_block', count: 0, fresh: true });
    assert.deepEqual(replay.timeline.find(entry => entry.entryId === 'real' && entry.kind === 'action').data, { material: 'diamond_block', count: 128, fresh: true });
    await harness.dispose();
});

test('WP-401 storage uncertainty is classified by the production ReconciliationBarrier and remains mutation-blocking', async () => {
    const clock = new VirtualClock();
    const harness = new RuntimeReplayHarness({ clock });
    const barrier = new ReconciliationBarrier();
    harness.registerAction('reconciliation.evaluate', payload => barrier.evaluate(payload));
    const replay = await harness.replay([
        {
            id: 'sell-uncertain', atMs: 0, kind: 'action', name: 'reconciliation.evaluate',
            payload: {
                operation: 'storage.sell.reconcile', path: 'iron_block',
                expectedGeneration: 7, currentGeneration: 7, applied: false, verifiedNoEffect: false,
                evidence: { before: 128, after: null }
            }
        }
    ]);
    const result = replay.timeline.find(entry => entry.entryId === 'sell-uncertain' && entry.kind === 'action').data;
    assert.equal(result.outcome, ReconciliationBarrier.Outcome.UNRESOLVED);
    assert.equal(result.blocksMutation, true);
    assert.equal(result.mayReplan, false);
    await harness.dispose();
});

test('WP-401 mode/task cancellation during virtual backoff drains without wall-clock sleep', async () => {
    const clock = new VirtualClock();
    const supervisor = new TaskSupervisor({
        name: 'wp401-backoff',
        historyLimit: 4,
        delay: (ms, options) => clock.delay(ms, options)
    });
    let attempts = 0;
    const handle = supervisor.start('mode-retry', async () => {
        attempts += 1;
        const error = new Error('synthetic failure');
        error.code = 'SYNTHETIC';
        throw error;
    }, { restart: 'on-failure', maxRestarts: 3, baseDelayMs: 100, maxDelayMs: 400 });
    clock.schedule(() => handle.cancel('mode disabled during backoff'), 10, { label: 'disable-mode' });
    await clock.runAll();
    await assert.rejects(handle.promise, error => error.code === 'CANCELLED');
    assert.equal(attempts, 1);
    assert.equal(supervisor.snapshot().active.length, 0);
    assert.equal(supervisor.snapshot().history.at(-1).state, 'CANCELLED');
    await supervisor.close();
    clock.dispose();
});

test('WP-401 multi-bot generation and unowned cleanup are isolated by production ownership contracts', async () => {
    const clockA = new VirtualClock();
    const clockB = new VirtualClock();
    const harnessA = new RuntimeReplayHarness({ clock: clockA });
    const harnessB = new RuntimeReplayHarness({ clock: clockB });
    const runtimeA = new SafetyReplayRuntime({ botId: 'bot-a', clock: clockA }).install(harnessA);
    const runtimeB = new SafetyReplayRuntime({ botId: 'bot-b', clock: clockB }).install(harnessB);

    const [replayA, replayB] = await Promise.all([
        harnessA.replay([
            { id: 'attach-a', atMs: 0, kind: 'action', name: 'connection.attach', payload: { clientId: 'a1' } },
            { id: 'own-a', atMs: 0, kind: 'action', name: 'mode.acquire', payload: { modeId: 'collector-b5', captureLeaseAs: 'owner' } },
            { id: 'wrong-cleanup-a', atMs: 1, kind: 'action', name: 'mode.release', payload: { modeId: 'collector-b5', leaseId: 'foreign-lease' } },
            { id: 'snapshot-a', atMs: 2, kind: 'action', name: 'state.snapshot', payload: {} }
        ]),
        harnessB.replay([
            { id: 'attach-b', atMs: 0, kind: 'action', name: 'connection.attach', payload: { clientId: 'b1' } },
            { id: 'own-b', atMs: 0, kind: 'action', name: 'mode.acquire', payload: { modeId: 'fishing', captureLeaseAs: 'owner' } },
            { id: 'snapshot-b', atMs: 2, kind: 'action', name: 'state.snapshot', payload: {} }
        ])
    ]);

    const cleanup = replayA.timeline.find(entry => entry.entryId === 'wrong-cleanup-a').data;
    assert.equal(cleanup.success, false);
    assert.equal(replayA.timeline.find(entry => entry.entryId === 'snapshot-a').data.modeCoordinator.primaryOwner.modeId, 'collector-b5');
    assert.equal(replayB.timeline.find(entry => entry.entryId === 'snapshot-b').data.modeCoordinator.primaryOwner.modeId, 'fishing');
    assert.equal(runtimeA.snapshot().connectionGeneration, 1);
    assert.equal(runtimeB.snapshot().connectionGeneration, 1);
    await harnessA.dispose();
    await harnessB.dispose();
});

test('WP-401 fault schema rejects unscoped unknown match keys and unsupported effects', () => {
    const harness = new RuntimeReplayHarness({ clock: new VirtualClock() });
    assert.throws(() => harness.addFault({ id: 'bad-match', match: { call: 3 }, effect: { type: 'drop' } }), /unknown key: call/);
    assert.throws(() => harness.addFault({ id: 'bad-effect', match: { operation: 'x' }, effect: { type: 'sleep-more' } }), /Unsupported fault effect type/);
});
