'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventBus = require('../../../../src/core/EventBus');
const CancellationSource = require('../../../../src/shared/cancellation/CancellationSource');
const AfkAreaService = require('../../../../src/server-features/afk/AfkAreaService');

const areas = [
    { id: 'afk-11', menuSlot: 11, priority: 1, capacity: 30, destination: { x: 74, y: 70, z: 90 } },
    { id: 'afk-13', menuSlot: 13, priority: 2, capacity: 30, destination: { x: 1, y: 64, z: 3 } }
];

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

async function waitFor(predicate, label = 'condition', loops = 100) {
    for (let index = 0; index < loops; index += 1) {
        if (predicate()) return;
        await new Promise(resolve => setImmediate(resolve));
    }
    throw new Error(`Timed out waiting for ${label}`);
}

function harness({ occupancy = [30, 4], generation = 1, click = null, teleportTimeoutMs = 100 } = {}) {
    const eventBus = new EventBus();
    let currentGeneration = generation;
    let connected = true;
    let position = { x: 0, y: 64, z: 0 };
    let closed = 0;
    let sent = 0;
    const slots = [];
    areas.forEach((area, index) => { slots[area.menuSlot] = { occupancy: occupancy[index] }; });
    const guiManager = {
        current: () => null,
        closeCurrentWindow: async () => { closed += 1; },
        performAndWaitForOpen: async action => {
            await action();
            return { session: { id: 1, window: { slots } } };
        },
        click: async slot => {
            if (click) return click({ slot, eventBus, generation: currentGeneration });
            position = { x: 74, y: 70, z: 90 };
            eventBus.emit('movement:teleport', { botId: 'bot-01', generation: currentGeneration, position });
        }
    };
    const service = new AfkAreaService({
        botId: 'bot-01', eventBus, guiManager,
        context: { getGeneration: () => currentGeneration, has: () => connected },
        commandService: { send: async () => { sent += 1; return { success: true }; } },
        positionService: { current: () => position, distance: (a, b) => Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z) },
        occupancyParser: { parse: item => ({ current: item?.occupancy ?? null, capacity: 30, full: item ? item.occupancy >= 30 : null, known: Boolean(item) }) },
        config: { commandKey: 'afk', guiTimeoutMs: 100, openSettleMs: 0, teleportTimeoutMs, teleportMinDistance: 1, areas }
    });
    return {
        service, eventBus, sent: () => sent, closed: () => closed,
        setGeneration: value => { currentGeneration = value; },
        setConnected: value => { connected = value; },
        setPosition: value => { position = value; }
    };
}

test('AfkAreaService selects first available area by priority and verifies teleport', async () => {
    const h = harness({ occupancy: [30, 3] });
    const result = await h.service.joinBestAvailable();
    assert.equal(result.success, true);
    assert.equal(result.data.joined, true);
    assert.equal(result.data.area.id, 'afk-13');
    assert.equal(result.data.teleport.source, 'forcedMove');
    assert.equal(h.sent(), 1);
    assert.deepEqual(h.service.area('afk-11').destination, areas[0].destination);
    assert.equal(h.service.areas().length, 2);
});

test('AfkAreaService returns bounded no-area result and closes menu', async () => {
    const h = harness({ occupancy: [30, 30] });
    const result = await h.service.joinBestAvailable();
    assert.equal(result.success, true);
    assert.equal(result.data.joined, false);
    assert.equal(result.data.reason, 'NO_AVAILABLE_AREA');
    assert.equal(h.closed(), 1);
});

test('AfkAreaService inspect returns occupancy snapshot', async () => {
    const h = harness({ occupancy: [2, 3] });
    const result = await h.service.inspect();
    assert.equal(result.success, true);
    assert.equal(result.data.areas[0].occupancy.current, 2);
    assert.equal(result.data.areas[1].occupancy.current, 3);
});

test('AfkAreaService rejects stale generation even if old forcedMove arrives', async () => {
    let h;
    h = harness({ occupancy: [1, 30], teleportTimeoutMs: 200, click: async ({ eventBus, generation }) => {
        h.setGeneration(generation + 1);
        eventBus.emit('connection:client-attached', { botId: 'bot-01', connectionGeneration: generation + 1 });
        eventBus.emit('movement:teleport', { botId: 'bot-01', generation, position: { x: 74, y: 70, z: 90 } });
    } });
    const result = await h.service.joinBestAvailable();
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'AFK_STALE_GENERATION');
    assert.equal(h.eventBus.listenerCount('movement:teleport'), 0);
});

