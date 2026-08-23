'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const createApplication = require('../../../src/bootstrap/createApplication');

async function createIsolatedBaseDir(t, prefix) {
    const sourceRoot = path.resolve(__dirname, '../../..');
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    t.after(() => fs.rm(baseDir, { recursive: true, force: true }));
    await fs.cp(path.join(sourceRoot, 'config'), path.join(baseDir, 'config'), { recursive: true });

    // Integration tests must not inherit a developer's real Discord token or
    // connect to external services merely because the local project enables
    // Discord in production.
    const discordPath = path.join(baseDir, 'config/discord/discord.json');
    const discord = JSON.parse(await fs.readFile(discordPath, 'utf8'));
    discord.enabled = false;
    await fs.writeFile(discordPath, JSON.stringify(discord, null, 2));

    const serverPath = path.join(baseDir, 'config/server.json');
    const server = JSON.parse(await fs.readFile(serverPath, 'utf8'));
    server.defaults.version = false;
    server.profiles.default.host = '127.0.0.1';
    server.profiles.default.port = 25565;
    await fs.writeFile(serverPath, JSON.stringify(server, null, 2));

    for (const [name, username] of [['bot-01.json', 'BotFarm01'], ['bot-02.json', 'BotFarm02']]) {
        const profilePath = path.join(baseDir, 'config/bots', name);
        const profile = JSON.parse(await fs.readFile(profilePath, 'utf8'));
        profile.enabled = false;
        profile.username = username;
        profile.version = false;
        await fs.writeFile(profilePath, JSON.stringify(profile, null, 2));
    }
    return baseDir;
}

test('application loads config and starts with disabled bot profiles without external services', async t => {
    const baseDir = await createIsolatedBaseDir(t, 'mcbot-app-config-');
    const output = [];
    const { application, profiles, discordService } = await createApplication({ baseDir, output: r => output.push(r) });
    assert.equal(profiles.length, 2);
    assert.equal(application.listRuntimes().length, 2);
    assert.equal(discordService.name, 'DiscordService');
    const runtime = application.getRuntime('bot-01');
    assert.equal(typeof runtime.requireService('serverFeatureFacade').skyblock().join, 'function');
    assert.equal(runtime.requireService('collectorB5Mode').status().modeAdapter.kind, 'legacy-strangler-v1');
    assert.equal(runtime.requireService('fishingMode').status().modeAdapter.kind, 'legacy-strangler-v1');
    assert.equal(typeof runtime.requireService('collectorB5Mode').publicConfig, 'function');
    assert.equal(typeof runtime.requireService('fishingMode').reconfigure, 'function');
    await application.initialize();
    await application.start();
    assert.equal(application.listRuntimes().every(r => !r.context.has()), true);
    await application.destroy();
});

async function waitFor(predicate, timeoutMs = 1500) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('Timed out waiting for condition');
}

function createFakeClient(chatMessages = []) {
    const client = new EventEmitter();
    client.chat = command => chatMessages.push(command);
    client.end = reason => client.emit('end', reason);
    return client;
}

