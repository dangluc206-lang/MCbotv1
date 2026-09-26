'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const DurableIntentStore = require('../../../src/recovery/DurableIntentStore');
const FleetScheduler = require('../../../src/fleet/FleetScheduler');
const FleetReconciler = require('../../../src/recovery/fleet/FleetReconciler');
const Result = require('../../../src/shared/result/Result');

// Phase 1 full-lifecycle contract (simulation, no network):
// startup-offline → operator connect → enable mode → kick/reconnect (gen N+1)
// → reconcile adopts generation → operator disconnect → no resurrect.
test('full lifecycle: offline boot, connect, mode, kick-reconnect, reconcile, disconnect', async t => {
    const store = new DurableIntentStore({ enabled: false });
    const scheduler = new FleetScheduler({
        concurrency: 1,
        taskTimeoutMs: 1000,
        shutdownDrainMs: 50,
        idFactory: (() => { let id = 0; return () => `lifecycle-full-${++id}`; })()
    });
    let connected = false;
    let generation = 0;
    let refreshed = 0;
    const calls = { connect: 0, stop: 0, enable: 0, disable: 0 };
    let modeEnabled = false;
    const runtime = {
        botId: 'bot-01',
        context: { has: () => connected, getGeneration: () => generation },
        getState: () => ({ lifecycleState: 'RUNNING' }),
        getService: name => {
            if (name === 'reconnectManager') return { suspend() {}, resume() {}, cancelPending() {} };
            if (name === 'modeRegistry') return null;
            if (name === 'fishingMode') return mode;
            return null;
        },
        requireService: name => {
            if (name === 'connectionManager') {
                return {
                    allowConnections() {},
                    async connect() { calls.connect += 1; connected = true; generation = 1; return {}; },
                    async stop() { calls.stop += 1; connected = false; }
                };
            }
            if (name === 'fishingMode') return mode;
            if (name === 'collectorB5Mode') return idleMode;
            throw new Error(`Missing fake service: ${name}`);
        }
    };
    const mode = {
        status: () => ({ enabled: modeEnabled, paused: false }),
        async enable() { calls.enable += 1; modeEnabled = true; return Result.ok(this.status()); },
        async disable() { calls.disable += 1; modeEnabled = false; return Result.ok(this.status()); },
        async pause() { return Result.ok(this.status()); },
        async resume() { return Result.ok(this.status()); },
        refreshGeneration() { refreshed += 1; return generation; }
    };
    const idleMode = {
        status: () => ({ enabled: false, paused: false }),
        async enable() { return Result.ok(this.status()); },
        async disable() { return Result.ok(this.status()); },
        async pause() { return Result.ok(this.status()); },
        async resume() { return Result.ok(this.status()); }
    };
    const reconciler = new FleetReconciler({
        store, scheduler,
        requireRuntime: () => runtime,
        profileFor: () => ({ id: 'bot-01', enabled: true })
    });
    await store.initialize();
    await store.start();
    await scheduler.start();
    t.after(() => scheduler.destroy().then(() => store.destroy()));

    // 1. Fresh session boots offline (M-1 A).
    await store.setIntent('bot-01', { desiredConnection: 'DISCONNECTED', desiredMode: null, modeState: null, source: 'new-process' });
    let outcome = await reconciler.reconcileBot('bot-01', { reason: 'application-start' });
    assert.equal(outcome.success, true);
    assert.equal(outcome.data.status, 'APPLIED_DISCONNECTED');
    assert.equal(calls.connect, 0);
    assert.equal(connected, false);

    // 2. Operator connects; no mode → idle.
    await store.setIntent('bot-01', { desiredConnection: 'CONNECTED', desiredMode: null, modeState: null, source: 'operator' });
    outcome = await reconciler.reconcileBot('bot-01', { reason: 'connection-intent:operator' });
    assert.equal(outcome.data.status, 'APPLIED_CONNECTED_IDLE');
    assert.equal(connected, true);

    // 3. Operator enables fishing.
    await store.setIntent('bot-01', { desiredConnection: 'CONNECTED', desiredMode: 'fishing', modeState: 'ACTIVE', source: 'operator' });
    outcome = await reconciler.reconcileBot('bot-01', { reason: 'mode-intent:operator' });
    assert.equal(outcome.data.status, 'APPLIED_MODE_ACTIVE');
    assert.equal(calls.enable, 1);

    // 4. Kick → reconnect on generation 2 (client replaced out of band).
    connected = false;
    generation = 2;
    connected = true;
    outcome = await reconciler.reconcileBot('bot-01', { reason: 'connection-spawned' });
    assert.equal(outcome.data.status, 'APPLIED_MODE_ACTIVE');
    assert.equal(refreshed, 1);

    // 5. Operator disconnects; mode torn down, connection stopped, no resurrect.
    await store.setIntent('bot-01', { desiredConnection: 'DISCONNECTED', desiredMode: null, modeState: null, source: 'operator' });
    outcome = await reconciler.reconcileBot('bot-01', { reason: 'connection-intent:operator' });
    assert.equal(outcome.data.status, 'APPLIED_DISCONNECTED');
    assert.equal(modeEnabled, false);
    assert.equal(connected, false);
    assert.equal(calls.stop, 2);
});
