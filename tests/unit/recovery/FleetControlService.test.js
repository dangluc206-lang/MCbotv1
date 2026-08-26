'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const BotRegistry = require('../../../src/bot/BotRegistry');
const EventBus = require('../../../src/core/EventBus');
const FleetScheduler = require('../../../src/fleet/FleetScheduler');
const DurableIntentStore = require('../../../src/recovery/DurableIntentStore');
const FleetControlService = require('../../../src/recovery/FleetControlService');
const Result = require('../../../src/shared/result/Result');
const Status = require('../../../src/shared/result/Status');
const Timeout = require('../../../src/shared/time/Timeout');

function deferred() {
    let resolve;
    const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
    return { promise, resolve };
}

function fakeMode({ enabled = false, paused = false, enableGate = null } = {}) {
    const calls = { enable: 0, disable: 0, pause: 0, resume: 0 };
    return {
        calls,
        status() { return { enabled, paused, phase: enabled ? (paused ? 'PAUSED' : 'ACTIVE') : 'OFF' }; },
        async enable() {
            calls.enable += 1;
            if (enableGate) await enableGate.promise;
            enabled = true;
            paused = false;
            return Result.ok(this.status());
        },
        async disable() {
            calls.disable += 1;
            enabled = false;
            paused = false;
            return Result.ok(this.status());
        },
        async pause() {
            calls.pause += 1;
            paused = true;
            return Result.ok(this.status());
        },
        async resume() {
            calls.resume += 1;
            paused = false;
            return Result.ok(this.status());
        }
    };
}

function fakeRuntime(botId = 'bot-01', options = {}) {
    let connected = Boolean(options.connected);
    let lifecycleState = options.lifecycleState || 'RUNNING';
    const eventBus = new EventBus();
    const collector = options.collector || fakeMode();
    const fishing = options.fishing || fakeMode();
    const calls = { connect: 0, stop: 0, cancelAll: 0, movementStop: 0, closeWindow: 0, reconnectSuspend: 0, reconnectResume: 0, reconnectCancel: 0 };
    const services = {
        eventBus,
        collectorB5Mode: collector,
        fishingMode: fishing,
        connectionManager: {
            async connect() { calls.connect += 1; connected = true; return { username: botId }; },
            async stop() { calls.stop += 1; connected = false; }
        },
        reconnectManager: {
            suspend() { calls.reconnectSuspend += 1; return true; },
            resume() { calls.reconnectResume += 1; return true; },
            cancelPending() { calls.reconnectCancel += 1; return true; }
        },
        operationManager: { cancelAll() { calls.cancelAll += 1; return 1; } },
        movementManager: { async stop() { calls.movementStop += 1; } },
        guiManager: { async closeCurrentWindow() { calls.closeWindow += 1; } }
    };
    return {
        botId,
        calls,
        collector,
        fishing,
        context: {
            has: () => connected,
            get: () => connected ? { username: botId } : null
        },
        getState: () => ({ lifecycleState }),
        setLifecycleState(value) { lifecycleState = value; },
        getService: name => services[name] || null,
        requireService(name) {
            const service = services[name];
            if (!service) throw new Error(`Missing fake service: ${name}`);
            return service;
        },
        emitSpawn(generation = 1) {
            eventBus.emit('connection:spawned', { botId, connectionGeneration: generation });
        }
    };
}

async function harness(t, {
    runtime = fakeRuntime(),
    profiles = null,
    initialize = true,
    taskTimeoutMs = 1000
} = {}) {
    const store = new DurableIntentStore({ enabled: false });
    const scheduler = new FleetScheduler({
        concurrency: 2,
        taskTimeoutMs,
        shutdownDrainMs: 50,
        idFactory: (() => { let id = 0; return () => `fleet-${++id}`; })()
    });
    const registry = new BotRegistry();
    if (runtime) registry.register(runtime);
    const control = new FleetControlService({ store, scheduler, botRegistry: registry });
    control.setProfiles(profiles || (runtime ? [{ id: runtime.botId, enabled: true, username: runtime.botId, password: 'not-retained' }] : []));
    if (initialize) {
        await control.initialize();
        await control.start();
    }
    t.after(() => control.destroy());
    return { control, store, scheduler, registry, runtime };
}

