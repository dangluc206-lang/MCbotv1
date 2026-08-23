'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const DiscordPanelManager = require('../../../src/discord/panels/DiscordPanelManager');

const sendHubWithGenerationHold = DiscordPanelManager.sendHubWithGenerationHold;

test('HUB hold rolls back exact generation once when /hub send throws', async () => {
    const calls = { hold: [], release: [], send: [] };
    const autoJoin = {
        holdAtHub(options) { calls.hold.push(options); return { success: true }; },
        releaseHubHold(options) { calls.release.push(options); return { success: true }; }
    };
    const slashCommandService = {
        async send(command, options) {
            calls.send.push({ command, options });
            const error = new Error('stale send'); error.code = 'COMMAND_STALE_GENERATION'; throw error;
        }
    };

    await assert.rejects(
        sendHubWithGenerationHold({ autoJoin, slashCommandService, expectedGeneration: 17, botId: 'bot-01' }),
        error => error?.code === 'COMMAND_STALE_GENERATION'
    );
    assert.deepEqual(calls.hold, [{ reason: 'discord-remote', expectedGeneration: 17 }]);
    assert.deepEqual(calls.release, [{ rejoin: true, trigger: 'discord-remote-hub-failed', expectedGeneration: 17 }]);
    assert.equal(calls.release.length, 1);
});

test('HUB hold rolls back exact generation once when /hub returns failure Result', async () => {
    const calls = { release: [] };
    const rootError = new Error('disconnected'); rootError.code = 'DISCONNECTED';
    const autoJoin = {
        holdAtHub() { return { success: true }; },
        releaseHubHold(options) { calls.release.push(options); return { success: true }; }
    };
    const slashCommandService = { async send() { return { success: false, status: 'DISCONNECTED', error: rootError, message: rootError.message }; } };

    await assert.rejects(
        sendHubWithGenerationHold({ autoJoin, slashCommandService, expectedGeneration: 21 }),
        error => error === rootError
    );
    assert.deepEqual(calls.release, [{ rejoin: true, trigger: 'discord-remote-hub-failed', expectedGeneration: 21 }]);
});

test('stale HUB rollback carries old generation and cannot clear replacement generation hold', async () => {
    const holds = new Set();
    let currentGeneration = 31;
    const autoJoin = {
        holdAtHub({ expectedGeneration }) { holds.add(expectedGeneration); return { success: true }; },
        releaseHubHold({ expectedGeneration }) { holds.delete(expectedGeneration); return { success: true }; }
    };
    const slashCommandService = {
        async send() {
            currentGeneration = 32;
            holds.add(32); // replacement generation acquired its own hold
            const error = new Error('client replaced'); error.code = 'COMMAND_STALE_GENERATION'; throw error;
        }
    };

    await assert.rejects(sendHubWithGenerationHold({ autoJoin, slashCommandService, expectedGeneration: 31 }));
    assert.equal(currentGeneration, 32);
    assert.equal(holds.has(31), false, 'failed generation hold is rolled back');
    assert.equal(holds.has(32), true, 'rollback from generation 31 must not mutate generation 32 hold');
});
