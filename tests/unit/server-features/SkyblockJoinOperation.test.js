'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventBus = require('../../../src/core/EventBus');
const CancellationSource = require('../../../src/shared/cancellation/CancellationSource');
const OperationLockPolicy = require('../../../src/operations/OperationLockPolicy');
const SkyblockJoinOperation = require('../../../src/server-features/skyblock/SkyblockJoinOperation');
const SkyblockService = require('../../../src/server-features/skyblock/SkyblockService');

function createHarness({
    commandSuccess = true,
    teleport = true,
    guiGeneration = 1,
    teleportGeneration = 1,
    positionMove = false,
    positionGeneration = 1,
    positionDelta = 10,
    cancelSource = null,
    cancelOnSlot = null
} = {}) {
    const botId = 'bot-01';
    const eventBus = new EventBus();
    const lockPolicy = new OperationLockPolicy();
    const clicks = [];
    let session = null;
    let sessionSequence = 0;
    const client = { entity: { position: { x: 0, y: 64, z: 0 } } };
    const context = { has: () => true, getGeneration: () => 1, get: () => client };

    const openGui = (definitionId, readySlot) => {
        sessionSequence += 1;
        const slots = Array(54).fill(null);
        if (Number.isInteger(readySlot)) slots[readySlot] = { name: 'test_item', count: 1 };
        session = {
            id: `session-${sessionSequence}`,
            connectionGeneration: guiGeneration,
            definitionId,
            window: { slots }
        };
        eventBus.emit('gui:opened', {
            botId,
            connectionGeneration: guiGeneration,
            sessionId: session.id,
            definitionId
        });
    };

    const commandService = {
        async send(key) {
            assert.equal(key, 'skyblock');
            if (!commandSuccess) return { success: false, message: 'command rejected' };
            queueMicrotask(() => {
                openGui('skyblock-selection', 12);
                session.window.slots[14] = { name: 'test_item', count: 1 };
            });
            return { success: true };
        }
    };

    const guiManager = {
        current() {
            return session;
        },
        async click(slot) {
            clicks.push(slot);
            if (cancelSource && slot === cancelOnSlot) queueMicrotask(() => cancelSource.cancel(`cancel on slot ${slot}`));
            if (slot === 12 || slot === 14) {
                queueMicrotask(() => openGui('skyblock-join', 19));
            } else if (slot === 19 && teleport) {
                queueMicrotask(() => eventBus.emit('movement:teleport', {
                    botId,
                    connectionGeneration: teleportGeneration,
                    position: { x: 10, y: 64, z: 10 }
                }));
            } else if (slot === 19 && positionMove) {
                queueMicrotask(() => {
                    const position = { x: positionDelta, y: 64, z: 0 };
                    client.entity.position = { ...position };
                    eventBus.emit('movement:position', {
                        botId,
                        connectionGeneration: positionGeneration,
                        position
                    });
                });
            }
            await new Promise(resolve => setImmediate(resolve));
            return { slot };
        }
    };

    const config = {
        commandKey: 'skyblock',
        entryGuiId: 'skyblock-selection',
        joinGuiId: 'skyblock-join',
        selections: {
            primary: { slot: 12 },
            secondary: { slot: 14 }
        },
        defaultSelection: 'primary',
        joinSlot: 19,
        guiTimeoutMs: 100,
        clickTimeoutMs: 100,
        slotReadyTimeoutMs: 100,
        selectionSettleMs: 0,
        joinSettleMs: 0,
        postJoinTimeoutMs: 50,
        postJoinMinPositionDelta: 4
    };

    const operation = new SkyblockJoinOperation({
        botId,
        context,
        commandService,
        guiManager,
        eventBus,
        lockPolicy,
        config
    });

    return { operation, service: new SkyblockService({ operation }), clicks, lockPolicy, eventBus };
}

test('skyblock join uses slot 12 then slot 19 and verifies teleport', async () => {
    const { operation, clicks, lockPolicy } = createHarness();
    const result = await operation.execute();

    assert.deepEqual(clicks, [12, 19]);
    assert.equal(result.selectionId, 'primary');
    assert.equal(result.verified, 'movement:teleport');
    assert.deepEqual(result.position, { x: 10, y: 64, z: 10 });
    assert.equal(lockPolicy.owner('gui'), null);
    assert.equal(lockPolicy.owner('teleport'), null);
});

