'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const EventBus = require('../../../src/core/EventBus');
const CancellationSource = require('../../../src/shared/cancellation/CancellationSource');
const FlowError = require('../../../src/shared/errors/FlowError');
const ConnectionStateView = require('../../../src/modes/fishing/ConnectionStateView');
const ConnectionPacketObserver = require('../../../src/modes/fishing/ConnectionPacketObserver');
const FishingPositionGuard = require('../../../src/modes/fishing/FishingPositionGuard');
const FishingRecoveryPolicy = require('../../../src/modes/fishing/FishingRecoveryPolicy');
const FishingWorldReadinessService = require('../../../src/modes/fishing/FishingWorldReadinessService');
const FishingMovementProbeService = require('../../../src/modes/fishing/FishingMovementProbeService');

test('ConnectionStateView exposes detached read-only connection state', () => {
    let bot = {};
    let generation = 4;
    const context = { has: () => Boolean(bot), getGeneration: () => generation };
    const view = new ConnectionStateView({ context });
    assert.equal(view.isConnected(), true);
    assert.equal(view.generation(), 4);
    assert.deepEqual(view.snapshot(), { connected: true, connectionGeneration: 4 });
    assert.equal(view.isCurrentGeneration(4), true);
    generation = 5;
    assert.equal(view.isCurrentGeneration(4), false);
    bot = null;
    assert.equal(view.isConnected(), false);
});

function connectionView(state) {
    return {
        generation: () => state.generation,
        isCurrentGeneration: expected => state.connected && Number(expected) === state.generation
    };
}

test('FishingPositionGuard covers anchor, drift, boundaries, invalid positions and reconnect', () => {
    const state = { connected: true, generation: 1 };
    let position = { x: 10, y: 64, z: 10 };
    const guard = new FishingPositionGuard({
        positionService: { current: () => position },
        connectionState: connectionView(state),
        config: { positionGuard: { radius: 1, verticalTolerance: 1.5 } }
    });
    assert.equal(guard.verifyCurrent().code, 'FISHING_ANCHOR_UNAVAILABLE');
    const anchor = guard.capture({ expectedGeneration: 1 });
    assert.deepEqual(anchor, { x: 10, y: 64, z: 10, connectionGeneration: 1 });
    position = { x: 10.5, y: 65, z: 10.5 };
    assert.equal(guard.verifyCurrent().valid, true);
    position = { x: 11.01, y: 64, z: 10 };
    assert.equal(guard.verifyCurrent().code, 'FISHING_HORIZONTAL_DRIFT');
    position = { x: 10, y: 65.51, z: 10 };
    assert.equal(guard.verifyCurrent().code, 'FISHING_VERTICAL_DRIFT');
    position = { x: NaN, y: 64, z: 10 };
    assert.equal(guard.verifyCurrent().code, 'FISHING_POSITION_UNAVAILABLE');
    position = { x: 10, y: 64, z: 10 };
    assert.equal(guard.verifyDestination({ x: 10.9, y: 65.4, z: 10 }).valid, true);
    assert.equal(guard.verifyDestination({ x: 12, y: 64, z: 10 }).code, 'FISHING_DESTINATION_NOT_REACHED');
    assert.equal(guard.verifyDestination({ x: 10, y: 67, z: 10 }).code, 'FISHING_DESTINATION_VERTICAL_DRIFT');
    assert.equal(guard.verifyDestination({ x: Infinity, y: 64, z: 10 }).code, 'FISHING_POSITION_UNAVAILABLE');
    state.generation = 2;
    assert.equal(guard.verifyCurrent().code, 'FISHING_STALE_GENERATION');
    assert.throws(() => guard.capture({ expectedGeneration: 1 }), error => error.code === 'FISHING_STALE_GENERATION');
    state.connected = false;
    assert.throws(() => guard.capture({ expectedGeneration: 2 }), error => error.code === 'FISHING_STALE_GENERATION');
    guard.invalidate();
    assert.equal(guard.snapshot(), null);
    guard.reconfigure({ positionGuard: { radius: 2, verticalTolerance: 2 } });
});

