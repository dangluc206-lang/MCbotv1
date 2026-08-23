
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ServerProfile = require('../../../src/server-profiles/ServerProfile');
const createServerProfileRegistry = require('../../../src/server-profiles/createServerProfileRegistry');
const CommandRegistry = require('../../../src/commands/CommandRegistry');
const CommandResolver = require('../../../src/commands/CommandResolver');
const CommandService = require('../../../src/commands/CommandService');

function endpointConfig() {
    return { defaultProfile: 'default', defaults: { auth: 'offline', version: '1.21.1' }, profiles: { default: { host: 'mc.minerua.com', port: 25565 } } };
}

test('WP-102 fake profile changes raw command while generic CommandService still uses semantic key', async () => {
    const profile = new ServerProfile({
        id: 'fake', revision: 'r-fake-1', endpoint: { host: 'fake.test', port: 25565 },
        catalogs: { commands: { storage: '/vault open' }, commandResponses: {} },
        bindings: { authentication: { enabled: false, commandKey: 'login' }, join: { commandKey: 'skyblock' } },
        capabilities: { commands: true, authentication: true, join: true }
    });
    const resolver = new CommandResolver({ registry: new CommandRegistry(profile.requireCatalog('commands')) });
    const calls = [];
    const service = new CommandService({ botId: 'bot-01', resolver, executor: { async execute(command, options) { calls.push({ command, options }); return { command }; } } });
    const result = await service.send('storage', { confirm: false, expectedGeneration: 9 });
    assert.equal(result.success, true);
    assert.equal(calls[0].command, '/vault open');
    assert.equal(calls[0].options.expectedGeneration, 9);
});

test('WP-102 profile revision includes command/auth/join facts but profile rejects credential material', () => {
    const common = { commands: { storage: '/kho', login: '/login {password}' }, commandResponses: {}, skyCommands: { sky1: '/sky 1' }, authentication: { enabled: true, commandKey: 'login', confirm: false }, join: { commandKey: 'skyblock', defaultSelection: 'sky1' } };
    const a = createServerProfileRegistry(endpointConfig(), common).require('default');
    const b = createServerProfileRegistry(endpointConfig(), { ...common, commands: { ...common.commands, storage: '/vault' } }).require('default');
    assert.notEqual(a.revision, b.revision);
    assert.deepEqual(a.requireCatalog('commands'), common.commands);
    assert.deepEqual(a.requireBinding('authentication'), common.authentication);
    assert.deepEqual(a.requireBinding('join'), common.join);
    assert.doesNotMatch(JSON.stringify(a), /\"password\"\s*:/i);
    assert.throws(() => new ServerProfile({ id: 'bad', revision: 'r-bad', endpoint: { host: 'bad.test' }, bindings: { authentication: { password: 'do-not-store' } } }), /credential material/);
});
