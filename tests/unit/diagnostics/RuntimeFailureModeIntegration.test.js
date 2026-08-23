'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const EventBus = require('../../../src/core/EventBus');
const BotRegistry = require('../../../src/bot/BotRegistry');
const FlowError = require('../../../src/shared/errors/FlowError');
const OperationCancelledError = require('../../../src/shared/errors/OperationCancelledError');
const Result = require('../../../src/shared/result/Result');
const Status = require('../../../src/shared/result/Status');
const RuntimeFailurePublisher = require('../../../src/diagnostics/runtime/RuntimeFailurePublisher');
const RuntimeFailureRecorder = require('../../../src/diagnostics/runtime/RuntimeFailureRecorder');
const DiscordErrorReporter = require('../../../src/discord/errors/DiscordErrorReporter');
const ModeCoordinator = require('../../../src/modes/ModeCoordinator');
const CollectorB5ModeService = require('../../../src/modes/collector-b5/CollectorB5ModeService');
const FishingModeService = require('../../../src/modes/fishing/FishingModeService');
const FishingRecoveryPolicy = require('../../../src/modes/fishing/FishingRecoveryPolicy');

const failureConfig = Object.freeze({
    enabled: true, repeatWindowMs: 40, maxFileMb: 1, maxTotalMb: 4, retentionDays: 14, cleanupIntervalMs: 0
});
const failurePolicy = Object.freeze({
    baseBackoffMs: 2, maxBackoffMs: 20, multiplier: 2, jitterRatio: 0, maxConsecutiveFailures: 2, openDurationMs: 60
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function tempRoot() { return fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-mode-failure-')); }
async function records(baseDir) {
    const text = await fs.readFile(path.join(baseDir, 'bot-01', 'errors.jsonl'), 'utf8');
    return text.trim().split('\n').filter(Boolean).map(JSON.parse);
}

function collector({ eventBus, publisher, preprocess, policy = failurePolicy, delayFn = undefined, config = {}, b1Materials = {} }) {
    const modeCoordinator = new ModeCoordinator({ botId: 'bot-01' });
    return new CollectorB5ModeService({
        botId: 'bot-01',
        context: { has: () => true, getGeneration: () => 1 },
        eventBus,
        island: { goHome: async () => ({ success: true }) },
        skyblock: {},
        skyblockReadiness: {
            requireTarget: () => ({ success: true }),
            releaseTarget: () => ({ success: true }),
            isGenerationReady: () => true
        },
        skyTarget: 'sky1',
        movementManager: { goTo: async () => {}, stop: async () => {} },
        positionService: { current: () => ({ x: 0, y: 64, z: 0 }), distance: () => 0 },
        b1Materials: { protectForB5Batch: preprocess, ...b1Materials },
        b5Planning: { inspectAdditional: async () => ({ success: true, data: { fullPlan: { feasible: false }, finalSteps: [], chains: [] } }) },
        b5Automation: {
            runNext: async () => ({ success: true, data: { completedNewB5: false } }),
            runMaintenance: async () => ({ success: true, data: { waitingForMaterials: true } })
        },
        modeCoordinator,
        failurePublisher: publisher,
        failurePolicy: policy,
        config: {
            enabled: true, teleportHomeOnEnable: false,
            pickupLocation: { x: 0, y: 64, z: 0 }, arrivalRadius: 1, reanchorRadius: 2,
            moveTimeoutMs: 20, pollIntervalMs: 5, errorRetryMs: 2, craftLoopDelayMs: 2,
            ...config
        },
        ...(delayFn ? { delay: delayFn } : {})
    });
}

function controllableDelay() {
    const calls = [];
    const waiters = [];
    const observers = [];
    const notify = () => {
        while (observers.length && calls.length >= observers[0].count) observers.shift().resolve(calls[calls.length - 1]);
    };
    const fn = (ms, { cancellationToken = null } = {}) => new Promise((resolve, reject) => {
        const entry = { ms, resolve, reject, off: null, settled: false };
        calls.push(entry);
        waiters.push(entry);
        if (cancellationToken?.onCancelled) {
            entry.off = cancellationToken.onCancelled(reason => {
                if (entry.settled) return;
                entry.settled = true;
                entry.off?.();
                reject(new OperationCancelledError(String(reason || 'cancelled')));
            });
        }
        notify();
    });
    return {
        fn,
        calls,
        waitForCall(count = 1) {
            if (calls.length >= count) return Promise.resolve(calls[count - 1]);
            return new Promise(resolve => observers.push({ count, resolve }));
        },
        releaseOne() {
            const entry = waiters.find(item => !item.settled);
            if (!entry) return false;
            entry.settled = true;
            entry.off?.();
            entry.resolve();
            return true;
        }
    };
}

test('collector compatibility event shares failureId and recorder persists one full record', async () => {
    const baseDir = await tempRoot();
    const eventBus = new EventBus();
    const publisher = new RuntimeFailurePublisher({ botId: 'bot-01', eventBus, connectionAggregationMs: 10 });
    const recorder = new RuntimeFailureRecorder({ botId: 'bot-01', eventBus, baseDir, config: failureConfig });
    const legacy = [];
    eventBus.on('mode:collector-b5:error', event => legacy.push(event));
    await publisher.initialize();
    await recorder.initialize();
    const mode = collector({
        eventBus,
        publisher,
        preprocess: async () => ({
            success: false,
            message: 'fatal collector',
            error: new FlowError('fatal collector', {
                code: 'COLLECTOR_FATAL', subsystem: 'collector-b5', operation: 'CollectorB5ModeService', step: 'preprocess', retryable: false
            })
        })
    });
    await mode.initialize();
    await mode.enable();
    await delay(20);
    assert.equal(mode.status().phase, 'PAUSED_ERROR');
    assert.equal(legacy.length, 1);
    assert.equal(typeof legacy[0].failureId, 'string');
    await mode.stop();
    await recorder.stop();
    await publisher.stop();
    const full = (await records(baseDir)).filter(record => record.event !== 'runtime:failure-repeat-summary');
    assert.equal(full.length, 1);
    assert.equal(full[0].failureId, legacy[0].failureId);
});

test('collector pause, disable and runtime stop cancellations never increment breaker', async () => {
    const eventBus = new EventBus();
    const publisher = new RuntimeFailurePublisher({ botId: 'bot-01', eventBus, connectionAggregationMs: 10 });
    await publisher.initialize();
    let entered = 0;
    const blockingPreprocess = async ({ cancellationToken }) => {
        entered += 1;
        await new Promise((resolve, reject) => {
            const off = cancellationToken.onCancelled(reason => {
                off();
                reject(new OperationCancelledError(String(reason || 'cancelled')));
            });
        });
        return { success: true };
    };
    const mode = collector({ eventBus, publisher, preprocess: blockingPreprocess });
    let failureCalls = 0;
    const original = mode.failureBreaker.recordFailure.bind(mode.failureBreaker);
    mode.failureBreaker.recordFailure = options => { failureCalls += 1; return original(options); };
    await mode.initialize();

    await mode.enable();
    while (entered < 1) await delay(2);
    await mode.pause('test pause');
    assert.equal(failureCalls, 0);

    await mode.resume();
    while (entered < 2) await delay(2);
    await mode.disable('test disable');
    assert.equal(failureCalls, 0);

    await mode.enable();
    while (entered < 3) await delay(2);
    await mode.stop();
    assert.equal(failureCalls, 0);
    await publisher.stop();
});

test('collector Result.cancelled with active token is an expected bounded wait, not a failure', async () => {
    const eventBus = new EventBus();
    const failures = [];
    const legacy = [];
    eventBus.on('runtime:failure', event => failures.push(event));
    eventBus.on('mode:collector-b5:error', event => legacy.push(event));
    const gate = controllableDelay();
    let calls = 0;
    const mode = collector({
        eventBus,
        publisher: null,
        delayFn: gate.fn,
        preprocess: async () => { calls += 1; return Result.cancelled('temporary operation cancellation'); }
    });
    await mode.initialize();
    await mode.enable();
    await gate.waitForCall(1);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.equal(mode.status().failureBudget.consecutiveFailures, 0);
    assert.equal(mode.status().phase, 'COLLECTING');
    assert.equal(failures.length, 0);
    assert.equal(legacy.length, 0);
    await mode.pause('expected cancellation test');
    assert.equal(mode.status().phase, 'PAUSED');
    assert.equal(mode.status().failureBudget.consecutiveFailures, 0);
});

test('collector thrown CANCELLED with active token waits before restart and never hot-loops or increments breaker', async () => {
    const eventBus = new EventBus();
    const failures = [];
    eventBus.on('runtime:failure', event => failures.push(event));
    const gate = controllableDelay();
    let calls = 0;
    const mode = collector({
        eventBus,
        publisher: null,
        delayFn: gate.fn,
        preprocess: async () => {
            calls += 1;
            throw new OperationCancelledError('operation-level cancel while mode remains active');
        }
    });
    await mode.initialize();
    await mode.enable();
    await gate.waitForCall(1);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.equal(failures.length, 0);
    assert.equal(mode.status().failureBudget.consecutiveFailures, 0);
    assert.equal(gate.releaseOne(), true);
    await gate.waitForCall(2);
    assert.equal(calls, 2, 'loop restarted once only after the bounded wait was released');
    assert.equal(mode.status().failureBudget.consecutiveFailures, 0);
    await mode.disable('test');
    assert.equal(mode.status().phase, 'OFF');
});

for (const waitResult of [
    () => Result.fail(Status.NOT_READY, 'not ready yet'),
    () => Result.fail(Status.NOT_ENOUGH_MATERIALS, 'waiting for materials'),
    () => Result.fail(Status.FAILED, 'domain wait', null, { code: 'WAITING_MATERIALS' })
]) {
    test(`collector ${waitResult().status}/${waitResult().meta?.code || 'status'} stays out of failure budget`, async () => {
        const eventBus = new EventBus();
        const failures = [];
        eventBus.on('runtime:failure', event => failures.push(event));
        const gate = controllableDelay();
        let calls = 0;
        const mode = collector({
            eventBus,
            publisher: null,
            delayFn: gate.fn,
            preprocess: async () => { calls += 1; return waitResult(); }
        });
        await mode.initialize();
        await mode.enable();
        await gate.waitForCall(1);
        assert.equal(calls, 1);
        assert.equal(mode.status().failureBudget.consecutiveFailures, 0);
        assert.equal(mode.status().phase, 'COLLECTING');
        assert.equal(failures.length, 0);
        await mode.disable('test');
    });
}

test('collector unhandled retryable failure opens breaker without finally overwriting DEGRADED or starting new work inside open window', async () => {
    const eventBus = new EventBus();
    let resolveFailure;
    const failureSeen = new Promise(resolve => { resolveFailure = resolve; });
    eventBus.on('runtime:failure', resolveFailure);
    let calls = 0;
    let movementStops = 0;
    const mode = collector({
        eventBus,
        publisher: null,
        policy: { ...failurePolicy, maxConsecutiveFailures: 1, openDurationMs: 200 },
        preprocess: async () => {
            calls += 1;
            throw new FlowError('unhandled preprocess failure', {
                code: 'COLLECTOR_UNHANDLED', subsystem: 'collector-b5', operation: 'CollectorB5ModeService', step: 'preprocess', retryable: true
            });
        }
    });
    mode.movementManager.stop = async () => { movementStops += 1; };
    await mode.initialize();
    await mode.enable();
    await failureSeen;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(mode.status().failureBudget.state, 'OPEN');
    assert.equal(mode.status().phase, 'DEGRADED');
    assert.equal(calls, 1);
    assert.equal(movementStops > 0, true);
    await delay(50);
    assert.equal(calls, 1, 'no business attempt may run during the 200 ms OPEN window');
    assert.equal(mode.status().phase, 'DEGRADED');
    await mode.disable('test');
});

test('verified collector automation success resets retryable failure streak', async () => {
    const eventBus = new EventBus();
    const publisher = new RuntimeFailurePublisher({ botId: 'bot-01', eventBus, connectionAggregationMs: 10 });
    let preprocessCalls = 0;
    const mode = collector({
        eventBus,
        publisher,
        preprocess: async () => {
            preprocessCalls += 1;
            if (preprocessCalls === 1) return { success: false, message: 'retry', error: new FlowError('retry', { code: 'RETRY_ONCE', retryable: true }) };
            return { success: true, data: {} };
        }
    });
    mode.b5Planning.inspectAdditional = async () => ({ success: true, data: { fullPlan: { feasible: true }, finalSteps: [{ recipeId: 'b5' }], chains: [] } });
    mode.b5Automation.runNext = async () => ({ success: true, data: { completedNewB5: true, waitingForMaterials: false } });
    await publisher.initialize();
    await mode.initialize();
    await mode.enable();
    await delay(80);
    const status = mode.status();
    await mode.disable('test');
    await publisher.stop();
    assert.equal(status.failureBudget.consecutiveFailures, 0);
});

class FakeEmbedBuilder {
    constructor() { this.data = { fields: [] }; }
    setTitle(value) { this.data.title = value; return this; }
    addFields(...value) { this.data.fields.push(...value); return this; }
    setFooter(value) { this.data.footer = value; return this; }
}

function fishingMode({
    eventBus,
    publisher,
    stowRod,
    policy = failurePolicy,
    delayFn = undefined,
    connectionState = null,
    joinBestAvailable = async () => ({ success: true, data: { joined: false, areas: [] } }),
    config = {}
}) {
    let anchor = null;
    const baseConfig = {
        enabled: true, areaRetryMs: 5, errorRetryMs: 2, connectionPollMs: 2,
        movement: { shoreFishingPitchDegrees: 10 },
        probe: { enabled: false, profiles: [{ name: 'shift-walk-continuous', forward: true, sneak: true, sprint: false, jump: false }] },
        recovery: { waitMs: 5, retryMs: 2, movementRetryMs: 2, connectionRetryMs: 2 },
        areas: [{ id: 'afk-test', destination: { x: 1, y: 64, z: 1 } }],
        ...config
    };
    const modeCoordinator = new ModeCoordinator({ botId: 'bot-01' });
    return new FishingModeService({
        botId: 'bot-01',
        eventBus,
        afkAreas: { area: () => null, joinBestAvailable },
        fishing: { stowRod, equipRod: async () => ({ equipped: true }), fishOnce: async () => ({ caught: true }) },
        island: { goHome: async () => ({ success: true }) },
        movement: { stop: async () => {}, move: async () => ({}) },
        movementProbe: { run: async () => ({ enabled: false, results: [] }), reconfigure: () => {} },
        connectionState: connectionState || { isConnected: () => true, generation: () => 1 },
        positionGuard: {
            invalidate: () => { anchor = null; },
            snapshot: () => anchor,
            current: () => ({ x: 0, y: 64, z: 0 }),
            verifyCurrent: () => ({ valid: Boolean(anchor), code: anchor ? 'OK' : 'FISHING_ANCHOR_UNAVAILABLE' }),
            verifyDestination: () => ({ valid: true, code: 'OK' }),
            capture: () => { anchor = { x: 0, y: 64, z: 0, connectionGeneration: 1 }; return anchor; },
            reconfigure: () => {}
        },
        worldReadiness: { waitUntilReady: async () => ({ ready: true }), reconfigure: () => {} },
        recoveryPolicy: new FishingRecoveryPolicy({ config: baseConfig }),
        modeCoordinator,
        failurePublisher: publisher,
        failurePolicy: policy,
        config: baseConfig,
        ...(delayFn ? { delay: delayFn } : {})
    });
}

test('fishing failure is received by recorder and Discord reporter through canonical runtime:failure', async () => {
    const baseDir = await tempRoot();
    const eventBus = new EventBus();
    const publisher = new RuntimeFailurePublisher({ botId: 'bot-01', eventBus, connectionAggregationMs: 10 });
    const recorder = new RuntimeFailureRecorder({ botId: 'bot-01', eventBus, baseDir, config: failureConfig });
    const registry = new BotRegistry();
    registry.register({ botId: 'bot-01', getService: name => name === 'eventBus' ? eventBus : null });
    const sent = [];
    const reporter = new DiscordErrorReporter({ botRegistry: registry, enabled: true, duplicateWindowMs: 40 });
    reporter.start({ channel: { send: async value => sent.push(value) }, discord: { EmbedBuilder: FakeEmbedBuilder } });
    await publisher.initialize();
    await recorder.initialize();

    const fatal = new FlowError('rod subsystem failed', {
        code: 'FISHING_FATAL', subsystem: 'fishing-mode', operation: 'FishingModeService', step: 'stow-rod', retryable: false
    });
    const mode = fishingMode({ eventBus, publisher, stowRod: async () => { throw fatal; } });
    await mode.initialize();
    await mode.enable();
    await delay(20);
    assert.equal(mode.status().phase, 'PAUSED_ERROR');
    await recorder.stop();
    const full = (await records(baseDir)).filter(record => record.event !== 'runtime:failure-repeat-summary');
    assert.equal(full.length, 1);
    assert.equal(full[0].source, 'fishing');
    assert.equal(full[0].code, 'FISHING_FATAL');
    await reporter.stop();
    assert.equal(sent.length >= 1, true);
    await mode.stop();
    await publisher.stop();
});

test('fishing Result.cancelled with active token is an expected bounded wait and never increments breaker', async () => {
    const eventBus = new EventBus();
    const failures = [];
    eventBus.on('runtime:failure', event => failures.push(event));
    const gate = controllableDelay();
    let stowCalls = 0;
    const mode = fishingMode({
        eventBus,
        publisher: null,
        delayFn: gate.fn,
        stowRod: async () => {
            stowCalls += 1;
            return Result.cancelled('temporary rod operation cancellation');
        }
    });
    await mode.initialize();
    await mode.enable();
    await gate.waitForCall(1);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(stowCalls, 1);
    assert.equal(mode.status().failureBudget.consecutiveFailures, 0);
    assert.equal(mode.status().phase, 'WAITING_AREA');
    assert.equal(failures.length, 0);
    await mode.pause('expected cancellation test');
    assert.equal(mode.status().phase, 'PAUSED');
    assert.equal(mode.status().failureBudget.consecutiveFailures, 0);
});

test('fishing thrown CANCELLED with active token waits before retry and does not hot-loop', async () => {
    const eventBus = new EventBus();
    const failures = [];
    eventBus.on('runtime:failure', event => failures.push(event));
    const gate = controllableDelay();
    let stowCalls = 0;
    const mode = fishingMode({
        eventBus,
        publisher: null,
        delayFn: gate.fn,
        stowRod: async () => {
            stowCalls += 1;
            throw new OperationCancelledError('operation-level fishing cancellation');
        }
    });
    await mode.initialize();
    await mode.enable();
    await gate.waitForCall(1);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(stowCalls, 1);
    assert.equal(mode.status().failureBudget.consecutiveFailures, 0);
    assert.equal(failures.length, 0);
    assert.equal(gate.releaseOne(), true);
    await gate.waitForCall(2);
    assert.equal(stowCalls, 2, 'next rod operation starts only after the bounded wait is released');
    assert.equal(mode.status().failureBudget.consecutiveFailures, 0);
    await mode.disable('test');
    assert.equal(mode.status().phase, 'OFF');
});

for (const waitResult of [
    () => Result.fail(Status.NOT_READY, 'AFK area not ready'),
    () => Result.fail(Status.NOT_ENOUGH_MATERIALS, 'domain wait'),
    () => Result.fail(Status.FAILED, 'domain wait', null, { code: 'WAITING_MATERIALS' })
]) {
    test(`fishing ${waitResult().status}/${waitResult().meta?.code || 'status'} stays out of failure budget`, async () => {
        const eventBus = new EventBus();
        const failures = [];
        eventBus.on('runtime:failure', event => failures.push(event));
        const gate = controllableDelay();
        let joinCalls = 0;
        const mode = fishingMode({
            eventBus,
            publisher: null,
            delayFn: gate.fn,
            stowRod: async () => Result.ok(),
            joinBestAvailable: async () => {
                joinCalls += 1;
                return waitResult();
            }
        });
        await mode.initialize();
        await mode.enable();
        await gate.waitForCall(1);
        assert.equal(joinCalls, 1);
        assert.equal(mode.status().failureBudget.consecutiveFailures, 0);
        assert.equal(mode.status().phase, 'WAITING_AREA');
        assert.equal(failures.length, 0);
        await mode.disable('test');
    });
}

test('fishing pause, disable and stop cancellation end the loop without failure accounting or restart', async () => {
    for (const lifecycleAction of ['pause', 'disable', 'stop']) {
        const eventBus = new EventBus();
        const failures = [];
        eventBus.on('runtime:failure', event => failures.push(event));
        let joinCalls = 0;
        let enteredResolve;
        const entered = new Promise(resolve => { enteredResolve = resolve; });
        const mode = fishingMode({
            eventBus,
            publisher: null,
            stowRod: async () => Result.ok(),
            joinBestAvailable: async ({ cancellationToken }) => {
                joinCalls += 1;
                enteredResolve();
                await new Promise((resolve, reject) => {
                    const off = cancellationToken.onCancelled(reason => {
                        off();
                        reject(new OperationCancelledError(String(reason || 'cancelled')));
                    });
                });
                return Result.ok();
            }
        });
        await mode.initialize();
        await mode.enable();
        await entered;
        if (lifecycleAction === 'pause') await mode.pause('test pause');
        else if (lifecycleAction === 'disable') await mode.disable('test disable');
        else await mode.stop();
        assert.equal(mode.status().failureBudget.consecutiveFailures, 0, lifecycleAction);
        assert.equal(failures.length, 0, lifecycleAction);
        assert.equal(joinCalls, 1, lifecycleAction);
        assert.equal(mode.loopPromise, null, lifecycleAction);
        assert.equal(mode.restartTimer, null, lifecycleAction);
        assert.equal(mode.status().phase, lifecycleAction === 'pause' ? 'PAUSED' : 'OFF', lifecycleAction);
        if (lifecycleAction === 'pause') await mode.disable('cleanup');
    }
});

test('fishing keeps DEGRADED phase while circuit breaker is OPEN', async () => {
    const eventBus = new EventBus();
    const gate = controllableDelay();
    const openOnFirstFailure = { ...failurePolicy, maxConsecutiveFailures: 1, openDurationMs: 120 };
    const retryable = new FlowError('temporary fishing failure', {
        code: 'FISHING_TEMP', subsystem: 'fishing-mode', operation: 'FishingModeService', step: 'stow-rod', retryable: true
    });
    const mode = fishingMode({
        eventBus,
        publisher: null,
        delayFn: gate.fn,
        stowRod: async () => { throw retryable; },
        policy: openOnFirstFailure
    });
    await mode.initialize();
    await mode.enable();
    await gate.waitForCall(1);
    const status = mode.status();
    assert.equal(status.failureBudget.state, 'OPEN');
    assert.equal(status.phase, 'DEGRADED');
    assert.equal(gate.calls.length, 1, 'OPEN breaker waits instead of starting another business iteration');
    await mode.disable('test');
});

test('fishing unhandled failure keeps DEGRADED phase and starts no business operation during OPEN window', async () => {
    const eventBus = new EventBus();
    let connectionChecks = 0;
    let stowCalls = 0;
    let joinCalls = 0;
    const connectionState = {
        isConnected: () => {
            connectionChecks += 1;
            if (connectionChecks === 1) {
                throw new FlowError('unhandled connection-state failure', {
                    code: 'FISHING_CONNECTION_STATE_FAILURE', subsystem: 'fishing-mode', operation: 'FishingModeService', step: 'connection-state-check', retryable: true
                });
            }
            return true;
        },
        generation: () => 1
    };
    const mode = fishingMode({
        eventBus,
        publisher: null,
        connectionState,
        stowRod: async () => { stowCalls += 1; return Result.ok(); },
        joinBestAvailable: async () => { joinCalls += 1; return Result.ok({ joined: false, areas: [] }); },
        policy: { ...failurePolicy, maxConsecutiveFailures: 1, openDurationMs: 200 }
    });
    let failureResolve;
    const failureSeen = new Promise(resolve => { failureResolve = resolve; });
    eventBus.on('runtime:failure', failureResolve);
    await mode.initialize();
    await mode.enable();
    await failureSeen;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(mode.status().failureBudget.state, 'OPEN');
    assert.equal(mode.status().phase, 'DEGRADED');
    assert.equal(stowCalls, 1, 'safe OPEN cleanup may stow the rod once');
    assert.equal(joinCalls, 0, 'no AFK/business route starts while breaker is OPEN');
    await delay(50);
    assert.equal(joinCalls, 0, 'no business operation runs before the 200 ms OPEN window elapses');
    assert.equal(mode.status().phase, 'DEGRADED');
    await mode.disable('test');
});

test('fishing stale generation failure is discarded before breaker, cleanup, reconnect, or canonical publish', async () => {
    const eventBus = new EventBus();
    const failures = [];
    eventBus.on('runtime:failure', event => failures.push(event));
    let generation = 1;
    let connected = true;
    let movementStops = 0;
    let reconnects = 0;
    let stowCalls = 0;
    let rejectStow;
    const stowGate = new Promise((resolve, reject) => { rejectStow = reject; });
    const connectionState = {
        isConnected: () => connected,
        generation: () => generation
    };
    const baseConfig = {
        enabled: true, areaRetryMs: 5, errorRetryMs: 2, connectionPollMs: 2,
        movement: { shoreFishingPitchDegrees: 10 },
        probe: { enabled: false, profiles: [{ name: 'shift-walk-continuous', forward: true, sneak: true, sprint: false, jump: false }] },
        recovery: { waitMs: 5, retryMs: 2, movementRetryMs: 2, connectionRetryMs: 2 },
        areas: [{ id: 'afk-test', destination: { x: 1, y: 64, z: 1 } }]
    };
    const mode = new FishingModeService({
        botId: 'bot-01',
        eventBus,
        connectionState,
        connectionControl: { requestReconnect: async () => { reconnects += 1; return true; } },
        afkAreas: { area: () => null, joinBestAvailable: async () => Result.ok({ joined: false, areas: [] }) },
        fishing: {
            stowRod: async ({ cancellationToken } = {}) => {
                stowCalls += 1;
                if (stowCalls === 1) {
                    await stowGate;
                    return Result.ok();
                }
                await new Promise((resolve, reject) => {
                    const off = cancellationToken?.onCancelled?.(reason => {
                        off?.();
                        reject(new OperationCancelledError(String(reason || 'cancelled')));
                    });
                    if (!off) resolve();
                });
                return Result.ok();
            },
            equipRod: async () => ({ equipped: true }),
            fishOnce: async () => ({ caught: true })
        },
        island: { goHome: async () => Result.ok() },
        movement: { stop: async () => { movementStops += 1; }, move: async () => ({}) },
        movementProbe: { run: async () => ({ enabled: false, results: [] }), reconfigure: () => {} },
        positionGuard: {
            invalidate: () => {}, snapshot: () => null, current: () => ({ x: 0, y: 64, z: 0 }),
            verifyCurrent: () => ({ valid: false, code: 'FISHING_ANCHOR_UNAVAILABLE' }),
            verifyDestination: () => ({ valid: true, code: 'OK' }),
            capture: () => ({ x: 0, y: 64, z: 0, connectionGeneration: generation }), reconfigure: () => {}
        },
        worldReadiness: { waitUntilReady: async () => ({ ready: true }), reconfigure: () => {} },
        recoveryPolicy: new FishingRecoveryPolicy({ config: baseConfig }),
        modeCoordinator: new ModeCoordinator({ botId: 'bot-01' }),
        failurePolicy,
        config: baseConfig
    });
    await mode.initialize();
    await mode.enable();
    while (stowCalls === 0) await new Promise(resolve => setImmediate(resolve));
    generation = 2;
    connected = true;
    rejectStow(new FlowError('old generation stow failed', {
        code: 'OLD_GENERATION_FAILURE', subsystem: 'fishing-mode', operation: 'FishingModeService', step: 'stow-rod', retryable: true
    }));
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(failures.length, 0, 'old generation failure must not be published as generation 2');
    assert.equal(mode.status().failureBudget.consecutiveFailures, 0);
    assert.equal(reconnects, 0, 'stale recovery must not reconnect the replacement client');
    assert.equal(movementStops, 0, 'stale cleanup must not stop movement on the replacement generation');
    await mode.disable('test');
});
