# ARCHITECTURE.md

## Mục đích và ký hiệu

Đây là bản đồ kỹ thuật của repository hiện tại. Nội dung dựa trên source/config/test đang tồn tại; không mô tả target như thể đã implement.

- **CURRENT**: đã tồn tại trong repository.
- **TARGET**: hướng kiến trúc nên tiến tới, chưa chắc đã tồn tại.
- Server mechanics chi tiết: xem `SERVER_BEHAVIOR.md`.
- Quy tắc agent: xem `AGENTS.md`.
- Invariant sâu và trách nhiệm file: xem `RULES.md`, `JS_RESPONSIBILITIES.md`.

## CURRENT 2.6 - GUI identity và B5 decision pipeline

Luồng GUI stateful hiện dùng `GuiIdentityEngine` làm lớp phân loại chung: `GuiManager -> GuiDetector -> GuiIdentityEngine`. Engine trả `id/candidateId/confidence/margin/evidence`; service nghiệp vụ phải kết hợp identity với transition hoặc semantic evidence, không được coi command context là bằng chứng duy nhất. Đặc biệt `/kho`, `/pv 2` và ba tầng `/ks` đã đi qua contract này.

B5 decision pipeline tách thành `B5PlanningService -> B5ExecutionPlanner -> B5AutomationService -> B5TraceRecorder`. `B5AutomationService` giữ vai trò transaction façade; recipe lookup và action diagnostics là pure support (`B5RecipeResolver`, `B5ActionDiagnostics`) để không trộn policy đọc với side-effect. Execution planner là pure compiler: input inspection -> decision/blockers/digest/replayInput, không được gửi command, click hoặc wait. Automation hiện vẫn là executor tương thích và trace giữ decision của planner để migration sang planner-authoritative có thể diễn ra dần, không thay lõi B5 một lần. `B5PlannerReplay` phát lại replayInput offline; support bundle giữ fixture mới nhất theo bot.

Từ 2.6.8, side-effect crafting có **reconciliation barrier**. `CraftingOperation` chỉ click quantity một lần; nếu verifier không xác định được outcome thì `CraftingOutcomeClassifier` trả trạng thái UNCERTAIN và operation fail với `retryable=false`. `B5CraftModeService` phải fresh-read/reconcile trước mọi mutation tiếp theo; không được re-click chỉ vì timeout/không thấy delta. Chỉ khi các input quan sát được và output cùng giữ nguyên qua số lần đọc cấu hình thì planner mới được phép re-plan; input không quan sát được (ví dụ B1 lấy trực tiếp từ `/kho`) phải fail-closed.

Từ 2.6.9, reconciliation baseline là **source-aware**: mỗi input mang `source` (`storage`, `inventory`, `personal-vault`) và chỉ được đối chiếu với snapshot cùng nguồn. `B1 -> B2 ALL` đồng thời là transaction boundary: một fresh B1 plan chỉ được click ALL một lần, sau đó bắt buộc fresh re-plan trước mutation tiếp theo. Strong identity cố định từ `items.json` là authority ngay từ lần verify đầu; learned identity chỉ bổ sung cho policy `learn`.

Strong MMOItems identity là contract một-một. Mọi B2–B5 phải có identity cố định ở inventory/PV hoặc khai báo policy `learn`; policy learn là learn-once và sau lần bind strong đầu tiên không được chuyển chủ. Config validator chịu trách nhiệm bắt thiếu/đụng identity trước runtime.


## 1. System Overview

### CURRENT

Package entry mặc định `npm start` là Desktop qua `src/desktop/main.js`. Headless dùng explicit `npm run core:start` qua `src/index.js`. Cả hai cuối cùng đều dựng ứng dụng bằng `src/bootstrap/createApplication.js`.

```text
Discord / operator intent
        |
        v
DiscordService / FleetControlService
        |
        v
Application
        |
        v
BotRegistry
        |
        +---- BotRuntime(bot-01)
        |       |
        |       +-- BotContext + BotState
        |       +-- ConnectionManager/ReconnectManager
        |       +-- OperationManager
        |       +-- ModeCoordinator
        |       +-- CollectorB5ModeService / FishingModeService
        |       +-- server-features services
        |       +-- command/gui/items/movement capabilities
        |
        +---- BotRuntime(bot-02)
                ... isolated bot-scoped state ...

low-level side effects
        |
        v
Mineflayer / mineflayer-pathfinder / Minecraft server
```

Event direction:

```text
Mineflayer/client events
  -> connection/gui/movement/command listeners or bindings
  -> EventBus + EventEnvelope
  -> botId/connectionGeneration filtering
  -> service/runtime/mode
```

`EventScopeRegistry` phân biệt bot-scoped và connection-scoped event; connection-scoped event phải có `botId` và positive `connectionGeneration`.

## 2. Repository Map

### `src/index.js`

- Responsibility: process entry point, gọi `createApplication()`, initialize/start, cài shutdown.
- Không nên chứa domain behavior.

### `src/bootstrap/`

- Wire configuration, application-scoped shared service, bot runtime và Discord.
- Key files: `createApplication.js`, `registerSharedServices.js`, `registerBotServices.js`, `registerDiscordServices.js`, `registerModules.js`.
- Không nên chứa B5/Fishing workflow logic.

### `src/core/`

- Primitive application: `Application`, `LifecycleCoordinator`, `EventBus`, `StateStore`, `Container`.
- `src/core/events/*` chuẩn hóa event envelope/scope.
- Không nên biết command `/kho`, recipe hoặc mode cụ thể.

### `src/bot/`

- Bot identity/context/state/runtime/registry/lifecycle.
- `BotContext` sở hữu current Mineflayer client và monotonically increasing `generation`.
- `BotRuntime` expose bot-scoped services qua `getService/requireService`.

### `src/connection/`

- Tạo client, attach session, spawn verification, reconnect, connection attempt coordination.
- `ConnectionManager` là owner raw connection lifecycle.

### `src/operations/`

- Operation ID/status, queue, timeout, cancellation, lock policy, manager.
- Dùng cho action nhiều bước có side effect/verification.

### `src/modes/`

- Long-running primary workflows.
- CURRENT: `collector-b5`, `fishing`.
- `ModeCoordinator` quản lý lease/resource ownership.

### `src/server-features/`

- Server/domain capability hiện tại: storage, personal vault, minerals, smelting, crafting/B5, island, dungeon, skyblock, AFK, fishing, authentication, resource pack.
- Đây là nơi phần lớn MinerUA-specific behavior hiện đang sống.

### `src/commands/`

