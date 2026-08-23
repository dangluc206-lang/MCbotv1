'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const FleetScheduler = require('../../../src/fleet/FleetScheduler');
const CancellationSource = require('../../../src/shared/cancellation/CancellationSource');
const Timeout = require('../../../src/shared/time/Timeout');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function flush() {
    return new Promise(resolve => setImmediate(resolve));
}

async function schedulerFor(t, options = {}) {
    let id = 0;
    const scheduler = new FleetScheduler({
        taskTimeoutMs: 1000,
        shutdownDrainMs: 50,
        idFactory: () => `task-${++id}`,
        ...options
    });
    await scheduler.initialize();
    await scheduler.start();
    t.after(() => scheduler.destroy());
    return scheduler;
}

test('enforces global concurrency and serializes work for each bot', async t => {
    const scheduler = await schedulerFor(t, { concurrency: 2 });
    const gates = [deferred(), deferred(), deferred()];
    const activeByBot = new Map();
    let active = 0;
    let maxActive = 0;
    let sameBotOverlap = false;
    const started = [];

    const run = (name, botId, gate) => scheduler.schedule({
        botId,
        key: name,
        run: async () => {
            started.push(name);
            active += 1;
            maxActive = Math.max(maxActive, active);
            const count = (activeByBot.get(botId) || 0) + 1;
            activeByBot.set(botId, count);
            if (count > 1) sameBotOverlap = true;
            await gate.promise;
            active -= 1;
            activeByBot.set(botId, count - 1);
            return name;
        }
    });

    const a1 = run('a1', 'bot-a', gates[0]);
    const a2 = run('a2', 'bot-a', gates[1]);
    const b1 = run('b1', 'bot-b', gates[2]);
    await flush();
    assert.deepEqual(new Set(started), new Set(['a1', 'b1']));
    assert.equal(scheduler.status().pending.length, 1);

    gates[2].resolve();
    await b1;
    await flush();
    assert.equal(started.includes('a2'), false);
    gates[0].resolve();
    assert.equal(await a1, 'a1');
    await flush();
    assert.equal(started.at(-1), 'a2');
    gates[1].resolve();
    assert.equal(await a2, 'a2');
    assert.equal(maxActive, 2);
    assert.equal(sameBotOverlap, false);
});

test('uses priority first and rotates equal-priority bots fairly', async t => {
    const scheduler = await schedulerFor(t, { concurrency: 1 });
    const order = [];
    const schedule = (botId, key, priority = 'normal') => scheduler.schedule({
        botId,
        key,
        priority,
        run: async () => { order.push(key); }
    });

    const low = schedule('bot-a', 'low', 'low');
    const a1 = schedule('bot-a', 'a1');
    const a2 = schedule('bot-a', 'a2');
    const b1 = schedule('bot-b', 'b1');
    const critical = schedule('bot-c', 'critical', 'critical');
    await Promise.all([low, a1, a2, b1, critical]);
    assert.deepEqual(order, ['critical', 'a1', 'b1', 'a2', 'low']);
});

test('deduplicates bot/key work and exposes immutable status snapshots', async t => {
    const scheduler = await schedulerFor(t, { concurrency: 1 });
    const gate = deferred();
    let runs = 0;
    const descriptor = {
        botId: ' bot-a ',
        key: ' reconcile ',
        run: async context => {
            runs += 1;
            assert.equal(context.botId, 'bot-a');
            assert.equal(context.key, 'reconcile');
            await gate.promise;
            return 42;
        }
    };
    const first = scheduler.schedule(descriptor);
    const second = scheduler.schedule({ ...descriptor, run: async () => 99 });
    assert.equal(first, second);
    await flush();
    const snapshot = scheduler.status();
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.running), true);
    assert.throws(() => snapshot.running.push({}), TypeError);
    gate.resolve();
    assert.equal(await first, 42);
    assert.equal(runs, 1);
    assert.equal(scheduler.status().running.length, 0);
});