test('FishingRecoveryPolicy decisions are pure and cover wait, retry, reconnect, pause and breaker states', () => {
    const policy = new FishingRecoveryPolicy({ config: { recovery: { waitMs: 11, retryMs: 12, movementRetryMs: 13, connectionRetryMs: 14 } } });
    const cases = [
        [{ classification: { kind: 'TOKEN_CANCELLED' }, enabled: true }, ['STOP', 'OFF', false]],
        [{ classification: { kind: 'ERROR' }, enabled: false }, ['STOP', 'OFF', false]],
        [{ classification: { kind: 'ERROR' }, paused: true }, ['STOP', 'PAUSED', false]],
        [{ classification: { kind: 'EXPECTED_CANCEL' } }, ['WAIT', 'WAITING_AREA', false]],
        [{ classification: { kind: 'WAIT' } }, ['WAIT', 'WAITING_AREA', false]],
        [{ classification: { kind: 'ERROR' }, error: new FlowError('fatal', { code: 'NO_ROD', retryable: false }), breaker: { state: 'OPEN' } }, ['PAUSE_ERROR', 'PAUSED_ERROR', true]],
        [{ classification: { kind: 'ERROR' }, error: new FlowError('temp', { code: 'X', retryable: true }), breaker: { state: 'OPEN', retryInMs: 21 } }, ['WAIT', 'DEGRADED', true]],
        [{ classification: { kind: 'ERROR' }, error: new FlowError('timeout', { code: 'TIMEOUT', subsystem: 'fishing', retryable: true }), breaker: { state: 'CLOSED' } }, ['RETRY', 'FISHING', true]],
        [{ classification: { kind: 'ERROR' }, error: new FlowError('drift', { code: 'FISHING_HORIZONTAL_DRIFT', retryable: true }), breaker: { state: 'CLOSED' } }, ['REANCHOR', 'REANCHORING', true]],
        [{ classification: { kind: 'ERROR' }, error: new FlowError('lost', { code: 'FISHING_WORLD_DISCONNECTED', retryable: true }), breaker: { state: 'CLOSED' } }, ['REJOIN_AREA', 'WAITING_CONNECTION', true]],
        [{ classification: { kind: 'ERROR' }, error: new FlowError('probe', { code: 'FISHING_PROBE_RECONNECT_REQUIRED', retryable: true }), breaker: { state: 'HALF_OPEN' } }, ['REQUEST_RECONNECT', 'WAITING_CONNECTION', true]],
        [{ classification: { kind: 'ERROR' }, error: new FlowError('retry', { code: 'OTHER', retryable: true }), phase: 'FISHING', breaker: { state: 'CLOSED' } }, ['RETRY', 'FISHING', true]]
    ];
    for (const [input, expected] of cases) {
        const out = policy.decide({ enabled: true, paused: false, ...input });
        assert.equal(out.action, expected[0]);
        assert.equal(out.nextPhase, expected[1]);
        assert.equal(out.publishFailure, expected[2]);
        assert.equal(Object.isFrozen(out), true);
    }
    assert.equal(policy.decide({ classification: { kind: 'EXPECTED_CANCEL' } }).delayMs, 11);
    policy.reconfigure({ recovery: { waitMs: 1, retryMs: 2, movementRetryMs: 3, connectionRetryMs: 4 } });
    assert.equal(policy.decide({ classification: { kind: 'WAIT' } }).delayMs, 1);
});

