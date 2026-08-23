'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const EventBus = require('../../../src/core/EventBus');
const CancellationSource = require('../../../src/shared/cancellation/CancellationSource');
const VirtualClock = require('../../../src/simulation/VirtualClock');
const RuntimeReplayHarness = require('../../../src/simulation/RuntimeReplayHarness');
const SafetyReplayRuntime = require('../../../src/simulation/SafetyReplayRuntime');
const { runScenario, validateScenario } = require('../../../scripts/replay-scenario');

const FIXTURE = path.resolve(__dirname, '../../fixtures/replay/stale-side-effects.json');

test('VirtualClock deterministically runs nested async delays and same-time tasks in insertion order', async () => {
    const clock = new VirtualClock({ startMs: 100 });
    const order = [];
    clock.schedule(async () => {
        order.push(`A:${clock.now()}`);
        await clock.delay(10, { label: 'nested' });
        order.push(`D:${clock.now()}`);
    }, 0, { label: 'async-root' });
    clock.schedule(() => order.push(`B:${clock.now()}`), 5);
    clock.schedule(() => order.push(`C:${clock.now()}`), 5);
    const count = await clock.runAll();
    assert.equal(count, 4);
    assert.deepEqual(order, ['A:100', 'B:105', 'C:105', 'D:110']);
    assert.deepEqual(clock.pendingSnapshot(), []);
});

test('VirtualClock cancellation rejects delay, clears ownership, and dispose is idempotent', async () => {
    const clock = new VirtualClock();
    const source = new CancellationSource();
    const pending = clock.delay(50, { cancellationToken: source.token });
    assert.equal(clock.pendingSnapshot().length, 1);
    source.cancel('test cancel');
    await assert.rejects(pending, error => error.code === 'CANCELLED');
    assert.equal(clock.pendingSnapshot().length, 0);
    assert.equal(clock.dispose(), true);
    assert.equal(clock.dispose(), false);
    source.dispose();
});

async function faultReplay() {
    const clock = new VirtualClock({ startMs: 500 });
    const eventBus = new EventBus();
    const harness = new RuntimeReplayHarness({ clock, eventBus });
    const observed = [];
    eventBus.on('simulation:event', event => observed.push({ value: event.value, atMs: clock.now() }));
    harness.addInvariant('no pending tasks at final boundary', ({ final, snapshot }) => {
        if (final) assert.deepEqual(snapshot.pendingTasks, []);
    });
    const entries = [
        { id: 'drop', atMs: 0, kind: 'event', name: 'simulation:event', payload: { value: 'drop' }, expect: { status: 'dropped' } },
        { id: 'delay', atMs: 1, kind: 'event', name: 'simulation:event', payload: { value: 'delay' }, expect: { delivered: true } },
        { id: 'duplicate', atMs: 2, kind: 'event', name: 'simulation:event', payload: { value: 'duplicate' }, expect: { delivered: true } },
        { id: 'error', atMs: 3, kind: 'event', name: 'simulation:event', payload: { value: 'error' }, expect: { status: 'rejected', errorCode: 'INJECTED' } }
    ];
    const faults = [
        { id: 'drop-first', match: { id: 'drop' }, effect: { type: 'drop' } },
        { id: 'delay-second', match: { id: 'delay' }, effect: { type: 'delay', delayMs: 10 } },
        { id: 'duplicate-third', match: { id: 'duplicate' }, effect: { type: 'duplicate', copies: 2 } },
        { id: 'error-fourth', match: { id: 'error' }, effect: { type: 'error', code: 'INJECTED', message: 'fault' } }
    ];
    const result = await harness.replay(entries, { faults });
    await harness.dispose();
    return { result, observed };
}

test('RuntimeReplayHarness applies drop/delay/duplicate/error faults and is byte-for-byte deterministic', async () => {
    const first = await faultReplay();
    const second = await faultReplay();
    assert.deepEqual(second, first);
    assert.deepEqual(first.observed, [
        { value: 'duplicate', atMs: 502 },
        { value: 'duplicate', atMs: 502 },
        { value: 'delay', atMs: 511 }
    ]);
    assert.equal(first.result.timeline.filter(entry => entry.kind === 'fault').length, 4);
    assert.equal(first.result.timeline.filter(entry => entry.entryId === 'duplicate' && entry.status === 'fulfilled').length, 2);
    assert.deepEqual(first.result.pendingTasks, []);
});

test('Safety replay fixture blocks stale-generation and cancelled commands/clicks without any real network', async () => {
    const first = await runScenario(FIXTURE);
    const second = await runScenario(FIXTURE);
    assert.deepEqual(second, first);
    assert.deepEqual(first.runtime.sideEffects.map(effect => [effect.type, effect.clientId, effect.command || null]), [
        ['chat', 'old-client', '/warmup'],
        ['chat', 'replacement-client', '/replacement-warmup']
    ]);
    assert.equal(first.runtime.sideEffects.some(effect => effect.type === 'click' || effect.type === 'end'), false);
    const rejected = first.replay.timeline.filter(entry => entry.status === 'rejected');
    assert.deepEqual(rejected.map(entry => entry.error.code), [
        'GUI_CLICK_STALE_GENERATION',
        'COMMAND_STALE_GENERATION',
        'CANCELLED'
    ]);
    assert.deepEqual(first.replay.pendingTasks, []);
});

test('SafetyReplayRuntime uses the real ModeCoordinator and keeps one primary-mode owner', async () => {
    const clock = new VirtualClock();
    const harness = new RuntimeReplayHarness({ clock });
    const runtime = new SafetyReplayRuntime({ clock }).install(harness);
    const result = await harness.replay([
        { id: 'collector', atMs: 0, kind: 'action', name: 'mode.acquire', payload: { modeId: 'collector-b5', captureLeaseAs: 'collector' } },
        { id: 'fishing', atMs: 1, kind: 'action', name: 'mode.acquire', payload: { modeId: 'fishing' } },
        { id: 'snapshot', atMs: 2, kind: 'action', name: 'state.snapshot', payload: {} }
    ]);
    const snapshot = result.timeline.find(entry => entry.entryId === 'snapshot').data;
    assert.equal(snapshot.modeCoordinator.primaryOwner.modeId, 'collector-b5');
    assert.equal(snapshot.modeCoordinator.leases.length, 1);
    const fishing = result.timeline.find(entry => entry.entryId === 'fishing').data;
    assert.equal(fishing.success, false);
    assert.equal(fishing.status, 'BUSY');
    await harness.dispose();
    assert.equal(runtime.context.has(), false);
});

test('scenario and trace contracts reject unknown keys, duplicates, and unregistered actions', async () => {
    assert.throws(() => validateScenario({ version: 1, name: 'x', entries: [], unknown: true }), /Unknown replay scenario key/);
    const clock = new VirtualClock();
    const harness = new RuntimeReplayHarness({ clock });
    await assert.rejects(() => harness.replay([
        { id: 'same', atMs: 0, kind: 'action', name: 'missing', payload: {} },
        { id: 'same', atMs: 1, kind: 'action', name: 'missing', payload: {} }
    ]), /Duplicate replay entry id/);
    await harness.dispose();

    const scenario = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    assert.equal(validateScenario(scenario), scenario);
});
