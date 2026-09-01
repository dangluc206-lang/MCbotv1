"use strict";
const path = require("node:path");
const EventBus = require("../core/EventBus");
const HealthRegistry = require("../core/HealthRegistry");
const RuntimePlatformService = require("../core/RuntimePlatformService");
const CapabilityRegistry = require("../core/registry/CapabilityRegistry");
const CapabilityInstaller = require("./installers/CapabilityInstaller");
const RuntimePlatformInstaller = require("./installers/RuntimePlatformInstaller");
const LifecycleInstaller = require("./installers/LifecycleInstaller");
const createConnectionStateBinding = require("./createConnectionStateBinding");
const createConnectionEventBinding = require("./createConnectionEventBinding");
const BotIdentity = require("../bot/BotIdentity");
const BotState = require("../bot/BotState");
const BotContext = require("../bot/BotContext");
const BotLifecycle = require("../bot/BotLifecycle");
const BotRuntime = require("../bot/BotRuntime");
const ConnectionFactory = require("../connection/ConnectionFactory");
const ConnectionManager = require("../connection/ConnectionManager");
const ReconnectManager = require("../connection/ReconnectManager");
const SessionManager = require("../connection/SessionManager");
const BotOperationInstaller = require("./installers/BotOperationInstaller");
const CommandRegistry = require("../commands/CommandRegistry");
const CommandResolver = require("../commands/CommandResolver");
const CommandGuard = require("../commands/CommandGuard");
const CommandExecutor = require("../commands/CommandExecutor");
const SlashCommandService = require("../commands/SlashCommandService");
const SkyCommandService = require("../commands/sky/SkyCommandService");
const ResponseMatcher = require("../commands/responses/ResponseMatcher");
const CommandConfirmation = require("../commands/responses/CommandConfirmation");
const CommandService = require("../commands/CommandService");
const GuiState = require("../gui/GuiState");
const GuiRegistry = require("../gui/GuiRegistry");
const TitleMatcher = require("../gui/detection/TitleMatcher");
const LayoutMatcher = require("../gui/detection/LayoutMatcher");
const SlotFingerprintMatcher = require("../gui/detection/SlotFingerprintMatcher");
const WindowMatcher = require("../gui/detection/WindowMatcher");
const GuiDetector = require("../gui/detection/GuiDetector");
const GuiIdentityEngine = require("../gui/identity/GuiIdentityEngine");
const SlotRegistry = require("../gui/slots/SlotRegistry");
const SlotResolver = require("../gui/slots/SlotResolver");
const SlotValidator = require("../gui/slots/SlotValidator");
const SlotInspector = require("../gui/slots/SlotInspector");
const ClickQueue = require("../gui/click/ClickQueue");
const ClickGuard = require("../gui/click/ClickGuard");
const ClickExecutor = require("../gui/click/ClickExecutor");
const ClickVerifier = require("../gui/click/ClickVerifier");
const GuiManager = require("../gui/GuiManager");
const GuiStructureNormalizer = require("../gui/observation/GuiStructureNormalizer");
const GuiObservationStore = require("../gui/observation/GuiObservationStore");
const GuiObservationService = require("../gui/observation/GuiObservationService");
const GuiKnowledgeRegistry = require("../gui/knowledge/GuiKnowledgeRegistry");
const MovementState = require("../movement/MovementState");
const ControlStateManager = require("../movement/ControlStateManager");
const PositionService = require("../movement/PositionService");
const RotationService = require("../movement/RotationService");
const DestinationResolver = require("../movement/navigation/DestinationResolver");
const RouteRegistry = require("../movement/navigation/RouteRegistry");
const ArrivalDetector = require("../movement/navigation/ArrivalDetector");
const RouteExecutor = require("../movement/navigation/RouteExecutor");
const SprintJumpRouteExecutor = require("../movement/navigation/SprintJumpRouteExecutor");
const NavigationManager = require("../movement/navigation/NavigationManager");
const PositionValidator = require("../movement/safety/PositionValidator");
const MovementGuard = require("../movement/safety/MovementGuard");
const MovementManager = require("../movement/MovementManager");
const ItemRegistry = require("../items/ItemRegistry");
const ItemResolver = require("../items/ItemResolver");
const InventoryReader = require("../items/inventory/InventoryReader");
const InventoryScanner = require("../items/inventory/InventoryScanner");
const InventoryCounter = require("../items/inventory/InventoryCounter");
const InventoryObservationStore = require("../items/inventory/observation/InventoryObservationStore");
const InventoryObservationService = require("../items/inventory/observation/InventoryObservationService");
const InventorySyncService = require("../items/inventory/sync/InventorySyncService");
const KhoCapacityReader = require("../server-features/storage/KhoCapacityReader");
const KhoReader = require("../server-features/storage/KhoReader");
const SellGuiReader = require("../server-features/storage/SellGuiReader");
const KhoService = require("../server-features/storage/KhoService");
const KhoSellOperation = require("../server-features/storage/KhoSellOperation");
const KhoWithdrawOperation = require("../server-features/storage/KhoWithdrawOperation");
const B1StorageMaterialService = require("../server-features/storage/B1StorageMaterialService");
const PersonalVaultReader = require("../server-features/personal-vault/PersonalVaultReader");
const PersonalVaultTransfer = require("../server-features/personal-vault/PersonalVaultTransfer");
const PersonalVaultService = require("../server-features/personal-vault/PersonalVaultService");
const MineralConversionOperation = require("../server-features/minerals/MineralConversionOperation");
const MineralService = require("../server-features/minerals/MineralService");
const SmeltingOperation = require("../server-features/smelting/SmeltingOperation");
const SmeltingService = require("../server-features/smelting/SmeltingService");
const CraftingRecipeRegistry = require("../server-features/crafting/CraftingRecipeRegistry");
const CraftingQuantityResolver = require("../server-features/crafting/CraftingQuantityResolver");
const CraftingResultVerifier = require("../server-features/crafting/CraftingResultVerifier");
const CraftingOperation = require("../server-features/crafting/CraftingOperation");
const CraftingService = require("../server-features/crafting/CraftingService");
const MaterialCalculator = require("../planning/crafting/MaterialCalculator");
const CraftingPlanner = require("../planning/crafting/CraftingPlanner");
const B5Planner = require("../planning/crafting/B5Planner");
const B5ExecutionPlanner = require("../planning/crafting/B5ExecutionPlanner");
const B5PlanningService = require("../server-features/crafting/B5PlanningService");
const B5TraceRecorder = require("../server-features/crafting/b5/trace/B5TraceRecorder");
const B5AutomationService = require("../server-features/crafting/B5AutomationService");
const B5AutomationRuntimeDecorator = require("../server-features/crafting/B5AutomationRuntimeDecorator");
const IslandTeleportOperation = require("../server-features/island/IslandTeleportOperation");
const IslandService = require("../server-features/island/IslandService");
const DungeonDestinationRegistry = require("../server-features/dungeon/DungeonDestinationRegistry");
const DungeonTeleportOperation = require("../server-features/dungeon/DungeonTeleportOperation");
const DungeonService = require("../server-features/dungeon/DungeonService");
const SkyblockJoinOperation = require("../server-features/skyblock/SkyblockJoinOperation");
const SkyblockService = require("../server-features/skyblock/SkyblockService");
const SkyblockAutoJoinService = require("../server-features/skyblock/SkyblockAutoJoinService");
const AfkAreaOccupancyParser = require("../server-features/afk/AfkAreaOccupancyParser");
const AfkAreaService = require("../server-features/afk/AfkAreaService");
const FishingService = require("../server-features/fishing/FishingService");
const ServerFeatureFacade = require("../server-features/ServerFeatureFacade");
const ServerLoginService = require("../server-features/authentication/ServerLoginService");
const ResourcePackAutoAcceptService = require("../server-features/resource-pack/ResourcePackAutoAcceptService");
const ItemInspector = require("../items/ItemInspector");
const GuiDiagnostics = require("../diagnostics/GuiDiagnostics");
const SlotDiagnostics = require("../diagnostics/SlotDiagnostics");
const ItemDiagnostics = require("../diagnostics/ItemDiagnostics");
const MovementDiagnostics = require("../diagnostics/MovementDiagnostics");
const CommandDiagnostics = require("../diagnostics/CommandDiagnostics");
const DiagnosticsManager = require("../diagnostics/DiagnosticsManager");
const GuiSnapshotSerializer = require("../diagnostics/GuiSnapshotSerializer");
const GuiInspectionService = require("../diagnostics/GuiInspectionService");
const RuntimeFailureRecorder = require("../diagnostics/runtime/RuntimeFailureRecorder");
const RuntimeFailurePublisher = require("../diagnostics/runtime/RuntimeFailurePublisher");
const { RuntimeWorkloadMetrics } = require("../diagnostics/metrics/RuntimeWorkloadMetrics");
const ModeCoordinator = require("../modes/ModeCoordinator");
const RuntimeModeRegistry = require("../modes/RuntimeModeRegistry");
const LegacyModeAdapter = require("../modes/legacy/LegacyModeAdapter");
const ModeControlService = require("../modes/ModeControlService");
const ModeContext = require("../modes/ModeContext");
const ModeSdk = require("../modes/ModeSdk");
const CollectorB5ModeService = require("../modes/collector-b5/CollectorB5ModeService");
const B5CraftModeService = require("../modes/b5-craft/B5CraftModeService");
const ComposableModeService = require("../modes/composable/ComposableModeService");
const FishingModeService = require("../modes/fishing/FishingModeService");
const resolveFishingConfig = require("../modes/fishing/resolveFishingConfig");
const ConnectionStateView = require("../modes/fishing/ConnectionStateView");
const ConnectionPacketObserver = require("../modes/fishing/ConnectionPacketObserver");
const FishingMovementOperation = require("../modes/fishing/FishingMovementOperation");
const FishingMovementProbeService = require("../modes/fishing/FishingMovementProbeService");
const FishingPositionGuard = require("../modes/fishing/FishingPositionGuard");
const FishingRecoveryPolicy = require("../modes/fishing/FishingRecoveryPolicy");
const FishingWorldReadinessService = require("../modes/fishing/FishingWorldReadinessService");
const CraftingVerificationService = require("../server-features/crafting/CraftingVerificationService");

