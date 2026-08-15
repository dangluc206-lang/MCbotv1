'use strict';
const path=require('node:path');
const EventBus=require('../core/EventBus');
const BotIdentity=require('../bot/BotIdentity');
const BotState=require('../bot/BotState');
const BotContext=require('../bot/BotContext');
const BotLifecycle=require('../bot/BotLifecycle');
const BotRuntime=require('../bot/BotRuntime');
const ConnectionFactory=require('../connection/ConnectionFactory');
const ConnectionManager=require('../connection/ConnectionManager');
const ReconnectManager=require('../connection/ReconnectManager');
const SessionManager=require('../connection/SessionManager');
const OperationQueue=require('../operations/OperationQueue');
const OperationLockPolicy=require('../operations/OperationLockPolicy');
const OperationTimeoutPolicy=require('../operations/OperationTimeoutPolicy');
const OperationManager=require('../operations/OperationManager');
const CommandRegistry=require('../commands/CommandRegistry');
const CommandResolver=require('../commands/CommandResolver');
const CommandGuard=require('../commands/CommandGuard');
const CommandExecutor=require('../commands/CommandExecutor');
const ResponseMatcher=require('../commands/responses/ResponseMatcher');
const CommandConfirmation=require('../commands/responses/CommandConfirmation');
const CommandService=require('../commands/CommandService');
const GuiState=require('../gui/GuiState');
const GuiRegistry=require('../gui/GuiRegistry');
const TitleMatcher=require('../gui/detection/TitleMatcher');
const LayoutMatcher=require('../gui/detection/LayoutMatcher');
const SlotFingerprintMatcher=require('../gui/detection/SlotFingerprintMatcher');
const WindowMatcher=require('../gui/detection/WindowMatcher');
const GuiDetector=require('../gui/detection/GuiDetector');
const SlotRegistry=require('../gui/slots/SlotRegistry');
const SlotResolver=require('../gui/slots/SlotResolver');
const SlotValidator=require('../gui/slots/SlotValidator');
const SlotInspector=require('../gui/slots/SlotInspector');
const ClickQueue=require('../gui/click/ClickQueue');
const ClickGuard=require('../gui/click/ClickGuard');
const ClickExecutor=require('../gui/click/ClickExecutor');
const ClickVerifier=require('../gui/click/ClickVerifier');
const GuiManager=require('../gui/GuiManager');
const GuiStructureNormalizer=require('../gui/observation/GuiStructureNormalizer');
const GuiObservationStore=require('../gui/observation/GuiObservationStore');
const GuiObservationService=require('../gui/observation/GuiObservationService');
const GuiKnowledgeRegistry=require('../gui/knowledge/GuiKnowledgeRegistry');
const MovementState=require('../movement/MovementState');
const ControlStateManager=require('../movement/ControlStateManager');
const PositionService=require('../movement/PositionService');
const RotationService=require('../movement/RotationService');
const DestinationResolver=require('../movement/navigation/DestinationResolver');
const RouteRegistry=require('../movement/navigation/RouteRegistry');
const ArrivalDetector=require('../movement/navigation/ArrivalDetector');
const RouteExecutor=require('../movement/navigation/RouteExecutor');
const SprintJumpRouteExecutor=require('../movement/navigation/SprintJumpRouteExecutor');
const NavigationManager=require('../movement/navigation/NavigationManager');
const PositionValidator=require('../movement/safety/PositionValidator');
const MovementGuard=require('../movement/safety/MovementGuard');
const MovementManager=require('../movement/MovementManager');
const InventoryReader=require('../items/inventory/InventoryReader');
const InventoryScanner=require('../items/inventory/InventoryScanner');
const InventoryCounter=require('../items/inventory/InventoryCounter');
const InventoryObservationStore=require('../items/inventory/observation/InventoryObservationStore');
const InventoryObservationService=require('../items/inventory/observation/InventoryObservationService');
const InventorySyncService=require('../items/inventory/sync/InventorySyncService');
const KhoCapacityReader=require('../server-features/storage/KhoCapacityReader');
const KhoReader=require('../server-features/storage/KhoReader');
const SellGuiReader=require('../server-features/storage/SellGuiReader');
const KhoService=require('../server-features/storage/KhoService');
const KhoSellOperation=require('../server-features/storage/KhoSellOperation');
const B1StorageMaterialService=require('../server-features/storage/B1StorageMaterialService');
const PersonalVaultReader=require('../server-features/personal-vault/PersonalVaultReader');
const PersonalVaultTransfer=require('../server-features/personal-vault/PersonalVaultTransfer');
const PersonalVaultService=require('../server-features/personal-vault/PersonalVaultService');
const MineralConversionOperation=require('../server-features/minerals/MineralConversionOperation');
const MineralService=require('../server-features/minerals/MineralService');
const SmeltingOperation=require('../server-features/smelting/SmeltingOperation');
const SmeltingService=require('../server-features/smelting/SmeltingService');
const CraftingRecipeRegistry=require('../server-features/crafting/CraftingRecipeRegistry');
const CraftingQuantityResolver=require('../server-features/crafting/CraftingQuantityResolver');
const CraftingResultVerifier=require('../server-features/crafting/CraftingResultVerifier');
const CraftingOperation=require('../server-features/crafting/CraftingOperation');
const CraftingService=require('../server-features/crafting/CraftingService');
const MaterialCalculator=require('../planning/crafting/MaterialCalculator');
const CraftingPlanner=require('../planning/crafting/CraftingPlanner');
const B5Planner=require('../planning/crafting/B5Planner');
const B5PlanningService=require('../server-features/crafting/B5PlanningService');
const B5AutomationService=require('../server-features/crafting/B5AutomationService');
const IslandTeleportOperation=require('../server-features/island/IslandTeleportOperation');
const IslandService=require('../server-features/island/IslandService');
const DungeonDestinationRegistry=require('../server-features/dungeon/DungeonDestinationRegistry');
const DungeonTeleportOperation=require('../server-features/dungeon/DungeonTeleportOperation');
const DungeonService=require('../server-features/dungeon/DungeonService');
const SkyblockJoinOperation=require('../server-features/skyblock/SkyblockJoinOperation');
const SkyblockService=require('../server-features/skyblock/SkyblockService');
const SkyblockAutoJoinService=require('../server-features/skyblock/SkyblockAutoJoinService');
const AfkAreaOccupancyParser=require('../server-features/afk/AfkAreaOccupancyParser');
const AfkAreaService=require('../server-features/afk/AfkAreaService');
const FishingService=require('../server-features/fishing/FishingService');
const ServerFeatureFacade=require('../server-features/ServerFeatureFacade');
const ServerLoginService=require('../server-features/authentication/ServerLoginService');
const ResourcePackAutoAcceptService=require('../server-features/resource-pack/ResourcePackAutoAcceptService');
const ItemInspector=require('../items/ItemInspector');
const GuiDiagnostics=require('../diagnostics/GuiDiagnostics');
const SlotDiagnostics=require('../diagnostics/SlotDiagnostics');
const ItemDiagnostics=require('../diagnostics/ItemDiagnostics');
const MovementDiagnostics=require('../diagnostics/MovementDiagnostics');
const CommandDiagnostics=require('../diagnostics/CommandDiagnostics');
const DiagnosticsManager=require('../diagnostics/DiagnosticsManager');
const GuiSnapshotSerializer=require('../diagnostics/GuiSnapshotSerializer');
const GuiInspectionService=require('../diagnostics/GuiInspectionService');
const RuntimeFailureRecorder=require('../diagnostics/runtime/RuntimeFailureRecorder');
const RuntimeFailurePublisher=require('../diagnostics/runtime/RuntimeFailurePublisher');
const CollectorB5ModeService=require('../modes/collector-b5/CollectorB5ModeService');
const FishingModeService=require('../modes/fishing/FishingModeService');
const resolveFishingConfig=require('../modes/fishing/resolveFishingConfig');
const ConnectionStateView=require('../modes/fishing/ConnectionStateView');
const ConnectionPacketObserver=require('../modes/fishing/ConnectionPacketObserver');
const FishingMovementOperation=require('../modes/fishing/FishingMovementOperation');
const FishingMovementProbeService=require('../modes/fishing/FishingMovementProbeService');
const FishingPositionGuard=require('../modes/fishing/FishingPositionGuard');
const FishingRecoveryPolicy=require('../modes/fishing/FishingRecoveryPolicy');
const FishingWorldReadinessService=require('../modes/fishing/FishingWorldReadinessService');


