'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CollectorB5ModeCommand = require('../../../src/discord/commands/CollectorB5ModeCommand');

function createInteraction(action = 'status') {
    const replies = [];
    return {
        commandName: 'mode',
        user: { id: '100' },
        isChatInputCommand: () => true,
        options: {
            getString(name) {
                if (name === 'action') return action;
                if (name === 'bot') return null;
                return null;
            }
        },
        async reply(payload) { replies.push(payload); },
        replies
    };
}

function createCommand() {
    const mode = {
        async enable() { return { success: true, data: this.status() }; },
        async disable() { return { success: true, data: this.status() }; },
        status() {
            return {
                enabled: true,
                phase: 'COLLECTING',
                pickupLocation: { x: 1, y: 2, z: 3 },
                craftedB5Cycles: 4,
                lastError: null
            };
        }
    };
    const runtime = {
        context: { has: () => true },
        requireService(name) { assert.equal(name, 'collectorB5Mode'); return mode; }
    };
    return new CollectorB5ModeCommand({
        botRegistry: { require: id => { assert.equal(id, 'bot-01'); return runtime; } },
        allowedUserIds: ['100'],
        config: { modeCommandName: 'mode', defaultBotId: 'bot-01', ephemeral: true }
    });
}

test('registers mode action choices without amount target option', () => {
    const definition = createCommand().definition(3);
    assert.equal(definition.name, 'mode');
    assert.deepEqual(definition.options[0].choices.map(choice => choice.value), ['on', 'off', 'status']);
    assert.deepEqual(definition.options.map(option => option.name), ['action', 'bot']);
});

test('turns mode on from Discord and returns continuous-mode status', async () => {
    const interaction = createInteraction('on');
    const handled = await createCommand().execute(interaction);
    assert.equal(handled, true);
    assert.match(interaction.replies[0].content, /Mode nhặt\+B5/);
    assert.match(interaction.replies[0].content, /B5 đã hoàn thành/);
});
