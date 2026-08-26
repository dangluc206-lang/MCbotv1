'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const resolveDesktopEnvironment = require('../../../src/desktop/DesktopEnvironmentResolver');
const DesktopController = require('../../../src/desktop/DesktopController');
const loadBotProfiles = require('../../../src/bootstrap/loadBotProfiles');
const packageJson = require('../../../package.json');

function fakeApplication() {
    return {
        async initialize() {},
        async start() {},
        async stop() {},
        async destroy() {},
        listRuntimes() { return []; },
        getState() { return 'RUNNING'; }
    };
}

test('first Desktop backend start receives dotenv credentials with encrypted secrets taking precedence', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-desktop-environment-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    let runtimeResolutionCalls = 0;
    const resolution = resolveDesktopEnvironment({
        templateRoot: root,
        isPackaged: false,
        baseEnvironment: { PROCESS_ONLY: '1', MCBOT_BOT_01_PASSWORD: 'process-password' },
        runtimeEnvironmentResolver({ baseEnvironment }) {
            runtimeResolutionCalls += 1;
            return {
                environment: { ...baseEnvironment, MCBOT_BOT_01_PASSWORD: 'dotenv-password', DOTENV_ONLY: '1' },
                provenance: { baseSource: 'PROCESS_ENVIRONMENT', dotenvState: 'LOADED', dotenvPrecedence: 'FILL_MISSING_ONLY' }
            };
        },
        secretStore: {
            environment(base) { return { ...base, MCBOT_BOT_01_PASSWORD: 'encrypted-secret-password' }; }
        }
    });
    let receivedEnvironment = null;
    const controller = new DesktopController({
        baseDir: root,
        environment: resolution.environment,
        applicationFactory: async options => {
            receivedEnvironment = options.environment;
            return { application: fakeApplication() };
        }
    });

    await controller.start();
    assert.equal(runtimeResolutionCalls, 1);
    assert.equal(receivedEnvironment.MCBOT_BOT_01_PASSWORD, 'encrypted-secret-password');
    assert.equal(receivedEnvironment.DOTENV_ONLY, '1');
    assert.equal(receivedEnvironment.MCBOT_DESKTOP, '1');
    assert.equal(resolution.provenance.secretOverlay, 'OS_ENCRYPTED_STORE_LAST');
    assert.equal(Object.isFrozen(resolution.environment), true);
    await controller.stop();
});

test('resolved Desktop credential reaches bot profile password lookup on the first load', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-profile-environment-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const directory = path.join(root, 'config', 'bots');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'bot-01.json'), '{}');
    const profiles = await loadBotProfiles({
        loader: {
            baseDir: root,
            async load() { return { id: 'bot-01', enabled: true, username: 'fixture' }; }
        },
        validator: { assertValid() {} },
        environment: { MCBOT_BOT_01_PASSWORD: 'first-start-password' }
    });
    assert.equal(profiles[0].password, 'first-start-password');
});

test('packaged Desktop skips dotenv and still applies the encrypted secret overlay', () => {
    let runtimeResolutionCalls = 0;
    const result = resolveDesktopEnvironment({
        templateRoot: 'C:/application',
        isPackaged: true,
        baseEnvironment: { BASE: '1' },
        runtimeEnvironmentResolver() { runtimeResolutionCalls += 1; throw new Error('must not run'); },
        secretStore: { environment(base) { return { ...base, SECRET: 'configured' }; } }
    });
    assert.equal(runtimeResolutionCalls, 0);
    assert.deepEqual(result.environment, { BASE: '1', SECRET: 'configured' });
    assert.equal(result.provenance.dotenvState, 'SKIPPED_PACKAGED');
});

