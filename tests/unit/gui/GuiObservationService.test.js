'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ItemNormalizer = require('../../../src/items/ItemNormalizer');
const GuiStructureNormalizer = require('../../../src/gui/observation/GuiStructureNormalizer');
const GuiObservationStore = require('../../../src/gui/observation/GuiObservationStore');

test('GUI observation keeps dynamic numbers out of structural revision while updating latest data', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-gui-observation-'));
    try {
        const normalizer = new GuiStructureNormalizer({ itemNormalizer: new ItemNormalizer() });
        const store = new GuiObservationStore({ baseDir: directory, botId: 'bot-01' });
        const makeSession = amount => ({
            id: `session-${amount}`,
            definitionId: 'storage',
            window: {
                title: 'Kho',
                type: 'minecraft:generic_9x6',
                slots: [{ name: 'coal', displayName: 'Than', count: 1, lore: [`Đang có: ${amount}`] }]
            }
        });

        const firstNormalized = normalizer.normalize(makeSession('123,456'));
        const first = await store.upsert(normalizer.keyFor(firstNormalized), firstNormalized);
        const secondNormalized = normalizer.normalize(makeSession('999,999'));
        const second = await store.upsert(normalizer.keyFor(secondNormalized), secondNormalized);

        assert.equal(first.created, true);
        assert.equal(first.record.revision, 1);
        assert.equal(second.structureChanged, false);
        assert.equal(second.record.revision, 1);
        assert.equal(second.record.seenCount, 2);
        assert.equal(second.record.latest.items[0].lore[0], 'Đang có: 999,999');
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
