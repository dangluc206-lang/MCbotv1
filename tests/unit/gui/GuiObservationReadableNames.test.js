'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ItemNormalizer = require('../../../src/items/ItemNormalizer');
const GuiStructureNormalizer = require('../../../src/gui/observation/GuiStructureNormalizer');
const GuiObservationStore = require('../../../src/gui/observation/GuiObservationStore');

function session(definitionId = 'skyServerSelect') {
    return {
        id: 'session-1',
        definitionId,
        window: {
            title: 'Menu',
            type: 'minecraft:generic_9x6',
            slots: [{ name: 'stone', displayName: 'Test', count: 1, lore: [] }]
        }
    };
}

test('uses readable command route names for GUI data files', () => {
    const normalizer = new GuiStructureNormalizer({ itemNormalizer: new ItemNormalizer() });
    const normalized = normalizer.normalize(session());

    assert.equal(normalizer.keyFor(normalized, { source: { command: '/sky', clicks: [] } }), 'sky');
    assert.equal(normalizer.keyFor(normalized, { source: { command: '/ks', clicks: [22, 13] } }), 'ks__slot-22__slot-13');
    assert.equal(normalizer.keyFor(normalized, { source: { command: '/pv 2', clicks: [] } }), 'pv-2');
    assert.equal(normalizer.keyFor(normalized, { source: { command: '/kho', clicks: [11] } }), 'kho__slot-11');
});

test('migrates an old technical-name observation to the readable command name', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-gui-readable-'));
    try {
        const normalizer = new GuiStructureNormalizer({ itemNormalizer: new ItemNormalizer() });
        const store = new GuiObservationStore({ baseDir: directory, botId: 'bot-01' });
        const normalized = normalizer.normalize(session());
        const legacy = normalizer.legacyKeyFor(normalized);
        await store.upsert(legacy, normalized);

        const readable = normalizer.keyFor(normalized, { source: { command: '/sky', clicks: [] } });
        const result = await store.upsert(readable, normalized, {
            source: { commandKey: 'skyblock', command: '/sky', clicks: [], source: 'discord-gui' },
            aliases: [legacy]
        });

        assert.equal(result.migratedFrom, legacy);
        assert.equal(await fs.stat(path.join(directory, 'bot-01', 'sky.json')).then(() => true), true);
        await assert.rejects(fs.stat(path.join(directory, 'bot-01', `${legacy}.json`)), { code: 'ENOENT' });
        const saved = JSON.parse(await fs.readFile(path.join(directory, 'bot-01', 'sky.json'), 'utf8'));
        assert.equal(saved.route.command, '/sky');
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
