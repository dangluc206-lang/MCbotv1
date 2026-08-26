'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const ConfigSpecs = require('../../../src/configuration/ConfigSpecs');
const createApplication = require('../../../src/bootstrap/createApplication');
const DesktopController = require('../../../src/desktop/DesktopController');
const DesktopRuntimeBootstrap = require('../../../src/desktop/use-cases/DesktopRuntimeBootstrap');

async function prepareTemplate(root) {
    const projectRoot = path.resolve(__dirname, '../../..');
    for (const spec of ConfigSpecs) {
        const target = path.join(root, spec.file);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(path.join(projectRoot, spec.file), target);
    }
    await fs.mkdir(path.join(root, 'config', 'bots'), { recursive: true });
    await fs.writeFile(path.join(root, 'config', 'bots', 'bot-01.json'), JSON.stringify({
        id: 'bot-01',
        enabled: true,
        displayName: 'Desktop first-start fixture',
        username: 'desktop-first-start-fixture',
        auth: 'offline',
        version: false,
        reconnect: { enabled: false, maxAttempts: 0, baseDelayMs: 0, maxDelayMs: 0 }
    }, null, 2));

    const discordPath = path.join(root, 'config', 'discord', 'discord.json');
    const discord = JSON.parse(await fs.readFile(discordPath, 'utf8'));
    discord.enabled = false;
    await fs.writeFile(discordPath, JSON.stringify(discord, null, 2));

    const serverPath = path.join(root, 'config', 'server.json');
    const server = JSON.parse(await fs.readFile(serverPath, 'utf8'));
    const defaultProfile = server.defaultProfile;
    server.defaults.version = false;
    server.profiles[defaultProfile].host = '127.0.0.1';
    server.profiles[defaultProfile].port = 25565;
    await fs.writeFile(serverPath, JSON.stringify(server, null, 2));
}

function fakeClient(chatMessages) {
    const client = new EventEmitter();
    client.chat = command => chatMessages.push(command);
    client.end = reason => client.emit('end', reason);
    return client;
}

async function waitFor(predicate, timeoutMs = 2000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('Timed out waiting for Desktop first-start connection fixture.');
}

test('Desktop first autostart uses migrated runtime config and resolved credential to connect', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-desktop-first-start-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const templateRoot = path.join(root, 'application');
    const userDataRoot = path.join(root, 'user-data');
    await prepareTemplate(templateRoot);
    const password = 'fixture-first-start-password';
    class FixtureSecretStore {
        environment(base) { return { ...base, MCBOT_BOT_01_PASSWORD: password }; }
        status() { return { state: 'READY', keys: ['MCBOT_BOT_01_PASSWORD'] }; }
    }
    const bootstrap = new DesktopRuntimeBootstrap({
        templateRoot,
        userDataRoot,
        appVersion: '2.7.67',
        safeStorage: {},
        baseEnvironmentProvider: () => ({}),
        DesktopSecretStoreClass: FixtureSecretStore
    });
    const prepared = await bootstrap.prepare();
    const chatMessages = [];
    let createOptions = null;
    const controller = new DesktopController({
        baseDir: prepared.runtimeRoot,
        environment: prepared.environment,
        applicationFactory: async options => {
            createOptions = options;
            return createApplication({ ...options, clientFactory: () => {
                const client = fakeClient(chatMessages);
                queueMicrotask(() => client.emit('login'));
                setImmediate(() => client.emit('spawn'));
                return client;
            } });
        }
    });

    await controller.start();
    await waitFor(() => controller.bundle.application.getRuntime('bot-01').getState().connectionState === 'CONNECTED');
    assert.equal(createOptions.baseDir, path.join(path.resolve(userDataRoot), 'runtime-dev'));
    assert.equal(createOptions.environment.MCBOT_BOT_01_PASSWORD, password);
    assert.equal(createOptions.environment.MCBOT_DESKTOP, '1');
    assert.deepEqual(chatMessages, [`/login ${password}`]);
    assert.equal(JSON.stringify(controller.logSnapshot()).includes(password), false);
    await controller.stop();
});

