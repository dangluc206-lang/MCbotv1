'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const GuiObservationStore = require('../../../src/gui/observation/GuiObservationStore');
const InventoryObservationStore = require('../../../src/items/inventory/observation/InventoryObservationStore');
const DiscordPanelStore = require('../../../src/discord/panels/DiscordPanelStore');

function createLogger() {
    const entries = [];
    return {
        entries,
        debug(message, meta) { entries.push({ level: 'debug', message, meta }); },
        warn(message, meta) { entries.push({ level: 'warn', message, meta }); }
    };
}

async function createBlockedBotDirectory(prefix) {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    const blocked = path.join(baseDir, 'bot-01');
    await fs.writeFile(blocked, 'blocks mkdir', 'utf8');
    return { baseDir, blocked };
}

test('GuiObservationStore rejects the failed write, records diagnostics, then recovers its queue', async () => {
    const { baseDir, blocked } = await createBlockedBotDirectory('mcbot-gui-queue-');
    const logger = createLogger();
    const store = new GuiObservationStore({ baseDir, botId: 'bot-01', logger });
    const normalized = {
        identity: { title: 'Test GUI' },
        structure: { slots: 9 },
        latest: { windowId: 1 }
    };

    await assert.rejects(() => store.upsert('test-gui', normalized), error => error?.code === 'EEXIST');
    assert.equal(logger.entries.some(entry => entry.message.includes('queue recovered')), true);

    await fs.rm(blocked, { force: true });
    const result = await store.upsert('test-gui', normalized);
    assert.equal(result.record.id, 'test-gui');
    assert.equal((await store.readRecord('test-gui')).identity.title, 'Test GUI');
});

test('InventoryObservationStore rejects the failed write, records diagnostics, then recovers its queue', async () => {
    const { baseDir, blocked } = await createBlockedBotDirectory('mcbot-inventory-queue-');
    const logger = createLogger();
    const store = new InventoryObservationStore({ baseDir, botId: 'bot-01', logger });

    await assert.rejects(() => store.write({ revision: 1 }), error => error?.code === 'EEXIST');
    assert.equal(logger.entries.some(entry => entry.message.includes('queue recovered')), true);

    await fs.rm(blocked, { force: true });
    await store.write({ revision: 2 });
    assert.deepEqual(await store.read(), { revision: 2 });
});

test('DiscordPanelStore rejects a failed persistence attempt without poisoning later writes', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-panel-queue-'));
    const blocked = path.join(baseDir, 'runtime');
    await fs.writeFile(blocked, 'blocks mkdir', 'utf8');
    const logger = createLogger();
    const store = new DiscordPanelStore({ baseDir, relativePath: 'runtime/panels.json', logger });

    await assert.rejects(() => store.set('main', { channelId: '1' }));
    assert.equal(logger.entries.some(entry => entry.message.includes('queue recovered')), true);

    await fs.rm(blocked, { force: true });
    await fs.mkdir(blocked, { recursive: true });
    await store.set('secondary', { channelId: '2' });
    assert.equal(await store.get('main'), null, 'a rejected mutation must not survive in memory or reappear in a later commit');
    assert.deepEqual(await store.get('secondary'), { channelId: '2' });
    const persisted = JSON.parse(await fs.readFile(path.join(baseDir, 'runtime', 'panels.json'), 'utf8'));
    assert.equal(Object.prototype.hasOwnProperty.call(persisted, 'main'), false);
    assert.deepEqual(persisted.secondary, { channelId: '2' });
});
