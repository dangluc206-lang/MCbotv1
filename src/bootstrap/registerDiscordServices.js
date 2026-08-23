'use strict';

const DiscordService = require('../discord/DiscordService');
const GuiInspectionCommand = require('../discord/commands/GuiInspectionCommand');
const CollectorB5ModeCommand = require('../discord/commands/CollectorB5ModeCommand');
const FishingModeCommand = require('../discord/commands/FishingModeCommand');
const DiscordPanelManager = require('../discord/panels/DiscordPanelManager');
const RemoteModeCommand = require('../discord/commands/RemoteModeCommand');
const SkyRemoteCommand = require('../discord/commands/SkyRemoteCommand');

function parseCsv(value) {
    return String(value || '').split(',').map(entry => entry.trim()).filter(Boolean);
}

function registerDiscordServices({ configuration, shared, environment = process.env, discord = null, botProfileAdmin = null, fleetControl = null }) {
    const configured = configuration.registry.require('discord');
    const logger = shared.loggerFactory.create('Discord');
    const desktopMode = ['1', 'true', 'yes', 'on'].includes(String(environment.MCBOT_DESKTOP || '').toLowerCase());
    const missingDesktopCredentials = desktopMode && configured.enabled && (!String(environment[configured.tokenEnv] || '').trim() || !String(environment[configured.applicationIdEnv] || '').trim());
    const config = missingDesktopCredentials ? { ...configured, enabled: false } : configured;
    if (missingDesktopCredentials) logger.warn('Discord integration is waiting for Desktop secret configuration.', { tokenEnv: configured.tokenEnv, applicationIdEnv: configured.applicationIdEnv });
    const allowedUserIds = parseCsv(environment[config.allowedUserIdsEnv]);

    if (config.enabled && allowedUserIds.length === 0) {
        logger.warn(`Discord allowlist is empty (${config.allowedUserIdsEnv}); Discord controls will deny every user until configured.`);
    }

    const commands = config.remoteOnly === true
        ? [
            new RemoteModeCommand({ botRegistry: shared.botRegistry, modeCatalog: shared.modeCatalog, config, allowedUserIds, fleetControl, logger }),
            new SkyRemoteCommand({ botRegistry: shared.botRegistry, config, allowedUserIds, logger })
        ]
        : [
            new GuiInspectionCommand({ botRegistry: shared.botRegistry, config, allowedUserIds, logger }),
            new CollectorB5ModeCommand({ botRegistry: shared.botRegistry, config, allowedUserIds, fleetControl, logger }),
            new FishingModeCommand({ botRegistry: shared.botRegistry, config, allowedUserIds, fleetControl, logger })
        ];
    const panelManager = new DiscordPanelManager({
        config,
        botRegistry: shared.botRegistry,
        allowedUserIds,
        configuration,
        environment,
        baseDir: configuration.loader.baseDir,
        logger,
        botProfileAdmin,
        fleetControl,
        mutationCoordinator: shared.configMutations
    });

    return new DiscordService({ config, commands, panelManager, environment, logger, discord });
}

module.exports = registerDiscordServices;