function registerBotServices({ profile, configuration, shared }) {
  const botId = profile.id;
  const logger = shared.loggerFactory.create(`BotRuntime:${botId}`);
  const workloadMetrics = new RuntimeWorkloadMetrics();
  const appConfig = configuration.registry.require("app");
  const runtimeFailureConfig = appConfig.diagnostics.runtimeFailures;
  const failurePolicy = appConfig.diagnostics.circuitBreaker;
  const selectedServerProfileId =
    profile.serverProfile ||
    configuration.registry.require("server").defaultProfile ||
    "default";
  const serverProfile = shared.serverProfiles.require(selectedServerProfileId);
  const server = serverProfile.endpoint;
  const eventBus = new EventBus();
  const identity = new BotIdentity({
    botId,
    displayName: profile.displayName,
    username: profile.username,
    role: profile.role,
    serverProfile: serverProfile.id,
    serverProfileRevision: serverProfile.revision,
  });
  const context = new BotContext(botId);
  const state = new BotState();
  const connectionStateBinding = createConnectionStateBinding({
    botId,
    state,
    eventBus,
    context,
  });
  const { operationConfig, queue, lockPolicy, timeoutPolicy, operationManager } = BotOperationInstaller.install({ botId, appConfig, logger });
  const commands = new CommandRegistry(
    serverProfile.requireCatalog("commands"),
  );
  const commandResolver = new CommandResolver({ registry: commands });
  const commandGuard = new CommandGuard({
    context,
    minimumIntervalMs: appConfig.commandIntervalMs || 250,
  });
  const commandExecutor = new CommandExecutor({ context, guard: commandGuard });
  const responseMatcher = new ResponseMatcher();
  const confirmation = new CommandConfirmation({
    eventBus,
    matcher: responseMatcher,
    context,
  });
  const commandService = new CommandService({
    botId,
    resolver: commandResolver,
    executor: commandExecutor,
    confirmation,
    responseRules: serverProfile.requireCatalog("commandResponses"),
  });
  const slashCommandService = new SlashCommandService({
    executor: commandExecutor,
  });
  const itemRegistry = new ItemRegistry(serverProfile.requireCatalog("items"));
  const itemResolver = new ItemResolver({
    registry: itemRegistry,
    matcher: shared.itemResolver.matcher,
  });
  const guiState = new GuiState();
  const guiRegistry = new GuiRegistry(
    serverProfile.requireCatalog("guiWindows"),
  );
  const titleMatcher = new TitleMatcher();
  const layoutMatcher = new LayoutMatcher();
  const fingerprintMatcher = new SlotFingerprintMatcher({
    itemResolver: itemResolver,
  });
  const windowMatcher = new WindowMatcher({
    titleMatcher,
    layoutMatcher,
    fingerprintMatcher,
  });
  const guiIdentityEngine = new GuiIdentityEngine({
    registry: guiRegistry,
    titleMatcher,
    layoutMatcher,
    fingerprintMatcher,
    config: serverProfile.requireCatalog("guiIdentity"),
  });
  const detector = new GuiDetector({
    registry: guiRegistry,
    windowMatcher,
    identityEngine: guiIdentityEngine,
  });
  const slotRegistry = new SlotRegistry(
    serverProfile.requireCatalog("guiSlots"),
  );
  const slotResolver = new SlotResolver({
    slotRegistry,
    itemResolver: itemResolver,
  });
  const slotValidator = new SlotValidator();
  const slotInspector = new SlotInspector({
    normalizer: shared.itemNormalizer,
  });
  const clickQueue = new ClickQueue();
  const clickGuard = new ClickGuard({ context, slotValidator });
  const clickExecutor = new ClickExecutor({ context });
  const clickVerifier = new ClickVerifier({ eventBus, context });
  const guiManager = new GuiManager({
    botId,
    context,
    state: guiState,
    detector,
    clickQueue,
    clickGuard,
    clickExecutor,
    clickVerifier,
    eventBus,
    logger,
    workloadMetrics,
  });
  const observationConfig = configuration.registry.require("guiObservation");
  const guiNormalizer = new GuiStructureNormalizer({
    itemNormalizer: shared.itemNormalizer,
  });
  const guiObservationStore = new GuiObservationStore({
    baseDir: path.resolve(
      configuration.loader.baseDir,
      observationConfig.directory,
    ),
    botId,
    logger,
  });
  const recipeDefinitionsForLearning = serverProfile.requireCatalog("recipes");
  const guiBootstrapMappings = [
    {
      recordKeys: ["ks__menu_crafting", "ks__slot-16"],
      entries: Object.entries(recipeDefinitionsForLearning).map(
        ([id, recipe]) => ({
          roleId: `recipe:${id}`,
          logicalItemId: recipe.menuItemId,
          bootstrapSlot: recipe.menuSlot,
        }),
      ),
    },
  ];
  const guiKnowledge =
    observationConfig.enabled === false
      ? null
      : new GuiKnowledgeRegistry({
          botId,
          normalizer: guiNormalizer,
          store: guiObservationStore,
          itemResolver: itemResolver,
          bootstrapMappings: guiBootstrapMappings,
          logger,
        });
  const guiObservationService =
    observationConfig.enabled === false
      ? null
      : new GuiObservationService({
          botId,
          eventBus,
          guiManager,
          knowledgeRegistry: guiKnowledge,
          debounceMs: observationConfig.debounceMs,
          logger,
        });
  const movementState = new MovementState();
  const controlStateManager = new ControlStateManager({ context });
  const positionService = new PositionService({ context });
  const rotationService = new RotationService({ context });
  const destinationResolver = new DestinationResolver(
    configuration.registry.require("locations"),
  );
  const routeRegistry = new RouteRegistry(
    configuration.registry.require("routes"),
  );
  const arrivalDetector = new ArrivalDetector({ positionService });
  const routeExecutor = new RouteExecutor({ context, arrivalDetector });
  const sprintJumpExecutor = new SprintJumpRouteExecutor({
    context,
    controlStateManager,
    rotationService,
    positionService,
    logger,
  });
  const navigationManager = new NavigationManager({
    destinationResolver,
    routeExecutor,
    state: movementState,
  });
  const positionValidator = new PositionValidator();
  const movementGuard = new MovementGuard({ positionValidator, lockPolicy });
  const movementManager = new MovementManager({
    navigationManager,
    controlStateManager,
    guard: movementGuard,
    sprintJumpExecutor,
  });
  const inventoryReader = new InventoryReader({
    botId,
    context,
    normalizer: shared.itemNormalizer,
    logger,
  });
  const inventoryScanner = new InventoryScanner({
    resolver: itemResolver,
    guiKnowledge,
  });
  const inventoryCounter = new InventoryCounter({ scanner: inventoryScanner });
  const inventoryObservationConfig = configuration.registry.require(
    "inventoryObservation",
  );
  const inventoryObservationStore = new InventoryObservationStore({
    baseDir: path.resolve(
      configuration.loader.baseDir,
      inventoryObservationConfig.directory || "data/runtime/inventory",
    ),
    botId,
    logger,
  });
  const inventoryObservationService =
    inventoryObservationConfig.enabled === false
      ? null
      : new InventoryObservationService({
          botId,
          context,
          eventBus,
          reader: inventoryReader,
          store: inventoryObservationStore,
          normalizer: shared.itemNormalizer,
          debounceMs: inventoryObservationConfig.debounceMs,
          historyLimit: inventoryObservationConfig.historyLimit || 300,
          logger,
        });
  const inventorySyncService = new InventorySyncService({
    botId,
    context,
    reader: inventoryReader,
    observation: inventoryObservationService,
    logger,
    config: inventoryObservationConfig.postActionSync || {},
  });
  const storageConfig = serverProfile.requireCatalog("storage");
  const capacityReader = new KhoCapacityReader({
    itemResolver: itemResolver,
    config: storageConfig,
  });
  const khoReader = new KhoReader({
    itemResolver: itemResolver,
    capacityReader,
    config: storageConfig,
  });
  const sellGuiReader = new SellGuiReader({
    itemResolver: itemResolver,
    config: storageConfig,
  });
  const khoSellOperation = new KhoSellOperation({
    commandService,
    guiManager,
    context,
    reader: sellGuiReader,
    config: storageConfig,
    logger,
  });
  const storage = new KhoService({
    commandService,
    guiManager,
    reader: khoReader,
    sellOperation: khoSellOperation,
    config: storageConfig,
    guiKnowledge,
    operationManager,
    context,
    logger,
  });
  const khoWithdrawOperation = new KhoWithdrawOperation({
    storage,
    guiManager,
    context,
    itemResolver: itemResolver,
    inventoryReader,
    inventoryCounter,
    config: storageConfig,
    logger,
    workloadMetrics,
  });
  storage.setWithdrawOperation(khoWithdrawOperation);
  const pvConfig = serverProfile.requireCatalog("personalVault");
  const pvReader = new PersonalVaultReader({
    itemResolver: itemResolver,
    guiKnowledge,
    normalizer: shared.itemNormalizer,
    storageSlots: pvConfig.storageSlots,
  });
  const pvTransfer = new PersonalVaultTransfer({
    guiManager,
    itemResolver: itemResolver,
    guiKnowledge,
    storageSlots: pvConfig.storageSlots,
    logger,
  });
  const personalVault = new PersonalVaultService({
    commandService,
    guiManager,
    reader: pvReader,
    transfer: pvTransfer,
    config: pvConfig,
    guiKnowledge,
    inventoryReader,
    inventoryCounter,
    operationManager,
    context,
    logger,
  });
  const mineralConfig = serverProfile.requireCatalog("minerals");
  const mineralConversionConfig =
    serverProfile.requireCatalog("mineralConversions");
  const mineralOperation = new MineralConversionOperation({
    commandService,
    guiManager,
    context,
    itemResolver: itemResolver,
    guiKnowledge,
    config: mineralConfig,
    conversionConfig: mineralConversionConfig,
    logger,
  });
  const minerals = new MineralService({
    operation: mineralOperation,
    operationManager,
    context,
  });
  const smeltingConfig = serverProfile.requireCatalog("smelting");
  const smeltingOperation = new SmeltingOperation({
    commandService,
    guiManager,
    context,
    itemResolver: itemResolver,
    guiKnowledge,
    config: smeltingConfig,
    logger,
  });
  const smelting = new SmeltingService({
    operation: smeltingOperation,
    operationManager,
    context,
  });
  const b1Materials = new B1StorageMaterialService({
    storage,
    minerals,
    smelting,
    conversionConfig: mineralConversionConfig,
    smeltingConfig,
    recipeConfig: recipeDefinitionsForLearning,
    targetId: configuration.registry.require("b5").targetId,
    serverProfile,
    logger,
  });
  const recipeRegistry = new CraftingRecipeRegistry(
    serverProfile.requireCatalog("recipes"),
  );
  const quantityResolver = new CraftingQuantityResolver(
    mineralConfig.crafting || {},
  );
  const resultVerifier = new CraftingResultVerifier({
    inventoryReader,
    inventoryCounter,
    guiKnowledge,
    inventoryObservation: inventoryObservationService,
    inventorySync: inventorySyncService,
  });
  const craftingVerificationService = new CraftingVerificationService({
    resultVerifier: craftingResultVerifier,
    stageContract: stageExecutionContract
  });
  const craftingOperation = new CraftingOperation({
    commandService,
    guiManager,
    context,
    itemResolver: itemResolver,
    recipeRegistry,
    quantityResolver,
    resultVerifier,
    guiKnowledge,
    config: mineralConfig.crafting || {},
    logger,
  });
  const crafting = new CraftingService({
    operation: craftingOperation,
    operationManager,
    context,
  });
  const materialCalculator = new MaterialCalculator({ recipeRegistry });
  const craftingPlanner = new CraftingPlanner({
    recipeRegistry,
    materialCalculator,
  });
  const craftingTiers = serverProfile.requireCatalog("craftingTiers");
  const b5Config = configuration.registry.require("b5");
  const b5Planner = new B5Planner({
    planner: craftingPlanner,
    targetId: b5Config.targetId,
    tiers: craftingTiers,
  });
  const b5ExecutionPlanner = new B5ExecutionPlanner();
  const b5TraceRecorder = new B5TraceRecorder({
    botId,
    serverProfile,
    historyLimit: 100,
    logger,
  });
  const b5Planning = new B5PlanningService({
    storage,
    personalVault,
    inventoryReader,
    inventoryCounter,
    b5Planner,
    executionPlanner: b5ExecutionPlanner,
    materialCalculator,
    recipeRegistry,
    tiers: craftingTiers,
    b1Materials,
    config: b5Config,
    guiDataMaxAgeMs: Number(observationConfig.semanticCacheMs || 5000),
  });
  const b5AutomationCore = new B5AutomationService({
    planningService: b5Planning,
    crafting,
    personalVault,
    storage,
    b1Materials,
    inventoryReader,
    inventoryCounter,
    recipeRegistry,
    operationManager,
    context,
    traceRecorder: b5TraceRecorder,
    config: b5Config,
    logger,
  });
  const b5Automation = new B5AutomationRuntimeDecorator({ service: b5AutomationCore, workloadMetrics });
  const connectionStateView = new ConnectionStateView({ context });
  const islandConfig = configuration.registry.require("island");
  const islandOperation = new IslandTeleportOperation({
    commandService,
    positionService,
    eventBus,
    connectionState: connectionStateView,
    botId,
    config: islandConfig,
  });
  const island = new IslandService({
    operation: islandOperation,
    operationManager,
    context,
  });
  const dungeonConfig = configuration.registry.require("dungeon");
  const destinations = new DungeonDestinationRegistry(
    dungeonConfig.destinations || {},
  );
  const dungeonOperation = new DungeonTeleportOperation({
    botId,
    context,
    commandService,
    guiManager,
    itemResolver: itemResolver,
    guiKnowledge,
    destinations,
    eventBus,
    config: dungeonConfig,
  });
  const dungeon = new DungeonService({
    operation: dungeonOperation,
    operationManager,
    context,
  });
  const skyblockConfig = serverProfile.requireBinding("join");
  const skyTarget =
    profile.skyblockSelection || skyblockConfig.defaultSelection;
  const skyblockOperation = new SkyblockJoinOperation({
    botId,
    context,
    commandService,
    guiManager,
    guiKnowledge,
    eventBus,
    config: skyblockConfig,
  });
  const skyblock = new SkyblockService({
    operation: skyblockOperation,
    operationManager,
    context,
  });
  const skyblockAutoJoin = new SkyblockAutoJoinService({
    botId,
    context,
    eventBus,
    skyblock,
    config: { ...(skyblockConfig.modeJoin || {}), selection: skyTarget },
    dailyRecovery: configuration.registry.require("dailyRecovery"),
    logger,
  });
  const skyCommandService = new SkyCommandService({
    botId,
    context,
    slashCommandService,
    skyblockReadiness: skyblockAutoJoin,
    config: serverProfile.requireCatalog("skyCommands"),
    logger,
  });
  const sessionManager = new SessionManager({ botId });
  const connectionFactory = new ConnectionFactory({
    botFactory: shared.botFactory,
  });
  const resourcePackAutoAccept = new ResourcePackAutoAcceptService({
    botId,
    context,
    eventBus,
    config: configuration.registry.require("resourcePack"),
    logger,
  });
  const serverLoginService = new ServerLoginService({
    botId,
    context,
    eventBus,
    commandService,
    password: profile.password,
    config: serverProfile.requireBinding("authentication"),
    logger,
  });
  const connectionManager = new ConnectionManager({
    botId,
    context,
    sessionManager,
    connectionFactory,
    profile,
    server,
    eventBus,
    logger,
    attemptCoordinator: shared.connectionAttempts,
    readyTimeoutMs: profile.readyTimeoutMs || 30000,
    autoConnect: profile.runtimeAutoConnect ?? profile.enabled,
  });
  const reconnectManager = new ReconnectManager({
    botId,
    connectionManager,
    context,
    eventBus,
    policy: profile.reconnect || {},
    dailyRecovery: configuration.registry.require("dailyRecovery"),
    attemptCoordinator: shared.connectionAttempts,
    logger,
  });
  const connectionEventBinding = createConnectionEventBinding({
    botId,
    context,
    eventBus,
  });
  const fishingConfig = resolveFishingConfig(
    configuration.registry.require("fishingMode"),
    profile.fishing || {},
  );
  const afkOccupancyParser = new AfkAreaOccupancyParser({
    itemNormalizer: shared.itemNormalizer,
    config: fishingConfig,
  });
  const afkAreas = new AfkAreaService({
    botId,
    context,
    commandService,
    guiManager,
    eventBus,
    positionService,
    occupancyParser: afkOccupancyParser,
    operationManager,
    config: fishingConfig,
    logger,
  });
  const fishing = new FishingService({
    context,
    rotationService,
    config: fishingConfig,
    logger,
  });
  const fishingPacketObserver = new ConnectionPacketObserver({
    botId,
    context,
    eventBus,
    config: fishingConfig,
    logger,
  });
  const fishingPositionGuard = new FishingPositionGuard({
    positionService,
    connectionState: connectionStateView,
    config: fishingConfig,
  });
  const fishingWorldReadiness = new FishingWorldReadinessService({
    context,
    connectionState: connectionStateView,
    config: fishingConfig,
    logger,
  });
  const fishingMovement = new FishingMovementOperation({
    botId,
    context,
    connectionState: connectionStateView,
    operationManager,
    controlStateManager,
    rotationService,
    positionService,
    config: fishingConfig,
    logger,
  });
  const fishingMovementProbe = new FishingMovementProbeService({
    movementOperation: fishingMovement,
    connectionState: connectionStateView,
    config: fishingConfig,
    logger,
  });
  const fishingRecoveryPolicy = new FishingRecoveryPolicy({
    config: fishingConfig,
  });
  const serverFeatureFacade = new ServerFeatureFacade({
    storage,
    personalVault,
    minerals,
    smelting,
    crafting,
    b5Planning,
    b5Automation,
    island,
    dungeon,
    skyblock,
    afkAreas,
    fishing,
  });
  const runtimeFailurePublisher = new RuntimeFailurePublisher({
    botId,
    eventBus,
    connectionAggregationMs: runtimeFailureConfig.connectionAggregationMs,
    logger,
  });
  const modeCoordinator = new ModeCoordinator({ botId, logger });
  const collectorB5Config = configuration.registry.require("collectorB5Mode");
  const collectorB5Mode = new CollectorB5ModeService({
    botId,
    context,
    eventBus,
    island,
    skyblock,
    skyblockReadiness: skyblockAutoJoin,
    skyTarget,
    movementManager,
    positionService,
    b1Materials,
    b5Planning,
    b5Automation,
    modeCoordinator,
    failurePublisher: runtimeFailurePublisher,
    failurePolicy,
    config: collectorB5Config,
    dailyRecovery: configuration.registry.require("dailyRecovery"),
    logger,
  });
  const fishingMode = new FishingModeService({
    botId,
    eventBus,
    connectionState: connectionStateView,
    connectionControl: connectionManager,
    skyblockReadiness: skyblockAutoJoin,
    skyTarget,
    afkAreas,
    fishing,
    island,
    movement: fishingMovement,
    movementProbe: fishingMovementProbe,
    positionGuard: fishingPositionGuard,
    worldReadiness: fishingWorldReadiness,
    recoveryPolicy: fishingRecoveryPolicy,
    modeCoordinator,
    failurePublisher: runtimeFailurePublisher,
    failurePolicy,
    config: fishingConfig,
    logger,
  });
  const capabilityRegistry = new CapabilityRegistry({ botId });
  const capabilities = {
    connection: connectionManager,
    commands: commandService,
    "slash-command": slashCommandService,
    "sky-commands": skyCommandService,
    gui: guiManager,
    "gui-identity": guiIdentityEngine,
    movement: movementManager,
    rotation: rotationService,
    position: positionService,
    inventory: inventoryReader,
    storage,
    "b1-materials": b1Materials,
    "personal-vault": personalVault,
    minerals,
    smelting,
    crafting,
    island,
    dungeon,
    skyblock,
    afk: afkAreas,
    fishing,
    "b5-planning": b5Planning,
    "b5-automation": b5Automation,
    "b5-trace": b5TraceRecorder,
  };
  new CapabilityInstaller({ registry: capabilityRegistry }).install(
    capabilities,
    {
      storage: {
        version: "1.0.0",
        scope: "connection",
        dependencies: [
          { id: "commands", version: "1.x" },
          { id: "gui", version: "1.x" },
          { id: "inventory", version: "1.x" },
        ],
        description: "Profile-backed semantic storage capability",
      },
    },
  );
  const modeContext = new ModeContext({
    botId,
    botContext: context,
    capabilityRegistry,
    eventBus,
    operationManager,
    logger,
  });
  const b5CraftConfig = {
    ...configuration.registry.require("b5CraftMode"),
    ...serverProfile.requireCatalog("serverTimings"),
  };
  const b5CraftMode = new B5CraftModeService({
    botId,
    modeContext,
    modeCoordinator,
    catalog: shared.modeCatalog,
    island,
    skyblockReadiness: skyblockAutoJoin,
    skyTarget,
    b1Materials,
    b5Planning,
    b5Automation,
    sharedStorageLeases: shared.sharedResourceLeases,
    storageLeaseKey: `storage:${profile.serverProfile || "default"}`,
    failurePublisher: runtimeFailurePublisher,
    failurePolicy,
    config: b5CraftConfig,
    logger,
  });
  const customModes = {};
  for (const definition of shared.modeCatalog
    .list()
    .filter((item) => item.metadata?.kind === "composable")) {
    customModes[definition.serviceName] = new ComposableModeService({
      botId,
      modeId: definition.id,
      definition: { workflow: definition.metadata.workflow },
      modeContext,
      modeCoordinator,
      catalog: shared.modeCatalog,
      logger,
    });
  }
  const collectorDefinition = shared.modeCatalog.require("collector-b5");
  const fishingDefinition = shared.modeCatalog.require("fishing");
  const collectorB5ModeAdapter = new LegacyModeAdapter({
    modeId: collectorDefinition.id,
    service: collectorB5Mode,
    modeContext,
    requiredCapabilities: collectorDefinition.requiredCapabilities,
  });
  const fishingModeAdapter = new LegacyModeAdapter({
    modeId: fishingDefinition.id,
    service: fishingMode,
    modeContext,
    requiredCapabilities: fishingDefinition.requiredCapabilities,
  });
  const servicesByName = {
    collectorB5Mode: collectorB5ModeAdapter,
    fishingMode: fishingModeAdapter,
    b5CraftMode,
    ...customModes,
  };
  const modeRegistry = new RuntimeModeRegistry({
    botId,
    catalog: shared.modeCatalog,
    capabilityRegistry,
    services: servicesByName,
  });
  const modeControl = new ModeControlService({
    botId,
    registry: modeRegistry,
    logger,
  });
  const modeSdk = new ModeSdk({
    botId,
    catalog: shared.modeCatalog,
    modeContext,
    modeRegistry,
    modeControl,
    capabilityRegistry,
  });
  const itemInspector = new ItemInspector({
    normalizer: shared.itemNormalizer,
    resolver: itemResolver,
  });
  const guiSnapshotSerializer = new GuiSnapshotSerializer();
  const guiInspectionService = new GuiInspectionService({
    botId,
    context,
    eventBus,
    commandService,
    guiManager,
    serializer: guiSnapshotSerializer,
    operationManager,
    observationService: guiObservationService,
    logger,
  });
  const runtimeFailureRecorder = new RuntimeFailureRecorder({
    botId,
    eventBus,
    baseDir: path.resolve(
      configuration.loader.baseDir,
      runtimeFailureConfig.directory,
    ),
    config: runtimeFailureConfig,
    guiManager,
    inventoryObservationService,
    logger,
  });
  const diagnostics = new DiagnosticsManager({
    gui: new GuiDiagnostics({ guiManager }),
    slots: new SlotDiagnostics({ slotInspector, guiManager }),
    items: new ItemDiagnostics({ itemInspector }),
    movement: new MovementDiagnostics({ movementState, positionService }),
    commands: new CommandDiagnostics({ commandRegistry: commands }),
  });
  const healthRegistry = new HealthRegistry({ botId });
  new RuntimePlatformInstaller({
    healthRegistry,
    context,
    modeRegistry,
    operationManager,
  }).install();
  const runtimePlatform = new RuntimePlatformService({
    botId,
    capabilityRegistry,
    modeRegistry,
    modeCoordinator,
    operationManager,
    healthRegistry,
    eventBus,
  });
  const lifecycleComponents = LifecycleInstaller.collect(
    [connectionStateBinding, connectionEventBinding, guiManager],
    [
      guiKnowledge,
      guiObservationService,
      inventoryObservationService,
      runtimeFailurePublisher,
      runtimeFailureRecorder,
      reconnectManager,
      resourcePackAutoAccept,
      serverLoginService,
      skyblockAutoJoin,
      connectionManager,
      operationManager,
      movementManager,
      fishingPacketObserver,
      fishingMovement,
      modeCoordinator,
      collectorB5Mode,
      b5CraftMode,
      fishingMode,
    ],
    customModes,
  );
  const lifecycle = new BotLifecycle(lifecycleComponents, { logger });
  return new BotRuntime({
    identity,
    context,
    state,
    lifecycleCoordinator: lifecycle,
    logger,
    services: {
      serverProfile,
      eventBus,
      connectionManager,
      reconnectManager,
      commandService,
      slashCommandService,
      skyCommandService,
      resourcePackAutoAccept,
      serverLoginService,
      guiManager,
      guiIdentityEngine,
      guiKnowledge,
      guiObservationService,
      guiInspectionService,
      movementManager,
      operationManager,
      modeCoordinator,
      modeRegistry,
      modeControl,
      modeContext,
      modeSdk,
      capabilityRegistry,
      healthRegistry,
      runtimePlatform,
      inventoryReader,
      inventoryCounter,
      inventoryObservationService,
      inventorySyncService,
      runtimeFailurePublisher,
      runtimeFailureRecorder,
      workloadMetrics,
      serverFeatureFacade,
      b1Materials,
      b5Planning,
      b5Automation,
      b5ExecutionPlanner,
      b5TraceRecorder,
      collectorB5Mode: collectorB5ModeAdapter,
      b5CraftMode,
      fishingMode: fishingModeAdapter,
      ...customModes,
      afkAreas,
      fishing,
      connectionStateView,
      fishingPacketObserver,
      fishingMovement,
      fishingMovementProbe,
      fishingPositionGuard,
      fishingWorldReadiness,
      fishingRecoveryPolicy,
      skyblockAutoJoin,
      diagnostics,
      slotResolver,
      routeRegistry,
    },
  });
}
module.exports = registerBotServices;
