'use strict';

try {
    require('dotenv').config({ quiet: true });
} catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') throw error;
}

const Application = require('../core/Application');
const LifecycleCoordinator = require('../core/LifecycleCoordinator');
const BotProfileAdminService = require('../discord/admin/BotProfileAdminService');
const FleetScheduler = require('../fleet/FleetScheduler');
const DurableIntentStore = require('../recovery/DurableIntentStore');
const FleetControlService = require('../recovery/FleetControlService');
const loadConfiguration = require('./loadConfiguration');
const loadBotProfiles = require('./loadBotProfiles');
const registerSharedServices = require('./registerSharedServices');
const registerDiscordServices = require('./registerDiscordServices');
const createBotRuntime = require('./createBotRuntime');
const registerModules = require('./registerModules');
const createModeCatalog = require('./createModeCatalog');

async function createApplication({
    baseDir = process.cwd(),
    output = null,
    clientFactory = null,
    environment = process.env,
    discord = null
} = {}) {
    const configuration = await loadConfiguration({ baseDir });
    const modeCatalog = createModeCatalog({ baseDir });
    const shared = registerSharedServices({ configuration, output, clientFactory });
    shared.modeCatalog = modeCatalog;
    const logger = shared.loggerFactory.create('Application');
    const controlConfig = configuration.registry.require('app').controlPlane || { enabled: false };
    const intentStore = new DurableIntentStore({
        baseDir,
        enabled: controlConfig.enabled !== false,
        file: controlConfig.intentFile,
        maxBytes: controlConfig.maxBytes,
        logger: shared.loggerFactory.create('DurableIntentStore'),
        modeCatalog
    });
    await intentStore.initialize();
    const fleetScheduler = new FleetScheduler({
        concurrency: controlConfig.concurrency,
        maxPending: controlConfig.maxPending,
        taskTimeoutMs: controlConfig.taskTimeoutMs,
        shutdownDrainMs: controlConfig.shutdownDrainMs,
        logger: shared.loggerFactory.create('FleetScheduler')
    });
    const fleetControl = new FleetControlService({
        store: intentStore,
        scheduler: fleetScheduler,
        botRegistry: shared.botRegistry,
        modeCatalog,
        logger: shared.loggerFactory.create('FleetControl')
    });

    // Build the application and all Minecraft runtimes first. Discord is added to
    // the lifecycle afterwards so its admin panel can create/reload runtimes live.
    const lifecycle = new LifecycleCoordinator([shared.runtimeLogOutput, fleetControl].filter(Boolean), {
        name: 'ApplicationLifecycle',
        logger
    });
    const application = new Application({
        botRegistry: shared.botRegistry,
        loggerFactory: shared.loggerFactory,
        lifecycleCoordinator: lifecycle,
        controlPlane: fleetControl,
        logger
    });

    const profiles = await loadBotProfiles({
        loader: configuration.loader,
        validator: configuration.validator,
        directory: 'config/bots',
        environment
    });
    configuration.crossValidator.assertValid(configuration.registry.snapshot(), { botProfiles: profiles });
    fleetControl.setProfiles(profiles);
    // A fresh desktop/application process starts a new operator session.
    // Enabled bot profiles reconnect automatically, but modes never replay
    // merely because they were active in the previous process. The same
    // in-process intent remains durable across server kicks/reconnects.
    await fleetControl.prepareApplicationSession({ source: 'application-startup-idle' });

    const enabledByUsername = new Map();
    for (const profile of profiles.filter(profile => profile.enabled)) {
        const usernameKey = String(profile.username || '').trim().toLowerCase();
        if (!usernameKey) continue;
        if (!enabledByUsername.has(usernameKey)) enabledByUsername.set(usernameKey, []);
        enabledByUsername.get(usernameKey).push(profile.id);
    }
    for (const [username, botIds] of enabledByUsername.entries()) {
        if (botIds.length < 2) continue;
        logger.warn('Multiple enabled bot profiles share one Minecraft username.', {
            username,
            botIds,
            action: 'use a distinct Minecraft identity for each simultaneously connected bot'
        });
    }

    const runtimes = profiles.map(profile => createBotRuntime({
        profile: fleetControl.runtimeProfile(profile),
        configuration,
        shared
    }));
    registerModules(application, runtimes);
    lifecycle.add(shared.configMutations);

    const botProfileAdmin = new BotProfileAdminService({
        baseDir,
        configuration,
        shared,
        application,
        environment,
        fleetControl,
        mutationCoordinator: shared.configMutations,
        logger: shared.loggerFactory.create('BotProfileAdmin')
    });
    const discordService = registerDiscordServices({
        configuration,
        shared,
        environment,
        discord,
        botProfileAdmin,
        fleetControl
    });
    lifecycle.add(discordService);

    return {
        application,
        configuration,
        shared,
        profiles,
        discordService,
        botProfileAdmin,
        fleetControl,
        intentStore,
        fleetScheduler,
        modeCatalog
    };
}

module.exports = createApplication;