- Command registry/resolver/guard/executor/confirmation.
- `CommandExecutor` là raw `bot.chat()` owner.

### `src/gui/`

- Session/state/detection/slot/click/knowledge/observation.
- `ClickExecutor` là raw `clickWindow()` owner.

### `src/items/`

- Normalize, resolve, match custom/vanilla items; inventory read/scan/count/observation/sync.

### `src/movement/`

- Movement state, pathfinding navigation, direct control-state strategy, arrival/safety.

### `src/planning/`

- Pure-ish planning/calculation cho crafting/B5; không nên có side effect Mineflayer.

### `src/discord/`

- Slash commands, panel, admin/config editor, error reporter.
- Control plane; không implement low-level Minecraft action.

### `src/fleet/` và `src/recovery/`

- `FleetScheduler`: application-scoped bounded task scheduler.
- `DurableIntentStore`: persist desired connection/mode state.
- `FleetControlService`: reconcile desired state với runtime.

### `src/diagnostics/`, `src/simulation/`

- Runtime failure recording, GUI inspection, replay/safety test harness.

### `config/`

- 29 config groups được đăng ký bởi `src/configuration/ConfigSpecs.js`, cộng bot profiles trong `config/bots/`.
- Config được load/validate/cross-validate trước runtime.

### `data/runtime/`

- GUI/inventory observations, errors, Discord panel state, durable control data.
- Không phải source code/config authority.

### `tests/`

- Unit/integration/fixtures; có tests cho multi-bot isolation, generation contracts, GUI/item identity, B5, fishing, durable control.

### `architecture/catalog.json`

- CURRENT machine-readable architecture audit: runtime entrypoint, official docs, governed documentation roots, side-effect owners và forbidden boundary patterns.
- `officialDocuments` là exact source-of-truth allowlist; `governedDocumentRoots` hiện cho phép `docs/architecture-roadmap/**` mà không nâng roadmap lên cùng authority với CURRENT docs.

## 3. Startup Lifecycle

### CURRENT

```text
npm start
-> Electron src/desktop/main.js
-> DesktopRuntimeBootstrap
   -> RuntimeConfigMigrator: application defaults -> AppData runtime/runtime-dev
   -> RuntimeEnvironment (DEV): process -> .env fill-missing
   -> DesktopSecretStore overlay cuối cùng
-> DesktopController.start()
-> createApplication(runtimeBaseDir, resolvedEnvironment)

npm run core:start
-> node src/index.js
-> RuntimeEnvironment: process -> .env fill-missing
-> createApplication(projectBaseDir, resolvedEnvironment)

createApplication(...)
-> loadConfiguration()
   -> ConfigSpecs
   -> ConfigLoader/ConfigValidator/ConfigurationContractValidator
-> registerSharedServices()
   -> LoggerFactory/EventBus/BotRegistry/BotFactory/item resolver/connection attempt coordinator
-> DurableIntentStore.initialize()
-> FleetScheduler + FleetControlService
-> Application + application lifecycle
-> loadBotProfiles(config/bots/*.json)
-> cross-validate profiles/config
-> fleetControl.setProfiles()
-> createBotRuntime(profile) for every profile
-> registerModules(application, runtimes)
-> BotProfileAdminService
-> registerDiscordServices()
-> return assembled application
-> application.initialize()
-> application.start()
-> FleetControlService.reconcileAll()
```

Mỗi runtime được wire bởi `registerBotServices.js`; `BotLifecycle` chứa các component bot-scoped theo thứ tự đăng ký.

## 4. Bot Lifecycle

### CURRENT state thực tế

`BotState` khởi tạo:

```text
lifecycleState = CREATED
connectionState = DISCONNECTED
```

`BotRuntime` set lifecycle:

```text
CREATED
-> INITIALIZED
-> RUNNING
-> STOPPED
```

Failure trong initialize/start/stop/destroy có thể set:

```text
FAILED
```

Connection state được cập nhật bởi `createConnectionStateBinding.js`; các giá trị thực tế gồm tối thiểu:

```text
DISCONNECTED
CONNECTING
CONNECTED
RECONNECTING
FAILED
```

`PAUSED` là mode state, không phải `BotState.lifecycleState`.

### TARGET

Nếu sau này cần public lifecycle enum đầy đủ cho dashboard, dùng một contract thống nhất thay vì suy ra từ nhiều subsystem; không thêm state không có transition owner.

## 5. Multi-bot Architecture

### CURRENT

`Application` sở hữu một `BotRegistry`, registry map `botId -> BotRuntime`.

Mỗi runtime có riêng:

- `BotIdentity`;
- `BotContext`/Mineflayer client;
- `BotState`;
- `EventBus` bot-scoped;
- connection/reconnect/session managers;
- operation queue/locks;
- GUI state/session/click queue/knowledge/observation;
- movement/inventory services;
- `ModeCoordinator`;
- server feature facade và mode services.

`BotContext.attach()` tăng `generation`. Generation là identity của physical connection hiện tại; stale callback phải fail closed.

Application-scoped shared definitions gồm config, logger factory, bot registry, item registry/resolver và connection-attempt coordinator.

Không dùng mutable global Mineflayer state giữa bot.

## 6. Runtime / State

### Configuration

`config/**`, load qua `ConfigurationService`, registry sau validate. Ví dụ command key, GUI bootstrap slot, recipe, timeout, mode config.

### Runtime state

`BotState`, connection/session ownership, active GUI session, movement state, mode status, operation/lease.

### Persistent state

- `DurableIntentStore`: desired connection/mode/modeState.
- Discord panel store/config backup tùy capability.
- GUI/inventory observations dưới `data/runtime` là persisted observation, không phải desired runtime state.

### Server-observed state

GUI snapshot, inventory snapshot, position/events, storage counts.

### Derived state

B5 plan, material requirement, storage pressure, occupancy parse, readiness.

Không serialize raw Mineflayer client/window/packet vào durable intent.

## 7. Mode / Workflow Architecture

### CURRENT

`ModeCoordinator` bot-scoped cấp lease cho resource `primary-mode`.

Mode hiện tại:

- `CollectorB5ModeService` (`src/modes/collector-b5/`)
- `FishingModeService` (`src/modes/fishing/`)

Enable flow phải acquire lease; pause giữ lease; disable release exact lease. Stale lease không được release current owner.

Mode điều phối service; raw side effect phải qua capability thấp hơn.

### TARGET

Có thể thêm `MiningMode`, `FarmingMode`, `AuctionMode`, `QuestMode`, `CombatMode` như peer của mode hiện tại. Chúng phải reuse `ModeCoordinator`, connection, operation, GUI, command, inventory và movement capability.

