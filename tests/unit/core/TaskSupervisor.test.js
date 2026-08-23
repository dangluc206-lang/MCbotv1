'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const TaskSupervisor = require('../../../src/core/TaskSupervisor');
const Timeout = require('../../../src/shared/time/Timeout');

test('TaskSupervisor retries with bounds, dedupes active keys, and records history', async () => {
    const waits = [];
    const supervisor = new TaskSupervisor({ delay: async ms => { waits.push(ms); }, historyLimit: 4 });
    let runs = 0;
    const first = supervisor.start('worker', async () => {
        runs += 1;
        if (runs < 3) throw new Error(`fail-${runs}`);
        return 'done';
    }, { restart: 'on-failure', maxRestarts: 2, baseDelayMs: 10, maxDelayMs: 100 });
    const duplicate = supervisor.start('worker', async () => 'other');
    assert.equal(duplicate, first);
    assert.equal(await first.promise, 'done');
    assert.equal(runs, 3);
    assert.deepEqual(waits, [10, 20]);
    assert.equal(supervisor.snapshot().history.at(-1).state, 'SUCCEEDED');
});

test('TaskSupervisor stop cancels and drains a long-running task', async () => {
    const supervisor = new TaskSupervisor();
    const handle = supervisor.start('loop', async ({ cancellationToken }) => {
        while (true) await Timeout.delay(50, { cancellationToken });
    });
    await supervisor.stop('loop', 'unit-stop');
    await assert.rejects(handle.promise, /unit-stop|cancel/i);
    assert.equal(supervisor.snapshot().active.length, 0);
    assert.equal(supervisor.snapshot().history.at(-1).state, 'CANCELLED');
});


test('TaskSupervisor snapshot exposes isolated cancellation-listener failures', async () => {
    const supervisor = new TaskSupervisor();
    const handle = supervisor.start('listener-failure', async ({ cancellationToken }) => {
        cancellationToken.onCancelled(() => { throw new Error('cleanup-listener-failed'); });
        await Timeout.delay(1000, { cancellationToken });
    });
    await supervisor.stop('listener-failure', 'stop');
    await assert.rejects(handle.promise, /stop|cancel/i);
    const history = supervisor.snapshot().history.at(-1);
    assert.equal(history.state, 'CANCELLED');
    assert.equal(history.cancellationListenerFailures, 1);
});
