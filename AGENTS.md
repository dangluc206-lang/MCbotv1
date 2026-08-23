# AGENTS.md

## Mission

Repository này là một **extensible multi-bot Minecraft automation framework** viết bằng Node.js/Mineflayer. Các workflow hiện tại như `collector-b5` và `fishing` là consumer của framework, không phải định nghĩa của framework.

Mục tiêu khi sửa code là giữ cho hệ thống có thể mở rộng thêm mode, capability và server profile mà không đưa logic server-specific vào generic core.

Tài liệu có trách nhiệm riêng:

- `AGENTS.md`: AI/developer phải làm việc thế nào.
- `ARCHITECTURE.md`: code hiện tại được tổ chức và chạy thế nào; phần nào là CURRENT, phần nào là TARGET.
- `SERVER_BEHAVIOR.md`: source of truth cho command, GUI, custom item, timing và quirks riêng của server.
- `RULES.md`: invariant bắt buộc và boundary chi tiết hiện có.
- `JS_RESPONSIBILITIES.md`: trách nhiệm file/class chi tiết hiện có.

Nếu task liên quan server mechanics, luôn đọc `SERVER_BEHAVIOR.md` trước khi kết luận.

## Quy trình đọc repository tiết kiệm token

Mặc định làm theo thứ tự sau:

1. Đọc `AGENTS.md`.
2. Xác định loại task: connection, mode, GUI, inventory, crafting, storage, movement, Discord, config, persistence, test...
3. Đọc đúng section trong `ARCHITECTURE.md`.
4. Nếu có command/GUI/item/cooldown/server timing thì đọc section tương ứng trong `SERVER_BEHAVIOR.md`.
5. Search symbol, error code, command key, event hoặc function liên quan bằng `rg`/IDE.
6. Đọc file implementation trực tiếp.
7. Đọc caller/callee và test trực tiếp liên quan.
8. Chỉ mở rộng context nếu các file trên chưa đủ giải thích root cause.

Không mặc định đọc toàn bộ `src/**`, `config/**`, `tests/**`, `data/**` hoặc full log.

### Context budget mặc định cho một bug

Ưu tiên:

- `AGENTS.md`;
- 1 section liên quan trong `ARCHITECTURE.md`;
- 1 section liên quan trong `SERVER_BEHAVIOR.md` nếu là server behavior;
- 2–6 source files;
- config/data observation đúng capability;
- test cùng module;
- đoạn log ngắn quanh lỗi, có `botId`, `connectionGeneration`, `operation`, `step` nếu có.

Chỉ đọc log lớn khi cần timeline dài; trước hết hãy lọc bằng `errorCode`, `operation`, `step`, `botId`, `recipeId`, command hoặc timestamp.

## Routing nhanh theo loại task

- Bootstrap/startup: `src/index.js`, `src/bootstrap/createApplication.js`, `src/bootstrap/registerBotServices.js`.
- Multi-bot/runtime: `src/core/Application.js`, `src/bot/BotRuntime.js`, `src/bot/BotContext.js`, `src/bot/BotRegistry.js`.
- Connection/reconnect: `src/connection/ConnectionManager.js`, `src/connection/ReconnectManager.js`, `src/bootstrap/createConnectionStateBinding.js`.
- Event/stale generation: `src/core/EventBus.js`, `src/core/events/EventEnvelope.js`, `src/core/events/EventScopeRegistry.js`.
- Mode ownership: `src/modes/ModeCoordinator.js`, mode service tương ứng.
- Command: `src/commands/CommandService.js`, `CommandExecutor.js`, config `config/commands/*`.
- GUI: `src/gui/GuiManager.js`, `src/gui/click/*`, `src/gui/knowledge/GuiKnowledgeRegistry.js`, observation tương ứng.
- Inventory/item identity: `src/items/**`, đặc biệt `ItemNormalizer.js`, `ItemResolver.js`, `items/inventory/*`.
- Movement: `src/movement/MovementManager.js`, `navigation/RouteExecutor.js`, executor đặc thù nếu có.
- Storage `/kho`: `src/server-features/storage/*` và `config/storage/kho.json`.
- Crafting `/ks`: `src/server-features/crafting/*`, `src/planning/crafting/*`, `config/server-data/*`, `config/minerals/menu.json`.
- B5: `src/server-features/crafting/B5AutomationService.js`, `src/server-features/crafting/b5/flows/*`, `src/planning/crafting/B5Planner.js`.
- Fishing: `src/modes/fishing/*`, `src/server-features/fishing/FishingService.js`, `config/modes/fishing.json`.
- Discord/control plane: `src/discord/**`, `src/recovery/FleetControlService.js`, `src/fleet/FleetScheduler.js`.
- Config contract: `src/configuration/ConfigSpecs.js`, schema tương ứng, `ConfigurationContractValidator.js`.