test('Desktop environment cannot be replaced while backend is active', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-desktop-environment-guard-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const controller = new DesktopController({
        baseDir: root,
        environment: {},
        applicationFactory: async () => ({ application: fakeApplication() })
    });
    await controller.start();
    assert.throws(() => controller.configureEnvironment({ NEW: '1' }), error => error.code === 'DESKTOP_ENVIRONMENT_REPLACE_UNSAFE');
    await controller.stop();
    controller.configureEnvironment({ NEW: '1' });
    assert.equal(controller.environment.NEW, '1');
    assert.equal(controller.environment.MCBOT_DESKTOP, '1');
    assert.equal(Object.isFrozen(controller.environment), true);
});

test('package entrypoints make Desktop the default and keep explicit headless startup', () => {
    assert.equal(packageJson.scripts.start, 'electron .');
    assert.equal(packageJson.scripts['desktop:start'], 'electron .');
    assert.equal(packageJson.scripts['core:start'], 'node src/index.js');
    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../src/desktop/main.js'), 'utf8');
    assert.match(mainSource, /environment:\s*preparedRuntime\.environment/);
    assert.match(mainSource, /configureEnvironment\(runtimeBootstrap\.resolveEnvironment\(\)\)/);
    assert.doesNotMatch(mainSource, /secretStore\.environment\(process\.env\)/);
});

test('DesktopRuntimeBootstrap migrates runtime before resolving first-start credentials', async () => {
    const DesktopRuntimeBootstrap = require('../../../src/desktop/use-cases/DesktopRuntimeBootstrap');
    const order = [];
    class FakeMigrator {
        constructor(options) { this.options = options; }
        async prepare() { order.push('migrate'); return { fromVersion: null, toVersion: '2.7.67', warnings: [] }; }
    }
    class FakeSecretStore {
        constructor(options) { this.options = options; order.push('secret-store'); }
        environment(base) { order.push('secret-overlay'); return { ...base, SECRET: 'ready' }; }
    }
    class FakeProvenance {
        constructor(options) { this.options = options; }
        async sample() { return { status: 'READY', environment: this.options.environmentProvenanceProvider() }; }
    }
    const bootstrap = new DesktopRuntimeBootstrap({
        templateRoot: 'C:/application',
        userDataRoot: 'C:/user-data',
        appVersion: '2.7.67',
        safeStorage: {},
        baseEnvironmentProvider: () => ({ PROCESS: '1' }),
        RuntimeConfigMigratorClass: FakeMigrator,
        DesktopSecretStoreClass: FakeSecretStore,
        DesktopRuntimeProvenanceServiceClass: FakeProvenance,
        environmentResolver({ baseEnvironment, secretStore }) {
            order.push('dotenv');
            return {
                environment: secretStore.environment({ ...baseEnvironment, DOTENV: '1' }),
                provenance: { dotenvState: 'LOADED', secretOverlay: 'OS_ENCRYPTED_STORE_LAST' }
            };
        }
    });
    const prepared = await bootstrap.prepare();
    const preparedAgain = await bootstrap.prepare();
    assert.deepEqual(order, ['migrate', 'secret-store', 'dotenv', 'secret-overlay']);
    assert.equal(preparedAgain, prepared);
    assert.equal(prepared.runtimeRoot, path.join(path.resolve('C:/user-data'), 'runtime-dev'));
    assert.deepEqual(prepared.environment, { PROCESS: '1', DOTENV: '1', SECRET: 'ready' });
    assert.equal((await prepared.provenanceService.sample()).environment.dotenvState, 'LOADED');
});

test('Desktop environment resolver rejects malformed injected providers', () => {
    assert.throws(() => resolveDesktopEnvironment({
        templateRoot: 'C:/application',
        secretStore: { environment: base => base },
        runtimeEnvironmentResolver: () => null
    }), /invalid environment/);
    assert.throws(() => resolveDesktopEnvironment({
        templateRoot: 'C:/application',
        secretStore: { environment: () => [] },
        runtimeEnvironmentResolver: () => ({ environment: {}, provenance: {} })
    }), /secret store returned an invalid environment/);
});
