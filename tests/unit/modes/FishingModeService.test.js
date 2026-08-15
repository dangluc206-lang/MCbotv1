'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventBus = require('../../../src/core/EventBus');
const Result = require('../../../src/shared/result/Result');
const Status = require('../../../src/shared/result/Status');
const FlowError = require('../../../src/shared/errors/FlowError');
const FishingModeService = require('../../../src/modes/fishing/FishingModeService');
const FishingRecoveryPolicy = require('../../../src/modes/fishing/FishingRecoveryPolicy');

const policy = Object.freeze({ baseBackoffMs: 2, maxBackoffMs: 20, multiplier: 2, jitterRatio: 0, maxConsecutiveFailures: 2, openDurationMs: 60 });
const area = Object.freeze({ id: 'afk-11', menuSlot: 11, priority: 1, capacity: 10, destination: { x: 74, y: 70, z: 90 } });
const config = Object.freeze({
    enabled: true, areaRetryMs: 5, errorRetryMs: 3, connectionPollMs: 3,
    movement: { shoreFishingPitchDegrees: 10 },
    probe: { enabled: false, profiles: [{ name: 'shift-walk-continuous', forward: true, sneak: true, sprint: false, jump: false }] },
    recovery: { waitMs: 5, retryMs: 3, movementRetryMs: 3, connectionRetryMs: 3 },
    areas: [area]
});

const tick = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(predicate, message = 'condition', loops = 200) {
    for (let i = 0; i < loops; i += 1) {
        if (predicate()) return;
        await tick();
    }
    throw new Error(`Timed out waiting for ${message}`);
}

function cancellableBlock(onEnter = null) {
    return async ({ cancellationToken } = {}) => {
        onEnter?.();
        await new Promise((resolve, reject) => {
            const off = cancellationToken?.onCancelled?.(reason => {
                off?.();
                const error = new FlowError(String(reason || 'cancelled'), { code: 'CANCELLED', retryable: true });
                reject(error);
            });
        });
    };
}

