'use strict';

const ConfigLoader = require('../configuration/ConfigLoader');
const ConfigRegistry = require('../configuration/ConfigRegistry');
const ConfigValidator = require('../configuration/ConfigValidator');
const ConfigResolver = require('../configuration/ConfigResolver');
const ConfigurationService = require('../configuration/ConfigurationService');
const ConfigurationContractValidator = require('../configuration/ConfigurationContractValidator');
const ConfigSpecs = require('../configuration/ConfigSpecs');
const appSchema = require('../configuration/schemas/app.schema');
const botSchema = require('../configuration/schemas/bot.schema');
const serverSchema = require('../configuration/schemas/server.schema');
const discordSchema = require('../configuration/schemas/discord.schema');
const fishingSchema = require('../configuration/schemas/fishing.schema');
const groupSchemas = require('../configuration/schemas/group.schemas');

async function loadConfiguration({ baseDir = process.cwd(), logger = null } = {}) {
    const loader = new ConfigLoader({ baseDir });
    const registry = new ConfigRegistry();
    const validator = new ConfigValidator({
        app: appSchema,
        bot: botSchema,
        server: serverSchema,
        discord: discordSchema,
        fishing: fishingSchema,
        ...groupSchemas
    });
    const crossValidator = new ConfigurationContractValidator();
    const service = new ConfigurationService({
        loader,
        validator,
        registry,
        crossValidator,
        specs: ConfigSpecs,
        logger
    });
    const result = await service.loadAll(ConfigSpecs);
    if (!result.success) throw result.error;

    return {
        loader,
        registry,
        validator,
        crossValidator,
        resolver: new ConfigResolver(registry),
        service,
        specs: ConfigSpecs,
        validation: result.meta
    };
}

module.exports = loadConfiguration;