test('enabled runtime connects, survives initial failure and reconnects to spawn', async t => {
    const previousPassword = process.env.MCBOT_BOT_01_PASSWORD;
    process.env.MCBOT_BOT_01_PASSWORD = 'test-password';
    t.after(() => {
        if (previousPassword === undefined) delete process.env.MCBOT_BOT_01_PASSWORD;
        else process.env.MCBOT_BOT_01_PASSWORD = previousPassword;
    });

    const baseDir = await createIsolatedBaseDir(t, 'mcbot-connect-');
    const appPath = path.join(baseDir, 'config/app.json');
    const appConfig = JSON.parse(await fs.readFile(appPath, 'utf8'));
    appConfig.multiBot = {
        connectionStartSpacingMs: 0,
        postSuccessSpacingMs: 0,
        transientFailureCooldownMs: 2,
        connectionResetCooldownMs: 2,
        lostConnectionCooldownMs: 2,
        loginTooFastCooldownMs: 2
    };
    await fs.writeFile(appPath, JSON.stringify(appConfig, null, 2));
    const firstProfilePath = path.join(baseDir, 'config/bots/bot-01.json');
    const secondProfilePath = path.join(baseDir, 'config/bots/bot-02.json');
    const firstProfile = JSON.parse(await fs.readFile(firstProfilePath, 'utf8'));
    const secondProfile = JSON.parse(await fs.readFile(secondProfilePath, 'utf8'));

    firstProfile.enabled = true;
    firstProfile.reconnect = { enabled: true, maxAttempts: 3, baseDelayMs: 2, maxDelayMs: 5 };
    secondProfile.enabled = false;
    await fs.writeFile(firstProfilePath, JSON.stringify(firstProfile, null, 2));
    await fs.writeFile(secondProfilePath, JSON.stringify(secondProfile, null, 2));

    let attempts = 0;
    const receivedOptions = [];
    const chatMessages = [];
    const clientFactory = options => {
        attempts += 1;
        receivedOptions.push(options);
        const client = createFakeClient(chatMessages);
        if (attempts === 1) queueMicrotask(() => client.emit('error', new Error('initial failure')));
        else {
            queueMicrotask(() => client.emit('login'));
            setImmediate(() => client.emit('spawn'));
        }
        return client;
    };

    const records = [];
    const { application } = await createApplication({ baseDir, clientFactory, output: record => records.push(record) });
    await application.initialize();
    await application.start();

    const runtime = application.getRuntime('bot-01');
    await waitFor(() => runtime.getState().connectionState === 'CONNECTED');
    assert.equal(attempts, 2);
    assert.equal(runtime.context.has(), true);
    assert.equal(runtime.getState().connectionState, 'CONNECTED');
    assert.equal(receivedOptions[0].host, '127.0.0.1');
    assert.equal(receivedOptions[0].port, 25565);
    assert.equal(receivedOptions[0].username, 'BotFarm01');
    assert.equal(receivedOptions[0].auth, 'offline');
    assert.equal(receivedOptions[0].version, false);
    assert.equal(records.some(record => record.message === 'Connecting Minecraft bot.'), true);
    assert.equal(records.some(record => record.message === 'Minecraft login completed.'), true);
    assert.equal(records.some(record => record.message === 'Minecraft bot spawned.'), true);
    assert.deepEqual(chatMessages, ['/login test-password']);
    assert.equal(JSON.stringify(records).includes('test-password'), false);
    await application.destroy();
});

test('a fresh application session ignores stale connection/mode intent and starts enabled bots connected but idle', async t => {
    const baseDir = await createIsolatedBaseDir(t, 'mcbot-fresh-session-');
    const profilePath = path.join(baseDir, 'config/bots/bot-01.json');
    const profile = JSON.parse(await fs.readFile(profilePath, 'utf8'));
    profile.enabled = true;
    await fs.writeFile(profilePath, JSON.stringify(profile, null, 2));
    const intentDirectory = path.join(baseDir, 'data/runtime/control');
    await fs.mkdir(intentDirectory, { recursive: true });
    await fs.writeFile(path.join(intentDirectory, 'intents.json'), `${JSON.stringify({
        version: 1,
        revision: 1,
        updatedAt: '2026-08-16T00:00:00.000Z',
        intents: {
            'bot-01': {
                botId: 'bot-01',
                desiredConnection: 'CONNECTED',
                desiredMode: 'fishing',
                modeState: 'ACTIVE',
                revision: 1,
                updatedAt: '2026-08-16T00:00:00.000Z',
                source: 'previous-process'
            }
        }
    }, null, 2)}
`, 'utf8');

    let clientCreations = 0;
    const { application, fleetControl } = await createApplication({
        baseDir,
        clientFactory: () => {
            clientCreations += 1;
            const client = createFakeClient();
            queueMicrotask(() => client.emit('login'));
            setImmediate(() => client.emit('spawn'));
            return client;
        },
        output: () => {}
    });
    await application.initialize();
    await application.start();
    await waitFor(() => application.getRuntime('bot-01').context.has());
    assert.equal(clientCreations, 1);
    assert.equal(fleetControl.intent('bot-01').desiredConnection, 'CONNECTED');
    assert.equal(fleetControl.intent('bot-01').desiredMode, null);
    assert.equal(fleetControl.intent('bot-01').modeState, null);
    assert.equal(application.getRuntime('bot-01').requireService('fishingMode').status().enabled, false);
    await application.destroy();
});

const registerShutdown = require('../../../src/bootstrap/shutdown');

test('shutdown registration is idempotent and cleans process handlers', async () => {
    let destroys = 0;
    const application = { async destroy() { destroys += 1; } };
    const registration = registerShutdown(application, { logger: { info() {}, error() {} }, timeoutMs: 50 });
    const first = registration.shutdown('test');
    const second = registration.shutdown('test-again');
    assert.equal(first, second);
    await first;
    assert.equal(destroys, 1);
    registration.dispose();
});