test('skyblock join accepts a large generation-owned position delta when forcedMove is not emitted', async () => {
    const { operation, clicks, eventBus } = createHarness({ teleport: false, positionMove: true, positionDelta: 12 });
    const result = await operation.execute();

    assert.deepEqual(clicks, [12, 19]);
    assert.equal(result.verified, 'movement:position-delta');
    assert.deepEqual(result.position, { x: 12, y: 64, z: 0 });
    assert.equal(eventBus.listenerCount('movement:position'), 0);
    assert.equal(eventBus.listenerCount('movement:teleport'), 0);
});

test('skyblock join ignores small or stale position updates as post-join verification', async () => {
    const stale = createHarness({ teleport: false, positionMove: true, positionGeneration: 2, positionDelta: 12 });
    const staleResult = await stale.service.join('primary', { expectedGeneration: 1 });
    assert.equal(staleResult.success, false);

    const jitter = createHarness({ teleport: false, positionMove: true, positionGeneration: 1, positionDelta: 1 });
    const jitterResult = await jitter.service.join('primary', { expectedGeneration: 1 });
    assert.equal(jitterResult.success, false);
});

test('skyblock join supports secondary slot 14', async () => {
    const { service, clicks } = createHarness();
    const result = await service.join('secondary');

    assert.equal(result.success, true);
    assert.deepEqual(clicks, [14, 19]);
});

test('skyblock join fails when final click does not produce teleport', async () => {
    const { service, clicks } = createHarness({ teleport: false });
    const result = await service.join();

    assert.equal(result.success, false);
    assert.match(result.message, /teleport was not verified/i);
    assert.deepEqual(clicks, [12, 19]);
});

test('skyblock join releases locks when the command fails', async () => {
    const { operation, lockPolicy } = createHarness({ commandSuccess: false });

    await assert.rejects(() => operation.execute(), /command rejected/);
    assert.equal(lockPolicy.owner('gui'), null);
    assert.equal(lockPolicy.owner('movement'), null);
    assert.equal(lockPolicy.owner('server-command'), null);
    assert.equal(lockPolicy.owner('teleport'), null);
});

test('skyblock join ignores a GUI opened by a stale generation', async () => {
    const { operation, clicks, eventBus } = createHarness({ guiGeneration: 2 });
    await assert.rejects(() => operation.execute(null, { expectedGeneration: 1 }), /Timed out waiting/i);
    assert.deepEqual(clicks, []);
    assert.equal(eventBus.listenerCount('gui:opened'), 0);
    assert.equal(eventBus.listenerCount('connection:ended'), 0);
});

test('skyblock join ignores stale teleport from an older/replacement generation', async () => {
    const { service, clicks, eventBus } = createHarness({ teleportGeneration: 2 });
    const result = await service.join('primary', { expectedGeneration: 1 });
    assert.equal(result.success, false);
    assert.match(result.message, /teleport was not verified/i);
    assert.deepEqual(clicks, [12, 19]);
    assert.equal(eventBus.listenerCount('movement:teleport'), 0);
    assert.equal(eventBus.listenerCount('connection:ended'), 0);
});

test('skyblock join cancellation while the second GUI waiter is armed cleans every waiter', async () => {
    const source = new CancellationSource();
    const { operation, eventBus } = createHarness({ cancelSource: source, cancelOnSlot: 12 });
    await assert.rejects(
        () => operation.execute('primary', { cancellationToken: source.token, expectedGeneration: 1 }),
        error => error?.code === 'CANCELLED'
    );
    for (const event of ['gui:opened', 'movement:teleport', 'movement:position', 'connection:ended']) {
        assert.equal(eventBus.listenerCount(event), 0, `${event} listener must be cleaned`);
    }
    source.dispose();
});

test('skyblock join cancellation after teleport waiter is armed prevents late teleport completion', async () => {
    const source = new CancellationSource();
    const { operation, eventBus } = createHarness({ cancelSource: source, cancelOnSlot: 19, teleport: false });
    await assert.rejects(
        () => operation.execute('primary', { cancellationToken: source.token, expectedGeneration: 1 }),
        error => error?.code === 'CANCELLED'
    );
    eventBus.emit('movement:teleport', { botId: 'bot-01', connectionGeneration: 1, position: { x: 99, y: 99, z: 99 } });
    assert.equal(eventBus.listenerCount('movement:teleport'), 0);
    assert.equal(eventBus.listenerCount('movement:position'), 0);
    assert.equal(eventBus.listenerCount('connection:ended'), 0);
    source.dispose();
});