test('rejects overflow and cancels pending and running work', async t => {
    const scheduler = await schedulerFor(t, { concurrency: 1, maxPending: 1 });
    const runningSource = new CancellationSource();
    const pendingSource = new CancellationSource();
    const running = scheduler.schedule({
        botId: 'bot-a',
        key: 'running',
        cancellationToken: runningSource.token,
        run: ({ cancellationToken }) => Timeout.delay(1000, { cancellationToken })
    });
    await flush();
    const pending = scheduler.schedule({
        botId: 'bot-b',
        key: 'pending',
        cancellationToken: pendingSource.token,
        run: async () => 'never'
    });
    await assert.rejects(
        scheduler.schedule({ botId: 'bot-c', key: 'overflow', run: async () => null }),
        error => error.code === 'FLEET_QUEUE_FULL'
    );
    pendingSource.cancel('pending cancelled');
    await assert.rejects(pending, error => error.code === 'CANCELLED' && /pending cancelled/.test(error.message));
    runningSource.cancel('running cancelled');
    await assert.rejects(running, error => error.code === 'CANCELLED' && /running cancelled/.test(error.message));
});

test('times out a task, propagates cancellation to its token, and ignores late completion', async t => {
    const scheduler = await schedulerFor(t, { concurrency: 1, taskTimeoutMs: 5 });
    let tokenCancelledAfterTimeout = false;
    const task = scheduler.schedule({
        botId: 'bot-a',
        key: 'slow',
        run: async ({ cancellationToken }) => {
            await Timeout.delay(25);
            tokenCancelledAfterTimeout = cancellationToken.isCancelled;
            return 'late';
        }
    });
    await assert.rejects(task, error => error.code === 'TIMEOUT');
    await Timeout.delay(35);
    assert.equal(tokenCancelledAfterTimeout, true);
    assert.equal(scheduler.status().running.length, 0);
});

test('validates lifecycle and task descriptors and drains on stop', async () => {
    const scheduler = new FleetScheduler({ concurrency: 1, shutdownDrainMs: 20, idFactory: () => '' });
    await assert.rejects(
        scheduler.schedule({ botId: 'bot-a', key: 'x', run: async () => null }),
        error => error.code === 'FLEET_SCHEDULER_NOT_RUNNING'
    );
    await scheduler.start();
    await assert.rejects(scheduler.schedule({ botId: '', key: 'x', run: async () => null }), TypeError);
    await assert.rejects(scheduler.schedule({ botId: 'bot-a', key: '', run: async () => null }), TypeError);
    await assert.rejects(scheduler.schedule({ botId: 'bot-a', key: 'x', priority: 'urgent', run: async () => null }), TypeError);
    await assert.rejects(scheduler.schedule({ botId: 'bot-a', key: 'x' }), TypeError);
    await assert.rejects(scheduler.schedule({ botId: 'bot-a', key: 'x', run: async () => null }), /empty taskId/);
    await scheduler.stop();
    assert.equal(scheduler.status().state, 'STOPPED');
    await scheduler.destroy();
    assert.equal(scheduler.status().state, 'DESTROYED');
    await assert.rejects(scheduler.start(), /destroyed/);
});

test('rejects duplicate active task IDs without corrupting the running task', async t => {
    const gate = deferred();
    const scheduler = await schedulerFor(t, { concurrency: 1, idFactory: () => 'same-id' });
    const first = scheduler.schedule({ botId: 'bot-a', key: 'first', run: () => gate.promise });
    await flush();
    await assert.rejects(
        scheduler.schedule({ botId: 'bot-b', key: 'second', run: async () => 'second' }),
        error => error.code === 'FLEET_TASK_ID_COLLISION'
    );
    assert.equal(scheduler.status().running.length, 1);
    gate.resolve('first');
    assert.equal(await first, 'first');
});
