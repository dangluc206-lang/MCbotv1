'use strict';
const path=require('node:path');
const ConfigLoader=require('../configuration/ConfigLoader');
const ConfigRegistry=require('../configuration/ConfigRegistry');
const ConfigValidator=require('../configuration/ConfigValidator');
const ConfigResolver=require('../configuration/ConfigResolver');
const ConfigurationService=require('../configuration/ConfigurationService');
const appSchema=require('../configuration/schemas/app.schema');
const botSchema=require('../configuration/schemas/bot.schema');
const serverSchema=require('../configuration/schemas/server.schema');
const guiSchema=require('../configuration/schemas/gui.schema');
const movementSchema=require('../configuration/schemas/movement.schema');
const commandsSchema=require('../configuration/schemas/commands.schema');
const itemsSchema=require('../configuration/schemas/items.schema');
const discordSchema=require('../configuration/schemas/discord.schema');
const fishingSchema=require('../configuration/schemas/fishing.schema');
async function loadConfiguration({baseDir=process.cwd(),logger=null}={}){const loader=new ConfigLoader({baseDir});const registry=new ConfigRegistry();const validator=new ConfigValidator({app:appSchema,bot:botSchema,server:serverSchema,gui:guiSchema,movement:movementSchema,commands:commandsSchema,items:itemsSchema,discord:discordSchema,fishing:fishingSchema});const service=new ConfigurationService({loader,validator,registry,logger});const specs=[['app','config/app.json','app'],['server','config/server.json','server'],['commands','config/commands/commands.json','commands'],['commandResponses','config/commands/responses.json',null],['serverLogin','config/authentication/login.json',null],['resourcePack','config/resource-pack/resource-pack.json',null],['discord','config/discord/discord.json','discord'],['guiWindows','config/gui/windows.json','gui'],['guiSlots','config/gui/slots.json','gui'],['guiObservation','config/gui/observation.json',null],['inventoryObservation','config/inventory/observation.json',null],['movement','config/movement/movement.json','movement'],['locations','config/movement/locations.json',null],['routes','config/movement/routes.json',null],['items','config/items/items.json','items'],['storage','config/storage/kho.json',null],['personalVault','config/personal-vault/pv2.json',null],['minerals','config/minerals/menu.json',null],['mineralConversions','config/minerals/conversions.json',null],['smelting','config/smelting/recipes.json',null],['island','config/island/island.json',null],['dungeon','config/dungeon/destinations.json',null],['skyblock','config/skyblock/join.json',null],['recipes','config/server-data/recipes.json',null],['craftingTiers','config/server-data/crafting-tiers.json',null],['b5','config/server-data/b5.json',null],['collectorB5Mode','config/modes/collector-b5.json',null],['fishingMode','config/modes/fishing.json','fishing'],['dailyRecovery','config/recovery/daily.json',null]];for(const [key,file,schema] of specs){const result=await service.load(key,path.join(baseDir,file),schema);if(!result.success)throw result.error;}return{loader,registry,validator,resolver:new ConfigResolver(registry),service};}
module.exports=loadConfiguration;
