'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const createApplication = require('../../../src/bootstrap/createApplication');

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

    await application.destroy();
});