function resolveServerProfile(serverConfig, profile) {
    if (!serverConfig || typeof serverConfig !== 'object') {
        throw new TypeError('server configuration is required');
    }
    if (!serverConfig.profiles) return serverConfig;

    const profileName = profile.serverProfile || serverConfig.defaultProfile;
    if (!profileName || !serverConfig.profiles[profileName]) {
        throw new Error(`Server profile not found: ${profileName || '<missing>'}`);
    }

    return Object.freeze({
        ...(serverConfig.defaults || {}),
        ...serverConfig.profiles[profileName]
    });
}

function createConnectionStateBinding({ botId, state, eventBus }) {
    const unsubscribers = [];
    const on = (eventName, handler) => {
        unsubscribers.push(eventBus.on(eventName, event => {
            if (event.botId === botId) handler(event);
        }));
    };

    return {
        name: 'ConnectionStateBinding',
        async initialize() {
            on('connection:disabled', () => state.patch({ connectionState: 'DISABLED' }));
            on('connection:connecting', () => state.patch({ connectionState: 'CONNECTING', lastError: null }));
            on('connection:login', () => state.patch({ connectionState: 'LOGGED_IN', lastError: null }));
            on('connection:spawned', () => state.patch({ connectionState: 'CONNECTED', lastError: null }));
            on('server-login:started', () => state.patch({ connectionState: 'AUTHENTICATING', lastError: null }));
            on('server-login:succeeded', () => state.patch({ connectionState: 'CONNECTED', lastError: null }));
            on('server-login:failed', event => state.patch({ connectionState: 'AUTHENTICATION_FAILED', lastError: event.error || null }));
            on('connection:kicked', event => state.patch({ connectionState: 'KICKED', lastError: event.reason || null }));
            on('connection:error', event => state.patch({ lastError: event.error || null }));
            on('connection:failed', event => state.patch({ connectionState: 'DISCONNECTED', lastError: event.error || null }));
            on('connection:ended', event => state.patch({ connectionState: 'DISCONNECTED', lastError: event.reason || null }));
            on('reconnect:scheduled', () => state.patch({ connectionState: 'RECONNECTING' }));
            on('reconnect:attempting', () => state.patch({ connectionState: 'CONNECTING' }));
            on('reconnect:exhausted', event => state.patch({ connectionState: 'FAILED', lastError: event.reason || null }));
        },
        async stop() {
            for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
        },
        async destroy() {
            await this.stop();
        }
    };
}

