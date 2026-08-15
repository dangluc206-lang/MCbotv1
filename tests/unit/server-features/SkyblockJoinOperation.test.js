'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventBus = require('../../../src/core/EventBus');
const OperationLockPolicy = require('../../../src/operations/OperationLockPolicy');
const SkyblockJoinOperation = require('../../../src/server-features/skyblock/SkyblockJoinOperation');
const SkyblockService = require('../../../src/server-features/skyblock/SkyblockService');

function createHarness({ commandSuccess = true, teleport = true } = {}) {
    const botId = 'bot-01';
    const eventBus = new EventBus();
    const lockPolicy = new OperationLockPolicy();
    const clicks = [];
    let session = null;
    let sessionSequence = 0;

    const openGui = (definitionId, readySlot) => {
        sessionSequence += 1;
        const slots = Array(54).fill(null);
        if (Number.isInteger(readySlot)) slots[readySlot] = { name: 'test_item', count: 1 };
        session = {
            id: `session-${sessionSequence}`,
            definitionId,
            window: { slots }
        };
        eventBus.emit('gui:opened', {
            botId,
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
            if (slot === 12 || slot === 14) {
                queueMicrotask(() => openGui('skyblock-join', 19));
            } else if (slot === 19 && teleport) {
                queueMicrotask(() => eventBus.emit('movement:teleport', {
                    botId,
                    position: { x: 10, y: 64, z: 10 }
                }));
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
        postJoinTimeoutMs: 50
    };

    const operation = new SkyblockJoinOperation({
        botId,
        commandService,
        guiManager,
        eventBus,
        lockPolicy,
        config
    });

    return { operation, service: new SkyblockService({ operation }), clicks, lockPolicy };
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