function harness(overrides = {}) {
    const eventBus = overrides.eventBus || new EventBus();
    let connected = overrides.connected ?? true;
    let generation = overrides.generation ?? 1;
    let anchor = null;
    let currentArea = null;
    const calls = [];
    const resolvedConfig = JSON.parse(JSON.stringify(overrides.config || config));
    const defaultJoin = async () => {
        calls.push('join');
        currentArea = area;
        return Result.ok({ joined: true, area, areas: [{ ...area, occupancy: { current: 1, capacity: 10, full: false, known: true } }] });
    };
    const capabilities = {
        afkAreas: {
            area: id => id === area.id ? currentArea || area : null,
            joinBestAvailable: overrides.joinBestAvailable || defaultJoin,
            reconfigure: value => calls.push(['afk-reconfigure', value])
        },
        fishing: {
            stowRod: overrides.stowRod || (async () => { calls.push('stow'); return { stowed: true }; }),
            equipRod: overrides.equipRod || (async () => { calls.push('equip'); return { equipped: true }; }),
            fishOnce: overrides.fishOnce || cancellableBlock(() => calls.push('fish')),
            reconfigure: value => calls.push(['fish-reconfigure', value])
        },
        island: { goHome: overrides.goHome || (async () => { calls.push('home'); return Result.ok({}); }) },
        movement: {
            move: overrides.move || (async () => { calls.push('move'); return { operationId: 'move-1' }; }),
            stop: overrides.stopMovement || (async () => { calls.push('move-stop'); }),
            reconfigure: value => calls.push(['move-reconfigure', value])
        },
        movementProbe: {
            run: overrides.probeRun || (async () => ({ enabled: false, selected: null, results: [] })),
            reconfigure: value => calls.push(['probe-reconfigure', value])
        },
        positionGuard: {
            current: () => ({ x: 74, y: 70, z: 90 }),
            snapshot: () => anchor,
            invalidate: () => { anchor = null; calls.push('guard-invalidate'); },
            verifyCurrent: overrides.verifyCurrent || (() => ({ valid: Boolean(anchor), code: anchor ? 'OK' : 'FISHING_ANCHOR_UNAVAILABLE' })),
            verifyDestination: overrides.verifyDestination || (() => ({ valid: overrides.arrived !== false, code: overrides.arrived === false ? 'FISHING_DESTINATION_NOT_REACHED' : 'OK' })),
            capture: ({ expectedGeneration }) => { anchor = { x: 74, y: 70, z: 90, connectionGeneration: expectedGeneration }; calls.push('guard-capture'); return anchor; },
            reconfigure: value => calls.push(['guard-reconfigure', value])
        },
        worldReadiness: {
            waitUntilReady: overrides.worldReady || (async () => { calls.push('world'); return { ready: true }; }),
            reconfigure: value => calls.push(['world-reconfigure', value])
        }
    };
    const connectionState = overrides.connectionState || {
        isConnected: () => connected,
        generation: () => generation
    };
    const mode = new FishingModeService({
        botId: 'bot-01', eventBus, connectionState,
        connectionControl: { requestReconnect: overrides.requestReconnect || (async (reason, options) => calls.push(['reconnect', reason, options])) },
        ...capabilities,
        recoveryPolicy: new FishingRecoveryPolicy({ config: resolvedConfig }),
        collectorB5Mode: { status: () => ({ enabled: Boolean(overrides.collectorActive) }) },
        failurePublisher: overrides.failurePublisher || null,
        failurePolicy: overrides.failurePolicy || policy,
        config: resolvedConfig,
        delay: overrides.delay || ((ms, { cancellationToken } = {}) => new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, Math.max(1, ms));
            timer.unref?.();
            const off = cancellationToken?.onCancelled?.(reason => {
                clearTimeout(timer); off?.(); reject(new FlowError(String(reason || 'cancelled'), { code: 'CANCELLED' }));
            });
        }))
    });
    return {
        mode, eventBus, calls, capabilities,
        setConnected: value => { connected = value; },
        setGeneration: value => { generation = value; },
        setArea: value => { currentArea = value; },
        setAnchor: value => { anchor = value; }
    };
}

test('FishingModeService enable/config-disabled/mutual-exclusion/repeated-enable preserve public API', async () => {
    const disabled = harness({ config: { ...config, enabled: false } });
    assert.equal((await disabled.mode.enable()).status, Status.NOT_READY);
    const busy = harness({ collectorActive: true });
    assert.equal((await busy.mode.enable()).status, Status.BUSY);

    const h = harness();
    await h.mode.initialize();
    const first = await h.mode.enable();
    assert.equal(first.success, true);
    const second = await h.mode.enable();
    assert.equal(second.meta.alreadyEnabled, true);
    const status = h.mode.status();
    for (const key of ['mode','enabled','paused','phase','currentAreaId','destination','areas','catches','lastCatchAt','startedAt','lastError','movementProfile','movementCalibration','fishingAnchor','fishingAnchorKind','fishingPitchOverrideDegrees','failureBudget','movementStrategy','position']) assert.equal(key in status, true, key);
    assert.equal(h.mode.publicConfig().areas[0].id, 'afk-11');
    await h.mode.disable('cleanup');
    assert.equal(h.mode.status().phase, 'OFF');
});

