'use strict';

const path = require('node:path');
const loadConfiguration = require('../src/bootstrap/loadConfiguration');
const loadBotProfiles = require('../src/bootstrap/loadBotProfiles');

async function main() {
    const baseDir = path.resolve(__dirname, '..');
    const configuration = await loadConfiguration({ baseDir });
    const profiles = await loadBotProfiles({
        loader: configuration.loader,
        validator: configuration.validator,
        directory: 'config/bots'
    });
    configuration.crossValidator.assertValid(configuration.registry.snapshot(), { botProfiles: profiles });

    const groupCount = configuration.registry.keys().length;
    console.log(`Loaded ${groupCount} configuration groups.`);
    console.log(`Schema validation: ${configuration.validation.schemas}/${configuration.specs.length} PASS.`);
    console.log(`Cross-reference validation: PASS (${profiles.length} bot profiles).`);
    for (const key of configuration.registry.keys()) console.log(`- ${key}`);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
