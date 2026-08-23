'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventBus = require('../../../src/core/EventBus');
const ModeCoordinator = require('../../../src/modes/ModeCoordinator');
const CollectorB5ModeService = require('../../../src/modes/collector-b5/CollectorB5ModeService');

function inspection({ actionable = false, maintenance = false } = {}) {
    return {
        success: true,
        data: {
            fullPlan: { targetId: 'super_alloy', feasible: actionable },
            finalSteps: actionable ? [{ recipeId: 'b5', crafts: 1 }] : [],
            chains: maintenance ? [{ b3Id: 'coal_b3', vaultB2: 16, inventoryB2: 0, b3InputPerCraft: 16, b3Crafts: 1 }] : [],
            progress: { remainingStages: actionable || maintenance ? 1 : 0, remainingCrafts: actionable || maintenance ? 1 : 0 }
        }
    };
}

const failurePolicy = Object.freeze({
    baseBackoffMs: 2,
    maxBackoffMs: 20,
    multiplier: 2,
    jitterRatio: 0,
    maxConsecutiveFailures: 3,
    openDurationMs: 50
});

function createMode(overrides = {}) {
    const calls = [];
    let position = { x: 0, y: 64, z: 0 };
    let generation = 1;
    let skyReady = overrides.skyReady !== false;
    const context = {
        has: () => true,
        getGeneration: () => generation
    };
    const modeCoordinator = overrides.modeCoordinator || new ModeCoordinator({ botId: 'bot-01' });
    const skyblockReadiness = {
        requireTarget(target, options) { calls.push(['sky-demand', target, options]); return { success: true }; },
        releaseTarget(target, options) { calls.push(['sky-release', target, options]); return { success: true }; },
        isGenerationReady(expected, target) { return skyReady && expected === generation && target === (overrides.skyTarget || 'sky1'); }
    };
    const b1Materials = {
        async protectForB5Batch(options) { calls.push(['protect', options]); return { success: true, data: { reserveCoverage: 1.5 } }; },
        ...(overrides.b1Materials || {})
    };
    const b5Planning = {
        async inspectAdditional(_amount, options) { calls.push(['planning', options]); return inspection(); },
        ...(overrides.b5Planning || {})
    };
    const b5Automation = {
        async runNext(options) { calls.push(['automation', options]); return { success: true, data: { completedNewB5: false } }; },
        async runMaintenance(options) { calls.push(['maintenance', options]); return { success: true, data: { completedNewB5: false } }; },
        ...(overrides.b5Automation || {})
    };

    const mode = new CollectorB5ModeService({
        botId: 'bot-01',
        context,
        eventBus: new EventBus(),
        island: {
            async goHome(options) { calls.push(['home', options]); return { success: true, data: {} }; }
        },
        skyblock: {},
        skyblockReadiness,
        skyTarget: overrides.skyTarget || 'sky1',
        movementManager: {
            async goTo(destination) { calls.push(['goto', destination]); position = { ...destination }; return destination; },
            async stop() { calls.push(['stop']); }
        },
        positionService: {
            current: () => ({ ...position }),
            distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
        },
        b1Materials,
        b5Planning,
        b5Automation,
        modeCoordinator,
        failurePolicy,
        config: {
            enabled: true,
            teleportHomeOnEnable: true,
            pickupLocation: { x: 10, y: 65, z: -4 },
            arrivalRadius: 1,
            reanchorRadius: 2,
            moveTimeoutMs: 100,
            pollIntervalMs: 20,
            errorRetryMs: 10,
            craftLoopDelayMs: 2,
            b1Decompression: { maxUsageRatio: 0.8, requireKnownCapacity: true },
            ...(overrides.config || {})
        }
    });

    return {
        mode,
        calls,
        modeCoordinator,
        b1Materials,
        b5Planning,
        b5Automation,
        setPosition(next) { position = { ...next }; },
        setGeneration(next) { generation = next; },
        setSkyReady(next) { skyReady = next; }
    };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('enable fails safely when pickup position is not configured', async () => {
    const { mode, modeCoordinator } = createMode({ config: { pickupLocation: { x: null, y: null, z: null } } });
    await mode.initialize();
    const result = await mode.enable();
    assert.equal(result.success, false);
    assert.match(result.message, /pickupLocation/);
    assert.equal(modeCoordinator.owner(), null);
});

test('collector loses atomic enable race without starting side effects', async () => {
    const modeCoordinator = new ModeCoordinator({ botId: 'bot-01' });
    modeCoordinator.acquire('fishing');
    const { mode, calls } = createMode({ modeCoordinator });
    await mode.initialize();
    const result = await mode.enable();
    assert.equal(result.status, 'BUSY');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, []);
});