## 8. Service Architecture

### CURRENT groups

Connection:
- `ConnectionManager`, `ReconnectManager`, `SessionManager`, `ConnectionAttemptCoordinator`.

Command:
- `CommandService`, `CommandExecutor`, `CommandConfirmation`.

GUI:
- `GuiManager`, detection/slot/click/knowledge/observation modules.

Movement:
- `MovementManager`, `NavigationManager`, `RouteExecutor`, `SprintJumpRouteExecutor`, safety modules.

Inventory/item:
- `InventoryReader`, `InventoryScanner`, `InventoryCounter`, observation/sync; `ItemNormalizer`, `ItemResolver`, matchers.

Server storage:
- `KhoService`, `KhoReader`, `KhoSellOperation`, `B1StorageMaterialService`, `B1StartupReserveTrimmer`. Startup reserve policy chỉ thuộc `config/storage/kho.json`; B5 mode không sở hữu bản sao reserve/trim. Snapshot `/kho` chỉ được reuse trong freshness window 1 giây và trước mọi mutation boundary.

Personal vault:
- `PersonalVaultService`, `PersonalVaultReader`, `PersonalVaultTransfer`.

Crafting:
- `CraftingService`, `CraftingOperation`, `CraftingRecipeRegistry`, `CraftingQuantityResolver`, `CraftingResultVerifier`.

B5:
- `B5PlanningService`, `B5AutomationService`, `b5/flows/*`, `b5/support/B5RecipeResolver`, `b5/support/B5ActionDiagnostics`, planner classes.

Other server capabilities:
- island, skyblock, dungeon, AFK, fishing, smelting, mineral conversion, resource pack, server login.

Control/diagnostics:
- Discord, fleet control/scheduler, runtime failure recorder/publisher, GUI inspection.

## 9. Adapter Layer

### CURRENT

Repo chưa có folder `adapters/` chính thức, nhưng adapter responsibility đã phân tán rõ:

- Minecraft command side effect: `CommandExecutor`.
- GUI click side effect: `ClickExecutor`.
- Connection/client creation: `ConnectionFactory`/`ConnectionManager`.
- Movement pathfinder: `RouteExecutor`.
- Item normalization khỏi Mineflayer representation: `ItemNormalizer`.

### TARGET

Nếu hỗ trợ nhiều Minecraft implementation/server lớn hơn, có thể formalize interface như:

```text
MinecraftAdapter
CommandAdapter
GuiAdapter
InventoryAdapter
MovementAdapter
ServerProfile
```

Không tạo adapter chỉ để đổi tên wrapper hiện có; chỉ formalize khi có từ hai implementation/capability consumer trở lên.

## 10. Server Profile Architecture

### CURRENT

`config/server.json` có `profiles` ở level connection (`host`, `port`, defaults auth/version), nhưng MinerUA-specific command/GUI/recipe vẫn nằm ở các group config và `src/server-features/**` chung.

### TARGET

Để multi-server thực sự sạch:

```text
servers/
  minerua/
    commands
    gui-signatures
    items
    recipes
    cooldowns
    join-flow
    storage-profile
  another-server/
    ...
```

hoặc một `ServerProfile` abstraction tương đương wire bởi bootstrap.

Generic core không assume `/kho`, `/ks`, MMOItems hay MinerUA GUI tồn tại.

## 11. GUI Architecture

### CURRENT

Flow chuẩn:

```text
request command/action
-> wait/open or transition
-> GuiSession bound to client + connectionGeneration
-> detect/identify window
-> observe + persist knowledge
-> resolve logical role/item to live slot
-> ClickQueue/ClickGuard
-> ClickExecutor
-> wait update/transition
-> verifier/postcondition
```

Key modules:

- `GuiManager`: session/binding/wait/click orchestration.
- `GuiDetector` + title/layout/fingerprint matcher.
- `SlotResolver`/`SlotInspector`.
- `ClickQueue`, `ClickGuard`, `ClickExecutor`, `ClickVerifier`.
- `GuiKnowledgeRegistry`: learned slot/item identity by route/source.
- `GuiObservationService`: auto-observe `gui:opened`/`gui:updated`.

GUI identity không chỉ dựa title hoặc fixed slot. Fixed config slot là bootstrap/fallback ở nhiều flow.

Crafting quantity là special case: `CraftingOperation` cố ý không dùng learned GUI fingerprint làm authority vì button `1` và `64` có thể collapse; luôn inspect live quantity GUI qua `CraftingQuantityResolver`.

## 12. Inventory Architecture

### CURRENT

```text
Mineflayer inventory/currentWindow player section
-> InventoryReader
-> normalized immutable snapshot
-> InventoryScanner
-> InventoryCounter
-> observation/sync
-> domain verification/planner
```

Khi custom GUI mở, `InventoryReader` ưu tiên player-inventory section của current window để tránh stale `bot.inventory`, đồng thời code/test có khả năng expose views cần thiết cho verification.

Không double-count cùng stack từ `currentWindow` và `bot.inventory`.

Mutation không thuộc reader/counter; transfer GUI đi qua capability tương ứng như `PersonalVaultTransfer`.

## 13. Item Identity

### CURRENT

`ItemNormalizer` trích identity từ component/NBT/custom data; config `config/items/items.json` có context-specific representations.

Đối với B2–B5, identity mạnh thường là:

```text
MMOITEMS_ITEM_ID:<VALUE>
```

`GuiKnowledgeRegistry` có thể học/bind strong identity từ observation và vault/inventory context.

Thứ tự khái niệm nên ưu tiên:

```text
stable server/custom identity
-> component/NBT identity (ví dụ MMOITEMS_ITEM_ID)
-> other configured structured rule
-> structured lore/name fallback theo context
-> vanilla material
-> slot chỉ là interaction location, không phải logical identity
```

Vanilla material có thể chỉ là carrier cho custom item; không dùng material một mình nếu custom metadata tồn tại.

## 14. Command Architecture

### CURRENT

`CommandRegistry` giữ command template từ `config/commands/commands.json`.

`CommandService.send()`:

- resolve command key;
- arm confirmation trước side effect nếu có response rule;
- forward cancellation + expectedGeneration;
- gọi `CommandExecutor`;
- map failure thành `Result`/`FlowError`.

`CommandExecutor`:

- capture exact client/generation;
- throttle qua `CommandGuard`;
- re-check cancellation/generation sau await;
- gọi `bot.chat()` không có await chen giữa final guard và send.

