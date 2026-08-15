'use strict';

try {
    require('dotenv').config({ quiet: true });
} catch {}

const Application = require('../core/Application');
const LifecycleCoordinator = require('../core/LifecycleCoordinator');
const BotProfileAdminService = require('../discord/admin/BotProfileAdminService');
const loadConfiguration = require('./loadConfiguration');
const loadBotProfiles = require('./loadBotProfiles');
const registerSharedServices = require('./registerSharedServices');
const registerDiscordServices = require('./registerDiscordServices');
const createBotRuntime = require('./createBotRuntime');
const registerModules = require('./registerModules');

async function createApplication({
    baseDir = process.cwd(),
    output = null,
    clientFactory = null,
    environment = process.env,
    discord = null
} = {}) {
    const configuration = await loadConfiguration({ baseDir });
    const shared = registerSharedServices({ configuration, output, clientFactory });
    const logger = shared.loggerFactory.create('Application');

    // Build the application and all Minecraft runtimes first. Discord is added to
    // the lifecycle afterwards so its admin panel can create/reload runtimes live.
    const lifecycle = new LifecycleCoordinator([shared.runtimeLogOutput].filter(Boolean), {
        name: 'ApplicationLifecycle',
        logger
    });
    const application = new Application({
        botRegistry: shared.botRegistry,
        loggerFactory: shared.loggerFactory,
        lifecycleCoordinator: lifecycle,
        logger
    });

    const profiles = await loadBotProfiles({
        loader: configuration.loader,
        validator: configuration.validator,
        directory: `${baseDir}/config/bots`
    });
    const duplicateIds = [...new Set(profiles
        .map(profile => profile.id)
        .filter((id, index, all) => all.indexOf(id) !== index))];
    if (duplicateIds.length > 0) throw new Error(`Duplicate bot profile id(s): ${duplicateIds.join(', ')}`);

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

    const runtimes = profiles.map(profile => createBotRuntime({ profile, configuration, shared }));
    registerModules(application, runtimes);

    const botProfileAdmin = new BotProfileAdminService({
        baseDir,
        configuration,
        shared,
        application,
        environment,
        logger: shared.loggerFactory.create('BotProfileAdmin')
    });
    const discordService = registerDiscordServices({
        configuration,
        shared,
        environment,
        discord,
        botProfileAdmin
    });
    lifecycle.add(discordService);

    return {
        application,
        configuration,
        shared,
        profiles,
        discordService,
        botProfileAdmin
    };
}

module.exports = createApplication;
