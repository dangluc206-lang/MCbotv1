'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const OperationManager = require('../../../src/operations/OperationManager');
const OperationQueue = require('../../../src/operations/OperationQueue');
const OperationLockPolicy = require('../../../src/operations/OperationLockPolicy');
const OperationTimeoutPolicy = require('../../../src/operations/OperationTimeoutPolicy');
const CancellationSource = require('../../../src/shared/cancellation/CancellationSource');
const FishingMovementOperation = require('../../../src/modes/fishing/FishingMovementOperation');

function harness({ positions = [{ x: 0, y: 64, z: 0 }], config = {}, generation = 1 } = {}) {
    const bot = new EventEmitter();
    let currentBot = bot;
    let currentGeneration = generation;
    let index = 0;
    let now = 0;
    const controls = new Map();
    let clearCount = 0;
    const context = { require: () => currentBot, get: () => currentBot };
    const connectionState = {
        generation: () => currentGeneration,
        isCurrentGeneration: expected => Boolean(currentBot) && Number(expected) === currentGeneration
    };
    const positionService = { current: () => positions[Math.min(index, positions.length - 1)] ?? null };
    const delay = async ms => { now += ms; if (index < positions.length - 1) index += 1; };
    const operationManager = new OperationManager({
        botId: 'bot-01', queue: new OperationQueue(), lockPolicy: new OperationLockPolicy(), timeoutPolicy: new OperationTimeoutPolicy()
    });
    const controlStateManager = {
        set: (key, value) => controls.set(key, Boolean(value)),
        clear: () => { clearCount += 1; controls.clear(); }
    };
    const looks = [];
    const movement = new FishingMovementOperation({
        botId: 'bot-01', context, connectionState, operationManager, controlStateManager,
        rotationService: { lookAt: async (...args) => looks.push(args) }, positionService,
        config: { movement: { timeoutMs: 100, tickMs: 10, arrivalRadius: 1, verticalTolerance: 1.5, arrivalStableMs: 0, noProgressMs: 30, progressDelta: 0.05, lookIntervalMs: 10 }, ...config },
        delay, clock: () => now
    });
    return {
        bot, movement, operationManager, controls, looks,
        clearCount: () => clearCount,
        setGeneration: value => { currentGeneration = value; },
        setBot: value => { currentBot = value; },
        setIndex: value => { index = value; }
    };
}

test('FishingMovementOperation reaches destination and clears controls/listeners/lock', async () => {
    const h = harness({ positions: [{ x: 0, y: 64, z: 0 }, { x: 5, y: 64, z: 0 }, { x: 9.5, y: 64, z: 0 }] });
    const result = await h.movement.move({ destination: { x: 10, y: 64, z: 0 }, expectedGeneration: 1 });
    assert.equal(result.connectionGeneration, 1);
    assert.equal(result.profile, 'shift-walk-continuous');
    assert.equal(h.bot.listenerCount('forcedMove'), 0);
    assert.equal(h.operationManager.lockPolicy.owner('movement'), null);
    assert.equal(h.controls.size, 0);
    assert.equal(h.clearCount() >= 1, true);
    assert.equal(h.looks.length >= 1, true);
});

test('FishingMovementOperation handles forcedMove storm without leaking listener', async () => {
    const h = harness({ positions: [{ x: 0, y: 64, z: 0 }, { x: 10, y: 64, z: 0 }] });
    const originalLook = h.movement.rotationService.lookAt;
    h.movement.rotationService.lookAt = async (...args) => {
        h.bot.emit('forcedMove');
        h.bot.emit('forcedMove');
        return originalLook(...args);
    };
    const result = await h.movement.move({ destination: { x: 10, y: 64, z: 0 }, expectedGeneration: 1, profile: { name: 'probe', forward: true, sneak: false, sprint: true, jump: true } });
    assert.equal(result.forcedMoves >= 0, true);
    assert.equal(h.bot.listenerCount('forcedMove'), 0);
    assert.equal(h.controls.size, 0);
});

test('FishingMovementOperation rejects invalid/stale destination and generation', async () => {
    const h = harness();
    await assert.rejects(h.movement.move({ destination: { x: NaN, y: 1, z: 1 }, expectedGeneration: 1 }), error => error.code === 'FISHING_DESTINATION_INVALID');
    h.setGeneration(2);
    await assert.rejects(h.movement.move({ destination: { x: 1, y: 64, z: 1 }, expectedGeneration: 1 }), error => error.code === 'FISHING_STALE_GENERATION');
});

test('FishingMovementOperation detects disconnect while active and clears controls', async () => {
    const h = harness({ positions: [{ x: 0, y: 64, z: 0 }, { x: 1, y: 64, z: 0 }] });
    h.movement.delay = async () => { h.setGeneration(2); };
    await assert.rejects(h.movement.move({ destination: { x: 10, y: 64, z: 0 }, expectedGeneration: 1 }), error => error.code === 'FISHING_MOVEMENT_DISCONNECTED');
    assert.equal(h.controls.size, 0);
    assert.equal(h.bot.listenerCount('forcedMove'), 0);
});

test('FishingMovementOperation times out and detects no-progress', async () => {
    const timeout = harness({ positions: [{ x: 0, y: 64, z: 0 }], config: { movement: { timeoutMs: 20, tickMs: 10, arrivalRadius: 1, verticalTolerance: 1, arrivalStableMs: 0, noProgressMs: 1000, progressDelta: 0.1, lookIntervalMs: 10 } } });
    await assert.rejects(timeout.movement.move({ destination: { x: 10, y: 64, z: 0 }, expectedGeneration: 1 }), error => error.code === 'FISHING_MOVEMENT_TIMEOUT');
    assert.equal(timeout.controls.size, 0);

    const stuck = harness({ positions: [{ x: 0, y: 64, z: 0 }], config: { movement: { timeoutMs: 100, tickMs: 10, arrivalRadius: 1, verticalTolerance: 1, arrivalStableMs: 0, noProgressMs: 20, progressDelta: 0.1, lookIntervalMs: 10 } } });
    await assert.rejects(stuck.movement.move({ destination: { x: 10, y: 64, z: 0 }, expectedGeneration: 1 }), error => error.code === 'FISHING_MOVEMENT_STUCK');
    assert.equal(stuck.controls.size, 0);
});

test('FishingMovementOperation cancellation releases controls and active operation', async () => {
    const h = harness({ positions: [{ x: 0, y: 64, z: 0 }] });
    const source = new CancellationSource();
    h.movement.delay = async () => { source.cancel('pause'); };
    await assert.rejects(h.movement.move({ destination: { x: 10, y: 64, z: 0 }, expectedGeneration: 1, cancellationToken: source.token }), error => error.code === 'CANCELLED');
    assert.equal(h.operationManager.snapshot().active, 0);
    assert.equal(h.operationManager.lockPolicy.owner('movement'), null);
    assert.equal(h.controls.size, 0);
});

test('FishingMovementOperation lock contention fails safely and stop/destroy clear controls', async () => {
    const h = harness();
    h.operationManager.lockPolicy.acquire(['movement'], 'other');
    await assert.rejects(h.movement.move({ destination: { x: 1, y: 64, z: 1 }, expectedGeneration: 1 }), error => error.code === 'FISHING_MOVEMENT_BUSY');
    h.operationManager.lockPolicy.release(['movement'], 'other');
    await h.movement.stop();
    await h.movement.destroy();
    assert.equal(h.controls.size, 0);
});
