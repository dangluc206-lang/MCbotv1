'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const DiscordInteractionRouter = require('../../../src/discord/DiscordInteractionRouter');

test('interaction router gives panel ownership first and stops after first command match', async () => {
    const calls = [];
    const panel = { handleInteraction:async () => { calls.push('panel'); return false; } };
    const router = new DiscordInteractionRouter({ panelManager:panel, commands:[
        { execute:async () => { calls.push('first'); return true; } },
        { execute:async () => { calls.push('second'); return true; } }
    ] });
    assert.equal(await router.handle({}), true);
    assert.deepEqual(calls, ['panel', 'first']);
});

test('interaction router reports unhandled interactions without throwing', async () => {
    const router = new DiscordInteractionRouter({ commands:[{ execute:async () => false }] });
    assert.equal(await router.handle({}), false);
});
