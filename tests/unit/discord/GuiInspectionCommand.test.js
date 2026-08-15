'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const GuiInspectionCommand = require('../../../src/discord/commands/GuiInspectionCommand');

function createInteraction({ userId = '100', target = 'sky', botId = null } = {}) {
    const replies = [];
    return {
        commandName: 'gui',
        user: { id: userId },
        options: {
            getString(name, required) {
                if (name === 'command') return target;
                if (name === 'bot') return botId;
                if (required) throw new Error(`Missing ${name}`);
                return null;
            }
        },
        isChatInputCommand: () => true,
        async reply(payload) { replies.push({ method: 'reply', payload }); },
        async deferReply(payload) { replies.push({ method: 'deferReply', payload }); },
        async editReply(payload) { replies.push({ method: 'editReply', payload }); },
        replies
    };
}

function createCommand() {
    const snapshot = {
        botId: 'bot-01',
        commandKey: 'skyblock',
        command: '/sky',
        gui: { title: 'Skyblock', slotCount: 63 },
        items: [{ slot: 12, name: 'grass_block' }]
    };
    const runtime = {
        context: { has: () => true },
        requireService(name) {
            assert.equal(name, 'guiInspectionService');
            return { capture: async () => snapshot };
        }
    };
    const botRegistry = {
        require(id) {
            assert.equal(id, 'bot-01');
            return runtime;
        }
    };
    return new GuiInspectionCommand({
        botRegistry,
        allowedUserIds: ['100'],
        config: {
            commandName: 'gui',
            defaultBotId: 'bot-01',
            guiTimeoutMs: 7000,
            maxAttachmentBytes: 100000,
            ephemeral: true,
            targets: {
                sky: { display: '/sky', commandKey: 'skyblock' },
                ks: { display: '/ks', commandKey: 'minerals' },
                kho: { display: '/kho', commandKey: 'storage' },
                pv2: { display: '/pv 2', commandKey: 'personalVault2' },
                nung: { display: '/nung', commandKey: 'smelting' },
                d: { display: '/d', commandKey: 'dungeon' }
            }
        }
    });
}

test('returns a JSON attachment for an authorized user', async () => {
    const command = createCommand();
    const interaction = createInteraction();

    const handled = await command.execute(interaction);

    assert.equal(handled, true);
    assert.equal(interaction.replies[0].method, 'deferReply');
    const final = interaction.replies.at(-1);
    assert.equal(final.method, 'editReply');
    assert.match(final.payload.content, /Skyblock/);
    assert.equal(final.payload.files.length, 1);
    const parsed = JSON.parse(final.payload.files[0].attachment.toString('utf8'));
    assert.equal(parsed.items[0].slot, 12);
});

test('denies users outside the allowlist', async () => {
    const command = createCommand();
    const interaction = createInteraction({ userId: '999' });

    await command.execute(interaction);

    assert.equal(interaction.replies.length, 1);
    assert.equal(interaction.replies[0].method, 'reply');
    assert.match(interaction.replies[0].payload.content, /không có quyền/);
});

test('builds configured GUI target choices', () => {
    const definition = createCommand().definition(3);
    assert.equal(definition.name, 'gui');
    assert.deepEqual(definition.options[0].choices, [
        { name: '/sky', value: 'sky' },
        { name: '/ks', value: 'ks' },
        { name: '/kho', value: 'kho' },
        { name: '/pv 2', value: 'pv2' },
        { name: '/nung', value: 'nung' },
        { name: '/d', value: 'd' }
    ]);
});
