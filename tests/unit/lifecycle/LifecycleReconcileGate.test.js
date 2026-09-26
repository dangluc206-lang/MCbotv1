'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const FleetScheduler = require('../../../src/fleet/FleetScheduler');
const DurableIntentStore = require('../../../src/recovery/DurableIntentStore');
const FleetReconciler = require('../../../src/recovery/fleet/FleetReconciler');

// I5: reconcile fails closed while runtime is STOPPING/STOPPED.
test('fleet reconcile is blocked while runtime is stopping', async () => {
    const store = new DurableIntentStore({ baseDir: process.cwd(), enabled: false, clock: () => 1 });
    await store.initialize();
    await store.start();
    const scheduler = new FleetScheduler({ concurrency: 1, taskTimeoutMs: 1000, shutdownDrainMs: 100 });
    await scheduler.start();
    let connects = 0;
    const runtime = {
        botId: 'block-bot',
        context: { has: () => false },
        getState: () => ({ lifecycleState: 'STOPPING' }),
        getService: name => (name === 'connectionManager' ? { async connect() { connects += 1; return {}; } } : null),
        requireService: name => {
            if (name === 'connectionManager') return { allowConnections() {}, async connect() { connects += 1; return {}; } };
            throw new Error('missing ' + name);
        }
    };
    const reconciler = new FleetReconciler({
        store, scheduler,
        requireRuntime: () => runtime,
        profileFor: () => ({ id: 'block-bot', enabled: true })
    });
    await store.setIntent('block-bot', { desiredConnection: 'CONNECTED', desiredMode: null, modeState: null, source: 'test' });
    const result = await reconciler.reconcileBot('block-bot', { reason: 'test-stop-gate' });
    assert.equal(result.success, false);
    assert.match(String(result.message || result.meta?.status), /BLOCKED_RUNTIME_STOPPING/);
    assert.equal(connects, 0);
    await scheduler.destroy();
    await store.destroy();
});

// I9: interleaved intent updates preserve both connection and mode changes.
test('interleaved intent updates preserve both connection and mode changes', async () => {
    const store = new DurableIntentStore({ baseDir: process.cwd(), enabled: false, clock: () => 1 });
    await store.initialize();
    await store.start();
    await store.setIntent('merge-bot', { desiredConnection: 'DISCONNECTED', desiredMode: null, modeState: null, source: 'seed' });
    const first = store.updateIntent('merge-bot', current => ({ ...current, desiredConnection: 'CONNECTED', source: 'a' }));
    const second = store.updateIntent('merge-bot', current => ({ desiredConnection: current.desiredConnection, desiredMode: 'fishing', modeState: 'ACTIVE', source: 'b' }));
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.revision, 2);
    assert.equal(b.revision, 3);
    const final = store.get('merge-bot');
    assert.equal(final.desiredConnection, 'CONNECTED');
    assert.equal(final.modeState, 'ACTIVE');
    assert.equal(final.revision, 3);
    await store.destroy();
});
