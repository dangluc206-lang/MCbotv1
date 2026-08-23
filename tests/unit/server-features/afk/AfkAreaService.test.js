'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventBus = require('../../../../src/core/EventBus');
const CancellationSource = require('../../../../src/shared/cancellation/CancellationSource');
const AfkAreaService = require('../../../../src/server-features/afk/AfkAreaService');
const { EventEmitter } = require('node:events');
const BotContext = require('../../../../src/bot/BotContext');
const GuiState = require('../../../../src/gui/GuiState');
const GuiManager = require('../../../../src/gui/GuiManager');
const ClickQueue = require('../../../../src/gui/click/ClickQueue');
const ClickGuard = require('../../../../src/gui/click/ClickGuard');
const ClickExecutor = require('../../../../src/gui/click/ClickExecutor');
const ClickVerifier = require('../../../../src/gui/click/ClickVerifier');
const SlotValidator = require('../../../../src/gui/slots/SlotValidator');

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
            eventBus.emit('movement:teleport', { botId: 'bot-01', connectionGeneration: currentGeneration, position });
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



async function realQueuedAfkHarness({ teleportTimeoutMs = 15 } = {}) {
    const eventBus = new EventBus();
    const context = new BotContext('bot-01');
    const makeClient = name => {
        const client = new EventEmitter();
        client.name = name;
        client.clickCalls = [];
        client.clickWindow = async (...args) => { client.clickCalls.push(args); };
        client.closeWindow = () => { client.currentWindow = null; };
        client.inventory = new EventEmitter();
        return client;
    };
    const oldClient = makeClient('old');
    const newClient = makeClient('new');
    context.attach(oldClient);
    const clickQueue = new ClickQueue({ maxPending: 8 });
    const state = new GuiState();
    const guiManager = new GuiManager({
        botId: 'bot-01', context, state,
        detector: { detect: () => ({ id: 'afk' }) },
        clickQueue,
        clickGuard: new ClickGuard({ context, slotValidator: new SlotValidator() }),
        clickExecutor: new ClickExecutor({ context }),
        clickVerifier: new ClickVerifier({ eventBus, context }),
        eventBus
    });
    await guiManager.initialize();
    const slots = new Array(54).fill(null);
    slots[11] = { occupancy: 1, name: 'available' };
    slots[13] = { occupancy: 30, name: 'full' };
    const window = new EventEmitter();
    Object.assign(window, { id: 91, title: 'AFK', type: 'chest', slots, inventoryStart: 18, inventoryEnd: 54 });
    const commandService = {
        async send() {
            oldClient.currentWindow = window;
            guiManager.open(window, { client: oldClient, connectionGeneration: 1 });
            return { success: true };
        }
    };
    const service = new AfkAreaService({
        botId: 'bot-01', context, eventBus, guiManager, commandService,
        positionService: { current: () => ({ x: 0, y: 64, z: 0 }), distance: () => 0 },
        occupancyParser: { parse: item => ({ current: item?.occupancy ?? null, capacity: 30, full: item ? item.occupancy >= 30 : null, known: Boolean(item) }) },
        config: { commandKey: 'afk', guiTimeoutMs: 100, openSettleMs: 0, teleportTimeoutMs, teleportMinDistance: 1, areas }
    });
    const blocker = deferred();
    const blockerRun = clickQueue.enqueue(() => blocker.promise, { id: 'test-blocker' });
    await waitFor(() => clickQueue.running === 1, 'click blocker running');
    return {
        service, eventBus, context, guiManager, clickQueue, blocker, blockerRun, oldClient, newClient,
        async release() { blocker.resolve(true); await blockerRun; await new Promise(resolve => setImmediate(resolve)); },
        replace() { context.detach(oldClient); context.attach(newClient); }
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


test('AFK timeout cancels a real queued GUI click before public settle and prevents late clickWindow', async () => {
    const h = await realQueuedAfkHarness({ teleportTimeoutMs: 12 });
    const result = await h.service.joinBestAvailable();
    assert.equal(result.status, 'TIMEOUT');
    assert.equal(result.error?.code, 'AFK_TELEPORT_VERIFY_TIMEOUT');
    assert.equal(h.clickQueue.pending, 0, 'cancelled AFK click must be removed from queue before return');
    assert.equal(h.eventBus.listenerCount('movement:teleport'), 0);
    await h.release();
    assert.equal(h.oldClient.clickCalls.length, 0);
    assert.equal(h.newClient.clickCalls.length, 0);
    await h.guiManager.destroy();
});

test('AFK cancellation cancels a real queued GUI click and leaves no late side effect', async () => {
    const h = await realQueuedAfkHarness({ teleportTimeoutMs: 500 });
    const source = new CancellationSource();
    const pending = h.service.joinBestAvailable({ cancellationToken: source.token });
    await waitFor(() => h.clickQueue.pending === 1, 'AFK click queued');
    source.cancel('pause');
    const result = await pending;
    assert.equal(result.status, 'CANCELLED');
    assert.equal(h.clickQueue.pending, 0);
    await h.release();
    assert.equal(h.oldClient.clickCalls.length, 0);
    assert.equal(h.newClient.clickCalls.length, 0);
    await h.guiManager.destroy();
});

test('AFK stale generation cancels a real queued GUI click before replacement can receive it', async () => {
    const h = await realQueuedAfkHarness({ teleportTimeoutMs: 500 });
    const pending = h.service.joinBestAvailable();
    await waitFor(() => h.clickQueue.pending === 1, 'AFK click queued');
    h.replace();
    h.eventBus.emit('connection:client-attached', { botId: 'bot-01', connectionGeneration: 2 });
    const result = await pending;
    assert.equal(result.status, 'DISCONNECTED');
    assert.equal(result.error?.code, 'AFK_STALE_GENERATION');
    assert.equal(h.clickQueue.pending, 0);
    await h.release();
    assert.equal(h.oldClient.clickCalls.length, 0);
    assert.equal(h.newClient.clickCalls.length, 0);
    await h.guiManager.destroy();
});

test('AFK disconnect cancels a real queued GUI click before executor', async () => {
    const h = await realQueuedAfkHarness({ teleportTimeoutMs: 500 });
    const pending = h.service.joinBestAvailable();
    await waitFor(() => h.clickQueue.pending === 1, 'AFK click queued');
    h.context.detach(h.oldClient);
    h.eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 1 });
    const result = await pending;
    assert.equal(result.status, 'DISCONNECTED');
    assert.equal(h.clickQueue.pending, 0);
    await h.release();
    assert.equal(h.oldClient.clickCalls.length, 0);
    assert.equal(h.newClient.clickCalls.length, 0);
    await h.guiManager.destroy();
});