Command success phải verify bằng response/GUI/position/inventory/event tùy capability. Không coi `bot.chat()` không throw là success cuối.

## 15. Movement Architecture

### CURRENT

Generic pathfinding:

```text
MovementManager
-> NavigationManager
-> DestinationResolver
-> RouteExecutor
-> mineflayer-pathfinder GoalNear
-> ArrivalDetector verification
```

`RouteExecutor` có timeout/cancellation, stop exact owned route và verify arrival.

Fishing còn có direct-control strategy riêng (`SprintJumpRouteExecutor`, `FishingMovementOperation`) để mô phỏng server movement behavior; đây không thay thế generic pathfinding.

Stuck/safety modules tồn tại trong `src/movement/safety` và fishing có recovery/probe riêng.

## 16. Connection & Reconnect

### CURRENT

`ConnectionManager`:

```text
acquire connection-attempt turn
-> create client
-> register pathfinder
-> BotContext.attach(client) => generation++
-> SessionManager.open
-> bind client events
-> wait spawn
-> verify pathfinder/current session
-> emit connection:spawned
```

Mỗi attempt có `attemptId` + `attemptEpoch`; success contract tách ownership nguồn retry với success result owner.

`ReconnectManager` nghe canonical failure/ended signals và schedule retry với policy + daily recovery hold.

Critical invariant: replacement client/generation thắng callback/timer cũ. Event consumer phải so `connectionGeneration` hoặc exact attempt ownership trước khi mutate state.

## 17. Event Architecture

### CURRENT

`EventBus.emit()` tạo immutable detached `EventEnvelope` cho object payload.

Connection-scoped examples trong `EventScopeRegistry`:

- `connection:client-attached`, `login`, `spawned`, `kicked`, `error`, `failed`, `ended`;
- `command:message`;
- `inventory:observed`, `inventory:delta`;
- server login/resource pack events;
- `movement:position`, `movement:teleport`, `player:death`;
- `gui:opened`, `gui:updated`, `gui:closed`;
- fishing/skyblock auto-join events.

Envelope loại raw `bot`, `client`, `window`, `packet` khỏi detached payload để không leak mutable object qua bus.

Listeners connection-scoped phải filter current generation.

## 18. Scheduler

### CURRENT

Hai loại scheduler khác nhau:

1. `FleetScheduler`: application-scoped bounded operator/control tasks, per-bot serialization/fairness/concurrency.
2. `DailyRecoverySchedule`: tính window 03:00/05:00 từ config để hold/retry join/reconnect.

Mode loops vẫn có timer/delay riêng cho polling/retry. Chưa có một generic workflow scheduler thống nhất cho mọi recurring domain action.

### TARGET

Có thể thêm scheduler domain-level cho cooldown/delayed/recurring workflow khi nhiều feature cùng cần, nhưng không thay `FleetScheduler` vì hai trách nhiệm khác nhau.

## 19. Operation / Transaction Model

### CURRENT

`OperationManager`, `OperationQueue`, `OperationLockPolicy`, cancellation/timeout policy đã tồn tại.

Tư duy action nhiều bước:

```text
PLAN
-> PRECONDITION
-> EXECUTE
-> OBSERVE
-> VERIFY
-> COMMIT/RETURN Result
-> RECOVER/CLEANUP
```

Áp dụng thực tế cho island teleport, dungeon, storage sell, crafting, personal-vault transfer, B5 flows.

Failure nên mang `operation`, `step`, `resource`, `action`, code/details qua `FlowError`.

## 20. Lock / Ownership Model

### CURRENT

Có nhiều lớp ownership:

- Connection: `BotContext` generation + `SessionManager`.
- Operation: `OperationManager`/lock policy.
- GUI: `GuiSession` + connection generation + click queue.
- Movement: active route owner/executor state.
- Primary workflow: `ModeCoordinator` lease `primary-mode`.
- Durable operator intent: revision trong `DurableIntentStore` + task trong `FleetScheduler`.

### TARGET

Nếu thêm resource conflict mới, mở rộng explicit resource claim thay vì boolean global. Ví dụ `inventory`, `gui`, `movement`, `command-exclusive` chỉ nên trở thành lock riêng khi operation thực sự cần cross-capability coordination.

## 21. Planner vs Executor

### CURRENT

Crafting đã tách:

```text
MaterialCalculator
-> CraftingPlanner
-> B5Planner
-> CraftingPlan/CraftingStep
```

Executor/domain side effect nằm trong `CraftingOperation`, `B5AutomationService` và B5 flows.

Planner không nên gọi server, timer hoặc GUI. `architecture/catalog.json` có `planner-purity` boundary audit cấm `clickWindow`, `chat`, `end`, `setTimeout`, `setInterval` trong `src/planning/**/*.js`.

## 22. Current B1 -> B5 Workflow

### CURRENT

B5 là một workflow server-specific trên framework:

```text
B1 preparation (storage /kho)
-> acquire B1 for B2
   -> storage strategy: no-op, craft dùng /kho trực tiếp
   -> inventory strategy: /kho overview -> material detail -> withdraw numeric amount -> verify inventory
-> B2
-> B3
-> B4 (carbon/titanium/tungsten)
-> B5 (super_alloy)
```

Responsibilities:

- Recipe/tier facts: `config/server-data/recipes.json`, `crafting-tiers.json`, `b5.json`.
- Material math/planning: `src/planning/crafting/*`.
- Read B1/storage + pressure/conversion/smelting: `B1StorageMaterialService`, storage/minerals/smelting services.
- Read inventory/PV2: inventory + `PersonalVaultService`.
- Server craft execution: `CraftingOperation`.
- B2 input strategy fork: `B2InputAcquisitionFlow`; `KhoWithdrawOperation` sở hữu GUI withdrawal, còn pure quantity/capacity planning nằm trong `src/planning/storage/*`. Đây là một bước trong pipeline chung, không tạo mode hay B5 orchestrator thứ hai.
- Result verification: `CraftingResultVerifier`.
- Long B5 orchestration: `B5AutomationService`, `src/server-features/crafting/b5/flows/*`.
- Long-running collector mode: `CollectorB5ModeService`.

Chi tiết command, quantity, item identity, `/kho`/`/pv 2` semantics nằm trong `SERVER_BEHAVIOR.md`.

## 23. Discord Architecture

### CURRENT

```text
Discord interaction/button
-> DiscordService
-> command or DiscordPanelManager
-> FleetControlService (operator desired state) / runtime API for diagnostic/admin paths
-> ModeCoordinator/runtime/service
-> low-level capability
```