test('FishingRecoveryPolicy covers fallback delays and every recovery-code family', () => {
    const fallback = new FishingRecoveryPolicy({ config: { areaRetryMs: 7, errorRetryMs: 8, connectionPollMs: 9 } });
    assert.equal(fallback.decide({ classification: { kind: 'EXPECTED_CANCEL' } }).delayMs, 7);
    const retryable = code => new FlowError(code, { code, subsystem: 'x', retryable: true });
    for (const code of [
        'FISHING_POSITION_LOST', 'FISHING_POSITION_NOT_READY', 'FISHING_HORIZONTAL_DRIFT', 'FISHING_VERTICAL_DRIFT',
        'FISHING_POSITION_UNAVAILABLE', 'FISHING_ANCHOR_UNAVAILABLE', 'FISHING_DESTINATION_NOT_REACHED',
        'FISHING_DESTINATION_VERTICAL_DRIFT', 'FISHING_MOVEMENT_TIMEOUT', 'FISHING_MOVEMENT_STUCK', 'FISHING_MOVEMENT_DISCONNECTED'
    ]) assert.equal(fallback.decide({ classification: { kind: 'ERROR' }, error: retryable(code), breaker: { state: 'CLOSED' } }).action, 'REANCHOR', code);
    for (const code of ['CONNECTION_FAILED', 'FISHING_STALE_GENERATION', 'FISHING_WORLD_DISCONNECTED']) {
        assert.equal(fallback.decide({ classification: { kind: 'ERROR' }, error: retryable(code), breaker: { state: 'CLOSED' } }).action, 'REJOIN_AREA', code);
    }
    const generic = fallback.decide({ classification: { kind: 'ERROR' }, error: retryable('GENERIC'), phase: 'OTHER', breaker: { state: 'CLOSED' } });
    assert.equal(generic.nextPhase, 'WAITING_RETRY');
    const openFallback = fallback.decide({ classification: { kind: 'ERROR' }, error: retryable('GENERIC'), breaker: { state: 'OPEN', currentBackoffMs: 17 } });
    assert.equal(openFallback.delayMs, 17);
    fallback.reconfigure({ recovery: { waitMs: -1, retryMs: -1, movementRetryMs: -1, connectionRetryMs: -1 } });
    assert.equal(fallback.decide({ classification: { kind: 'WAIT' } }).delayMs, 5000);
    assert.equal(fallback.decide({ classification: { kind: 'ERROR' }, error: new FlowError('timeout', { code: 'TIMEOUT', subsystem: 'movement', retryable: true }) }).nextPhase, 'WAITING_RETRY');
    assert.equal(fallback.decide({ classification: { kind: 'ERROR' }, error: null, breaker: { state: 'CLOSED' } }).action, 'RETRY');
    assert.equal(fallback.decide({ classification: null, error: retryable('GENERIC'), breaker: null }).action, 'RETRY');
    assert.equal(fallback.decide({ classification: { kind: 'ERROR' }, error: retryable('GENERIC'), breaker: { state: 'OPEN' } }).delayMs, 0);
});

