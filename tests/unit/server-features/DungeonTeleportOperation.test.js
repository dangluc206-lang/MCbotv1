'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventBus = require('../../../src/core/EventBus');
const CancellationSource = require('../../../src/shared/cancellation/CancellationSource');
const DungeonTeleportOperation = require('../../../src/server-features/dungeon/DungeonTeleportOperation');

function harness({ generation = 2, clickImpl = null, countdownMs = 0, verifyTimeoutMs = 40 } = {}) {
    const eventBus = new EventBus();
    let currentGeneration = generation;
    const session = { id: 'dungeon-session', connectionGeneration: generation, window: { slots: Array(9).fill({ name: 'paper' }) } };
    const clicks = [];
    const guiManager = {
        current: () => null,
        async closeCurrentWindow() {},
        async performAndWaitForOpen(action) {
            const command = await action();
            assert.notEqual(command?.success, false);
            return { session };
        },
        async click(slot, options) {
            clicks.push({ slot, options });
            if (clickImpl) return clickImpl({ slot, options, eventBus });
            return { slot };
        },
        describeCurrent: () => null
    };
    const operation = new DungeonTeleportOperation({
        botId: 'bot-01',
        context: { has: () => true, getGeneration: () => currentGeneration },
        commandService: { async send(_key, options) { assert.equal(options.expectedGeneration, generation); return { success: true }; } },
        guiManager,
        itemResolver: { matches: () => ({ matched: true }) },
        guiKnowledge: { async resolveSlot() { return 3; } },
        destinations: {
            require() {
                return { menuItemId: 'dungeon-test', menuSlot: 3, countdownMs, verifyTimeoutMs };
            }
        },
        eventBus,
        config: { commandKey: 'dungeon', guiTimeoutMs: 40, defaultCountdownMs: 0, openSettleMs: 0 }
    });
    return { operation, eventBus, clicks, setGeneration: value => { currentGeneration = value; } };
}

test('DungeonTeleportOperation ignores stale teleport and completes only the expected generation', async () => {
    const h = harness({
        clickImpl: async ({ eventBus }) => {
            eventBus.emit('movement:teleport', { botId: 'bot-01', connectionGeneration: 1, position: { x: 1, y: 2, z: 3 } });
            queueMicrotask(() => eventBus.emit('movement:teleport', { botId: 'bot-01', connectionGeneration: 2, position: { x: 4, y: 5, z: 6 } }));
        }
    });
    const result = await h.operation.execute('test', { expectedGeneration: 2 });
    assert.deepEqual(result.position, { x: 4, y: 5, z: 6 });
    assert.equal(result.connectionGeneration, 2);
    assert.equal(h.eventBus.listenerCount('movement:teleport'), 0);
    assert.equal(h.eventBus.listenerCount('connection:ended'), 0);
});

test('DungeonTeleportOperation cancellation during countdown settles CANCELLED and releases teleport waiter immediately', async () => {
    const source = new CancellationSource();
    const h = harness({
        countdownMs: 50,
        clickImpl: async () => { queueMicrotask(() => source.cancel('pause')); }
    });
    await assert.rejects(
        () => h.operation.execute('test', { expectedGeneration: 2, cancellationToken: source.token }),
        error => error?.code === 'CANCELLED'
    );
    assert.equal(h.clicks.length, 1);
    assert.equal(h.eventBus.listenerCount('movement:teleport'), 0);
    assert.equal(h.eventBus.listenerCount('connection:ended'), 0);
    source.dispose();
});

test('DungeonTeleportOperation click failure cancels and observes the pre-bound teleport waiter', async () => {
    const h = harness({ clickImpl: async () => { throw new Error('click failed'); } });
    const unhandled = [];
    const onUnhandled = reason => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
        await assert.rejects(() => h.operation.execute('test', { expectedGeneration: 2 }), /click failed/);
        assert.equal(h.eventBus.listenerCount('movement:teleport'), 0);
        assert.equal(h.eventBus.listenerCount('connection:ended'), 0);
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(unhandled, []);
    } finally {
        process.off('unhandledRejection', onUnhandled);
    }
});

test('DungeonTeleportOperation generation replacement rejects as disconnected and cannot accept the old callback', async () => {
    const h = harness({
        clickImpl: async ({ eventBus }) => {
            h.setGeneration(3);
            eventBus.emit('movement:teleport', { botId: 'bot-01', connectionGeneration: 2, position: { x: 1, y: 2, z: 3 } });
        }
    });
    await assert.rejects(
        () => h.operation.execute('test', { expectedGeneration: 2 }),
        error => error?.code === 'DISCONNECTED'
    );
    assert.equal(h.eventBus.listenerCount('movement:teleport'), 0);
    assert.equal(h.eventBus.listenerCount('connection:ended'), 0);
});