test('FishingModeService successful route orders home/AFK/world/movement/equip before fishing and verified catch resets breaker', async () => {
    let caughtOnce = false;
    const h = harness({
        arrived: false,
        verifyDestination: (() => { let count = 0; return () => ({ valid: ++count > 1, code: count > 1 ? 'OK' : 'FISHING_DESTINATION_NOT_REACHED' }); })(),
        fishOnce: async ({ cancellationToken }) => {
            h.calls.push('fish');
            if (!caughtOnce) { caughtOnce = true; return { caught: true, signal: 'test-catch' }; }
            return cancellableBlock()( { cancellationToken } );
        }
    });
    await h.mode.initialize();
    await h.mode.enable();
    await waitFor(() => h.mode.status().catches === 1, 'verified catch');
    const sequence = h.calls.filter(value => typeof value === 'string');
    for (const name of ['stow','home','join','world','move','guard-capture','equip','fish']) assert.equal(sequence.includes(name), true, name);
    assert.equal(sequence.indexOf('equip') > sequence.indexOf('move'), true);
    assert.equal(h.mode.status().failureBudget.consecutiveFailures, 0);
    assert.equal(h.mode.status().currentAreaId, 'afk-11');
    await h.mode.disable('cleanup');
});

for (const [phaseName, overrides, expectedPhase] of [
    ['teleport', { goHome: cancellableBlock() }, 'RETURNING_ISLAND'],
    ['AFK selection', { joinBestAvailable: cancellableBlock() }, 'SELECTING_AREA'],
    ['world readiness', { worldReady: cancellableBlock() }, 'WAITING_AFK_WORLD'],
    ['movement', { arrived: false, move: cancellableBlock() }, 'MOVING_TO_SHORE'],
    ['probe', { config: { ...config, probe: { enabled: true, maxProfiles: 1, totalTimeoutMs: 100, profileTimeoutMs: 50, gapMs: 0, profiles: config.probe.profiles } }, probeRun: cancellableBlock() }, 'PROBING_MOVEMENT'],
    ['fishing', { fishOnce: cancellableBlock() }, 'FISHING']
]) {
    test(`FishingModeService pause cancels ${phaseName} and leaves PAUSED without failure`, async () => {
        const failures = [];
        const h = harness(overrides);
        h.eventBus.on('runtime:failure', value => failures.push(value));
        await h.mode.initialize();
        await h.mode.enable();
        await waitFor(() => h.mode.status().phase === expectedPhase, expectedPhase);
        await h.mode.pause('test pause');
        assert.equal(h.mode.status().phase, 'PAUSED');
        assert.equal(h.mode.status().failureBudget.consecutiveFailures, 0);
        assert.equal(failures.length, 0);
        assert.equal(h.mode.loopPromise, null);
        await h.mode.disable('cleanup');
    });
}

test('FishingModeService disable/stop/destroy are idempotent and clean loop/restart/listeners', async () => {
    const h = harness({ fishOnce: cancellableBlock() });
    await h.mode.initialize(); await h.mode.enable();
    await waitFor(() => h.mode.status().phase === 'FISHING');
    await h.mode.disable('disable');
    await h.mode.disable('again');
    assert.equal(h.mode.loopPromise, null);
    assert.equal(h.mode.restartTimer, null);
    assert.equal(h.mode.status().phase, 'OFF');
    await h.mode.stop(); await h.mode.destroy();
    assert.equal(h.mode.unsubscribers.length, 0);
});

test('FishingModeService ignores stale connection:ended without mutating current generation state', async () => {
    const h = harness({ fishOnce: cancellableBlock() });
    const failures = [];
    h.eventBus.on('runtime:failure', failure => failures.push(failure));
    await h.mode.initialize(); await h.mode.enable();
    await waitFor(() => h.mode.status().phase === 'FISHING');
    assert.equal(h.mode.status().currentAreaId, 'afk-11');
    const invalidationsBefore = h.calls.filter(value => value === 'guard-invalidate').length;
    h.setGeneration(2);
    h.eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 1 });
    assert.equal(h.mode.status().phase, 'FISHING');
    assert.equal(h.mode.status().currentAreaId, 'afk-11');
    assert.equal(h.calls.filter(value => value === 'guard-invalidate').length, invalidationsBefore);
    assert.equal(failures.length, 0);
    await h.mode.disable('cleanup');
});