test('ConnectionPacketObserver normalizes packets, bounds samples and ignores stale clients/generations', async () => {
    const eventBus = new EventBus();
    const protocol1 = new EventEmitter();
    const protocol2 = new EventEmitter();
    const bot1 = { _client: protocol1 };
    const bot2 = { _client: protocol2 };
    let bot = bot1;
    let generation = 1;
    const context = { has: () => Boolean(bot), get: () => bot, getGeneration: () => generation };
    const observer = new ConnectionPacketObserver({ botId: 'bot-01', context, eventBus, config: { packetObservation: { sampleLimit: 2 } } });
    const emitted = [];
    eventBus.on('fishing:packet-observation', value => emitted.push(value));
    await observer.initialize();
    assert.equal(protocol1.listenerCount('entity_velocity'), 1);
    protocol1.emit('entity_velocity', { entityId: 7, velocityX: 1, velocityY: 2, velocityZ: 3, nested: { raw: true } });
    protocol1.emit('entity_velocity', null);
    protocol1.emit('entity_velocity', { entityId: 8, velocityX: 4 });
    assert.equal(observer.snapshot().length, 2);
    assert.equal(emitted[0].botId, 'bot-01');
    assert.equal('nested' in emitted[0], false);
    assert.equal(Object.isFrozen(emitted[0]), true);
    bot = bot2;
    generation = 2;
    eventBus.emit('connection:client-attached', { botId: 'other', connectionGeneration: 2 });
    assert.equal(protocol1.listenerCount('entity_velocity'), 1);
    eventBus.emit('connection:client-attached', { botId: 'bot-01', connectionGeneration: 2 });
    assert.equal(protocol1.listenerCount('entity_velocity'), 0);
    assert.equal(protocol2.listenerCount('entity_velocity'), 1);
    protocol1.emit('entity_velocity', { entityId: 99 });
    assert.equal(emitted.length, 3);
    protocol2.emit('entity_velocity', { entityId: 9 });
    assert.equal(emitted.at(-1).connectionGeneration, 2);
    eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 1 });
    assert.equal(protocol2.listenerCount('entity_velocity'), 1);
    eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 2 });
    assert.equal(protocol2.listenerCount('entity_velocity'), 0);
    observer.reconfigure({ packetObservation: { sampleLimit: 1 } });
    assert.equal(observer.snapshot().length <= 1, true);
    await observer.stop();
    assert.equal(observer.snapshot().length, 0);
    await observer.destroy();
});

test('ConnectionPacketObserver instances keep multi-bot packet state isolated', async () => {
    const eventBus = new EventBus();
    const a = { _client: new EventEmitter() };
    const b = { _client: new EventEmitter() };
    const make = (botId, bot) => new ConnectionPacketObserver({
        botId, eventBus, config: { packetObservation: { sampleLimit: 4 } },
        context: { has: () => true, get: () => bot, getGeneration: () => 1 }
    });
    const one = make('bot-01', a);
    const two = make('bot-02', b);
    await one.initialize(); await two.initialize();
    a._client.emit('entity_velocity', { entityId: 1 });
    assert.equal(one.snapshot().length, 1);
    assert.equal(two.snapshot().length, 0);
    await one.stop(); await two.stop();
});

test('ConnectionPacketObserver tolerates malformed packets, absent protocol and cleanup failures', async () => {
    const eventBus = new EventBus();
    const logs = [];
    const protocol = new EventEmitter();
    const originalRemove = protocol.removeListener.bind(protocol);
    let bot = { _client: protocol };
    let generation = 1;
    const context = { has: () => Boolean(bot), get: () => bot, getGeneration: () => generation };
    const observer = new ConnectionPacketObserver({ botId: 'bot-01', context, eventBus, config: { packetObservation: { sampleLimit: 3 } }, logger: { debug: (...args) => logs.push(args) } });
    await observer.initialize();
    const malformed = {};
    Object.defineProperty(malformed, 'velocityX', { get() { throw new Error('malformed'); } });
    protocol.emit('entity_velocity', malformed);
    assert.equal(logs.length >= 1, true);
    eventBus.emit('connection:client-attached', { botId: 'bot-01', connectionGeneration: 1 });
    assert.equal(protocol.listenerCount('entity_velocity'), 1, 'duplicate current attach does not duplicate listener');
    protocol.removeListener = () => { throw new Error('cleanup failed'); };
    bot = { _client: {} }; generation = 2;
    eventBus.emit('connection:client-attached', { botId: 'bot-01', connectionGeneration: 2 });
    assert.equal(logs.some(entry => String(entry[0]).includes('cleanup')), true);
    protocol.removeListener = originalRemove;
    await observer.stop();

    const disconnected = new ConnectionPacketObserver({ botId: 'bot-02', context: { has: () => false, get: () => null, getGeneration: () => 0 }, eventBus, config: {} });
    await disconnected.initialize();
    await disconnected.stop();
});