Với `config/discord/discord.json -> remoteOnly=true`, Discord chỉ là remote control: `/mode` điều khiển generic mode trong `ModeCatalog`, `/skycmd` gọi lệnh Sky đã đăng ký, panel có Kết nối/Ngắt bot/Vào Sky/Về HUB/`/is` và lifecycle mode. GUI inspector/editor/profile config không được đăng ký trong remote-only; Desktop là owner của cấu hình/chẩn đoán sâu. Legacy handlers chỉ còn cho compatibility khi `remoteOnly=false`.

Panel có selected target bot riêng, nên bot-02+ là first-class target thay vì dùng một global bot. `Vào Sky` đi qua `SkyblockAutoJoinService`; `Về HUB` dùng generation-scoped manual HUB hold để không bị auto-join kéo ngược.

Control path bền vững phải publish intent qua `FleetControlService`; durable intent chỉ chứa desired connection/mode/mode state, không raw click/packet/operation. Sky custom command phải qua `SkyCommandService`, không gửi `bot.chat` trực tiếp.

## 24. Logging & Observability

### CURRENT

`LoggerFactory`, `Logger`, `RuntimeLogOutput`, `CompactLogFormatter` hỗ trợ console + JSONL file.

`config/app.json`:

- console INFO compact;
- file DEBUG dưới `data/logs`.

Diagnostics:

- `RuntimeFailurePublisher` + `RuntimeFailureRecorder`;
- GUI/inventory observation stores;
- GUI inspection via Discord;
- runtime error snapshots dưới `data/runtime/errors`.

Domain code đã log structured fields như operation/step/phase/resource/recipe/quantity/before/after ở nhiều path.

TARGET minimum context nên nhất quán thêm `botId`, `connectionGeneration`, `operationId`, `correlationId`, `errorCode` ở mọi flow quan trọng.

## 25. Persistence

### CURRENT

Persisted categories:

- durable desired fleet intent;
- Discord panel state/config backups;
- GUI knowledge/observations;
- inventory observation;
- runtime failure records/logs.

Không persist raw Mineflayer client/window/Promise/token.

`DurableIntentStore` dùng revisioned desired state để recovery hội tụ; paused intent không replay startup side effect chỉ để rồi pause.

### TARGET

Nếu thêm workflow checkpoint, chỉ lưu logical checkpoint/cooldown/server profile/bot profile; phải versioned và revalidate khi restore.

## 26. Error Model

### CURRENT

Shared primitives:

- `AppError`, `FlowError`, `TimeoutError`, `OperationCancelledError`;
- `Result` + `Status`.

Typical propagation:

```text
adapter/capability
-> operation FlowError/Result
-> mode/service recovery policy
-> runtime failure publisher/recorder
-> logger/Discord errors
```

Retryable failure phải phân biệt deterministic/config/non-retryable. Generation-stale thường retryable/disconnected-compatible nhưng không được thực hiện side effect muộn.

## 27. Testing Architecture

### CURRENT

Unit:
- core lifecycle/event contracts;
- bot/runtime/registry;
- command/generation;
- GUI/item/inventory;
- mode coordinator/modes;
- operations/planner;
- server features B5/storage/smelting/skyblock/resource-pack/fishing;
- fleet/recovery/simulation.

Integration:
- bootstrap application;
- Discord bot profile admin;
- multi-bot isolation.

Fixtures:
- configs, inventories, items, messages, windows, replay scenarios.

Architecture validation:
- `scripts/validate-architecture.js` + `architecture/catalog.json` audit import cycle, side-effect ownership, config registration, event producer, stale paths.

Coverage thresholds trong catalog: lines 80, branches 65, functions 80.

## 28. Extension Guide

### Thêm Fishing capability/mode mới

CURRENT đã có Fishing, nên feature mới phải mở rộng đúng layer:

1. Server behavior/AFK/fishing rule: `SERVER_BEHAVIOR.md` + config server/mode tương ứng.
2. Low-level fishing capability: `src/server-features/fishing/FishingService.js` hoặc module peer.
3. Movement đặc thù: reuse movement operation/executor; không tạo connection manager.
4. Long-running state machine: `src/modes/fishing/`.
5. Ownership: acquire `ModeCoordinator` lease.
6. Control: Discord/FleetControl only nếu user-facing mode.
7. Tests: service + mode + stale-generation/reconnect nếu có.

### Thêm Farming

TARGET path:

```text
server-specific farm knowledge/config
-> FarmingService (capability: detect/harvest/plant nếu cần)
-> reuse Inventory/Movement/GUI/Command
-> FarmingMode (long-running orchestration)
-> ModeCoordinator
-> Discord/FleetControl adapter
-> unit + workflow tests
```

Không đặt crop/server coordinates trong generic `core`.

### Thêm Mining

Repo đã có `src/server-features/mining/AdaptiveMiningService.js`, nhưng chưa có primary MiningMode trong `src/modes/`. Trước khi tạo mode mới phải đọc service hiện có và caller/test để tránh duplicate.

### Thêm server mới

TARGET:

1. Thêm connection profile (`config/server.json`) nếu chỉ khác host/port.
2. Nếu command/GUI/item semantics khác, tạo server profile/knowledge tách MinerUA-specific behavior.
3. Định nghĩa command registry, join flow, GUI signature, item identities, recipes/storage capability.
4. Wire profile qua bootstrap/config resolver; generic core không đổi nếu abstraction đủ.
5. Thêm contract/integration tests bằng fixture, không cần server live.

## 29. Debug Routing Guide

### Lỗi startup/config

Đọc:
- `src/index.js`
- `src/bootstrap/createApplication.js`
- `src/configuration/ConfigSpecs.js`
- schema/group config liên quan
- `ConfigurationContractValidator.js`

### Lỗi connect/reconnect/stale callback

Đọc:
- `src/connection/ConnectionManager.js`
- `src/connection/ReconnectManager.js`
- `src/bot/BotContext.js`
- `src/core/events/EventScopeRegistry.js`
- `src/bootstrap/createConnectionStateBinding.js`
- test `tests/unit/connection/*`

### Lỗi GUI không mở/click sai

Đọc:
- capability gọi GUI (ví dụ `CraftingOperation`, `KhoService`)
- `src/gui/GuiManager.js`
- `src/gui/knowledge/GuiKnowledgeRegistry.js`
- `data/runtime/gui/<botId>/<route>.json`
- config GUI/capability tương ứng
- test `tests/unit/gui/*`

### Lỗi inventory/count/custom item