test('AFK teleport success cancels sibling queued click before public success settles', async () => {
    const h = await realQueuedAfkHarness({ teleportTimeoutMs: 500 });
    const pending = h.service.joinBestAvailable();
    await waitFor(() => h.clickQueue.pending === 1, 'AFK click queued');
    h.eventBus.emit('movement:teleport', { botId: 'bot-01', connectionGeneration: 1, position: { x: 74, y: 70, z: 90 } });
    const result = await pending;
    assert.equal(result.success, true);
    assert.equal(h.clickQueue.pending, 0);
    await h.release();
    assert.equal(h.oldClient.clickCalls.length, 0);
    assert.equal(h.newClient.clickCalls.length, 0);
    await h.guiManager.destroy();
});

test('AfkAreaService.inspect preserves stale, cancellation and unknown parser domain semantics', async () => {
    const stale = harness({ occupancy: [1, 2] });
    const staleResult = await stale.service.inspect({ expectedGeneration: 2 });
    assert.equal(staleResult.status, 'DISCONNECTED');
    assert.equal(staleResult.error.code, 'AFK_STALE_GENERATION');

    const cancelled = harness({ occupancy: [1, 2] });
    cancelled.service.guiManager.performAndWaitForOpen = async () => {
        const OperationCancelledError = require('../../../../src/shared/errors/OperationCancelledError');
        throw new OperationCancelledError('cancel inspect');
    };
    const cancelledResult = await cancelled.service.inspect();
    assert.equal(cancelledResult.status, 'CANCELLED');
    assert.equal(cancelledResult.error.code, 'CANCELLED');

    const unknown = harness({ occupancy: [1, 2] });
    unknown.service.occupancyParser.parse = () => { throw new Error('bad occupancy payload'); };
    const unknownResult = await unknown.service.inspect();
    assert.equal(unknownResult.status, 'FAILED');
    assert.equal(unknownResult.error.code, 'AFK_MENU_INSPECT_FAILED');
});

test('AfkAreaService.inspect managed path preserves the same stale and unknown statuses as direct path', async () => {
    const OperationManager = require('../../../../src/operations/OperationManager');
    const OperationQueue = require('../../../../src/operations/OperationQueue');
    const OperationLockPolicy = require('../../../../src/operations/OperationLockPolicy');
    const OperationTimeoutPolicy = require('../../../../src/operations/OperationTimeoutPolicy');
    const createManager = () => new OperationManager({
        botId: 'bot-01', queue: new OperationQueue({ maxPending: 8 }), lockPolicy: new OperationLockPolicy(),
        timeoutPolicy: new OperationTimeoutPolicy(), config: { defaultQueueWaitTimeoutMs: 100, defaultExecutionTimeoutMs: 100, shutdownDrainTimeoutMs: 100 }
    });

    const stale = harness({ occupancy: [1, 2] });
    stale.service.operationManager = createManager();
    const originalOpen = stale.service.guiManager.performAndWaitForOpen;
    stale.service.guiManager.performAndWaitForOpen = async (...args) => {
        const opened = await originalOpen(...args);
        stale.setGeneration(2);
        return opened;
    };
    const staleResult = await stale.service.inspect();
    assert.equal(staleResult.status, 'DISCONNECTED');
    assert.equal(staleResult.error.code, 'AFK_STALE_GENERATION');

    const unknown = harness({ occupancy: [1, 2] });
    unknown.service.operationManager = createManager();
    unknown.service.occupancyParser.parse = () => { throw new Error('bad managed occupancy'); };
    const unknownResult = await unknown.service.inspect();
    assert.equal(unknownResult.status, 'FAILED');
    assert.equal(unknownResult.error.code, 'AFK_MENU_INSPECT_FAILED');
});
