'use strict';

const DiscordService = require('../discord/DiscordService');
const GuiInspectionCommand = require('../discord/commands/GuiInspectionCommand');
const CollectorB5ModeCommand = require('../discord/commands/CollectorB5ModeCommand');
const FishingModeCommand = require('../discord/commands/FishingModeCommand');
const DiscordPanelManager = require('../discord/panels/DiscordPanelManager');

function parseCsv(value) {
    return String(value || '').split(',').map(entry => entry.trim()).filter(Boolean);
}

function registerDiscordServices({ configuration, shared, environment = process.env, discord = null, botProfileAdmin = null }) {
    const config = configuration.registry.require('discord');
    const logger = shared.loggerFactory.create('Discord');
    const allowedUserIds = parseCsv(environment[config.allowedUserIdsEnv]);

    if (config.enabled && allowedUserIds.length === 0) {
        logger.warn(`Discord allowlist is empty (${config.allowedUserIdsEnv}); Discord controls will deny every user until configured.`);
    }

    const commands = [
        new GuiInspectionCommand({ botRegistry: shared.botRegistry, config, allowedUserIds, logger }),
        new CollectorB5ModeCommand({ botRegistry: shared.botRegistry, config, allowedUserIds, logger }),
        new FishingModeCommand({ botRegistry: shared.botRegistry, config, allowedUserIds, logger })
    ];
    const panelManager = new DiscordPanelManager({
        config,
        botRegistry: shared.botRegistry,
        allowedUserIds,
        configuration,
        environment,
        baseDir: configuration.loader.baseDir,
        logger,
        botProfileAdmin
    });

    return new DiscordService({ config, commands, panelManager, environment, logger, discord });
}

module.exports = registerDiscordServices;