test('FishingWorldReadinessService handles ready, delayed ready, disconnect, cancellation and timeout', async () => {
    const state = { connected: true, generation: 3 };
    let position = null;
    let blockReady = false;
    const bot = { entity: { get position() { return position; } }, blockAt: () => blockReady ? {} : null };
    const delays = [];
    const service = new FishingWorldReadinessService({
        context: { get: () => bot }, connectionState: connectionView(state),
        config: { worldReadiness: { timeoutMs: 20, pollMs: 1, settleMs: 0 } },
        delay: async ms => { delays.push(ms); position = { x: 1, y: 64, z: 1 }; blockReady = true; }
    });
    const ready = await service.waitUntilReady({ expectedGeneration: 3 });
    assert.equal(ready.ready, true);
    assert.equal(delays.length, 1);
    state.generation = 4;
    await assert.rejects(service.waitUntilReady({ expectedGeneration: 3 }), error => error.code === 'FISHING_WORLD_DISCONNECTED');
    state.generation = 3;
    const cancelled = new CancellationSource(); cancelled.cancel('stop');
    await assert.rejects(service.waitUntilReady({ expectedGeneration: 3, cancellationToken: cancelled.token }), error => error.code === 'CANCELLED');

    position = null; blockReady = false;
    const timeoutService = new FishingWorldReadinessService({
        context: { get: () => bot }, connectionState: connectionView(state),
        config: { worldReadiness: { timeoutMs: 2, pollMs: 1, settleMs: 0 } },
        delay: ms => new Promise(resolve => setTimeout(resolve, ms))
    });
    await assert.rejects(timeoutService.waitUntilReady({ expectedGeneration: 3 }), error => error.code === 'FISHING_WORLD_READY_TIMEOUT');
    service.reconfigure({ worldReadiness: { timeoutMs: 10, pollMs: 2, settleMs: 1 } });
});

test('FishingWorldReadinessService handles block probe errors and generation change during settle', async () => {
    const state = { connected: true, generation: 1 };
    let probeCalls = 0;
    const bot = { entity: { position: { x: 1, y: 64, z: 1 } }, blockAt: () => { probeCalls += 1; if (probeCalls === 1) throw new Error('chunk not ready'); return {}; } };
    let delays = 0;
    const service = new FishingWorldReadinessService({
        context: { get: () => bot }, connectionState: connectionView(state), logger: { debug() {} },
        config: { worldReadiness: { timeoutMs: 50, pollMs: 1, settleMs: 1 } },
        delay: async () => { delays += 1; }
    });
    assert.equal((await service.waitUntilReady({ expectedGeneration: 1 })).ready, true);
    assert.equal(probeCalls >= 2, true);
    assert.equal(delays >= 2, true);

    let settleCalls = 0;
    const changing = new FishingWorldReadinessService({
        context: { get: () => ({ entity: { position: { x: 1, y: 64, z: 1 } } }) }, connectionState: connectionView(state),
        config: { worldReadiness: { timeoutMs: 10, pollMs: 1, settleMs: 1 } },
        delay: async () => { settleCalls += 1; if (settleCalls === 1) state.generation = 2; }
    });
    await assert.rejects(changing.waitUntilReady({ expectedGeneration: 1 }), error => error.code === 'FISHING_WORLD_DISCONNECTED');
});