test('FishingModeService ignores stale connection:spawned while waiting for the current generation', async () => {
    const h = harness({ fishOnce: cancellableBlock() });
    await h.mode.initialize(); await h.mode.enable();
    await waitFor(() => h.mode.status().phase === 'FISHING');
    h.setConnected(false);
    h.eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 1 });
    assert.equal(h.mode.status().phase, 'WAITING_CONNECTION');
    h.setGeneration(2);
    h.setConnected(true);
    const invalidationsBefore = h.calls.filter(value => value === 'guard-invalidate').length;
    h.eventBus.emit('connection:spawned', { botId: 'bot-01', connectionGeneration: 1 });
    assert.equal(h.mode.status().phase, 'WAITING_CONNECTION');
    assert.equal(h.calls.filter(value => value === 'guard-invalidate').length, invalidationsBefore);
    await h.mode.disable('cleanup');
});

test('FishingModeService matching connection:ended invalidates route and matching spawn resumes current generation', async () => {
    const h = harness({ fishOnce: cancellableBlock() });
    await h.mode.initialize(); await h.mode.enable();
    await waitFor(() => h.mode.status().phase === 'FISHING');
    assert.equal(h.mode.status().currentAreaId, 'afk-11');
    h.setConnected(false);
    h.eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 1 });
    assert.equal(h.mode.status().phase, 'WAITING_CONNECTION');
    assert.equal(h.mode.status().currentAreaId, null);

    h.setGeneration(2);
    h.setConnected(true);
    h.eventBus.emit('connection:spawned', { botId: 'bot-01', connectionGeneration: 2 });
    assert.equal(h.mode.status().phase, 'RESUMING');
    assert.equal(h.mode.status().currentAreaId, null);
    await h.mode.disable('cleanup');
});

test('FishingModeService stale ended arriving after current spawn cannot destroy new route state', async () => {
    const h = harness({ fishOnce: cancellableBlock() });
    await h.mode.initialize(); await h.mode.enable();
    await waitFor(() => h.mode.status().phase === 'FISHING');
    h.setConnected(false);
    h.eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 1 });
    h.setGeneration(2);
    h.setConnected(true);
    h.eventBus.emit('connection:spawned', { botId: 'bot-01', connectionGeneration: 2 });

    h.mode.phase = 'FISHING';
    h.mode.currentAreaId = 'afk-11';
    const invalidationsBefore = h.calls.filter(value => value === 'guard-invalidate').length;
    h.eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 1 });
    assert.equal(h.mode.status().phase, 'FISHING');
    assert.equal(h.mode.status().currentAreaId, 'afk-11');
    assert.equal(h.calls.filter(value => value === 'guard-invalidate').length, invalidationsBefore);
    await h.mode.disable('cleanup');
});

test('FishingModeService generation-less connection events cannot mutate an active route', async () => {
    const h = harness({ fishOnce: cancellableBlock() });
    await h.mode.initialize(); await h.mode.enable();
    await waitFor(() => h.mode.status().phase === 'FISHING');
    const before = h.mode.status();
    const invalidationsBefore = h.calls.filter(value => value === 'guard-invalidate').length;
    h.eventBus.emit('connection:ended', { botId: 'bot-01' });
    h.eventBus.emit('connection:spawned', { botId: 'bot-01' });
    assert.equal(h.mode.status().phase, before.phase);
    assert.equal(h.mode.status().currentAreaId, before.currentAreaId);
    assert.equal(h.calls.filter(value => value === 'guard-invalidate').length, invalidationsBefore);
    await h.mode.disable('cleanup');
});

test('FishingModeService waits for disconnected connection without starting business work', async () => {
    let delayCalls = 0;
    const h = harness({ connected: false, delay: async (_ms, { cancellationToken }) => {
        delayCalls += 1;
        await cancellableBlock()({ cancellationToken });
    } });
    await h.mode.initialize(); await h.mode.enable();
    await waitFor(() => h.mode.status().phase === 'WAITING_CONNECTION');
    assert.equal(delayCalls, 1);
    assert.equal(h.calls.includes('home'), false);
    await h.mode.disable('cleanup');
});