test('Collector+B5 demands its configured Sky, homes, anchors, then protects storage before planning', async () => {
    const { mode, calls } = createMode({ skyTarget: 'sky2', config: { pollIntervalMs: 50 } });
    await mode.initialize();
    const enabled = await mode.enable();
    assert.equal(enabled.success, true);
    await sleep(15);

    const demandIndex = calls.findIndex(call => call[0] === 'sky-demand');
    const homeIndex = calls.findIndex(call => call[0] === 'home');
    const moveIndex = calls.findIndex(call => call[0] === 'goto');
    const protectIndex = calls.findIndex(call => call[0] === 'protect');
    const planIndex = calls.findIndex(call => call[0] === 'planning');
    assert.deepEqual(calls[demandIndex].slice(0, 2), ['sky-demand', 'sky2']);
    assert.ok(demandIndex < homeIndex && homeIndex < moveIndex && moveIndex < protectIndex && protectIndex < planIndex);
    assert.equal(mode.status().skyTarget, 'sky2');
    assert.equal(mode.status().storagePressure, undefined);
    await mode.disable('test');
});

test('storage protection runs once for a batch and runs again only after a new B5 completes', async () => {
    let automationCalls = 0;
    const { mode, calls, b5Planning, b5Automation } = createMode({ config: { pollIntervalMs: 5, craftLoopDelayMs: 2 } });
    b5Planning.inspectAdditional = async () => inspection({ actionable: true });
    b5Automation.runNext = async options => {
        automationCalls += 1;
        calls.push(['automation', options]);
        return { success: true, data: { completedNewB5: automationCalls === 1 } };
    };

    await mode.initialize();
    await mode.enable();
    await sleep(25);
    const protects = calls.filter(call => call[0] === 'protect');
    assert.equal(protects.length >= 2, true, 'completed B5 must arm protection for the next batch');
    assert.equal(mode.status().craftedB5Cycles >= 1, true);
    await mode.disable('test');
});

test('idle material waiting does not rerun storage protection inside the same batch', async () => {
    const { mode, calls, b5Planning } = createMode({ config: { pollIntervalMs: 5 } });
    b5Planning.inspectAdditional = async () => inspection({ actionable: false });
    await mode.initialize();
    await mode.enable();
    await sleep(24);
    assert.equal(calls.filter(call => call[0] === 'protect').length, 1);
    assert.equal(calls.filter(call => call[0] === 'automation').length, 0);
    assert.equal(mode.status().phase, 'COLLECTING');
    await mode.disable('test');
});

test('Collector+B5 passes only its own decompression headroom policy into active crafting', async () => {
    const observed = [];
    const { mode, b5Planning, b5Automation } = createMode({
        config: { pollIntervalMs: 20, craftLoopDelayMs: 20, b1Decompression: { maxUsageRatio: 0.77, requireKnownCapacity: true } }
    });
    b5Planning.inspectAdditional = async () => inspection({ actionable: true });
    b5Automation.runNext = async options => {
        observed.push(options);
        return { success: true, data: { completedNewB5: false, waitingForMaterials: true } };
    };
    await mode.initialize();
    await mode.enable();
    await sleep(12);
    await mode.pause('test');
    assert.equal(observed.length > 0, true);
    assert.equal(observed[0].decompressionPolicy, 'guarded');
    assert.equal(observed[0].decompressionMaxUsageRatio, 0.77);
    assert.equal(observed[0].requireKnownCapacity, true);
    await mode.disable('test');
});