test('FishingMovementProbeService is bounded, immutable, generation-aware and cancellation-safe', async () => {
    const state = { connected: true, generation: 1 };
    const calls = [];
    const movementOperation = {
        move: async input => {
            calls.push(input.profile.name);
            if (input.profile.name === 'bad') throw new FlowError('bad profile', { code: 'FISHING_MOVEMENT_STUCK' });
            return { operationId: 'x', position: { x: 1, y: 2, z: 3 } };
        }
    };
    const config = { probe: {
        enabled: true, maxProfiles: 2, totalTimeoutMs: 1000, profileTimeoutMs: 20, gapMs: 0,
        profiles: [
            { name: 'bad', forward: true, sneak: true, sprint: false, jump: false },
            { name: 'good', forward: true, sneak: false, sprint: false, jump: false },
            { name: 'unused', forward: true, sneak: true, sprint: false, jump: false }
        ]
    } };
    const probe = new FishingMovementProbeService({ movementOperation, connectionState: connectionView(state), config });
    const result = await probe.run({ destination: { x: 1, y: 2, z: 3 }, expectedGeneration: 1 });
    assert.deepEqual(calls, ['bad', 'good']);
    assert.equal(result.selected, 'good');
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.results), true);
    assert.equal(probe.status().active, false);

    state.generation = 2;
    const stale = await probe.run({ destination: {}, expectedGeneration: 1 });
    assert.equal(stale.requiresReconnect, true);
    state.generation = 1;
    movementOperation.move = async () => { throw new FlowError('disconnect', { code: 'FISHING_MOVEMENT_DISCONNECTED' }); };
    const reconnect = await probe.run({ destination: {}, expectedGeneration: 1 });
    assert.equal(reconnect.requiresReconnect, true);

    probe.reconfigure({ probe: { enabled: false, profiles: [{ name: 'x' }] } });
    assert.equal((await probe.run({})).enabled, false);
    await probe.stop(); await probe.destroy();
});

test('FishingMovementProbeService covers busy, exhausted, cancellation, time budget and gap cleanup', async () => {
    const state = { connected: true, generation: 1 };
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const movementOperation = { move: async () => pending };
    const config = { probe: { enabled: true, maxProfiles: 1, totalTimeoutMs: 100, profileTimeoutMs: 50, gapMs: 1, profiles: [{ name: 'one', forward: true, sneak: true, sprint: false, jump: false }] } };
    const probe = new FishingMovementProbeService({ movementOperation, connectionState: connectionView(state), config, delay: async () => {} });
    const first = probe.run({ destination: {}, expectedGeneration: 1 });
    await Promise.resolve();
    assert.equal((await probe.run({ destination: {}, expectedGeneration: 1 })).busy, true);
    release({ ok: true });
    assert.equal((await first).selected, 'one');

    movementOperation.move = async () => { throw new FlowError('fail', { code: 'OTHER' }); };
    assert.equal((await probe.run({ destination: {}, expectedGeneration: 1 })).exhausted, true);
    const source = new CancellationSource(); source.cancel('stop');
    await assert.rejects(probe.run({ destination: {}, expectedGeneration: 1, cancellationToken: source.token }), error => error.code === 'CANCELLED');

    let now = 0;
    const timed = new FishingMovementProbeService({ movementOperation, connectionState: connectionView(state), config, clock: () => { now += 200; return now; }, delay: async () => {} });
    assert.equal((await timed.run({ destination: {}, expectedGeneration: 1 })).exhausted, true);
});

test('ConnectionPacketObserver ignores generation-less and stale connection end for current protocol listener', async () => {
    const protocol = new EventEmitter();
    const client = { _client: protocol };
    const context = { has: () => true, get: () => client, getGeneration: () => 2 };
    const raw = new EventEmitter();
    const eventBus = {
        on(name, handler) { raw.on(name, handler); return () => raw.off(name, handler); },
        emit(name, payload) { raw.emit(name, payload); return true; }
    };
    const observer = new ConnectionPacketObserver({ botId: 'bot-01', context, eventBus, config: { packetObservation: { sampleLimit: 8 } } });
    await observer.initialize();
    const before = protocol.listenerCount('entity_velocity');
    assert.equal(before, 1);

    raw.emit('connection:ended', { botId: 'bot-01' });
    assert.equal(protocol.listenerCount('entity_velocity'), 1);
    raw.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 1 });
    assert.equal(protocol.listenerCount('entity_velocity'), 1);
    raw.emit('connection:ended', { botId: 'bot-02', connectionGeneration: 2 });
    assert.equal(protocol.listenerCount('entity_velocity'), 1);

    raw.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 2 });
    assert.equal(protocol.listenerCount('entity_velocity'), 0);
    await observer.destroy();
});