Xem `ARCHITECTURE.md` mục **Debug Routing Guide** để có routing chi tiết hơn.

## Dependency boundaries

CURRENT repository có các layer/capability thực tế sau:

```text
src/index.js
  -> bootstrap
  -> Application / BotRegistry
  -> BotRuntime
  -> mode/workflow
  -> service/domain capability
  -> command/gui/inventory/movement/connection adapter-like modules
  -> Mineflayer / Minecraft server
```

Quy tắc:

- `bootstrap`: wire dependency; không chứa domain workflow.
- `core`/`bot`: lifecycle, registry, event/state primitive; không biết B5, `/kho`, `/ks`.
- `mode`: điều phối hành vi dài hạn; không tự gọi raw Mineflayer side effect nếu capability đã tồn tại.
- `service/domain`: cung cấp capability như storage, crafting, island, fishing.
- `commands`, `gui`, `movement`, `items`, `connection`: adapter/capability thấp hơn, bao side effect cụ thể.
- `listener`: chuyển raw event thành event/state nội bộ và phải generation-safe.
- `Discord`: control plane; không phải nơi implement Minecraft workflow.
- `config`: definition/policy tĩnh; không phải runtime state.
- `data/runtime`: observation/persistence; không phải config authority.
- server-specific command/GUI/item/timing không được rải vào generic core.

Tầng thấp không được import mode/workflow tầng cao.

## Side-effect ownership

Theo CURRENT architecture và `architecture/catalog.json`:

- Chỉ `src/commands/CommandExecutor.js` được gọi `bot.chat()` cho server command.
- Chỉ `src/gui/click/ClickExecutor.js` được gọi `clickWindow()`.
- Chỉ `src/connection/ConnectionManager.js` sở hữu `client.end()`.
- Raw fishing protocol `_client` chỉ thuộc `src/modes/fishing/ConnectionPacketObserver.js` theo catalog hiện tại.

Không tạo đường tắt từ mode/Discord thẳng tới các API trên.

## Async, concurrency và ownership

Minecraft automation là stateful. Không dùng `Promise.all()` cho các hành động có thể xung đột GUI, inventory, movement hoặc command chỉ để chạy nhanh hơn.

Bắt buộc giữ các nguyên tắc:

- Một bot không chạy hai GUI transaction xung đột.
- Không có hai workflow cùng mutate inventory cùng lúc.
- Command phải đi qua throttle/serialization hiện có.
- Operation nhiều bước đi qua `OperationManager` khi capability hiện tại đã làm như vậy.
- Primary mode phải sở hữu lease của `ModeCoordinator`; không tự check boolean của mode khác để loại trừ.
- Pause/disable/stop/reconnect phải cancel operation và cleanup side effect do owner cũ tạo.
- Listener/callback cũ phải kiểm tra `botId` và `connectionGeneration` trước khi tác động runtime mới.
- Không để callback generation cũ release lease/lock/session của generation mới.

## Verification-first

Trong game automation:

```text
action sent != action succeeded
```

Ví dụ:

- `bot.chat()` hoặc command send thành công != server command thành công.
- GUI click resolve != recipe/sell thành công.
- pathfinder Promise resolve != vị trí cuối hợp lệ.
- shift-click resolve != item đã nằm đúng destination.
- `/is` gửi được != bot đã teleport.

Flow chuẩn:

```text
BEFORE
-> ACTION
-> OBSERVE EVENT/GUI/INVENTORY/POSITION
-> AFTER
-> VERIFY POSTCONDITION
```

Không xóa verification chỉ để workflow chạy qua lỗi.

## Quy tắc sửa bug

Trước khi sửa, ghi được tối thiểu:

```text
Observed behavior
Expected behavior
Root cause
Affected layer
Smallest safe fix
Verification
Regression risk
```

Sau đó:

1. Tìm error code/symbol và caller trực tiếp.
2. Xác định lỗi là server observation, config, stale generation, concurrency, domain plan hay executor.
3. Sửa tại layer sở hữu root cause.
4. Giữ public contract/backward compatibility nếu task không yêu cầu đổi.
5. Thêm/cập nhật test tái hiện bug.
6. Chạy test targeted trước, broader regression sau nếu đụng core.

Cấm “fix” bằng cách tăng `sleep()`, tăng retry vô hạn, bỏ timeout, bỏ generation guard hoặc bỏ verification nếu chưa chứng minh timing là contract thật.

## Quy tắc thêm feature

Trước khi tạo service/helper/file mới:

1. Search capability tương tự.
2. Xác định layer và owner.
3. Reuse abstraction hiện có.
4. Không duplicate queue, connection manager, GUI click path, item resolver, operation system hoặc mode ownership.
5. Tách generic capability khỏi server-specific profile/behavior nếu có thể.
6. Nếu feature cần server mechanic mới, cập nhật `SERVER_BEHAVIOR.md` với status phù hợp.

Ví dụ:

- Fishing mới không tạo connection manager riêng.
- Auction workflow không tự gọi `clickWindow()` nếu GUI abstraction đã tồn tại.
- Server mới không được làm generic core assume `/kho` hoặc `/ks` tồn tại.

## Config vs runtime vs observation

Không trộn:

- Configuration: `config/**`, immutable definition/policy sau validate.
- Runtime state: `BotState`, mode status, connection state, lease, active operation.
- Persistent desired state: `DurableIntentStore`, panel metadata nếu liên quan.
- Server-observed state: `data/runtime/gui/**`, inventory observation, runtime log.
- Derived state: planner output, counts, pressure calculation, readiness.

Observation có thể stale. Luôn xem generation/timestamp/source trước khi dùng để khẳng định server contract.

## Server-specific isolation

Các kiến thức như sau thuộc `SERVER_BEHAVIOR.md`, không phải generic core:

- `/is`, `/sky`, `/kho`, `/kho sell`, `/pv 2`, `/ks`, `/nung`, `/afk`, `/d`;
- GUI title/slot/fingerprint;
- left/right/shift-click meaning trong server GUI;
- MMOItems/custom item identity;
- storage capacity/format;
- crafting quantity buttons;
- daily recovery 03:00/05:00;
- server-specific cooldown và join flow.

Kiến trúc mục tiêu:

```text
generic engine
  -> server capability/profile
  -> server-specific behavior/knowledge
```

Không hard-code server hiện tại sâu trong `core`, `bot`, `operations`, `items` generic hoặc `movement` generic.

## Logging và diagnostics

Ưu tiên structured log đủ để debug từ đoạn ngắn:

```text
botId
serverId/profile
connectionGeneration
mode
workflow
operation
step
resource
recipeId
action
attempt
reason
before
after
verification
duration/error elapsed
errorCode
operationId
correlationId
```

Không dump full inventory/GUI/NBT ở INFO. Snapshot lớn để DEBUG/data observation.

Error code nên ổn định theo nhóm:

```text
CONNECTION_*
COMMAND_*
GUI_*
INVENTORY_*
MOVEMENT_*
CRAFTING_*
STORAGE_*
SERVER_*
CONFIG_*
TIMEOUT_*
VERIFICATION_*
```

Không parse message text như public API nếu đã có `code`/`status`/structured metadata.

## Tests

Khi sửa JavaScript:

```text
node --check file-da-sua.js
-> targeted unit test
-> affected service/integration test
-> npm test nếu scope đủ rộng
-> npm run validate nếu thay đổi architecture/config contract
```

