'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventBus = require('../../../src/core/EventBus');
const OperationLockPolicy = require('../../../src/operations/OperationLockPolicy');
const GuiInspectionService = require('../../../src/diagnostics/GuiInspectionService');
const GuiSnapshotSerializer = require('../../../src/diagnostics/GuiSnapshotSerializer');

test('captures the next GUI after sending a configured command', async () => {
    const eventBus = new EventBus();
    const lockPolicy = new OperationLockPolicy();
    let currentSession = null;
    const commands = [];
    const guiManager = { current: () => currentSession };
    const commandService = {
        async send(key, options) {
            commands.push({ key, options });
            currentSession = {
                id: 'bot-01:1:123',
                connectionGeneration: 1,
                definitionId: 'sky-menu',
                window: {
                    id: 1,
                    title: {
                        type: 'compound',
                        value: {
                            text: { type: 'string', value: 'ᴄʜọɴ ᴍáʏ ᴄʜủ' },
                            color: { type: 'string', value: 'black' }
                        }
                    },
                    type: 'generic_9x3',
                    inventoryStart: 27,
                    inventoryEnd: 63,
                    slots: Array.from({ length: 63 }, (_, slot) => (
                        slot === 12
                            ? {
                                name: 'grass_block',
                                displayName: 'Đảo mặc định',
                                count: 1,
                                type: 5,
                                metadata: 0,
                                lore: ['Nhấn để chọn'],
                                nbt: { type: 'compound', value: { serverId: { type: 'string', value: 'sky-default' } } }
                            }
                            : null
                    ))
                }
            };
            queueMicrotask(() => eventBus.emit('gui:opened', {
                botId: 'bot-01',
                connectionGeneration: 1,
                sessionId: currentSession.id,
                definitionId: currentSession.definitionId
            }));
            return { success: true };
        }
    };
    const context = {
        has: () => true,
        getGeneration: () => 1
    };
    const service = new GuiInspectionService({
        botId: 'bot-01',
        context,
        eventBus,
        commandService,
        guiManager,
        serializer: new GuiSnapshotSerializer(),
        lockPolicy
    });

    const snapshot = await service.capture({
        commandKey: 'skyblock',
        commandDisplay: '/sky',
        timeoutMs: 100
    });

    assert.equal(commands.length, 1);
    assert.equal(commands[0].key, 'skyblock');
    assert.equal(snapshot.botId, 'bot-01');
    assert.equal(snapshot.command, '/sky');
    assert.equal(snapshot.gui.title.value.text.value, 'ᴄʜọɴ ᴍáʏ ᴄʜủ');
    assert.equal(snapshot.gui.titleText, 'ᴄʜọɴ ᴍáʏ ᴄʜủ');
    assert.equal(snapshot.gui.slotCount, 63);
    assert.equal(snapshot.items.length, 1);
    assert.equal(snapshot.items[0].slot, 12);
    assert.equal(snapshot.items[0].name, 'grass_block');
    assert.equal(lockPolicy.owner('gui'), null);
    assert.equal(lockPolicy.owner('server-command'), null);
});

test('rejects when the bot is not connected', async () => {
    const service = new GuiInspectionService({
        botId: 'bot-01',
        context: { has: () => false },
        eventBus: new EventBus(),
        commandService: { send: async () => ({ success: true }) },
        guiManager: { current: () => null },
        serializer: new GuiSnapshotSerializer(),
        lockPolicy: new OperationLockPolicy()
    });

    await assert.rejects(
        service.capture({ commandKey: 'skyblock', commandDisplay: '/sky', timeoutMs: 20 }),
        /not connected/
    );
});

test('clicks configured slots in order, records the route, and serializes only the final GUI', async () => {
    const eventBus = new EventBus();
    const lockPolicy = new OperationLockPolicy();
    const clicked = [];
    const observed = [];
    let currentSession = null;
    const guiManager = {
        current: () => currentSession,
        async click(slot) {
            clicked.push(slot);
            currentSession = {
                id: `session-${slot}`,
                connectionGeneration: 1,
                definitionId: null,
                window: { title: `GUI after ${slot}`, type: 'generic', slots: [null] }
            };
        },
        async waitFor() { return currentSession; }
    };
    const commandService = {
        async send() {
            currentSession = {
                id: 'session-initial',
                connectionGeneration: 1,
                definitionId: 'minerals',
                window: { title: 'Minerals', type: 'generic', slots: [null] }
            };
            queueMicrotask(() => eventBus.emit('gui:opened', {
                botId: 'bot-01', connectionGeneration: 1, sessionId: currentSession.id, definitionId: 'minerals'
            }));
            return { success: true };
        }
    };
    const service = new GuiInspectionService({
        botId: 'bot-01',
        context: { has: () => true, getGeneration: () => 1 },
        eventBus,
        commandService,
        guiManager,
        serializer: new GuiSnapshotSerializer(),
        lockPolicy,
        observationService: {
            async observeSession(session, options) { observed.push({ session, options }); }
        }
    });

    const snapshot = await service.capture({
        commandKey: 'minerals', commandDisplay: '/ks', slots: [22, 13], timeoutMs: 100
    });

    assert.deepEqual(clicked, [22, 13]);
    assert.equal(snapshot.gui.title, 'GUI after 13');
    assert.deepEqual(snapshot.clicks, [22, 13]);
    assert.equal(observed.length, 3);
    assert.deepEqual(observed.map(entry => entry.options.source.clicks), [[], [22], [22, 13]]);
});