test('applies active, paused, switched, idle, and disconnected desired states idempotently', async t => {
    const { control, runtime } = await harness(t, { runtime: fakeRuntime('bot-01', { connected: false }) });
    const active = await control.requestMode('bot-01', 'fishing', { source: 'unit-test' });
    assert.equal(active.success, true);
    assert.equal(active.data.status, 'APPLIED_MODE_ACTIVE');
    assert.equal(runtime.calls.connect, 1);
    assert.equal(runtime.fishing.status().enabled, true);
    assert.deepEqual(control.intent('bot-01'), {
        botId: 'bot-01',
        desiredConnection: 'CONNECTED',
        desiredMode: 'fishing',
        modeState: 'ACTIVE',
        revision: 1,
        updatedAt: control.intent('bot-01').updatedAt,
        source: 'unit-test'
    });

    const paused = await control.requestModeState('bot-01', 'PAUSED', { source: 'pause-test' });
    assert.equal(paused.success, true);
    assert.equal(runtime.fishing.status().paused, true);
    const resumed = await control.requestModeState('bot-01', 'ACTIVE');
    assert.equal(resumed.success, true);
    assert.equal(runtime.fishing.status().paused, false);

    const switched = await control.requestMode('bot-01', 'collector-b5');
    assert.equal(switched.success, true);
    assert.equal(runtime.fishing.status().enabled, false);
    assert.equal(runtime.collector.status().enabled, true);
    const repeated = await control.reconcileBot('bot-01');
    assert.equal(repeated.success, true);
    assert.equal(runtime.collector.calls.enable, 1);

    const idle = await control.requestMode('bot-01', null);
    assert.equal(idle.success, true);
    assert.equal(idle.data.status, 'APPLIED_CONNECTED_IDLE');
    assert.equal(runtime.collector.status().enabled, false);
    const disconnected = await control.requestConnection('bot-01', 'DISCONNECTED');
    assert.equal(disconnected.success, true);
    assert.equal(disconnected.data.status, 'APPLIED_DISCONNECTED');
    assert.equal(runtime.calls.stop, 1);
    assert.equal(runtime.calls.cancelAll, 2);
    assert.equal(runtime.calls.movementStop, 2);
    assert.equal(runtime.calls.closeWindow, 2);
    assert.equal(control.intent('bot-01').desiredMode, null);
});

test('does not replay side effects merely to restore a paused mode after a crash', async t => {
    const { control, store, runtime } = await harness(t);
    const intent = await store.setIntent('bot-01', {
        desiredConnection: 'CONNECTED',
        desiredMode: 'collector-b5',
        modeState: 'PAUSED',
        source: 'restart'
    });
    const result = await control.reconcileBot('bot-01', { expectedRevision: intent.revision });
    assert.equal(result.success, true);
    assert.equal(result.data.status, 'SAFE_PAUSED_NOT_REPLAYED');
    assert.equal(runtime.collector.calls.enable, 0);
    assert.equal(runtime.collector.calls.pause, 0);
});

test('blocks missing or disabled profiles without connecting or enabling a mode', async t => {
    const runtime = fakeRuntime();
    const { control } = await harness(t, { runtime, profiles: [{ id: 'bot-01', enabled: false }] });
    const disabled = await control.requestMode('bot-01', 'fishing');
    assert.equal(disabled.success, false);
    assert.equal(disabled.status, 'NOT_READY');
    assert.match(disabled.message, /disabled/);
    assert.equal(runtime.calls.connect, 0);
    assert.equal(runtime.fishing.calls.enable, 0);

    control.removeProfile('bot-01');
    const missing = await control.reconcileBot('bot-01');
    assert.equal(missing.success, false);
    assert.match(missing.message, /missing/);
});