Không sửa test để che implementation sai.

Planner/pure logic nên test được không cần Minecraft thật. Tests mặc định không được phụ thuộc server public đang online.

### Governance tài liệu hiện tại

`architecture/catalog.json` phân biệt hai mức: `officialDocuments` là exact allowlist cho tài liệu source-of-truth ở root; `governedDocumentRoots` cho phép một documentation tree được validator quản lý mà không nâng toàn bộ tree lên cùng authority. CURRENT governed root là `docs/architecture-roadmap`. `scripts/validate-architecture.js` vẫn reject Markdown nằm ngoài hai boundary này và fail-closed với root thiếu, traversal, sai casing hoặc symlink.

Roadmap là TARGET/migration program. Khi roadmap mâu thuẫn với task hiện tại, `AGENTS.md`/`RULES.md`, `SERVER_BEHAVIOR.md`, `ARCHITECTURE.md`, source/config/test CURRENT thì authority cấp cao hơn thắng. Không dùng roadmap để khẳng định capability đã tồn tại.

## Không được tự ý làm

- Đổi framework hoặc thay Mineflayer.
- Đổi version Mineflayer/Minecraft/protocol nếu task không yêu cầu.
- Chuyển toàn repo CJS <-> ESM.
- Rewrite module lớn khi fix nhỏ đủ giải quyết root cause.
- Tắt/xóa verification.
- Hard-code GUI observation chưa được xác nhận.
- Tăng retry vô hạn hoặc sleep để che race.
- Thay server behavior bằng assumption.
- Tạo mutable singleton bot-scoped dùng chung nhiều bot.
- Bỏ generation guard/stale event protection.
- Phá backward compatibility mà không nêu rõ.
- Đọc/chỉnh `.env` thật, commit credential/token/password/session.
- Serialize raw Mineflayer client/window/packet vào durable state.
- Tự sửa task tiếp theo ngoài scope người dùng.

## Definition of Done

Task hoàn thành khi:

- root cause hoặc feature requirement đã được giải quyết;
- dependency boundary vẫn đúng;
- owner/lock/cancellation/cleanup hợp lý;
- verification vẫn tồn tại;
- stale-generation protection không bị suy yếu;
- test liên quan pass, hoặc failure ngoài scope được báo rõ;
- không tạo duplicate capability;
- config/docs/server behavior được cập nhật nếu contract thay đổi;
- không đưa secret hoặc full runtime dump vào output.


## Mode extension rules (v2.2+)

Khi thêm mode mới:

- dùng `ModeCatalog` + `RuntimeModeRegistry`; không thêm `if (mode === ...)` vào `FleetControlService`/durable recovery;
- khai báo dependency bằng `requiredCapabilities`; không inject raw Mineflayer client khi capability tương ứng đã tồn tại;
- ưu tiên `ManagedMode` + `ModeContext` + `TaskSupervisor` cho lifecycle/loop mới;
- listener/timer phải thuộc `SubscriptionBag` hoặc supervisor để disable/destroy cleanup được;
- event connection-scoped mới phải đăng ký scope và mang `botId` + `connectionGeneration`;
- mode status cần đi qua contract `status()` và platform introspection; không tạo control-plane-only state;
- resource conflicts phải khai báo bằng `requestedResources` và đi qua `ModeCoordinator`;
- thêm test chứng minh mode có thể bind/start/recover qua generic registry trước khi thêm logic server-specific.

## B5 thuần và Mode Builder rules (v2.3+)