test('pause and resume preserve the same primary lease and Sky demand ownership', async () => {
    const { mode, modeCoordinator } = createMode({ config: { pollIntervalMs: 20 } });
    await mode.initialize();
    await mode.enable();
    await sleep(8);
    const lease = modeCoordinator.owner().leaseId;
    await mode.pause('panel pause');
    assert.equal(mode.status().paused, true);
    assert.equal(modeCoordinator.owner().leaseId, lease);
    assert.equal(modeCoordinator.owner().state, 'PAUSED');
    await mode.resume();
    assert.equal(modeCoordinator.owner().leaseId, lease);
    assert.equal(modeCoordinator.owner().state, 'ACTIVE');
    await mode.disable('test');
    assert.equal(modeCoordinator.owner(), null);
});

test('collector reanchors only at a transaction boundary after drifting outside reanchorRadius', async () => {
    const { mode, calls, setPosition, b5Planning } = createMode({ config: { pollIntervalMs: 5 } });
    b5Planning.inspectAdditional = async () => inspection({ actionable: false });
    await mode.initialize();
    await mode.enable();
    await sleep(12);
    assert.equal(calls.filter(call => call[0] === 'goto').length, 1);
    setPosition({ x: 25, y: 65, z: -4 });
    await sleep(15);
    const moves = calls.filter(call => call[0] === 'goto');
    assert.equal(moves.length >= 2, true);
    assert.deepEqual(moves.at(-1), ['goto', { x: 10, y: 65, z: -4 }]);
    await mode.disable('test');
});

test('collector propagates one exact generation and cancellation token through Sky preparation, protection, planning and automation', async () => {
    const observations = [];
    const { mode, b1Materials, b5Planning, b5Automation } = createMode({ config: { pollIntervalMs: 30, craftLoopDelayMs: 30 } });
    b1Materials.protectForB5Batch = async options => { observations.push(['protect', options]); return { success: true, data: {} }; };
    b5Planning.inspectAdditional = async (_amount, options) => { observations.push(['planning', options]); return inspection({ actionable: true }); };
    b5Automation.runNext = async options => { observations.push(['automation', options]); return { success: true, data: { completedNewB5: false, waitingForMaterials: true } }; };
    await mode.initialize();
    await mode.enable();
    await sleep(12);
    await mode.pause('test');
    for (const [name, options] of observations) {
        assert.equal(options.expectedGeneration, 1, `${name} must use the captured generation`);
        assert.equal(typeof options.cancellationToken?.onCancelled, 'function', `${name} must receive the mode token`);
    }
    await mode.disable('test');
});

test('collector ignores stale/generation-less connection end and only current generation invalidates preparation', async () => {
    const { mode, setGeneration } = createMode();
    setGeneration(2);
    await mode.initialize();
    mode.enabled = true;
    mode.paused = false;
    mode.phase = 'COLLECTING';
    mode.preparedGeneration = 2;

    mode.eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 1 });
    assert.equal(mode.phase, 'COLLECTING');
    mode.eventBus.emit('connection:ended', { botId: 'bot-01' });
    assert.equal(mode.phase, 'COLLECTING');
    mode.eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 2 });
    assert.equal(mode.phase, 'WAITING_CONNECTION');
    assert.equal(mode.preparedGeneration, null);
    assert.equal(mode.batchProtectionRequired, true);
    mode.enabled = false;
    await mode.destroy();
});

test('public config contains Collector decompression policy but no legacy Sky/protection toggles', () => {
    const { mode } = createMode();
    const cfg = mode.publicConfig();
    assert.deepEqual(cfg.b1Decompression, { maxUsageRatio: 0.8, requireKnownCapacity: true });
    assert.equal(cfg.waitForSkyblockReady, undefined);
    assert.equal(cfg.storageProtection, undefined);
});

test('collector stale generation boundary does not consume failure budget or publish a current failure', async () => {
    const h = createMode({ config: { pollIntervalMs: 30, errorRetryMs: 5, craftLoopDelayMs: 5 } });
    let first = true;
    const failures = [];
    h.mode.eventBus.on('runtime:failure', event => failures.push(event));
    h.b5Planning.inspectAdditional = async () => {
        if (first) {
            first = false;
            h.setGeneration(2);
        }
        return inspection({ actionable: false });
    };

    await h.mode.initialize();
    await h.mode.enable();
    await sleep(25);

    assert.equal(h.mode.status().failureBudget.consecutiveFailures, 0, 'stale generation must not consume breaker budget');
    assert.equal(failures.length, 0, 'stale generation must not publish a current-generation runtime failure');
    await h.mode.disable('test');
});
