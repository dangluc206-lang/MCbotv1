'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const createApplication = require('../../../src/bootstrap/createApplication');
const FishingBotConfigEditor = require('../../../src/discord/config/FishingBotConfigEditor');

async function isolatedProject(t) {
    const sourceRoot = path.resolve(__dirname, '../../..');
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-profile-admin-'));
    t.after(() => fs.rm(baseDir, { recursive: true, force: true }));
    await fs.cp(path.join(sourceRoot, 'config'), path.join(baseDir, 'config'), { recursive: true });
    const discordPath = path.join(baseDir, 'config/discord/discord.json');
    const discord = JSON.parse(await fs.readFile(discordPath, 'utf8'));
    discord.enabled = false;
    await fs.writeFile(discordPath, JSON.stringify(discord, null, 2));
    const entries = await fs.readdir(path.join(baseDir, 'config/bots'));
    for (const name of entries.filter(name => name.endsWith('.json'))) {
        const file = path.join(baseDir, 'config/bots', name);
        const profile = JSON.parse(await fs.readFile(file, 'utf8'));
        profile.enabled = false;
        await fs.writeFile(file, JSON.stringify(profile, null, 2));
    }
    return baseDir;
}

test('Discord bot profile admin can add, edit and clone disabled runtimes live', async t => {
    const baseDir = await isolatedProject(t);
    const { application, botProfileAdmin } = await createApplication({ baseDir, output: () => {} });
    await application.initialize();
    await application.start();

    const created = await botProfileAdmin.createProfile({
        id: 'bot-03',
        displayName: 'Farm 03',
        username: 'Farm03',
        auth: 'offline',
        version: '1.21.1'
    });
    assert.equal(created.enabled, false);
    assert.equal(application.botRegistry.has('bot-03'), true);
    assert.equal(application.getRuntime('bot-03').identity.displayName, 'Farm 03');

    const edited = await botProfileAdmin.updateProfile('bot-03', {
        displayName: 'Farm Chính',
        username: 'Farm03B'
    });
    assert.equal(edited.displayName, 'Farm Chính');
    assert.equal(application.getRuntime('bot-03').identity.username, 'Farm03B');

    const cloned = await botProfileAdmin.cloneProfile('bot-03', 'bot-04');
    assert.equal(cloned.enabled, false);
    assert.equal(application.botRegistry.has('bot-04'), true);
    assert.equal(application.getRuntime('bot-04').identity.displayName.includes('copy'), true);

    const deleted = await botProfileAdmin.deleteProfile('bot-04');
    assert.deepEqual(deleted, { id: 'bot-04', deleted: true });
    assert.equal(application.botRegistry.has('bot-04'), false);
    await assert.rejects(() => fs.access(path.join(baseDir, 'config/bots/bot-04.json')));

    await application.destroy();
});

test('Discord bot profile admin serializes concurrent read-modify-write mutations without lost updates', async t => {
    const baseDir = await isolatedProject(t);
    const { application, botProfileAdmin } = await createApplication({ baseDir, output: () => {} });
    await application.initialize();
    await application.start();

    await botProfileAdmin.createProfile({
        id: 'bot-03',
        displayName: 'Original',
        username: 'Race03',
        auth: 'offline',
        version: '1.21.1',
        skyblockSelection: 'sky1'
    });

    await Promise.all([
        botProfileAdmin.updateProfile('bot-03', { displayName: 'Changed' }),
        botProfileAdmin.updateProfile('bot-03', { skyblockSelection: 'sky2' })
    ]);

    const { profile } = await botProfileAdmin.getProfile('bot-03');
    assert.equal(profile.displayName, 'Changed');
    assert.equal(profile.skyblockSelection, 'sky2');
    assert.equal(application.getRuntime('bot-03').identity.displayName, 'Changed');

    const rejectedMutation = botProfileAdmin.updateProfile('bot-03', { username: '' });
    const recoveredMutation = botProfileAdmin.updateProfile('bot-03', { displayName: 'Recovered' });
    await assert.rejects(rejectedMutation, /Minecraft username/);
    assert.equal((await recoveredMutation).displayName, 'Recovered');

    let finalMutationSettled = false;
    const finalMutation = botProfileAdmin.updateProfile('bot-03', { skyblockSelection: 'sky1' })
        .then(result => { finalMutationSettled = true; return result; });
    await botProfileAdmin.drain();
    assert.equal(finalMutationSettled, true);
    assert.equal((await finalMutation).skyblockSelection, 'sky1');

    await application.destroy();
});

test('bot profile admin and fishing editor share one bot-profile transaction boundary', async t => {
    const baseDir = await isolatedProject(t);
    const { application, configuration, shared, botProfileAdmin } = await createApplication({ baseDir, output: () => {} });
    await application.initialize();
    await application.start();

    await botProfileAdmin.createProfile({ id: 'bot-03', displayName: 'Original', username: 'Cross03', auth: 'offline', version: '1.21.1' });
    const fishingEditor = new FishingBotConfigEditor({
        baseDir,
        configuration,
        botRegistry: shared.botRegistry,
        mutationCoordinator: shared.configMutations
    });
    const areaId = configuration.registry.require('fishingMode').areas[1].id;

    await Promise.all([
        botProfileAdmin.updateProfile('bot-03', { displayName: 'Admin Changed' }),
        fishingEditor.setAreaPosition({ botId: 'bot-03', areaId, x: 101, y: 70, z: 202, pitchDegrees: 15 })
    ]);

    const { profile } = await botProfileAdmin.getProfile('bot-03');
    assert.equal(profile.displayName, 'Admin Changed');
    assert.deepEqual(profile.fishing.areas[areaId], { x: 101, y: 70, z: 202 });
    assert.equal(application.getRuntime('bot-03').identity.displayName, 'Admin Changed');

    await application.destroy();
});