- `b5-craft` là B5 mode khuyến nghị. Không thêm movement/pathfinder/pickup. Storage protection được phép gọi `/nung` chỉ cho raw iron và raw gold theo contract đã được user xác nhận.
- Boundary trước mỗi đợt B5 bắt buộc theo thứ tự: fresh `/kho` -> nung raw iron/raw gold -> nén mọi B1 family có block form -> chốt immutable sell baseline -> bán surplus bằng đúng quantity `64` -> giữ lại phần dư dưới `64` -> verify còn tối thiểu 1.5 B5 -> mới craft.
- Sell episode lớn phải chia thành bounded slices và tiếp tục đúng immutable baseline/episode; không chạy lại nung/nén, không hấp thụ inflow mới và không tính verified continuation là business failure.
- `collector-b5` là legacy/compatibility, không dùng làm template cho feature mới.
- Workflow đơn giản nên thử ghép bằng `src/modes/composable/*` trước khi tạo mode code mới.
- Module tùy chỉnh phải đi qua allowlist/schema; tuyệt đối không thêm `eval`, `new Function`, arbitrary JS hoặc raw chat.
- Slash command tùy chỉnh chỉ đi qua `SlashCommandService`, phải bắt đầu `/` và không được phép chứa credential command.
- Module side effect phải gọi capability trong `ModeContext`; không import Mineflayer bot/client trực tiếp từ `ComposableModeService`/`WorkflowStepExecutor`.
- Custom mode file lỗi không được làm backend fail boot. Giữ behavior skip-at-runtime + visible-for-repair trong Desktop.
- Config Desktop write phải đi qua `ConfigurationValidator` + `ConfigurationContractValidator` và backup; không ghi JSON thẳng từ renderer.
- Khi thêm module mới, bắt buộc: validator schema + capability dependency + executor implementation + module catalog + targeted test + architecture reachability.

## Session / reconnect / local update rules (v2.5+)

- Một process MCbot mới là một operator session mới: profile `enabled` được tự kết nối, nhưng `desiredMode` của process trước phải bị xóa trước khi runtime start.
- Server kick/reconnect trong cùng process không được xóa mode intent; `connection:spawned` reconcile lại mode hiện tại.
- Explicit disconnect của một bot phải suspend `ReconnectManager` đúng bot đó, hủy pending timer và dọn cả connect attempt/client xuất hiện muộn. Explicit connect phải resume reconnect policy.
- `b5-craft` phải bỏ kết quả nếu `connectionGeneration` thay đổi giữa bất kỳ side effect/snapshot/craft nào; không được tính output của generation cũ.
- Cùng một no-progress blocker B5 lặp lại phải dùng bounded backoff và log suppression; không tăng retry vô hạn hoặc spam `/kho`/`/pv 2`.
- Desktop UI log là operator summary. Detailed JSONL vẫn là forensic source; không đổ toàn bộ STEP/GUI/KHO/PV meta vào renderer.
- Local ZIP update chỉ được ghi application tree, không ghi `.env`, runtime data, logs, backups, secrets hoặc `config/modes/custom`.
- ZIP update phải có `mcbot-update.json`, version/base version hợp lệ và dependency runtime không đổi. Dependency đổi => dùng installer.
- Update helper phải backup target trước khi replace/delete và rollback nếu apply thất bại.

## GUI Identity / B5 replay invariant (2.6+)

- Không nhận diện GUI stateful chỉ bằng command hoặc regex đầu tiên khớp. Dùng `GuiIdentityEngine` và kiểm tra confidence/evidence; transition/semantic evidence phải khớp với nghiệp vụ trước khi click.
- Planner B5 phải giữ pure: không network, không GUI click, không timer side effect. Quyết định phải có snapshot digest/replay input để regression có thể phát lại offline.
- Log Desktop tiếp tục gọn; trace/replay chi tiết đi qua B5TraceRecorder/support bundle, không spam renderer.

## Local AI Agent rules (2.7+)

- `src/ai/**` là development/control-plane capability, không phải gameplay authority.
- Không cho model raw `child_process` command, raw `bot.chat()`, raw `clickWindow()` hoặc truy cập secret/.env.
- Mọi tool sửa file phải khóa trong workspace và chống path traversal/symlink escape.
- Quyền mutation/runtime phải fail-closed theo permission `READ/PATCH/DEVELOP/ADMIN`.
- Khi agent sửa code, ưu tiên `apply_patch`, sau đó chạy check/test liên quan; không báo PASS nếu tool không thực sự chạy.
- Runtime control của AI phải đi qua boundary DesktopController/service hiện hữu, không bypass command/mode/operation owner.