Đọc:
- `src/items/ItemNormalizer.js`
- `src/items/ItemResolver.js`
- `src/items/inventory/InventoryReader.js`
- `InventoryScanner.js`, `InventoryCounter.js`
- `config/items/items.json`
- `data/runtime/inventory/<botId>/inventory.json`

### Lỗi `/kho`/sell/storage pressure

Đọc:
- `src/server-features/storage/KhoService.js`
- `KhoReader.js`, `KhoCapacityReader.js`
- `KhoSellOperation.js`, `SellGuiReader.js`
- `B1StorageMaterialService.js`
- `config/storage/kho.json`
- `config/minerals/conversions.json`

### Lỗi crafting/B5

Đọc:
- `CraftingOperation.js`
- `CraftingQuantityResolver.js`
- `CraftingResultVerifier.js`
- `B5AutomationService.js`
- flow đúng step trong `server-features/crafting/b5/flows/`
- `src/planning/crafting/*`
- `config/server-data/recipes.json`, `b5.json`, `crafting-tiers.json`

### Lỗi `/pv 2`

Đọc:
- `PersonalVaultService.js`
- `PersonalVaultReader.js`
- `PersonalVaultTransfer.js`
- `config/personal-vault/pv2.json`
- GUI observation `pv-2.json`

### Lỗi movement

Đọc:
- `MovementManager.js`
- `NavigationManager.js`
- `RouteExecutor.js`
- executor/mode-specific movement nếu task là Fishing
- `PositionService.js`, arrival/safety module tương ứng

### Lỗi Fishing

Đọc:
- `src/modes/fishing/FishingModeService.js`
- `FishingMovementOperation.js`
- `FishingPositionGuard.js`
- `src/server-features/fishing/FishingService.js`
- `src/server-features/afk/AfkAreaService.js`
- `config/modes/fishing.json`

### Lỗi Discord/control state không giữ sau restart

Đọc:
- `DiscordService.js`/handler liên quan
- `DiscordPanelManager.js`
- `FleetControlService.js`
- `DurableIntentStore.js`
- `FleetScheduler.js`

## 30. Current vs Target Architecture

### Current architecture

Điểm mạnh đã implement:

- Multi-bot `BotRuntime` isolation theo `botId`.
- Connection generation/session ownership và stale-event guards.
- Explicit operation/queue/lock/cancellation primitives.
- Explicit primary-mode lease qua `ModeCoordinator`.
- Command và GUI raw side-effect ownership rõ.
- GUI observation/knowledge + custom item identity.
- Planner/executor separation cho crafting.
- Durable desired-state control plane + fleet scheduler.
- Architecture/test contracts khá sâu cho reconnect và side effect.

### Target architecture

Ưu tiên tiếp theo để thành framework multi-server/multi-workflow tổng quát hơn:

1. Formalize `ServerProfile`/server adapter để MinerUA command/GUI/item/recipe không nằm chung namespace mặc định.
2. Tách server-independent service interface khỏi MinerUA-specific implementation khi có server thứ hai.
3. Chuẩn hóa operation resource ownership nếu thêm nhiều concurrent workflow phụ.
4. Chuẩn hóa event/domain result contract cho tất cả capability mới.
5. Mở rộng planner/executor model sang trade/auction/storage transaction nếu thêm feature đó.

### Known technical debt

- MinerUA-specific `src/server-features/**` chưa nằm dưới explicit `servers/minerua/` profile.
- Một số mode-specific movement/recovery nằm sâu trong `src/modes/fishing`, nên cần tránh copy sang mode mới.
- Scheduler domain recurring chưa được formalize; hiện có fleet scheduler + local timers.
- Architecture validator 2.7.2 giữ Markdown fail-closed theo `officialDocuments` + `governedDocumentRoots`; roadmap governance đã được đóng bởi WP-000.

### Migration priorities

P0: không phá generation/side-effect/mode ownership invariants hiện có.

P1: giữ document governance fail-closed; chỉ nâng một tài liệu từ governed lên official khi có quyết định authority riêng.

P2: tạo explicit server-profile boundary trước khi thêm server thứ hai.

P3: chỉ trích adapter/interface mới khi có nhu cầu thực tế; tránh refactor hình thức.


## Mode Platform v2.2

Mode extension có dependency direction chuẩn:

```text
ModeCatalog (application)
        ↓
CapabilityRegistry (per bot) ──→ generic/server capabilities
        ↓
ModeContext ──→ EventBus / OperationManager / generation-safe boundary
        ↓
ManagedMode / mode implementation
        ↓
RuntimeModeRegistry
        ↓
ModeControlService / FleetControlService / Desktop / Discord
```

### Contracts

- `ModeCatalog` là source of truth cho `modeId`, `serviceName`, `requiredCapabilities`, `requestedResources`, durable/primary metadata.
- `CapabilityRegistry` fail-closed khi mode yêu cầu capability runtime không có.
- `RuntimeModeRegistry` kiểm tra service contract `enable/disable/pause/resume/status` và bind descriptor với implementation.
- `ModeContext` là boundary ưu tiên cho mode mới: capability lookup, generation, event declaration/emission, operation execution, subscription ownership và task supervisor.
- `ManagedMode` sở hữu lease/resource lifecycle, base status, pause/resume/disable cleanup và capability readiness.
- `ModeLeaseSession` là primitive lease dùng chung cho `ManagedMode` và hai legacy mode; exact lease identity/acquire/pause/resume/release/isHeld không còn được copy riêng trong Collector/Fishing.
- `TaskSupervisor` là primitive chuẩn cho background task; Collector+B5/Fishing đã hội tụ main-loop cancellation lifetime và bounded restart scheduling vào primitive này, còn gameplay/recovery decisions vẫn là strangler debt có kiểm soát.
- `HealthRegistry` và `RuntimePlatformService` cung cấp health/introspection chuẩn, không để mỗi mode tạo format riêng.
- `DurableIntentStore` nhận supported mode ids từ catalog; `FleetControlService` resolve mode qua runtime registry, không dùng switch/if theo tên mode.
- `collector-b5` và `fishing` vẫn giữ gameplay state machine cũ bên trong, nhưng public `BotRuntime` service names đã trỏ qua `LegacyModeAdapter`; Discord/Desktop/config editor không còn nhận raw legacy service trực tiếp. Raw service chỉ còn là lifecycle-internal implementation cho strangler migration.

### Adding a mode

Mode mới nên được scaffold bằng `npm run mode:scaffold -- <mode-id> "<Label>"`. Không copy `CollectorB5ModeService` hoặc `FishingModeService` làm template. Hai mode cũ là reference behavior; SDK mới là extension contract chính.