test('FishingModeService no available AFK area stays in bounded WAITING_AREA', async () => {
    let entered = 0;
    const h = harness({
        joinBestAvailable: async () => Result.ok({ joined: false, areas: [] }),
        delay: async (_ms, { cancellationToken }) => { entered += 1; await cancellableBlock()({ cancellationToken }); }
    });
    await h.mode.initialize(); await h.mode.enable();
    await waitFor(() => h.mode.status().phase === 'WAITING_AREA');
    assert.equal(entered, 1);
    assert.equal(h.mode.status().failureBudget.consecutiveFailures, 0);
    await h.mode.disable('cleanup');
});

test('FishingModeService ordinary fish-cycle retry keeps route while real retryable failures consume breaker', async () => {
    let fishCalls = 0;
    const failures = [];
    let streakAtFailure = null;
    const h = harness({ config: { ...config, recovery: { ...config.recovery, retryMs: 0 } }, fishOnce: async ({ cancellationToken }) => {
        fishCalls += 1;
        if (fishCalls === 1) return { caught: false, retry: true, signal: 'fish-cycle-error' };
        if (fishCalls === 2) throw new FlowError('temporary', { code: 'FISHING_TEMP', subsystem: 'fishing', retryable: true });
        if (fishCalls === 3) return { caught: true, signal: 'verified-catch' };
        return cancellableBlock()({ cancellationToken });
    } });
    h.eventBus.on('runtime:failure', value => {
        failures.push(value);
        streakAtFailure = h.mode.status().failureBudget.consecutiveFailures;
    });
    await h.mode.initialize(); await h.mode.enable();
    await waitFor(() => failures.length === 1, 'runtime failure');
    assert.equal(streakAtFailure, 1, 'real retryable failure increments breaker before recovery catch');
    assert.equal(h.calls.filter(x => x === 'home').length, 1, 'ordinary fish retry reuses current route');
    await waitFor(() => h.mode.status().catches === 1, 'verified recovery catch');
    assert.equal(h.mode.status().failureBudget.consecutiveFailures, 0, 'verified catch resets the failure streak');
    await h.mode.disable('cleanup');
});

test('FishingModeService non-retryable no-rod failure pauses with PAUSED_ERROR', async () => {
    const h = harness({ equipRod: async () => { throw new FlowError('no rod', { code: 'FISHING_ROD_NOT_FOUND', subsystem: 'fishing', retryable: false }); } });
    await h.mode.initialize(); await h.mode.enable();
    await waitFor(() => h.mode.status().phase === 'PAUSED_ERROR', 'PAUSED_ERROR');
    assert.equal(h.mode.status().paused, true);
    await h.mode.stop();
});

test('FishingModeService OPEN breaker holds DEGRADED and starts no business route inside open window', async () => {
    let stow = 0;
    const h = harness({
        failurePolicy: { ...policy, maxConsecutiveFailures: 1, openDurationMs: 200 },
        stowRod: async () => { stow += 1; if (stow === 1) throw new FlowError('temporary', { code: 'TEMP', retryable: true }); return { stowed: true }; }
    });
    await h.mode.initialize(); await h.mode.enable();
    await waitFor(() => h.mode.status().failureBudget.state === 'OPEN');
    assert.equal(h.mode.status().phase, 'DEGRADED');
    const homeBefore = h.calls.filter(x => x === 'home').length;
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(h.calls.filter(x => x === 'home').length, homeBefore);
    assert.equal(h.mode.status().phase, 'DEGRADED');
    await h.mode.disable('cleanup');
});

