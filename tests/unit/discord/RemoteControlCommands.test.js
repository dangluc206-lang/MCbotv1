'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const RemoteModeCommand = require('../../../src/discord/commands/RemoteModeCommand');
const SkyRemoteCommand = require('../../../src/discord/commands/SkyRemoteCommand');

function interaction(name, values) {
    const replies = [];
    return {
        commandName: name, user: { id: 'operator' }, isChatInputCommand: () => true,
        options: { getString(key, required) { const value = values[key]; if (required && !value) throw new Error(`missing ${key}`); return value ?? null; } },
        async reply(payload) { replies.push(payload); }, replies
    };
}

test('remote /mode controls any registered mode through FleetControl', async () => {
    const requests = [];
    const registry = { has: id => ['b5-craft','custom-x'].includes(id), active: () => [], status: id => id ? { definition: { id }, status: { enabled: false } } : { modes: [] } };
    const runtime = { requireService: name => name === 'modeRegistry' ? registry : { } };
    const command = new RemoteModeCommand({
        botRegistry: { require: () => runtime }, modeCatalog: { list: () => [{ id:'b5-craft',label:'B5' },{ id:'custom-x',label:'Custom' }] },
        config: { modeCommandName:'mode', defaultBotId:'bot-01', ephemeral:true }, allowedUserIds:['operator'],
        fleetControl: { async requestMode(botId, modeId, options) { requests.push({ botId, modeId, options }); return { success:true }; } }
    });
    const i = interaction('mode', { action:'start', mode:'custom-x' });
    assert.equal(await command.execute(i), true);
    assert.equal(requests[0].modeId, 'custom-x');
    assert.equal(requests[0].options.state, 'ACTIVE');
    assert.match(i.replies[0].content, /custom-x/);
});

test('remote /skycmd forwards registered command args only through SkyCommandService', async () => {
    const sent = [];
    const runtime = { requireService(name) { assert.equal(name,'skyCommandService'); return { async send(id, options) { sent.push({id,options}); return { success:true, data:{ command:'/warp mine' } }; } }; } };
    const command = new SkyRemoteCommand({ botRegistry:{ require:()=>runtime }, config:{ skyCommandName:'skycmd', defaultBotId:'bot-01', ephemeral:true }, allowedUserIds:['operator'] });
    const i = interaction('skycmd', { command:'warp', args:'{"name":"mine"}' });
    assert.equal(await command.execute(i), true);
    assert.deepEqual(sent[0], { id:'warp', options:{ args:{ name:'mine' } } });
    assert.match(i.replies[0].content, /warp mine/);
});
