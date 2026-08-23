'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SlashCommandService = require('../../../src/commands/SlashCommandService');

test('SlashCommandService only sends one safe slash command through CommandExecutor', async () => {
    const calls = [];
    const service = new SlashCommandService({ executor: { async execute(command, options) { calls.push({ command, options }); return { command }; } } });
    const token = { throwIfCancelled() {} };
    const result = await service.send('  /kho  ', { cancellationToken: token, expectedGeneration: 7 });
    assert.equal(result.command, '/kho');
    assert.equal(calls[0].command, '/kho');
    assert.equal(calls[0].options.expectedGeneration, 7);
});

test('SlashCommandService blocks chat, multiline and credential commands', async () => {
    const service = new SlashCommandService({ executor: { async execute() { throw new Error('must not execute'); } } });
    for (const command of ['hello', '/kho\n/sell', '/login secret', '/register a b', '/password abc']) {
        await assert.rejects(() => service.send(command), /Lệnh|đăng nhập|mật khẩu/);
    }
});