function createMessageBinding({botId,context,eventBus}){let cleanup=[];let offSpawn=null;let offEnd=null;const clear=()=>{for(const fn of cleanup.splice(0))fn();};return{name:'ConnectionMessageBinding',async initialize(){offSpawn=eventBus.on('connection:spawned',event=>{if(event.botId!==botId)return;clear();const client=context.get();if(!client)return;const generation=context.getGeneration();const onMessage=message=>eventBus.emit('command:message',{botId,connectionGeneration:generation,message:String(message)});const onMove=()=>eventBus.emit('movement:position',{botId,connectionGeneration:generation,position:client.entity?.position});const onTeleport=()=>eventBus.emit('movement:teleport',{botId,connectionGeneration:generation,position:client.entity?.position});client.on?.('messagestr',onMessage);client.on?.('move',onMove);client.on?.('forcedMove',onTeleport);cleanup.push(()=>{client.off?.('messagestr',onMessage);client.off?.('move',onMove);client.off?.('forcedMove',onTeleport);});});offEnd=eventBus.on('connection:ended',event=>{if(event.botId===botId)clear();});},async stop(){clear();offSpawn?.();offEnd?.();offSpawn=null;offEnd=null;},async destroy(){await this.stop();}};}

function registerBotServices({profile,configuration,shared}){
 const botId=profile.id;const logger=shared.loggerFactory.create(`BotRuntime:${botId}`);const appConfig=configuration.registry.require('app');const runtimeFailureConfig=appConfig.diagnostics.runtimeFailures;const failurePolicy=appConfig.diagnostics.circuitBreaker;const server=resolveServerProfile(configuration.registry.require('server'),profile);const eventBus=new EventBus();const identity=new BotIdentity({botId,displayName:profile.displayName,username:profile.username,role:profile.role,serverProfile:profile.serverProfile});const context=new BotContext(botId);const state=new BotState();const connectionStateBinding=createConnectionStateBinding({botId,state,eventBus});
 const queue=new OperationQueue();const lockPolicy=new OperationLockPolicy();const timeoutPolicy=new OperationTimeoutPolicy();const operationManager=new OperationManager({botId,queue,lockPolicy,timeoutPolicy,logger});
 const commands=new CommandRegistry(configuration.registry.require('commands'));const commandResolver=new CommandResolver({registry:commands});const commandGuard=new CommandGuard({context,minimumIntervalMs:appConfig.commandIntervalMs||250});const commandExecutor=new CommandExecutor({context,guard:commandGuard});const responseMatcher=new ResponseMatcher();const confirmation=new CommandConfirmation({eventBus,matcher:responseMatcher});const commandService=new CommandService({botId,resolver:commandResolver,executor:commandExecutor,confirmation,responseRules:configuration.registry.require('commandResponses')});
 const guiState=new GuiState();const guiRegistry=new GuiRegistry(configuration.registry.require('guiWindows'));const titleMatcher=new TitleMatcher();const layoutMatcher=new LayoutMatcher();const fingerprintMatcher=new SlotFingerprintMatcher({itemResolver:shared.itemResolver});const windowMatcher=new WindowMatcher({titleMatcher,layoutMatcher,fingerprintMatcher});const detector=new GuiDetector({registry:guiRegistry,windowMatcher});const slotRegistry=new SlotRegistry(configuration.registry.require('guiSlots'));const slotResolver=new SlotResolver({slotRegistry,itemResolver:shared.itemResolver});const slotValidator=new SlotValidator();const slotInspector=new SlotInspector({normalizer:shared.itemNormalizer});const clickQueue=new ClickQueue();const clickGuard=new ClickGuard({context,slotValidator});const clickExecutor=new ClickExecutor({context});const clickVerifier=new ClickVerifier({eventBus});const guiManager=new GuiManager({botId,context,state:guiState,detector,clickQueue,clickGuard,clickExecutor,clickVerifier,eventBus,logger});
 const observationConfig=configuration.registry.require('guiObservation');const guiNormalizer=new GuiStructureNormalizer({itemNormalizer:shared.itemNormalizer});const guiObservationStore=new GuiObservationStore({baseDir:path.resolve(configuration.loader.baseDir,observationConfig.directory),botId,logger});const recipeDefinitionsForLearning=configuration.registry.require('recipes');const guiBootstrapMappings=[{recordKeys:['ks__menu_crafting','ks__slot-16'],entries:Object.entries(recipeDefinitionsForLearning).map(([id,recipe])=>({roleId:`recipe:${id}`,logicalItemId:recipe.menuItemId,bootstrapSlot:recipe.menuSlot}))}];const guiKnowledge=observationConfig.enabled===false?null:new GuiKnowledgeRegistry({botId,normalizer:guiNormalizer,store:guiObservationStore,itemResolver:shared.itemResolver,bootstrapMappings:guiBootstrapMappings,logger});const guiObservationService=observationConfig.enabled===false?null:new GuiObservationService({botId,eventBus,guiManager,knowledgeRegistry:guiKnowledge,debounceMs:observationConfig.debounceMs,logger});
 const movementState=new MovementState();const controlStateManager=new ControlStateManager({context});const positionService=new PositionService({context});const rotationService=new RotationService({context});const destinationResolver=new DestinationResolver(configuration.registry.require('locations'));const routeRegistry=new RouteRegistry(configuration.registry.require('routes'));const arrivalDetector=new ArrivalDetector({positionService});const routeExecutor=new RouteExecutor({context,arrivalDetector});const sprintJumpExecutor=new SprintJumpRouteExecutor({context,controlStateManager,rotationService,positionService,logger});const navigationManager=new NavigationManager({destinationResolver,routeExecutor,state:movementState});const positionValidator=new PositionValidator();const movementGuard=new MovementGuard({positionValidator,lockPolicy});const movementManager=new MovementManager({navigationManager,controlStateManager,guard:movementGuard,sprintJumpExecutor});
 const inventoryReader=new InventoryReader({botId,context,normalizer:shared.itemNormalizer,logger});const inventoryScanner=new InventoryScanner({resolver:shared.itemResolver,guiKnowledge});const inventoryCounter=new InventoryCounter({scanner:inventoryScanner});const inventoryObservationConfig=configuration.registry.require('inventoryObservation');const inventoryObservationStore=new InventoryObservationStore({baseDir:path.resolve(configuration.loader.baseDir,inventoryObservationConfig.directory||'data/runtime/inventory'),botId,logger});const inventoryObservationService=inventoryObservationConfig.enabled===false?null:new InventoryObservationService({botId,context,eventBus,reader:inventoryReader,store:inventoryObservationStore,normalizer:shared.itemNormalizer,debounceMs:inventoryObservationConfig.debounceMs,historyLimit:inventoryObservationConfig.historyLimit||300,logger});const inventorySyncService=new InventorySyncService({botId,context,reader:inventoryReader,observation:inventoryObservationService,logger,config:inventoryObservationConfig.postActionSync||{}});
 const storageConfig=configuration.registry.require('storage');const capacityReader=new KhoCapacityReader({itemResolver:shared.itemResolver,config:storageConfig});const khoReader=new KhoReader({itemResolver:shared.itemResolver,capacityReader,config:storageConfig});const sellGuiReader=new SellGuiReader({itemResolver:shared.itemResolver,config:storageConfig});const khoSellOperation=new KhoSellOperation({commandService,guiManager,reader:sellGuiReader,config:storageConfig,logger});const storage=new KhoService({commandService,guiManager,reader:khoReader,sellOperation:khoSellOperation,config:storageConfig,guiKnowledge,logger});
 const pvConfig=configuration.registry.require('personalVault');const pvReader=new PersonalVaultReader({itemResolver:shared.itemResolver,guiKnowledge,normalizer:shared.itemNormalizer,storageSlots:pvConfig.storageSlots});const pvTransfer=new PersonalVaultTransfer({guiManager,itemResolver:shared.itemResolver,guiKnowledge,storageSlots:pvConfig.storageSlots,logger});const personalVault=new PersonalVaultService({commandService,guiManager,reader:pvReader,transfer:pvTransfer,config:pvConfig,guiKnowledge,inventoryReader,inventoryCounter,logger});
 const mineralConfig=configuration.registry.require('minerals');const mineralConversionConfig=configuration.registry.require('mineralConversions');const mineralOperation=new MineralConversionOperation({commandService,guiManager,itemResolver:shared.itemResolver,guiKnowledge,config:mineralConfig,conversionConfig:mineralConversionConfig,logger});const minerals=new MineralService({operation:mineralOperation});
 const smeltingConfig=configuration.registry.require('smelting');const smeltingOperation=new SmeltingOperation({commandService,guiManager,itemResolver:shared.itemResolver,guiKnowledge,config:smeltingConfig,logger});const smelting=new SmeltingService({operation:smeltingOperation});const b1Materials=new B1StorageMaterialService({storage,minerals,smelting,conversionConfig:mineralConversionConfig,smeltingConfig,recipeConfig:recipeDefinitionsForLearning,targetId:configuration.registry.require('b5').targetId,logger});
 const recipeRegistry=new CraftingRecipeRegistry(configuration.registry.require('recipes'));const quantityResolver=new CraftingQuantityResolver(mineralConfig.crafting||{});const resultVerifier=new CraftingResultVerifier({inventoryReader,inventoryCounter,guiKnowledge,inventoryObservation:inventoryObservationService,inventorySync:inventorySyncService});const craftingOperation=new CraftingOperation({commandService,guiManager,context,itemResolver:shared.itemResolver,recipeRegistry,quantityResolver,resultVerifier,guiKnowledge,config:mineralConfig.crafting||{},logger});const crafting=new CraftingService({operation:craftingOperation});const materialCalculator=new MaterialCalculator({recipeRegistry});const craftingPlanner=new CraftingPlanner({recipeRegistry,materialCalculator});const craftingTiers=configuration.registry.require('craftingTiers');const b5Config=configuration.registry.require('b5');const b5Planner=new B5Planner({planner:craftingPlanner,targetId:b5Config.targetId,tiers:craftingTiers});const b5Planning=new B5PlanningService({storage,personalVault,inventoryReader,inventoryCounter,b5Planner,materialCalculator,recipeRegistry,tiers:craftingTiers,b1Materials,config:b5Config,guiDataMaxAgeMs:Number(observationConfig.semanticCacheMs||5000)});const b5Automation=new B5AutomationService({planningService:b5Planning,crafting,personalVault,storage,b1Materials,inventoryReader,inventoryCounter,recipeRegistry,operationManager,config:b5Config,logger});
 const connectionStateView=new ConnectionStateView({context});const islandConfig=configuration.registry.require('island');const islandOperation=new IslandTeleportOperation({commandService,positionService,eventBus,connectionState:connectionStateView,botId,config:islandConfig});const island=new IslandService({operation:islandOperation});
 const dungeonConfig=configuration.registry.require('dungeon');const destinations=new DungeonDestinationRegistry(dungeonConfig.destinations||{});const dungeonOperation=new DungeonTeleportOperation({botId,commandService,guiManager,itemResolver:shared.itemResolver,guiKnowledge,destinations,eventBus,lockPolicy,config:dungeonConfig});const dungeon=new DungeonService({operation:dungeonOperation});
 const skyblockConfig=configuration.registry.require('skyblock');const skyblockOperation=new SkyblockJoinOperation({botId,commandService,guiManager,guiKnowledge,eventBus,lockPolicy,config:skyblockConfig});const skyblock=new SkyblockService({operation:skyblockOperation});const skyblockAutoJoin=new SkyblockAutoJoinService({botId,eventBus,skyblock,config:skyblockConfig.autoJoin||{},dailyRecovery:configuration.registry.require('dailyRecovery'),logger});
 const sessionManager=new SessionManager({botId});const connectionFactory=new ConnectionFactory({botFactory:shared.botFactory});const resourcePackAutoAccept=new ResourcePackAutoAcceptService({botId,context,eventBus,config:configuration.registry.require('resourcePack'),logger});const serverLoginService=new ServerLoginService({botId,context,eventBus,commandService,password:profile.password,config:configuration.registry.require('serverLogin'),logger});const connectionManager=new ConnectionManager({botId,context,sessionManager,connectionFactory,profile,server,eventBus,logger,attemptCoordinator:shared.connectionAttempts,readyTimeoutMs:profile.readyTimeoutMs||30000});const reconnectManager=new ReconnectManager({botId,connectionManager,eventBus,policy:profile.reconnect||{},dailyRecovery:configuration.registry.require('dailyRecovery'),attemptCoordinator:shared.connectionAttempts,logger});const messageBinding=createMessageBinding({botId,context,eventBus});
 const fishingConfig=resolveFishingConfig(configuration.registry.require('fishingMode'),profile.fishing||{});const afkOccupancyParser=new AfkAreaOccupancyParser({itemNormalizer:shared.itemNormalizer,config:fishingConfig});const afkAreas=new AfkAreaService({botId,context,commandService,guiManager,eventBus,positionService,occupancyParser:afkOccupancyParser,config:fishingConfig,logger});const fishing=new FishingService({context,rotationService,config:fishingConfig,logger});const fishingPacketObserver=new ConnectionPacketObserver({botId,context,eventBus,config:fishingConfig,logger});const fishingPositionGuard=new FishingPositionGuard({positionService,connectionState:connectionStateView,config:fishingConfig});const fishingWorldReadiness=new FishingWorldReadinessService({context,connectionState:connectionStateView,config:fishingConfig,logger});const fishingMovement=new FishingMovementOperation({botId,context,connectionState:connectionStateView,operationManager,controlStateManager,rotationService,positionService,config:fishingConfig,logger});const fishingMovementProbe=new FishingMovementProbeService({movementOperation:fishingMovement,connectionState:connectionStateView,config:fishingConfig,logger});const fishingRecoveryPolicy=new FishingRecoveryPolicy({config:fishingConfig});
 const serverFeatureFacade=new ServerFeatureFacade({storage,personalVault,minerals,smelting,crafting,b5Planning,b5Automation,island,dungeon,skyblock,afkAreas,fishing});
 const runtimeFailurePublisher=new RuntimeFailurePublisher({botId,eventBus,connectionAggregationMs:runtimeFailureConfig.connectionAggregationMs,logger});const collectorB5Config=configuration.registry.require('collectorB5Mode');const collectorB5Mode=new CollectorB5ModeService({botId,context,eventBus,island,skyblock,movementManager,positionService,b1Materials,b5Planning,b5Automation,failurePublisher:runtimeFailurePublisher,failurePolicy,config:collectorB5Config,dailyRecovery:configuration.registry.require('dailyRecovery'),logger});const fishingMode=new FishingModeService({botId,eventBus,connectionState:connectionStateView,connectionControl:connectionManager,afkAreas,fishing,island,movement:fishingMovement,movementProbe:fishingMovementProbe,positionGuard:fishingPositionGuard,worldReadiness:fishingWorldReadiness,recoveryPolicy:fishingRecoveryPolicy,collectorB5Mode,failurePublisher:runtimeFailurePublisher,failurePolicy,config:fishingConfig,logger});
 const itemInspector=new ItemInspector({normalizer:shared.itemNormalizer,resolver:shared.itemResolver});const guiSnapshotSerializer=new GuiSnapshotSerializer();const guiInspectionService=new GuiInspectionService({botId,context,eventBus,commandService,guiManager,serializer:guiSnapshotSerializer,lockPolicy,observationService:guiObservationService,logger});const runtimeFailureRecorder=new RuntimeFailureRecorder({botId,eventBus,baseDir:path.resolve(configuration.loader.baseDir,runtimeFailureConfig.directory),config:runtimeFailureConfig,guiManager,inventoryObservationService,logger});const diagnostics=new DiagnosticsManager({gui:new GuiDiagnostics({guiManager}),slots:new SlotDiagnostics({slotInspector,guiManager}),items:new ItemDiagnostics({itemInspector}),movement:new MovementDiagnostics({movementState,positionService}),commands:new CommandDiagnostics({commandRegistry:commands})});
 const lifecycleComponents=[connectionStateBinding,messageBinding,guiManager];if(guiKnowledge)lifecycleComponents.push(guiKnowledge);if(guiObservationService)lifecycleComponents.push(guiObservationService);if(inventoryObservationService)lifecycleComponents.push(inventoryObservationService);lifecycleComponents.push(runtimeFailurePublisher,runtimeFailureRecorder,reconnectManager,resourcePackAutoAccept,serverLoginService,skyblockAutoJoin,connectionManager,operationManager,movementManager,fishingPacketObserver,fishingMovement,collectorB5Mode,fishingMode);const lifecycle=new BotLifecycle(lifecycleComponents,{logger});
 return new BotRuntime({identity,context,state,lifecycleCoordinator:lifecycle,logger,services:{eventBus,connectionManager,commandService,resourcePackAutoAccept,serverLoginService,guiManager,guiKnowledge,guiObservationService,guiInspectionService,movementManager,operationManager,inventoryReader,inventoryCounter,inventoryObservationService,inventorySyncService,runtimeFailurePublisher,runtimeFailureRecorder,serverFeatureFacade,b1Materials,b5Planning,b5Automation,collectorB5Mode,fishingMode,afkAreas,fishing,connectionStateView,fishingPacketObserver,fishingMovement,fishingMovementProbe,fishingPositionGuard,fishingWorldReadiness,fishingRecoveryPolicy,skyblockAutoJoin,diagnostics,slotResolver,routeRegistry}});
}
module.exports=registerBotServices;