test('FishingModeService movement probe reconnect result requests connection capability', async () => {
    let reconnects = 0;
    let reconnectOptions = null;
    const h = harness({
        config: { ...config, probe: { enabled: true, maxProfiles: 1, totalTimeoutMs: 100, profileTimeoutMs: 50, gapMs: 0, profiles: config.probe.profiles } },
        probeRun: async () => ({ enabled: true, requiresReconnect: true, selected: null, results: [] }),
        requestReconnect: async (_reason, options) => { reconnects += 1; reconnectOptions = options; return true; }
    });
    await h.mode.initialize(); await h.mode.enable();
    await waitFor(() => reconnects === 1, 'reconnect request');
    assert.deepEqual(reconnectOptions, { expectedGeneration: 1 });
    assert.equal(h.mode.status().failureBudget.consecutiveFailures >= 1, true);
    await h.mode.disable('cleanup');
});

test('FishingModeService stale probe outcome cannot publish, cleanup, or reconnect the replacement generation', async () => {
    let resolveProbe;
    const probe = new Promise(resolve => { resolveProbe = resolve; });
    let reconnects = 0;
    const failures = [];
    const h = harness({
        config: { ...config, probe: { enabled: true, maxProfiles: 1, totalTimeoutMs: 100, profileTimeoutMs: 50, gapMs: 0, profiles: config.probe.profiles } },
        probeRun: () => probe,
        requestReconnect: async () => { reconnects += 1; return true; }
    });
    h.eventBus.on('runtime:failure', failure => failures.push(failure));
    await h.mode.initialize(); await h.mode.enable();
    await waitFor(() => h.mode.status().phase === 'PROBING_MOVEMENT', 'probe phase');
    const stowBefore = h.calls.filter(value => value === 'stow').length;
    const movementStopsBefore = h.calls.filter(value => value === 'move-stop').length;
    h.setGeneration(2);
    h.setConnected(false);
    resolveProbe({ enabled: true, requiresReconnect: true, selected: null, results: [] });
    await waitFor(() => h.mode.status().phase === 'WAITING_CONNECTION', 'new generation wait state');
    assert.equal(reconnects, 0, 'stale probe must not request reconnect for generation 2');
    assert.equal(failures.length, 0, 'stale outcome must not be published as current generation failure');
    assert.equal(h.mode.status().failureBudget.consecutiveFailures, 0, 'stale outcome must not consume new generation breaker');
    assert.equal(h.calls.filter(value => value === 'stow').length, stowBefore, 'stale cleanup must not stow rod on replacement generation');
    assert.equal(h.calls.filter(value => value === 'move-stop').length, movementStopsBefore, 'stale cleanup must not stop replacement movement');
    await h.mode.disable('cleanup');
});

test('FishingModeService position drift reanchors route rather than casting from stale anchor', async () => {
    let verification = 0;
    const h = harness({ verifyCurrent: () => {
        verification += 1;
        if (verification <= 1) return { valid: false, code: 'FISHING_ANCHOR_UNAVAILABLE' };
        return { valid: false, code: 'FISHING_HORIZONTAL_DRIFT' };
    } });
    const failures = [];
    h.eventBus.on('runtime:failure', value => failures.push(value));
    await h.mode.initialize(); await h.mode.enable();
    await waitFor(() => failures.some(f => f.code === 'FISHING_HORIZONTAL_DRIFT'), 'drift failure');
    assert.equal(h.mode.status().currentAreaId, null);
    await h.mode.disable('cleanup');
});

test('FishingModeService reconfigure propagates validated config to every capability and resumes running mode', async () => {
    const h = harness({ fishOnce: cancellableBlock() });
    await h.mode.initialize(); await h.mode.enable();
    await waitFor(() => h.mode.status().phase === 'FISHING');
    const next = JSON.parse(JSON.stringify(config));
    next.movement.shoreFishingPitchDegrees = 12;
    const publicConfig = await h.mode.reconfigure(next);
    assert.equal(publicConfig.movement.shoreFishingPitchDegrees, 12);
    for (const owner of ['afk-reconfigure','fish-reconfigure','move-reconfigure','probe-reconfigure','guard-reconfigure','world-reconfigure']) {
        assert.equal(h.calls.some(value => Array.isArray(value) && value[0] === owner), true, owner);
    }
    await h.mode.disable('cleanup');
});