test('converges to the latest revision when a new request joins an in-flight deduplicated reconcile', async t => {
    const gate = deferred();
    const collector = fakeMode({ enableGate: gate });
    const runtime = fakeRuntime('bot-01', { connected: true, collector });
    const { control } = await harness(t, { runtime });
    const first = control.requestMode('bot-01', 'collector-b5', { source: 'first' });
    while (collector.calls.enable === 0) await new Promise(resolve => setImmediate(resolve));
    const second = control.requestMode('bot-01', 'fishing', { source: 'second' });
    gate.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.equal(firstResult.success, true);
    assert.equal(secondResult.success, true);
    assert.equal(secondResult.data.intentRevision, 2);
    assert.equal(runtime.collector.status().enabled, false);
    assert.equal(runtime.fishing.status().enabled, true);
    assert.equal(control.intent('bot-01').source, 'second');
});

test('restarts a mode as one per-bot scheduled reset followed by latest-intent reconciliation', async t => {
    const runtime = fakeRuntime('bot-01', { connected: true, fishing: fakeMode({ enabled: true }) });
    const { control } = await harness(t, { runtime });
    await control.requestMode('bot-01', 'fishing');
    const beforeEnable = runtime.fishing.calls.enable;
    const restarted = await control.restartMode('bot-01', 'fishing', { source: 'restart-test' });
    assert.equal(restarted.success, true);
    assert.equal(restarted.data.status, 'APPLIED_MODE_ACTIVE');
    assert.equal(runtime.fishing.calls.disable >= 1, true);
    assert.equal(runtime.fishing.calls.enable, beforeEnable + 1);
    assert.equal(runtime.calls.cancelAll >= 1, true);
    assert.equal(control.intent('bot-01').source, 'restart-test');
});

test('reconciles registered runtimes on canonical spawned events and isolates fleet failures', async t => {
    const { control, store, runtime, registry } = await harness(t);
    await store.setIntent('bot-01', {
        desiredConnection: 'CONNECTED', desiredMode: 'fishing', modeState: 'ACTIVE', source: 'spawn'
    });
    runtime.emitSpawn(1);
    for (let index = 0; index < 30 && !runtime.fishing.status().enabled; index += 1) await Timeout.delay(2);
    assert.equal(runtime.fishing.status().enabled, true);

    await store.setIntent('ghost-bot', {
        desiredConnection: 'DISCONNECTED', desiredMode: null, modeState: null, source: 'ghost'
    });
    const all = await control.reconcileAll({ reason: 'unit-all' });
    assert.equal(Object.isFrozen(all), true);
    assert.equal(all.find(entry => entry.botId === 'bot-01').result.success, true);
    assert.equal(all.find(entry => entry.botId === 'ghost-bot').result.success, false);

    registry.remove('bot-01', runtime);
    assert.equal(control.status().scheduler.state, 'RUNNING');
});

test('ignores initial spawn until the runtime lifecycle is fully running', async t => {
    const runtime = fakeRuntime('bot-01', { connected: true, lifecycleState: 'INITIALIZED' });
    const { control, store } = await harness(t, { runtime });
    await store.setIntent('bot-01', {
        desiredConnection: 'CONNECTED', desiredMode: 'fishing', modeState: 'ACTIVE', source: 'startup'
    });
    runtime.emitSpawn(1);
    await Timeout.delay(5);
    assert.equal(runtime.fishing.calls.enable, 0);
    runtime.setLifecycleState('RUNNING');
    runtime.emitSpawn(1);
    for (let index = 0; index < 30 && runtime.fishing.calls.enable === 0; index += 1) await Timeout.delay(2);
    assert.equal(runtime.fishing.calls.enable, 1);
    assert.equal(control.intent('bot-01').source, 'startup');
});

test('derives startup auto-connect policy from durable intent without persisting credentials', async t => {
    const { control, store } = await harness(t);
    await store.setIntent('bot-01', {
        desiredConnection: 'DISCONNECTED', desiredMode: null, modeState: null, source: 'shutdown'
    });
    const runtimeProfile = control.runtimeProfile({ id: 'bot-01', enabled: true, username: 'worker', password: 'runtime-only' });
    assert.equal(runtimeProfile.runtimeAutoConnect, false);
    assert.equal(runtimeProfile.password, 'runtime-only');
    assert.equal(Object.isFrozen(runtimeProfile), true);
    assert.equal(control.profileSnapshot()['bot-01'].password, undefined);

    await store.remove('bot-01');
    assert.equal(control.runtimeProfile({ id: 'bot-01', enabled: true }).runtimeAutoConnect, true);
    assert.equal(control.runtimeProfile({ id: 'bot-01', enabled: false }).runtimeAutoConnect, false);
    assert.throws(() => control.runtimeProfile({ enabled: true }), /profile.id/);
    await assert.rejects(control.requestModeState('bot-01', 'ACTIVE'), /No durable mode intent/);
});