Event mới cần connection-generation safety phải được đăng ký qua `ModeContext.declareEvent(..., { scope: 'connection' })` hoặc `EventBus.registerEventScope`, thay vì sửa global event list tùy tiện.

## Mode Platform v2.3 — B5 thuần và Composable Mode Builder

### `b5-craft` là mode B5 mặc định được khuyến nghị

`src/modes/b5-craft/B5CraftModeService.js` chỉ điều phối các capability cần cho chế B5:

```text
SkyblockAutoJoinService readiness
→ IslandService (/is)
→ B1StorageMaterialService.protectForB5Batch()
   (fresh /kho → nung raw iron/raw gold → nén B1 → bán 64-only theo immutable baseline)
→ B5PlanningService.inspectAdditionalFresh()
→ B5AutomationService.runNext()
```

Invariant của mode này:

- không nhận `movement` capability và không gọi `MovementManager`/pathfinder;
- khi storage protection kích hoạt: raw iron/raw gold được nung có verify, mọi base/phôi có block form được nén trước khi chốt sell baseline;
- sell chỉ dùng quantity `64`; surplus dưới `64` được giữ lại. Episode lớn chạy theo bounded slice/checkpoint và continuation không được tính lại baseline hoặc hấp thụ inflow mới;
- vẫn được đổi loose/base ↔ compressed block theo policy B1 để dùng vật liệu và giảm occupancy;
- B2–B5 vẫn đi qua GUI/inventory/PV2/crafting verification hiện có;
- `collector-b5` chỉ còn là compatibility workflow cho pickup/movement cũ.

### Composable Mode Builder

Custom mode được định nghĩa bằng JSON tại `config/modes/custom/*.json`, được `CustomModeStore` validate và nạp vào `ModeCatalog` khi backend boot. File lỗi bị bỏ qua ở runtime nhưng vẫn hiển thị trong Desktop để sửa/xóa.

Dependency flow:

```text
Desktop Mode Builder
→ CustomModeStore
→ WorkflowDefinitionValidator
→ ModeCatalog
→ ComposableModeService (ManagedMode)
→ WorkflowStepExecutor
→ ModeContext
→ CapabilityRegistry
→ command / GUI / movement / storage / crafting / ...
```

`WorkflowDefinitionValidator` là allowlist fail-closed. Không có `eval`, Function constructor, raw JavaScript hoặc raw chat. Slash command tùy chỉnh đi qua `SlashCommandService`: phải bắt đầu bằng `/`, một dòng, giới hạn độ dài và chặn command credential như login/register/password.

Module hiện có: registered command, slash-command, GUI click/wait/close, wait, move, look, `/is`, Sky join, storage read/protect, B5 cycle, log, condition và repeat.

Mode cần behavior/domain state machine phức tạp vẫn phải dùng Mode SDK (`ManagedMode`, `ModeContext`, `TaskSupervisor`) thay vì nhồi logic phức tạp vào JSON workflow.

### Config/control plane

Desktop 2.3 có editor chuyên dụng cho `b5CraftMode`, B5 quantity/PV2 rules, storage pressure protection và Sky auto-join; đồng thời có generic editor cho toàn bộ `ConfigSpecs`. Mọi write phải qua schema + cross-reference validation + backup. Chỉ group có explicit hot-reload contract mới được apply live; còn lại báo `restartRequired`.

## 31. Desktop session, local ZIP update và log policy (v2.5)

Desktop tách application tree khỏi mutable runtime tree. Bản cài dùng `AppData/.../runtime`; bản DEV dùng `AppData/.../runtime-dev`. `RuntimeConfigMigrator` merge default mới nhưng giữ giá trị người dùng, vì vậy cập nhật code không được dùng `config/` trong application tree làm state vận hành trực tiếp.

Environment được resolve trước lần `DesktopController.start()` đầu tiên. Ở DEV, precedence là `process environment` → `.env` chỉ điền key còn thiếu → encrypted `DesktopSecretStore` phủ cuối; bản packaged bỏ `.env` và dùng process + encrypted store. `DesktopRuntimeProvenanceService` so sánh hash/path của application defaults với runtime config theo budget, báo `IN_SYNC`, `RUNTIME_CUSTOMIZED` hoặc fail-closed `RUNTIME_INCOMPLETE`; contract không gửi nội dung file hay giá trị environment ra renderer.

Fresh process boundary:

```text
load profiles
-> prepareApplicationSession()
-> enabled profile => CONNECTED
-> disabled profile => DISCONNECTED
-> desiredMode = null
-> start runtimes
```

Server kick trong cùng process không đi qua boundary trên. Durable/session intent vẫn tồn tại, `ReconnectManager` reconnect và `FleetControlService` reconcile mode khi generation mới spawn.

Explicit per-bot OFF dùng `ReconnectManager.suspend()` + `ConnectionManager.stop()`. OFF phải thắng cả pending timer và in-flight connect; ON gọi `resume()` rồi reconcile connection intent.

Local ZIP update:

```text
select ZIP
-> scan paths/sizes/symlinks
-> extract staging
-> validate mcbot-update.json + package.json + version/dependency contract
-> backup config
-> stop backend
-> spawn local-update-helper
-> MCbot exits
-> backup application files
-> replace/delete staged files
-> rollback on failure
-> restart MCbot
-> RuntimeConfigMigrator merges defaults into runtime config
```

Desktop log pipeline:

```text
raw structured record
-> redact
-> detailed JSONL persist
-> DesktopLogPolicy
   -> hide low-level STEP/GUI/KHO/PV chatter
   -> keep operator info/warn/error
   -> suppress repeated signatures in time window
-> renderer
```

B5 pure stability adds generation guards around preparation/storage/crafting and bounded no-progress backoff keyed by the concrete blocker.

### Scoped Sky commands (2.6.12)

`SkyCommandRegistry` sở hữu dữ liệu lệnh do người vận hành đăng ký theo Sky. `SkyCommandService` là cổng thực thi duy nhất: nó kiểm tra HUB/SKY readiness, selection, generation và gửi qua `SlashCommandService`/`CommandExecutor`. Registry hệ thống trong `commands.json` không bị mutate. Desktop và Mode Builder đều gọi cùng service này để tránh hai đường thực thi khác nhau.

### B5 campaign normalization scheduling (2.6.13)