test('AfkAreaService cancellation during teleport returns CANCELLED and cleans listeners/timers', async () => {
    const source = new CancellationSource();
    const h = harness({ occupancy: [1, 30], teleportTimeoutMs: 500, click: async () => { source.cancel('pause'); } });
    const result = await h.service.joinBestAvailable({ cancellationToken: source.token });
    assert.equal(result.status, 'CANCELLED');
    assert.equal(result.error.code, 'CANCELLED');
    assert.equal(h.eventBus.listenerCount('movement:teleport'), 0);
});

test('AfkAreaService immediate click rejection disposes teleport waiter before public method settles', async () => {
    const unhandled = [];
    const onUnhandled = reason => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
        const h = harness({
            occupancy: [1, 30],
            teleportTimeoutMs: 20,
            click: async () => { throw new Error('click rejected immediately'); }
        });
        const result = await h.service.joinBestAvailable();
        assert.equal(result.success, false);
        assert.equal(result.error.code, 'AFK_AREA_JOIN_FAILED');
        assert.equal(h.eventBus.listenerCount('movement:teleport'), 0, 'waiter listener must be gone immediately');
        await new Promise(resolve => setTimeout(resolve, 35));
        assert.equal(unhandled.length, 0, 'disposed waiter must not reject out-of-band');
    } finally {
        process.off('unhandledRejection', onUnhandled);
    }
});

test('AfkAreaService waiter timeout settles while click is still pending and observes late click rejection', async () => {
    const click = deferred();
    const unhandled = [];
    const onUnhandled = reason => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
        const h = harness({ occupancy: [1, 30], teleportTimeoutMs: 15, click: () => click.promise });
        const result = await Promise.race([
            h.service.joinBestAvailable(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('joinBestAvailable did not settle after waiter timeout')), 100))
        ]);
        assert.equal(result.success, false);
        assert.equal(result.error.code, 'AFK_TELEPORT_VERIFY_TIMEOUT');
        assert.equal(h.eventBus.listenerCount('movement:teleport'), 0, 'listener cleanup must not wait for click promise');
        click.reject(new Error('late click rejection'));
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(unhandled.length, 0, 'late click rejection must already have an observer');
    } finally {
        process.off('unhandledRejection', onUnhandled);
    }
});

test('AfkAreaService cancellation settles while click is pending and leaves no orphan promise', async () => {
    const click = deferred();
    const source = new CancellationSource();
    const unhandled = [];
    const onUnhandled = reason => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
        const h = harness({ occupancy: [1, 30], teleportTimeoutMs: 500, click: () => click.promise });
        const pending = h.service.joinBestAvailable({ cancellationToken: source.token });
        await waitFor(() => h.eventBus.listenerCount('movement:teleport') === 1, 'AFK teleport waiter');
        source.cancel('pause');
        const result = await pending;
        assert.equal(result.status, 'CANCELLED');
        assert.equal(result.error.code, 'CANCELLED');
        assert.equal(h.eventBus.listenerCount('movement:teleport'), 0);
        click.reject(new Error('late cancelled click rejection'));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(unhandled.length, 0);
    } finally {
        process.off('unhandledRejection', onUnhandled);
    }
});

test('AfkAreaService ignores old and generation-less teleport events until current generation verifies', async () => {
    let h;
    h = harness({ occupancy: [1, 30], teleportTimeoutMs: 100, click: async ({ eventBus, generation }) => {
        eventBus.emit('movement:teleport', { botId: 'bot-01', connectionGeneration: generation - 1, position: { x: 8, y: 70, z: 8 } });
        eventBus.emit('movement:teleport', { botId: 'bot-01', position: { x: 8, y: 70, z: 8 } });
        queueMicrotask(() => eventBus.emit('movement:teleport', { botId: 'bot-01', connectionGeneration: generation, position: { x: 74, y: 70, z: 90 } }));
    } });
    const result = await h.service.joinBestAvailable();
    assert.equal(result.success, true);
    assert.equal(result.data.teleport.source, 'forcedMove');
    assert.equal(h.eventBus.listenerCount('movement:teleport'), 0);
});

test('AfkAreaService no teleport event times out bounded and releases listener immediately', async () => {
    const h = harness({ occupancy: [1, 30], teleportTimeoutMs: 12, click: async () => {} });
    const result = await h.service.joinBestAvailable();
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'AFK_TELEPORT_VERIFY_TIMEOUT');
    assert.equal(h.eventBus.listenerCount('movement:teleport'), 0);
});

test('AfkAreaService reconfigure keeps existing server coordinates and validates area contract', () => {
    const h = harness();
    const updated = h.service.reconfigure({ commandKey: 'afk', guiTimeoutMs: 120, openSettleMs: 0, teleportTimeoutMs: 100, teleportMinDistance: 1, areas });
    assert.deepEqual(updated[0].destination, areas[0].destination);
    assert.throws(() => h.service.reconfigure({ commandKey: '', areas }), /commandKey/);
});
