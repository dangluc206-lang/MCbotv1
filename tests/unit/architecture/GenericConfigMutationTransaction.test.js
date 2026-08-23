'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const DesktopController = require('../../../src/desktop/DesktopController');
const KeyedMutationCoordinator = require('../../../src/core/KeyedMutationCoordinator');
const CollectorB5ConfigEditor = require('../../../src/discord/config/CollectorB5ConfigEditor');

const projectRoot = path.resolve(__dirname, '../../..');

async function copyJson(baseDir, relativePath) {
    const source = path.join(projectRoot, relativePath);
    const target = path.join(baseDir, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
    return JSON.parse(await fs.readFile(target, 'utf8'));
}

function registryFrom(initial) {
    let snapshot = structuredClone(initial);
    return {
        require(key) {
            if (!Object.prototype.hasOwnProperty.call(snapshot, key)) throw new Error(`unexpected config key ${key}`);
            return snapshot[key];
        },
        get(key) { return snapshot[key]; },
        snapshot() { return snapshot; },
        replace(key, value) { snapshot = { ...snapshot, [key]: value }; }
    };
}

function runningDesktop({ baseDir, registry, coordinator, profiles = {} }) {
    const controller = new DesktopController({ baseDir });
    controller.lifecycle = 'RUNNING';
    controller.bundle = {
        shared: { configMutations: coordinator },
        fleetControl: { profileSnapshot: () => profiles },
        configuration: {
            registry,
            validator: { assertValid() {} },
            crossValidator: { assertValid() {} },
            service: {
                async reload(key, relativePath) {
                    const target = path.isAbsolute(relativePath) ? relativePath : path.join(baseDir, relativePath);
                    const value = JSON.parse(await fs.readFile(target, 'utf8'));
                    registry.replace(key, value);
                    return { success: true, data: value };
                }
            }
        },
        application: { listRuntimes: () => [] }
    };
    return controller;
}

test('generic Desktop config transactions preserve concurrent Sky command inserts', async t => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-generic-config-sky-'));
    t.after(() => fs.rm(baseDir, { recursive: true, force: true }));
    const skyCommands = await copyJson(baseDir, 'config/commands/sky-commands.json');
    const registry = registryFrom({ skyCommands });
    const coordinator = new KeyedMutationCoordinator();
    const controller = runningDesktop({ baseDir, registry, coordinator });

    await Promise.all([
        controller.upsertSkyCommand({ skyId: 'sky1', commandId: 'txn-a', command: '/txn-a', label: 'A' }),
        controller.upsertSkyCommand({ skyId: 'sky1', commandId: 'txn-b', command: '/txn-b', label: 'B' })
    ]);

    const final = JSON.parse(await fs.readFile(path.join(baseDir, 'config/commands/sky-commands.json'), 'utf8'));
    assert.equal(final.sky1['txn-a'].command, '/txn-a');
    assert.equal(final.sky1['txn-b'].command, '/txn-b');
    assert.equal(coordinator.activeKeys().length, 0);
});

test('Desktop storage protection and Collector editor share one config-set transaction boundary', async t => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-generic-config-cross-'));
    t.after(() => fs.rm(baseDir, { recursive: true, force: true }));
    const storage = await copyJson(baseDir, 'config/storage/kho.json');
    const collectorB5Mode = await copyJson(baseDir, 'config/modes/collector-b5.json');
    const mineralConversions = await copyJson(baseDir, 'config/minerals/conversions.json');
    const registry = registryFrom({ storage, collectorB5Mode, mineralConversions });
    const coordinator = new KeyedMutationCoordinator();
    const controller = runningDesktop({ baseDir, registry, coordinator, profiles: { 'bot-01': {} } });
    const botRegistry = {
        get: () => null,
        ids: () => ['bot-01'],
        require: () => ({ requireService: () => ({ reconfigure() {} }) })
    };
    const editor = new CollectorB5ConfigEditor({
        baseDir,
        configuration: controller.bundle.configuration,
        botRegistry,
        botId: 'bot-01',
        mutationCoordinator: coordinator
    });

    const originalDelay = collectorB5Mode.craftLoopDelayMs;
    const nextDelay = originalDelay + 123;
    await Promise.all([
        controller.updateStorageProtectionConfig({
            sell: { blockOnly: !Boolean(storage.sell?.blockOnly) },
            collector: { b1Decompression: { maxUsageRatio: 0.83, requireKnownCapacity: true } }
        }),
        editor.setCraftLoopDelayMs(nextDelay)
    ]);

    const finalStorage = JSON.parse(await fs.readFile(path.join(baseDir, 'config/storage/kho.json'), 'utf8'));
    const finalCollector = JSON.parse(await fs.readFile(path.join(baseDir, 'config/modes/collector-b5.json'), 'utf8'));
    assert.equal(finalStorage.sell.blockOnly, !Boolean(storage.sell?.blockOnly));
    assert.equal(finalCollector.b1Decompression.maxUsageRatio, 0.83);
    assert.equal(finalCollector.craftLoopDelayMs, nextDelay);
    assert.equal(coordinator.activeKeys().length, 0);
});