test('explicit per-bot disconnect suspends reconnect and reconnect intent resumes it', async t => {
    const runtime = fakeRuntime('bot-01', { connected: true });
    const { control } = await harness(t, { runtime });
    const stopped = await control.requestConnection('bot-01', 'DISCONNECTED', { source: 'desktop-bot-card' });
    assert.equal(stopped.success, true);
    assert.equal(runtime.calls.reconnectSuspend >= 1, true);
    assert.equal(runtime.calls.stop, 1);
    assert.equal(runtime.context.has(), false);
    const started = await control.requestConnection('bot-01', 'CONNECTED', { source: 'desktop-bot-card' });
    assert.equal(started.success, true);
    assert.equal(runtime.calls.reconnectResume >= 1, true);
    assert.equal(runtime.calls.connect, 1);
    assert.equal(runtime.context.has(), true);
});

test('fresh application session clears persisted modes but keeps enabled bot auto-connect intent', async t => {
    const runtime = fakeRuntime('bot-01', { connected: false });
    const profiles = [
        { id: 'bot-01', enabled: true, username: 'worker' },
        { id: 'bot-02', enabled: false, username: 'off-worker' }
    ];
    const { control, store } = await harness(t, { runtime, profiles });
    await store.setIntent('bot-01', { desiredConnection: 'CONNECTED', desiredMode: 'fishing', modeState: 'ACTIVE', source: 'previous-process' });
    await store.setIntent('bot-02', { desiredConnection: 'CONNECTED', desiredMode: 'collector-b5', modeState: 'ACTIVE', source: 'previous-process' });
    const intents = await control.prepareApplicationSession({ source: 'new-process' });
    assert.equal(intents.length, 2);
    assert.equal(control.intent('bot-01').desiredConnection, 'CONNECTED');
    assert.equal(control.intent('bot-01').desiredMode, null);
    assert.equal(control.intent('bot-02').desiredConnection, 'DISCONNECTED');
    assert.equal(control.intent('bot-02').desiredMode, null);
    assert.equal(control.intent('bot-01').source, 'new-process');
});

test('disconnecting one bot never stops or suspends another bot runtime', async t => {
    const bot1 = fakeRuntime('bot-01', { connected: true });
    const bot2 = fakeRuntime('bot-02', { connected: true });
    const { control, registry, store } = await harness(t, {
        runtime: bot1,
        profiles: [
            { id: 'bot-01', enabled: true, username: 'worker-1' },
            { id: 'bot-02', enabled: true, username: 'worker-2' }
        ]
    });
    registry.register(bot2);
    control.upsertProfile({ id: 'bot-02', enabled: true, username: 'worker-2' });
    await store.setIntent('bot-02', { desiredConnection: 'CONNECTED', desiredMode: null, modeState: null, source: 'unit-test' });

    const result = await control.requestConnection('bot-01', 'DISCONNECTED', { source: 'desktop-bot-card' });
    assert.equal(result.success, true);
    assert.equal(bot1.calls.stop, 1);
    assert.equal(bot1.context.has(), false);
    assert.equal(bot2.calls.stop, 0, 'bot-02 connection must remain untouched');
    assert.equal(bot2.calls.reconnectSuspend, 0, 'bot-02 reconnect manager must remain untouched');
    assert.equal(bot2.context.has(), true);
});


test('fleet reconciliation preserves scheduler timeout as TIMEOUT instead of generic FAILED', async t => {
    const gate = deferred();
    const fishing = fakeMode({ enableGate: gate });
    const runtime = fakeRuntime('bot-01', { connected: true, fishing });
    const { control } = await harness(t, { runtime, taskTimeoutMs: 5 });

    const result = await control.requestMode('bot-01', 'fishing', { source: 'timeout-regression' });
    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'TIMEOUT');
    assert.equal(result.status, Status.TIMEOUT);

    gate.resolve();
    await Timeout.delay(2);
});

