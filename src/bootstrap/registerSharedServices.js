'use strict';
const LoggerFactory=require('../shared/logger/LoggerFactory');
const RuntimeLogOutput=require('../shared/logger/RuntimeLogOutput');
const EventBus=require('../core/EventBus');
const KeyedMutationCoordinator=require('../core/KeyedMutationCoordinator');
const BotRegistry=require('../bot/BotRegistry');
const BotFactory=require('../bot/BotFactory');
const ItemRegistry=require('../items/ItemRegistry');
const ItemNormalizer=require('../items/ItemNormalizer');
const NameMatcher=require('../items/matching/NameMatcher');
const LoreMatcher=require('../items/matching/LoreMatcher');
const NbtMatcher=require('../items/matching/NbtMatcher');
const MaterialMatcher=require('../items/matching/MaterialMatcher');
const IdentityMatcher=require('../items/matching/IdentityMatcher');
const CompositeItemMatcher=require('../items/matching/CompositeItemMatcher');
const ItemMatcher=require('../items/matching/ItemMatcher');
const ItemResolver=require('../items/ItemResolver');
const ConnectionAttemptCoordinator=require('../connection/ConnectionAttemptCoordinator');
const createServerProfileRegistry=require('../server-profiles/createServerProfileRegistry');

function registerSharedServices({configuration,output=null,clientFactory=null}){
    const app=configuration.registry.require('app');
    let loggerOutput=output;
    let runtimeLogOutput=null;
    let minimumLevel=process.env.LOG_LEVEL||app.logLevel||'info';
    if(!loggerOutput){
        runtimeLogOutput=new RuntimeLogOutput({baseDir:configuration.loader.baseDir,app});
        loggerOutput=record=>runtimeLogOutput.write(record);
        minimumLevel=runtimeLogOutput.minimumLevel;
    }
    const loggerFactory=new LoggerFactory({minimumLevel,output:loggerOutput});
    const eventBus=new EventBus();const botRegistry=new BotRegistry();const serverProfiles=createServerProfileRegistry(configuration.registry.require('server'),{commands:configuration.registry.require('commands'),commandResponses:configuration.registry.require('commandResponses'),skyCommands:configuration.registry.require('skyCommands'),authentication:configuration.registry.require('serverLogin'),join:configuration.registry.require('skyblock'),guiWindows:configuration.registry.require('guiWindows'),guiIdentity:configuration.registry.require('guiIdentity'),guiSlots:configuration.registry.require('guiSlots'),items:configuration.registry.require('items'),recipes:configuration.registry.require('recipes'),craftingTiers:configuration.registry.require('craftingTiers'),storage:configuration.registry.require('storage'),personalVault:configuration.registry.require('personalVault'),minerals:configuration.registry.require('minerals'),mineralConversions:configuration.registry.require('mineralConversions'),smelting:configuration.registry.require('smelting'),serverTimings:{postB5CooldownMs:configuration.registry.require('b5CraftMode').postB5CooldownMs}});const botFactory=new BotFactory({clientFactory});const multiBot=app?.multiBot||{};const connectionAttempts=new ConnectionAttemptCoordinator({minSpacingMs:Number(multiBot.connectionStartSpacingMs ?? 10000),postSuccessSpacingMs:Number(multiBot.postSuccessSpacingMs ?? multiBot.connectionStartSpacingMs ?? 10000),transientFailureCooldownMs:Number(multiBot.transientFailureCooldownMs ?? 15000),connectionResetCooldownMs:Number(multiBot.connectionResetCooldownMs ?? 20000),lostConnectionCooldownMs:Number(multiBot.lostConnectionCooldownMs ?? 20000),loginTooFastCooldownMs:Number(multiBot.loginTooFastCooldownMs ?? 30000),logger:loggerFactory.create('ConnectionAttempts')});const itemRegistry=new ItemRegistry(configuration.registry.require('items'));const itemNormalizer=new ItemNormalizer();const composite=new CompositeItemMatcher({name:new NameMatcher(),lore:new LoreMatcher(),nbt:new NbtMatcher(),material:new MaterialMatcher(),identity:new IdentityMatcher()});const itemMatcher=new ItemMatcher({normalizer:itemNormalizer,composite});const itemResolver=new ItemResolver({registry:itemRegistry,matcher:itemMatcher});const configMutations=new KeyedMutationCoordinator({name:'ConfigMutationCoordinator',logger:loggerFactory.create('ConfigMutations')});return{loggerFactory,eventBus,botRegistry,botFactory,itemRegistry,itemNormalizer,itemResolver,connectionAttempts,runtimeLogOutput,serverProfiles,configMutations};
}
module.exports=registerSharedServices;