`B5CraftModeService` tách hai khái niệm: production campaign đang tiến triển và idle material wait. `productive=true` là transaction-level evidence của tiến triển nên luôn reset no-progress/backoff và yêu cầu fresh re-plan, không kích hoạt normalization. `nextIdleB1NormalizationAt` chỉ được schedule cho blocker nhóm `materials` khi cycle không productive. B5 completion/new connection generation vẫn dùng `forceB1Normalization` làm hard boundary. Cách này ngăn wall-clock normalization chen giữa B2/B3/B4 trong cùng campaign.



### Reconciliation / storage telemetry hardening (2.6.15)

- Capacity telemetry is not authoritative merely because a label regex matched. Absolute counts reject percentage tokens and are cross-checked against the item totals parsed from the same `/kho` snapshot. Impossible telemetry falls back to the configured storage limit plus parsed item totals.
- Craft quarantine separates strong click-time side-effect evidence from fresh state observations. One transient lower storage read is provisional; only repeated consecutive evidence confirms a fresh side effect.
- When there was no strong click-time side effect and repeated fresh state keeps every observable expected input at or above its baseline while the expected output remains unchanged, the stale transaction baseline may be superseded and the planner re-plans from current state. This is a fresh-plan transition, not a blind replay of the stale click.

### Infrastructure / remote hardening (2.6.14)

- `GuiManager.waitForPostCloseSettle()` là pacing primitive chung cho service mở GUI sau một close event; storage/PV dùng cùng contract thay vì sleep rải rác.
- `SkyblockAutoJoinService` sở hữu manual HUB hold + managed join, giữ HUB/SKY readiness ở một owner.
- Discord `remoteOnly` chỉ expose control plane; Desktop giữ configuration/diagnostic plane.
- Test runner có source-only gate và installed gate tách biệt để dependency availability không che regression logic.

## 2.7 - Local AI Agent boundary

### CURRENT

Desktop có một AI control-plane riêng dưới `src/ai/`:

```text
Desktop renderer
  -> trusted IPC (`mcbot:ai:*`)
  -> LocalAiService
  -> AgentSession
     -> OllamaProvider (loopback OpenAI-compatible API)
     -> AiToolRegistry
        -> ProjectWorkspace (search/read/controlled edits)
        -> allowlisted verification runner
        -> DesktopController read/runtime-control boundary
```

Các invariant:

1. Local model không sở hữu filesystem, shell, Mineflayer hoặc raw server chat.
2. Project source được truy cập bằng tool; secret/environment/runtime-data/build output bị loại khỏi workspace.
3. Permission tăng dần `READ < PATCH < DEVELOP < ADMIN`; tool không được expose nếu permission chưa đủ.
4. `DEVELOP` chỉ chạy check allowlist, không expose command string tùy ý.
5. `ADMIN` điều khiển bot qua `DesktopController`/core service hiện hữu; không tạo side-effect owner Minecraft mới.
6. AI không trở thành authority của deterministic B5/storage/crafting core. AI có thể chẩn đoán, sửa source, test và ra operator intent; runtime invariant/verification vẫn do core quyết định.
7. Renderer giữ `connect-src 'none'`; network Local AI chỉ ở Electron main process và provider bị khóa vào loopback.

## 2.7.3 - Architecture baseline evidence

WP-001 thêm một baseline tool **read-only** cho migration/audit. `scripts/inspect-architecture-baseline.js` dựng baseline từ source/config/test hiện tại và chỉ xuất stdout; `--check` chỉ xác minh committed manifest, exclusion policy và so sánh lại các số liệu architecture validator. Inspector không tự ghi/mutate repository.

Baseline ghi source-area ownership/layer, runtime/project reachability, raw side-effect owner/callsite, connection event producer/generation guard, ModeCatalog/capability binding, vị trí MinerUA fact và config consumer/reload evidence. Nó không đọc `.env*`, `data/**`, `node_modules/**` hoặc log; payload `config/bots/**` không được content-scan. Baseline là evidence CURRENT, không có authority sửa gameplay và không tự khắc phục DEBT.

## 2.7.67 - Product experience và decomposition closure

CURRENT Desktop operator path dùng contract/projection thay vì gửi toàn bộ runtime object:

```text
BotRuntime / failure artifacts / configuration
  -> Desktop operator services
     -> IncidentIndexStore / OperatorHealthService / B5OperatorProjection
     -> ConfigurationWorkspaceService / BackupCatalogService
  -> OperatorSnapshotProjector
  -> DesktopApiContract + trusted preload IPC
  -> renderer core/page/feature presenters
```

Snapshot có revision/digest và được coalesce bằng `SnapshotDeliveryCoordinator`. Detail incident, bot và B5 được tải theo use case riêng. Renderer vẫn giữ `app.js` làm compatibility façade trong giai đoạn strangler; module mới nằm dưới `core/components/pages/features`, và static quality manifest khóa size/complexity hiện tại để façade không phình thêm.

Desktop composition tiếp tục được tách vật lý: `DesktopRuntimeBootstrap` sở hữu thứ tự migrate/runtime-root/environment/provenance, còn `BotProfileUseCases` sở hữu allowlist và lời gọi quản trị profile. `DesktopController` và Electron `main.js` chỉ giữ façade/dispatch tương thích, và static-quality gate cấm chúng tăng trở lại.

B5 mode giữ nguyên side-effect order và owner. Phần state/policy được tách ra:

```text
B5CraftModeService (lifecycle + side-effect façade)
  -> B5CampaignSession
  -> B5BatchCoordinator
  -> StorageProtectionEpisode
  -> B5FaultPolicyAdapter
  -> B5StatusProjection
  -> B1StorageMaterialService / B5AutomationService capabilities
```

`RuntimeConfigMigrator` giữ public façade nhưng delegating seam đã có cho version reader, pure planner, journal, filesystem applier, tree verifier và recovery coordinator. Mọi mutation file mới phải được khai báo trong `architecture/artifact-ownership.json`.

Composable Mode Builder dùng presentation schema cho đủ 17 module, typed start/loop/stop editor, bounded `if/repeat`, static dry-run không gọi capability, template metadata và deterministic package manifest. Unknown field bị loại khi normalize; storage protection không có toggle để bỏ nung sắt/vàng.

R6 hiện là quyết định `NO_GO_MONOLITH_SUFFICIENT`, không phải work package bị quên. Benchmark synthetic 1/8/16/32/64 bot đạt contract operator projection hiện tại; không có bằng chứng cho thấy worker/process isolation đáng đổi lấy protocol, split-brain và vận hành phức tạp hơn. Quyết định phải mở lại nếu field SLO hoặc incident driver đáp ứng điều kiện XP-500.