test('fleet reconciliation preserves stale-generation mode failure as DISCONNECTED', async t => {
    const runtime = fakeRuntime('bot-01', { connected: true });
    runtime.fishing.enable = async () => {
        const error = new Error('mode belongs to the old connection generation');
        error.code = 'COMMAND_STALE_GENERATION';
        return Result.fail(Status.DISCONNECTED, error.message, error);
    };
    const { control } = await harness(t, { runtime });

    const result = await control.requestMode('bot-01', 'fishing', { source: 'stale-regression' });
    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'COMMAND_STALE_GENERATION');
    assert.equal(result.status, Status.DISCONNECTED);
});

test('XP-012 emergency stop revokes all intents before all-settled disconnect and isolates one bot failure', async t => {
    const bot1 = fakeRuntime('bot-01', { connected: true, fishing: fakeMode({ enabled: true }) });
    const bot2 = fakeRuntime('bot-02', { connected: true, collector: fakeMode({ enabled: true }) });
    const { control, registry, store } = await harness(t, {
        runtime: bot1,
        profiles: [{ id: 'bot-01', enabled: true }, { id: 'bot-02', enabled: true }]
    });
    registry.register(bot2);
    control.upsertProfile({ id: 'bot-02', enabled: true });
    await store.setIntent('bot-01', { desiredConnection: 'CONNECTED', desiredMode: 'fishing', modeState: 'ACTIVE', source: 'test' });
    await store.setIntent('bot-02', { desiredConnection: 'CONNECTED', desiredMode: 'collector-b5', modeState: 'ACTIVE', source: 'test' });
    bot1.getService('connectionManager').stop = async () => { bot1.calls.stop += 1; throw Object.assign(new Error('bot-01 stop failed'), { code: 'CONNECTION_STOP_FAILED' }); };

    const result = await control.emergencyStop(['bot-01', 'bot-02'], { source: 'unit-emergency', idempotencyKey: 'emergency-1', timeoutMs: 500 });
    assert.equal(result.outcome, 'PARTIAL');
    assert.equal(result.botCount, 2);
    assert.equal(result.terminalCount, 1);
    assert.equal(result.results.find(entry => entry.botId === 'bot-01').terminal, false);
    assert.equal(result.results.find(entry => entry.botId === 'bot-02').terminal, true);
    assert.equal(bot2.calls.stop, 1, 'bot-02 must still be attempted after bot-01 fails');
    assert.equal(control.intent('bot-01').desiredConnection, 'DISCONNECTED');
    assert.equal(control.intent('bot-02').desiredConnection, 'DISCONNECTED');
    assert.equal(bot1.calls.reconnectSuspend >= 1, true);
    assert.equal(bot2.calls.reconnectSuspend >= 1, true);
});

test('XP-012 emergency stop is idempotent for duplicate transaction keys and bounded per bot', async t => {
    const runtime = fakeRuntime('bot-01', { connected: true });
    const { control, store } = await harness(t, { runtime, taskTimeoutMs: 1000 });
    await store.setIntent('bot-01', { desiredConnection: 'CONNECTED', desiredMode: null, modeState: null, source: 'test' });
    const gate = deferred();
    runtime.getService('connectionManager').stop = async () => { runtime.calls.stop += 1; await gate.promise; };
    const first = control.emergencyStop(['bot-01'], { idempotencyKey: 'duplicate-key', timeoutMs: 250 });
    const second = control.emergencyStop(['bot-01'], { idempotencyKey: 'duplicate-key', timeoutMs: 250 });
    assert.equal(first, second);
    assert.throws(() => control.emergencyStop(['bot-02'], { idempotencyKey: 'duplicate-key', timeoutMs: 250 }), error => error.code === 'FLEET_EMERGENCY_IDEMPOTENCY_CONFLICT');
    const result = await first;
    assert.equal(result.outcome, 'TIMEOUT');
    assert.equal(result.results[0].status, 'TIMEOUT');
    assert.equal(runtime.calls.reconnectSuspend >= 1, true);
    gate.resolve();
});
