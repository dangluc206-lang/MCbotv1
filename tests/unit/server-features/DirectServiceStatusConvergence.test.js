'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const SkyblockService = require('../../../src/server-features/skyblock/SkyblockService');
const DungeonService = require('../../../src/server-features/dungeon/DungeonService');
const IslandService = require('../../../src/server-features/island/IslandService');
const Operation = require('../../../src/operations/Operation');

function codedError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

async function expectDirectStatus(invoke, code) {
    const result = await invoke({
        execute: async () => {
            throw codedError(code);
        }
    });
    assert.equal(result.success, false);
    assert.equal(result.error?.code, code);
    assert.equal(result.status, Operation.statusForError({ code }), `${code} must use the shared operation status classifier`);
}

test('SkyblockService direct path shares managed operation status semantics', async () => {
    for (const code of ['GUI_WAIT_DISCONNECTED', 'COMMAND_CONFIRM_TIMEOUT', 'OPERATION_LOCK_BUSY']) {
        await expectDirectStatus(
            operation => new SkyblockService({ operation }).join('primary'),
            code
        );
    }
});

test('DungeonService direct path shares managed operation status semantics', async () => {
    for (const code of ['COMMAND_STALE_GENERATION', 'DUNGEON_TELEPORT_VERIFY_TIMEOUT', 'OPERATION_LOCK_BUSY']) {
        await expectDirectStatus(
            operation => new DungeonService({ operation }).enter('dungeon-1'),
            code
        );
    }
});

test('IslandService direct path shares managed operation status semantics', async () => {
    for (const code of ['GUI_WAIT_DISCONNECTED', 'ISLAND_TELEPORT_VERIFY_TIMEOUT', 'OPERATION_LOCK_BUSY']) {
        await expectDirectStatus(
            operation => new IslandService({ operation }).goHome(),
            code
        );
    }
});
