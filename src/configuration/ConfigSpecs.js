'use strict';

const SPECS = [
    ['app', 'config/app.json', 'app'],
    ['server', 'config/server.json', 'server'],
    ['commands', 'config/commands/commands.json', 'commands'],
    ['skyCommands', 'config/commands/sky-commands.json', 'skyCommands'],
    ['commandResponses', 'config/commands/responses.json', 'commandResponses'],
    ['serverLogin', 'config/authentication/login.json', 'serverLogin'],
    ['resourcePack', 'config/resource-pack/resource-pack.json', 'resourcePack'],
    ['discord', 'config/discord/discord.json', 'discord'],
    ['guiWindows', 'config/gui/windows.json', 'guiWindows'],
    ['guiIdentity', 'config/gui/identity.json', 'guiIdentity'],
    ['guiSlots', 'config/gui/slots.json', 'guiSlots'],
    ['guiObservation', 'config/gui/observation.json', 'guiObservation'],
    ['inventoryObservation', 'config/inventory/observation.json', 'inventoryObservation'],
    ['movement', 'config/movement/movement.json', 'movement'],
    ['locations', 'config/movement/locations.json', 'locations'],
    ['routes', 'config/movement/routes.json', 'routes'],
    ['items', 'config/items/items.json', 'items'],
    ['storage', 'config/storage/kho.json', 'storage'],
    ['personalVault', 'config/personal-vault/pv2.json', 'personalVault'],
    ['minerals', 'config/minerals/menu.json', 'minerals'],
    ['mineralConversions', 'config/minerals/conversions.json', 'mineralConversions'],
    ['smelting', 'config/smelting/recipes.json', 'smelting'],
    ['island', 'config/island/island.json', 'island'],
    ['dungeon', 'config/dungeon/destinations.json', 'dungeon'],
    ['skyblock', 'config/skyblock/join.json', 'skyblock'],
    ['recipes', 'config/server-data/recipes.json', 'recipes'],
    ['craftingTiers', 'config/server-data/crafting-tiers.json', 'craftingTiers'],
    ['b5', 'config/server-data/b5.json', 'b5'],
    ['collectorB5Mode', 'config/modes/collector-b5.json', 'collectorB5Mode'],
    ['b5CraftMode', 'config/modes/b5-craft.json', 'b5CraftMode'],
    ['fishingMode', 'config/modes/fishing.json', 'fishing'],
    ['dailyRecovery', 'config/recovery/daily.json', 'dailyRecovery']
].map(([key, file, schema]) => Object.freeze({ key, file, schema }));

module.exports = Object.freeze(SPECS);
