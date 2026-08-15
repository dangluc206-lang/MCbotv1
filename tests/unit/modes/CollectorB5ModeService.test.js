'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventBus = require('../../../src/core/EventBus');
const CollectorB5ModeService = require('../../../src/modes/collector-b5/CollectorB5ModeService');

function inspection({ actionable = false } = {}) {
    return {
        success: true,
        data: {
            fullPlan: { targetId: 'super_alloy', feasible: actionable },
            finalSteps: actionable ? [{ recipeId: 'b5', crafts: 1 }] : [],
            chains: []
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
    const context = {
        has: () => true,
        getGeneration: () => 1
    };
    const mode = new CollectorB5ModeService({
        botId: 'bot-01',
        context,
        eventBus: new EventBus(),
        island: {
            async goHome() { calls.push('home'); return { success: true, data: {} }; }
        },
        movementManager: {
            async goTo(destination) { calls.push(['goto', destination]); position = { ...destination }; return destination; },
            async stop() { calls.push('stop'); }
        },
        positionService: {
            current: () => ({ ...position }),
            distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
        },
        b1Materials: {
            async preprocessForCraft() { calls.push('preprocess'); return { success: true, data: { actions: [] } }; }
        },
        b5Planning: {
            async inspectAdditional() { calls.push('inspectAdditional'); return inspection(); }
        },
        b5Automation: {
            async runNext() { calls.push('automation'); return { success: true, data: { completedNewB5: false } }; }
        },
        failurePolicy,
        config: {
            enabled: true,
            teleportHomeOnEnable: true,
            waitForSkyblockReady: false,
            pickupLocation: { x: 10, y: 65, z: -4 },
            arrivalRadius: 1,
            reanchorRadius: 2,
            moveTimeoutMs: 100,
            pollIntervalMs: 20,
            errorRetryMs: 10,
            craftLoopDelayMs: 2,
            ...overrides.config
        }
    });
    return { mode, calls };
}

test('enable fails safely when pickup position is not configured', async () => {
    const { mode } = createMode({ config: { pickupLocation: { x: null, y: null, z: null } } });
    await mode.initialize();
    const result = await mode.enable();
    assert.equal(result.success, false);
    assert.match(result.message, /pickupLocation/);
});

test('mode goes /is, anchors once, then preprocesses while staying at pickup', async () => {
    const { mode, calls } = createMode();
    await mode.initialize();
    const enabled = await mode.enable();
    assert.equal(enabled.success, true);

    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(calls[0], 'home');
    assert.deepEqual(calls[1], ['goto', { x: 10, y: 65, z: -4 }]);
    assert.equal(calls.includes('preprocess'), true);
    assert.equal(calls.includes('inspectAdditional'), true);

    await mode.disable('test');
    assert.equal(mode.status().enabled, false);
    assert.equal(mode.status().phase, 'OFF');
});

test('completed B5 immediately continues into the next craftable B5 cycle', async () => {
    const { mode } = createMode({ config: { pollIntervalMs: 50, craftLoopDelayMs: 2 } });
    let automationCalls = 0;
    mode.b5Planning.inspectAdditional = async () => inspection({ actionable: true });
    mode.b5Automation.runNext = async ({ cancellationToken }) => {
        assert.equal(typeof cancellationToken?.onCancelled, 'function');
        automationCalls += 1;
        return { success: true, data: { completedNewB5: true } };
    };

    await mode.initialize();
    await mode.enable();
    await new Promise(resolve => setTimeout(resolve, 30));
    const status = mode.status();
    assert.equal(automationCalls >= 2, true);
    assert.equal(status.craftedB5Cycles >= 2, true);
    assert.equal(status.nextCraftAt, undefined);
    assert.equal(status.cooldownRemainingMs, undefined);
    assert.notEqual(status.phase, 'COOLDOWN');
    await mode.disable('test');
});

test('pause and resume preserve continuous mode instead of disabling it', async () => {
    const { mode } = createMode({ config: { pollIntervalMs: 20 } });
    await mode.initialize();
    await mode.enable();
    await new Promise(resolve => setTimeout(resolve, 10));

    const paused = await mode.pause('panel pause');
    assert.equal(paused.success, true);
    assert.equal(mode.status().enabled, true);
    assert.equal(mode.status().paused, true);
    assert.equal(mode.status().phase, 'PAUSED');

    const resumed = await mode.resume();
    assert.equal(resumed.success, true);
    assert.equal(mode.status().enabled, true);
    assert.equal(mode.status().paused, false);
    await mode.disable('test');
});

test('existing B2 in /pv 2 makes the collector enter B5 automation even when B1 reserve is not ready', async () => {
    const { mode, calls } = createMode({ config: { pollIntervalMs: 50 } });
    mode.b5Planning.inspectAdditional = async () => ({
        success: true,
        data: {
            fullPlan: { targetId: 'super_alloy', feasible: false },
            finalSteps: [],
            chains: [{
                baseId: 'cobblestone', b2Id: 'super_cobblestone', b3Id: 'super_cobblestone_block',
                readyToReserve: false, b2Crafts: 0, b3Crafts: 1,
                vaultB2: 16, inventoryB2: 0, b3InputPerCraft: 16, missingRaw: 999
            }]
        }
    });
    mode.b5Automation.runNext = async () => {
        calls.push('automation');
        return { success: true, data: { completedNewB5: false } };
    };

    await mode.initialize();
    await mode.enable();
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(calls.includes('automation'), true);
    await mode.disable('test');
});


test('continuous mode still performs storage maintenance when production is not actionable', async () => {
    const { mode } = createMode({ config: { pollIntervalMs: 5, craftLoopDelayMs: 2 } });
    let productionCalls = 0;
    let maintenanceCalls = 0;
    mode.b5Planning.inspectAdditional = async () => inspection({ actionable: false });
    mode.b1Materials.inspectStoragePressure = async () => ({
        success: true,
        data: { known: true, level: 'HIGH', shouldConsumeB1: true, sellRequired: false, critical: false }
    });
    mode.b5Automation.runNext = async () => {
        productionCalls += 1;
        return { success: true, data: { completedNewB5: false } };
    };
    mode.b5Automation.runMaintenance = async ({ allowNewB2 }) => {
        maintenanceCalls += 1;
        assert.equal(allowNewB2, true);
        return { success: true, data: { completedNewB5: false } };
    };

    await mode.initialize();
    await mode.enable();
    await new Promise(resolve => setTimeout(resolve, 25));
    const status = mode.status();
    assert.equal(productionCalls, 0);
    assert.equal(maintenanceCalls > 0, true);
    assert.equal(status.storagePressure.level, 'HIGH');
    assert.equal(status.cooldownRemainingMs, undefined);
    await mode.disable('test');
});


test('idle collector runs maintenance even at NORMAL pressure so loose B1 is compacted before waiting', async () => {
    const { mode } = createMode({ config: { pollIntervalMs: 5, craftLoopDelayMs: 2 } });
    let maintenanceCalls = 0;
    mode.b5Planning.inspectAdditional = async () => inspection({ actionable: false });
    mode.b1Materials.inspectStoragePressure = async () => ({
        success: true,
        data: { known: true, level: 'NORMAL', shouldConsumeB1: false, sellRequired: false, critical: false }
    });
    mode.b5Automation.runMaintenance = async ({ allowNewB2 }) => {
        maintenanceCalls += 1;
        assert.equal(allowNewB2, false);
        return { success: true, data: { completedNewB5: false } };
    };

    await mode.initialize();
    await mode.enable();
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(maintenanceCalls > 0, true);
    await mode.disable('test');
});

test('collector hard-gates crafting while continuously-fed /kho remains above high-water', async () => {
    const { mode, calls } = createMode({ config: { pollIntervalMs: 5, errorRetryMs: 3, craftLoopDelayMs: 2 } });
    let pressureReads = 0;
    let stabilizeCalls = 0;
    let planningCalls = 0;
    let automationCalls = 0;

    mode.b1Materials.inspectStoragePressure = async () => {
        pressureReads += 1;
        return {
            success: true,
            data: {
                known: true,
                level: 'HIGH',
                protectionRequired: true,
                shouldConsumeB1: true,
                sellRequired: true,
                critical: false,
                usageRatio: 0.84,
                highWaterRatio: 0.80,
                lowWaterRatio: 0.70
            }
        };
    };
    mode.b1Materials.stabilizeStorage = async () => {
        stabilizeCalls += 1;
        return {
            success: true,
            data: {
                pressure: {
                    known: true,
                    level: 'HIGH',
                    protectionRequired: true,
                    usageRatio: 0.82,
                    highWaterRatio: 0.80,
                    lowWaterRatio: 0.70
                }
            }
        };
    };
    mode.b5Planning.inspectAdditional = async () => {
        planningCalls += 1;
        return inspection({ actionable: true });
    };
    mode.b5Automation.runNext = async () => {
        automationCalls += 1;
        return { success: true, data: { completedNewB5: false } };
    };

    await mode.initialize();
    await mode.enable();
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(pressureReads > 0, true);
    assert.equal(stabilizeCalls > 0, true);
    assert.equal(calls.filter(call => call === 'preprocess').length > 0, true);
    assert.equal(planningCalls, 0);
    assert.equal(automationCalls, 0);
    await mode.disable('test');
});

test('startup B1 reserve trim runs once per explicit mode enable, not again on resume', async () => {
    const { mode } = createMode({ config: { pollIntervalMs: 5, craftLoopDelayMs: 2 } });
    let startupChecks = 0;
    mode.b1Materials.startupTrimToReserve = async () => {
        startupChecks += 1;
        return { success: true, data: { reserveCoverage: 3, actions: [] } };
    };
    mode.b5Planning.inspectAdditional = async () => inspection({ actionable: false });
    mode.b5Automation.runMaintenance = async () => ({ success: true, data: {} });

    await mode.initialize();
    await mode.enable();
    await new Promise(resolve => setTimeout(resolve, 12));
    assert.equal(startupChecks, 1);
    assert.equal(mode.status().startupStorageSafetyDone, true);

    await mode.pause('test');
    await mode.resume();
    await new Promise(resolve => setTimeout(resolve, 12));
    assert.equal(startupChecks, 1);

    await mode.disable('test');
    await mode.enable();
    await new Promise(resolve => setTimeout(resolve, 12));
    assert.equal(startupChecks, 2);
    await mode.disable('test');
});
