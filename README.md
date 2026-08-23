# MCbot V1

## 2.6.16: B5 batch storage protection + mode-driven Sky gateway

Mỗi campaign B5 bắt đầu bằng một boundary cố định: đọc fresh `/kho` → nung raw iron/raw gold (không nung stone) → nén toàn bộ B1 → bán đúng phần vượt reserve 1.5 B5 → verify, rồi mới chế. Trong campaign không còn pressure/burst/forecast/click-limit hay bán chen giữa các tier; pure B5 bung B1 không giới hạn, còn Collector+B5 giữ headroom riêng qua `b1Decompression`.

Sky không còn `autoJoin.enabled/maxAttempts`. Mode B5/Collector/Fishing tự demand `skyTarget` của bot (`sky1`, `sky2`, `skyOP` hoặc profile khác), gateway retry đúng target khi bị trả về HUB và release demand khi mode dừng. Desktop/config đã bỏ các toggle/tuning legacy tương ứng; migration 2.6.16 tự dọn cấu hình cũ.

## 2.6.15: reconciliation + capacity parser hardening

`/kho` không còn hiểu nhầm percentage-only telemetry như `Đã sử dụng: 100.0%` thành `used=1000`. Capacity tuyệt đối được cross-check với tổng item cùng snapshot; dữ liệu mâu thuẫn bị loại và fallback về tổng item với limit cấu hình.

Reconciliation vẫn fail-closed sau quantity click, nhưng một fresh-read storage giảm tạm thời không còn biến thành side-effect sticky vô hạn. Fresh side-effect phải được xác nhận qua nhiều read liên tiếp; nếu click ban đầu không có strong side-effect evidence và trạng thái material mới giữ toàn bộ input ở baseline hoặc cao hơn qua nhiều fresh-read, stale baseline được coi là superseded và planner được re-plan từ state mới.

## 2.6.14: hạ tầng runtime + Discord remote-only

Discord hiện là remote control thuần: chọn bot, kết nối/ngắt riêng bot, Vào Sky/Về HUB, `/is`, điều khiển mọi mode trong ModeCatalog và gọi lệnh Sky đã đăng ký. Cấu hình/chẩn đoán sâu thuộc Desktop. `Về HUB` tạo manual HUB hold theo connection generation để auto-join không kéo bot quay lại Sky; `Vào Sky` đi qua `SkyblockAutoJoinService` để readiness luôn nhất quán.

`GuiManager` có post-close command gate dùng chung cho `/kho` và `/pv 2`, giảm trường hợp server bỏ command đầu ngay sau khi GUI vừa đóng. GUI `/nung` có strong identity riêng cho title MinerUA. Test runner tách `npm test` source-only khỏi `npm run test:installed` để thiếu dependency không bị báo lẫn thành regression logic.

## 2.6.9: reconciliation theo nguồn + B2 ALL transaction boundary

Reconciliation giờ giữ `source` cho từng baseline input: B1 storage chỉ so với `/kho`, inventory chỉ so inventory, PV chỉ so `/pv 2`; thiếu baseline thật thì fail-closed. Mỗi `B1 -> B2 ALL` là một transaction boundary: sau đúng một ALL phải fresh re-plan/compact/promote trước khi có mutation tiếp theo. Strong MMOItems identity cố định từ `items.json` được dùng ngay bởi verifier; policy `learn` như tungsten vẫn chỉ khóa identity sau quan sát thật.

## 2.6.8: reconciliation sau side-effect + strong identity contract

B5 thuần không còn retry mù sau khi đã click nút số lượng. Nếu server outcome chưa xác minh được, craft được đánh dấu `CRAFTING_OUTCOME_UNCERTAIN`, đặt vào reconciliation barrier và chỉ đọc lại trạng thái; cùng mutation bị khóa cho tới khi thấy output thật hoặc chứng minh được các input quan sát được vẫn nguyên vẹn qua nhiều fresh-read. Input lấy trực tiếp từ `/kho` mà không có baseline đủ mạnh sẽ fail-closed, không tự click `ALL` lần hai.

Error taxonomy được tập trung về `Operation.statusForError`; B2–B5 được validator bắt buộc strong MMOItems identity cho inventory/PV hoặc policy `learn`. `tungsten` dùng learn-once thay vì đoán ID: strong identity chỉ được khóa sau quan sát thật và không thể bị chuyển chủ. Desktop cho chỉnh tham số reconciliation nhưng không thể tắt barrier; migration 2.6.7→2.6.8 giữ nguyên tùy chỉnh và fixed tungsten identity của người dùng.

## 2.6.3: nung + nén trước bảo vệ kho

Khi `/kho` chạm ngưỡng cần bảo vệ, B5 thuần đổi thứ tự thành **chỉ nung raw iron/raw gold → nén base/phôi thành block → đọc lại áp lực → bán/bảo vệ kho → B5 planner**. Nếu bước nén đã đủ hạ áp lực thì không bán. `allowSmelting` mặc định bật và có checkbox trong Desktop; không dùng movement/pathfinder. Runtime 2.6.2 được migration giá trị `allowSmelting:false` bắt buộc lịch sử sang `true` sau khi backup config.

## 2.6.2: sửa migration GUI Identity runtime

2.6.2 sửa trường hợp runtime được tạo từ 2.5.x vẫn giữ regex GUI cũ sau khi nâng lên 2.6.0. Migration mới backup config rồi chỉ nâng đúng các giá trị mặc định cũ của `/kho` và `/pv 2`, giữ nguyên cấu hình người dùng khác. Điều này ngăn `/pv 2` mở đúng nhưng bị Identity V2 chấm confidence thấp, tự đóng rồi retry đến timeout.


## 2.6.0: GUI Identity V2 + B5 Planner/Trace/Replay

Từ 2.6.0, GUI không còn được nhận diện theo kiểu "regex nào khớp trước thì thắng". `GuiIdentityEngine` chấm confidence từ title, layout, fingerprint, command context, session trước và semantic evidence. `/kho`, `/pv 2`, root `/ks`, menu chế tạo và menu số lượng đều được khóa identity trước khi thao tác; GUI mâu thuẫn/không đủ confidence sẽ bị từ chối thay vì click nhầm.

B5 có `B5ExecutionPlanner` thuần (không click/send/wait) tạo decision, blocker, snapshot digest và replay input cho mỗi inspection. `B5TraceRecorder` giữ trace chu kỳ gọn trong RAM; gói hỗ trợ tự kèm fixture replay B5 mới nhất của từng bot. Có replay offline bằng `npm run replay:b5`, cùng fixture GUI MinerUA để khóa regression `/kho` ↔ `/pv 2`.

## 2.5.0: cập nhật ZIP + session mode + log gọn

Từ 2.5.0, `Cài đặt -> Cập nhật phần mềm` có thể chọn gói `MCbot_x.y.z_update.zip`. MCbot kiểm tra manifest, version/base version, dependency, đường dẫn và vùng dữ liệu được bảo vệ; sau đó backup, dừng backend, giao việc thay file cho updater riêng và khởi động lại. Cấu hình người dùng không còn nằm trong cây code khi chạy Desktop: bản DEV dùng `AppData/.../runtime-dev`, bản cài dùng `AppData/.../runtime`.

Một lần mở MCbot mới chỉ tự kết nối các bot profile đang bật và auto join Sky. Mode không tự bật lại từ phiên trước. Ngược lại, khi server kick trong cùng phiên, durable intent vẫn còn nên bot reconnect và mode được reconcile/tiếp tục. Nút Ngắt của từng bot suspend reconnect riêng của bot đó.

B5 thuần có generation guard và no-progress backoff: kết quả sinh ra từ connection generation cũ bị loại, còn cùng một blocker lặp lại sẽ tăng thời gian chờ có giới hạn thay vì spam GUI. Nhật ký Desktop chỉ hiển thị hoạt động chính; trace chi tiết vẫn nằm trong `data/logs`.


Framework Minecraft bot đa năng viết bằng Node.js/Mineflayer, được tổ chức theo hướng **multi-bot**, **config-driven**, có workflow/mode, service theo capability, Discord control plane, reconnect/recovery và verification cho các thao tác stateful.

Repository hiện chạy chủ yếu với server MinerUA/Skyblock và đã có các use-case như Chế B5 thuần, Collector + B5 tương thích, Fishing, GUI automation, storage, crafting, movement, Mode Builder và Discord. Đây là các module hiện tại, **không phải giới hạn kiến trúc của framework**.

> B5 là một workflow sử dụng framework. Core của dự án không được thiết kế riêng cho B5.

## Trạng thái hiện tại

### Mode

| Mode | Trạng thái | Ghi chú |
|---|---|---|
| `b5-craft` | CURRENT / RECOMMENDED | Chế B5 thuần: `/is` → đọc kho → nếu cần bảo vệ: nung raw → nén phôi thành khối → bảo vệ kho → B1→B5; **không di chuyển** |
| `collector-b5` | LEGACY / COMPAT | Collector + B5 cũ, có movement/preprocessing |
| `fishing` | CURRENT | Fishing + movement/position guard/recovery |
| Custom Mode Builder | CURRENT | Ghép mô-đun lệnh `/`, GUI, movement, wait, condition, repeat... |
| `mining` | PLANNED | Chưa có primary Mining Mode |
| `farming` | PLANNED | Hướng mở rộng |
| `auction/trading` | PLANNED | Hướng mở rộng |

### Server support

| Server/profile | Trạng thái |
|---|---|
| MinerUA / Skyblock | CURRENT |
| Server/profile khác | Chưa triển khai đầy đủ |

Kiến trúc được định hướng để có thể thêm server/profile mới mà không rewrite generic core. Chi tiết `CURRENT` và `TARGET` nằm trong [`ARCHITECTURE.md`](ARCHITECTURE.md).

### Đã có trong repository

- Multi-bot runtime với profile riêng cho từng bot.
- Mineflayer connection lifecycle, reconnect và session/generation ownership.
- `OperationManager`, queue, timeout, cancellation và lock policy cho thao tác stateful.
- `ModeCoordinator` để điều phối mode và ownership tài nguyên.
- Command abstraction và response matching.
- GUI detection, observation, knowledge, slot resolution, click queue và click verification.
- Inventory/item identity với support custom item/MMOItems identity.
- Movement/navigation, arrival/stuck/safety handling.
- Server features cho Skyblock, island, `/kho`, `/kho sell`, `/pv 2`, `/ks`, smelting, mineral conversion, dungeon, fishing và resource pack.
- Planner/executor cho crafting B1 → B5.
- `b5-craft` mode khuyến nghị, cho phép chỉ nung raw iron/raw gold trước bảo vệ kho (`allowSmelting=true` mặc định) và không có movement dependency.
- `collector-b5` mode cũ để tương thích.
- `fishing` mode.
- Mode Platform + Mode Builder an toàn cho custom workflow.
- Discord slash commands, control panel và error reporting.
- Durable desired state qua `DurableIntentStore`/`FleetControlService`.
- Structured logging, runtime failure diagnostics và replay harness.

### Hướng mở rộng

Các capability/workflow dự kiến có thể bổ sung:

- farming;
- mining;
- combat;
- mob farming;
- auction/trading;
- buying/selling;
- quest/NPC interaction;
- resource gathering;
- navigation workflow;
- scheduled/event automation;
- nhiều server/profile khác nhau.

## MCbot Desktop — sản phẩm Windows

MCbot Desktop là control plane chính cho người dùng Windows. Giao diện chạy trên Electron nhưng sử dụng trực tiếp backend/runtime hiện có; logic Mineflayer, mode, operation, verification và reconnect không được viết lại trong renderer.

Các màn hình hiện có:

- **Tổng quan** — trạng thái backend, bot, kết nối, HP/food, vị trí, inventory và primary mode.
- **Bots** — sửa profile và bật/tắt bot.
- **Chế độ** — điều khiển B5 thuần/Collector cũ/Fishing; chỉnh B5, bảo vệ `/kho`, auto-join Skyblock và quy tắc quantity/PV2.
- **Tạo chế độ** — ghép mô-đun an toàn như lệnh `/`, lệnh đã đăng ký, click GUI, di chuyển, chờ, `/is`, vào Sky, đọc/bảo vệ kho, B5, điều kiện và lặp.
- **Cài đặt nâng cao** — chỉnh toàn bộ nhóm config JSON có schema/cross-validation và tự sao lưu.
- **GUI Inspector** — mở command đã đăng ký, click slot tùy chọn và xem snapshot GUI.
- **Logs** — log realtime có filter theo level/bot/search.
- **Diagnostics** — đọc runtime failure record.
- **Cài đặt** — backend control, thư mục runtime/log và secret Discord/password bot.

### Dùng bản đã đóng gói

Sau khi cài bằng `MCbot Setup.exe`, mở **MCbot** từ Windows. Bản Desktop đóng gói không yêu cầu người dùng cài Node.js/npm và không cần đặt `.env` cạnh executable.

Config mutable và runtime data được đặt trong thư mục dữ liệu ứng dụng của Windows. Secret như Discord token/password bot được lưu riêng qua Electron `safeStorage`; không ghi secret vào `config/*.json`.

Nếu Discord chưa được cấu hình, Desktop vẫn khởi động backend với Discord ở trạng thái disabled. Sau khi nhập secret trong **Cài đặt**, restart backend để áp dụng.

### Build `MCbot Setup.exe` từ source trên Windows

Nhấp đúp:

```text
scripts\BUILD_SETUP_WINDOWS.cmd
```

Builder 2.3.0 chạy theo pipeline Direct Packager có kiểm soát:

```text
Dependency preflight / npm ci khi cần
→ audited stale cleanup
→ validate
→ test + coverage gate
→ direct copy Electron Windows runtime
→ copy filtered production app into resources\app
→ verify out\MCbot-win32-x64\MCbot.exe
→ electron-winstaller / Squirrel.Windows
→ verify MCbot Setup.exe
```

Builder không còn dùng `electron-forge package`, nên bỏ hẳn bước native dependency preparation từng gây treo trên Windows. Direct packager in tiến độ copy app theo phần trăm; installer vẫn có heartbeat/timeout riêng. Muốn xem log build/Squirrel chi tiết:

```text
scripts\BUILD_SETUP_WINDOWS.cmd --verbose
```

Nếu nghi `node_modules` hỏng hoặc build tool không đồng bộ:

```text
scripts\BUILD_SETUP_WINDOWS.cmd --clean-install
```

Installer cuối:

```text
out\make\squirrel.windows\x64\MCbot Setup.exe
```

Packaging dùng `package-lock.json` để loại dependency chỉ phục vụ development ngay từ bước copy, đồng thời bỏ dữ liệu Bedrock theo phiên bản của `minecraft-data` vì MCbot/Mineflayer là Java Edition. `bedrock/common` vẫn được giữ vì thư viện `minecraft-data` cần metadata này khi load.

Chạy Desktop ở chế độ development:

```text
scripts\RUN_DESKTOP_WINDOWS.cmd
```

hoặc sau khi Electron đã được cài:

```bash
npm run desktop:start
```

CLI/core cũ vẫn được giữ để debug hoặc chạy headless:

```bash
npm start
# hoặc
npm run core:start
```

Desktop entry point là `src/desktop/main.js`; CLI entry point là `src/index.js`.

## Yêu cầu cho source/development

- Node.js `>= 22`.
- npm.
- Minecraft server/profile phù hợp với config.
- Discord bot/application nếu bật Discord integration.

Dependency chính hiện tại:

- `mineflayer` `^4.37.1`;
- `mineflayer-pathfinder` `^2.4.5`;
- `discord.js` `^14.25.1`;
- `dotenv` `^17.4.2`.

Project dùng CommonJS (`"type": "commonjs"`). Desktop entry point là `src/desktop/main.js`; CLI/core entry point là `src/index.js`.

## Cài đặt source nhanh

Với repository đã có `package-lock.json`, ưu tiên cài dependency đúng lockfile:

```bash
npm ci
```

Dùng `npm install` khi chủ động thay đổi dependency hoặc cập nhật lockfile.

Tạo `.env` từ `.env.example` rồi điền các giá trị cần thiết.

PowerShell:

```powershell
Copy-Item .env.example .env
```

CMD:

```cmd
copy .env.example .env
```

Danh sách biến môi trường và giá trị mẫu được duy trì trong `.env.example`.

Không commit `.env`, token Discord, password hoặc credential thật.

## Kiểm tra nhanh trước khi chạy

```bash
npm run validate
npm test
npm start
```

Khi thay đổi code lớn hoặc chuẩn bị merge/release, chạy thêm:

```bash
npm run test:coverage
```

Validation và test phải được coi là gate của thay đổi code. Không sửa validator hoặc test chỉ để làm xanh kết quả nếu contract/architecture thực tế chưa đúng.

## Chạy core/headless

```bash
npm start
```

Luồng khởi động chính:

```text
src/index.js
  ↓
bootstrap/createApplication.js
  ↓
load configuration + bot profiles
  ↓
register shared services / Discord / runtimes
  ↓
Application.initialize()
  ↓
BotRuntime.initialize()
  ↓
Application.start()
  ↓
BotRuntime.start()
  ↓
connect / spawn / server join / ready
  ↓
control plane + mode execution
```

Không thêm logic feature trực tiếp vào `src/index.js`; file này chỉ là entry/bootstrap boundary.

## Cấu hình chính

Các file thường cần chỉnh:

```text
config/app.json                 logging, operations, control plane, diagnostics
config/server.json              server profile, host, port, auth/version default
config/bots/*.json              profile từng bot
config/discord/discord.json     slash commands, panel, channels
config/modes/b5-craft.json       Chế B5 thuần
config/modes/collector-b5.json  Collector + B5 tương thích cũ
config/modes/fishing.json       Fishing
config/modes/custom/*.json      Chế độ ghép mô-đun do người dùng tạo
config/recovery/daily.json      daily recovery windows
config/resource-pack/...        resource-pack behavior
```

Server-specific knowledge và crafting/storage config nằm trong các nhóm như:

```text
config/commands/
config/gui/
config/items/
config/server-data/
config/storage/
config/personal-vault/
config/smelting/
config/minerals/
config/skyblock/
```

Không dùng config làm runtime mutable state. Runtime/persistent state được tách khỏi manual configuration.

## Multi-bot

Bot profile hiện nằm tại:

```text
config/bots/bot-01.json
config/bots/bot-02.json
```

Mỗi bot có ownership riêng cho:

```text
bot instance
runtime
BotContext
connection generation
services
mode
operations/locks
runtime state
```

Không chia sẻ mutable Mineflayer state giữa các bot. Event/callback cũ phải được scope theo connection generation để không tác động connection mới sau reconnect.

## Mode hiện có

### Chế B5 thuần — `b5-craft`

Đây là mode B5 được khuyến nghị cho mục tiêu chỉ chế B5. Policy được khóa rõ:

```text
Auto Join Skyblock (service nền)
→ /is
→ đọc /kho (snapshot authoritative; reuse ngắn hạn chỉ khi chưa có side-effect)
→ nếu áp lực kho cao: đổi/nén B1 + bán phần dư theo policy bảo vệ kho
→ đọc trạng thái B5/PV2/inventory
→ chế B2 → B3 → B4 → B5
→ lặp
```

**Không dùng MovementManager/pathfinder.** Khi `/kho` cần bảo vệ, mode chỉ nung raw iron/raw gold trước, sau đó nén base/phôi thành block rồi mới bắt đầu bán/bảo vệ áp lực kho. `storageProtection.allowSmelting` mặc định bật và có thể chỉnh trong Desktop. B2–B5 vẫn sử dụng GUI/PV2/crafting capability hiện có để bảo toàn item và xác minh output.

Implementation chính:

```text
src/modes/b5-craft/B5CraftModeService.js
src/server-features/storage/B1StorageMaterialService.js
src/server-features/storage/b1/B1StartupReserveTrimmer.js
src/server-features/crafting/B5PlanningService.js
src/server-features/crafting/B5AutomationService.js
src/server-features/crafting/b5/support/B5RecipeResolver.js
src/server-features/crafting/b5/support/B5ActionDiagnostics.js
```

Config chính:

```text
config/modes/b5-craft.json
config/server-data/b5.json
config/minerals/conversions.json
config/storage/kho.json   # owner duy nhất của startup trim/reserve B1
```

### Collector + B5 — tương thích cũ

`src/modes/collector-b5/CollectorB5ModeService.js` vẫn được giữ để không phá workflow cũ có pickup/movement/preprocessing. Không dùng nó làm template cho mode mới.

### Câu cá

Implementation chính:

```text
src/modes/fishing/FishingModeService.js
src/server-features/fishing/FishingService.js
src/modes/fishing/FishingMovementOperation.js
src/modes/fishing/FishingPositionGuard.js
src/modes/fishing/FishingRecoveryPolicy.js
```

### Mode Builder / custom mode

Custom mode được lưu tại `config/modes/custom/*.json` và chỉ ghép module đã whitelist. Không có `eval`/raw JavaScript. Module hiện có gồm:

```text
Lệnh đã đăng ký
Lệnh / tùy chỉnh (chỉ slash-command; chặn chat/mật khẩu)
Click GUI / chờ GUI / đóng GUI
Di chuyển / nhìn hướng
Chờ
/is / vào Skyblock
Đọc /kho / bảo vệ kho
Một chu kỳ B5
Ghi trạng thái
Điều kiện
Lặp N lần
```

Mode tùy chỉnh lỗi JSON/schema không làm backend chết; Desktop vẫn hiển thị file lỗi để sửa hoặc xóa. Thay đổi danh mục custom mode hiện cần restart backend để ModeCatalog nạp lại an toàn.

## Discord control plane

Discord được cấu hình tại:

```text
config/discord/discord.json
```

Các slash command hiện được đăng ký từ implementation/config gồm:

- `/gui` — mở command Minecraft đã cấu hình, click chuỗi slot tùy chọn và xuất snapshot GUI.
- `/mode` — điều khiển Collector + B5 mode theo implementation hiện tại.
- `/fishmode` — bật/tắt/xem trạng thái Fishing mode.

> Về dài hạn, command điều khiển mode nên hội tụ về một interface thống nhất khi số mode tăng, thay vì để Discord handler chứa logic riêng cho từng workflow.

Panel Discord sử dụng các channel logical:

```text
bot-control
bot-config
bot-errors
```

Tên/channel ID có thể thay đổi bằng config/environment.

Discord chỉ là **control plane**. Handler Discord nên gọi manager/runtime/service API; không nên tự chứa logic Mineflayer low-level như `bot.chat()`, `clickWindow()` hay mutate inventory nếu abstraction tương ứng đã tồn tại.

## GUI inspection

`/gui` hỗ trợ các target hiện được cấu hình:

```text
/sky
/ks
/kho
/pv 2
/nung
/d
```

Luồng logic:

```text
/gui
  ↓
resolve bot + command target
  ↓
GuiInspectionService.capture(...)
  ↓
open command
  ↓
optional slot clicks
  ↓
serialize final GUI snapshot
  ↓
Discord attachment JSON
```

GUI automation trong workflow production phải tuân theo nguyên tắc:

```text
request/open
→ wait
→ identify
→ observe
→ resolve action
→ click
→ observe change
→ verify
```

`click sent` không đồng nghĩa với `action succeeded`.

## Repository map

```text
src/
├─ bootstrap/        ghép application, config, services và runtime
├─ core/             application/container/event/lifecycle primitives
├─ bot/              BotRuntime, BotContext, BotRegistry, bot lifecycle
├─ connection/       connect/session/reconnect/listeners
├─ operations/       operation queue, timeout, cancellation, locks
├─ modes/            long-running workflows/modes
├─ server-features/  capability đặc thù server hiện tại
├─ commands/         command abstraction và response handling
├─ gui/              GUI detection/knowledge/observation/click/slots
├─ items/            item identity, matching, inventory snapshots
├─ movement/         navigation, position, safety, stuck handling
├─ planning/         pure/plannable decision logic, hiện có crafting
├─ recovery/         durable intents và fleet control
├─ fleet/            multi-bot scheduling
├─ discord/          Discord control plane
├─ diagnostics/      inspection/runtime failure diagnostics
├─ simulation/       replay/safety simulation
└─ shared/           logger, errors, resilience, cancellation, utilities

config/               manual/config-driven behavior
data/                 runtime state, observations, diagnostics và logs
tests/                unit/service/integration/workflow/regression tests
scripts/              validation, inspection, replay và maintenance tools
architecture/         architecture catalog/validation metadata
```

Muốn biết chính xác file nào chịu trách nhiệm cho một bug/feature, dùng Debug Routing Guide trong [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Tài liệu dành cho developer và AI agent

Bộ tài liệu chính nên được đọc theo thứ tự:

1. [`README.md`](README.md) — bắt đầu sử dụng và tổng quan project.
2. [`AGENTS.md`](AGENTS.md) — luật làm việc cho AI/Codex.
3. [`ARCHITECTURE.md`](ARCHITECTURE.md) — bản đồ kỹ thuật, ownership và dependency flow.
4. [`SERVER_BEHAVIOR.md`](SERVER_BEHAVIOR.md) — source of truth cho mechanics riêng của server.
5. [`docs/architecture-roadmap/README.md`](docs/architecture-roadmap/README.md) — TARGET/roadmap có governance riêng; chỉ đọc sau các source-of-truth CURRENT ở trên khi task liên quan migration kiến trúc.

`RULES.md` và `JS_RESPONSIBILITIES.md` là tài liệu legacy/hỗ trợ trong quá trình chuyển đổi. Nội dung còn giá trị nên dần được hợp nhất vào `AGENTS.md` hoặc `ARCHITECTURE.md` để tránh nhiều nguồn sự thật chồng nhau.

Khi có xung đột, không tự đoán. Đối chiếu code hiện tại, architecture catalog và source-of-truth phù hợp trước khi sửa.

## Nguyên tắc architecture

Dependency direction mong muốn:

```text
Control Plane
    ↓
Manager / Runtime API
    ↓
Mode / Workflow
    ↓
Service / Capability
    ↓
Adapter / server-feature boundary
    ↓
Mineflayer / Minecraft server
```

Event direction:

```text
Minecraft event
    ↓
listener / adapter
    ↓
internal observation/event
    ↓
runtime/service
    ↓
workflow decision
```

Một mode không nên tự tạo connection manager, tự viết lại GUI engine hoặc tự quản lý inventory nếu capability tương ứng đã tồn tại.

Server-specific implementation không được tự động coi là generic framework behavior.

## Verification-first

Đối với automation Minecraft:

```text
action sent != action succeeded
```

Ví dụ:

```text
bot.chat(command)       != GUI opened
GUI click               != craft succeeded
pathfinder completed    != final state valid
item move request       != transfer verified
sell click              != storage quantity decreased
```

Pattern ưu tiên:

```text
before
→ action
→ observation/event
→ after
→ verify
```

Không sửa lỗi timing bằng retry vô hạn hoặc tăng `sleep()` nếu chưa xác định root cause.

## Server-specific behavior

Server hiện tại dùng nhiều mechanics không phải vanilla Minecraft, gồm command/GUI đặc biệt, custom item identity, storage riêng và crafting flow riêng.

Một số command đang được project sử dụng gồm:

```text
/is
/sky
/kho
/kho sell
/pv 2
/ks
/nung
/afk
```

Không coi các command này là capability generic của mọi Minecraft server.

Chi tiết đã xác nhận/quan sát, click semantics, GUI signatures, storage behavior, MMOItems identity, B1/B2/B3/B4/B5 rules, recovery window và các server-specific unknowns nằm tại [`SERVER_BEHAVIOR.md`](SERVER_BEHAVIOR.md).

## Logging và diagnostics

Console logging được tối ưu để ngắn hơn; file log có thể giữ metadata debug chi tiết hơn.

Config mặc định:

```text
config/app.json
```

Log runtime:

```text
data/logs/
```

Runtime failure records:

```text
data/runtime/errors/
```

Khi debug, ưu tiên lấy một đoạn log ngắn quanh lỗi cùng các field như:

```text
botId
connectionGeneration
mode
operation
step
action
attempt
reason
before
after
verification
errorCode
```

Không dump hàng chục nghìn dòng log vào context nếu chưa cần.

## Test và validation

Chạy toàn bộ test:

```bash
npm test
```

Coverage:

```bash
npm run test:coverage
```

Kiểm tra config:

```bash
npm run inspect:config
```

Structure + architecture validation:

```bash
npm run validate
```

Architecture report dạng JSON:

```bash
npm run inspect:architecture
```

Baseline kiến trúc CURRENT (WP-001):

```bash
npm run baseline:inspect   # read-only: in fresh manifest JSON ra stdout
npm run baseline:report    # read-only: render gap report hiện tại ra stdout
npm run baseline:check     # read-only: schema/exclusion + stale comparison
```

Manifest được capture tại `architecture/baseline/current.json`; human gap report nằm ở `docs/architecture-roadmap/baseline/WP-001_GAP_REPORT.md`. Inspector không tự ghi file vào repository.

Replay fixture:

```bash
npm run replay
```

Dọn stale path theo catalog:

```bash
npm run cleanup:stale:dry
npm run cleanup:stale
```

Trước khi merge/release, mục tiêu là:

```text
npm run validate      PASS
npm test              PASS
npm run test:coverage PASS
```

Nếu validation fail, xử lý nguyên nhân trong code/config/catalog/docs thay vì hạ chuẩn validator chỉ để đạt PASS.

## Thêm feature mới

Trước khi tạo module mới:

1. đọc `AGENTS.md`;
2. tìm capability tương tự;
3. xác định đúng layer trong `ARCHITECTURE.md`;
4. nếu liên quan server mechanics, kiểm tra `SERVER_BEHAVIOR.md`;
5. tái sử dụng service/abstraction đang có;
6. tách planner khỏi executor nếu logic quyết định đủ phức tạp;
7. thêm verification và error handling;
8. thêm targeted tests;
9. cập nhật docs/config/catalog nếu contract thay đổi.

Ví dụ, thêm Fishing/Farming/Mining mới không được tạo một connection lifecycle riêng chỉ cho feature đó.

## Security

Không commit hoặc đưa vào log:

- `.env` thật;
- Discord token;
- account password;
- session/token authentication;
- credential của server;
- secret khác.

Secret phải đi qua environment variable hoặc secret mechanism phù hợp. `config/*.json` nên chỉ chứa non-secret configuration.

## Tài liệu chi tiết

- [`AGENTS.md`](AGENTS.md) — cách AI/Codex phải làm việc với repository, context budget, dependency boundaries, bug/feature workflow, concurrency, testing và Definition of Done.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — system overview, repository map, lifecycle, multi-bot, runtime/state, modes, services, GUI, inventory, command, movement, reconnect, operation/lock model, testing, extension guide và debug routing.
- [`SERVER_BEHAVIOR.md`](SERVER_BEHAVIOR.md) — command registry, GUI semantics/signatures, custom item identity, storage, crafting B1 → B5, server time/recovery behavior, verification rules và unknowns.
- [`docs/architecture-roadmap/README.md`](docs/architecture-roadmap/README.md) — chương trình migration kiến trúc theo work package; được validator govern nhưng có authority thấp hơn CURRENT source-of-truth.


## Mode Platform / Extension SDK

Từ v2.2, mode mới không nên copy nguyên kiến trúc của Collector+B5 hoặc Fishing. Core cung cấp một platform chung để mở rộng mode:

```text
ModeCatalog                 metadata + capability/resource requirements
CapabilityRegistry          capability lookup theo runtime/bot
RuntimeModeRegistry         bind mode id -> service implementation
ModeControlService          start/pause/resume/restart/stop generic
ModeContext                 event/operation/capability/generation boundary
ManagedMode                 lifecycle base class cho mode mới
TaskSupervisor              long-running task + bounded retry + cancellation
HealthRegistry              readiness/health probes chuẩn
RuntimePlatformService      introspection chung cho diagnostics/UI
```

Tạo skeleton mode mới:

```bash
npm run mode:scaffold -- mining "Mining"
```

Sau đó:

1. khai báo descriptor trong `src/bootstrap/createModeCatalog.js`;
2. khai báo các `requiredCapabilities` và `requestedResources` thật sự cần;
3. nếu có config riêng, thêm spec/schema tương ứng;
4. construct service trong bot bootstrap và bind theo `serviceName` của descriptor;
5. dùng `ModeContext`/capability thay vì truy cập Mineflayer low-level trực tiếp nếu capability đã tồn tại;
6. với mode mới, ưu tiên kế thừa `ManagedMode` và dùng `createTaskSupervisor()` cho loop dài hạn;
7. chạy `npm run validate`, `npm test`, `npm run test:coverage`.

Durable recovery và FleetControl không còn hard-code danh sách `collector-b5`/`fishing`; mode được resolve qua `ModeCatalog` + `RuntimeModeRegistry`. Desktop cũng lấy danh sách mode từ runtime registry cho nút start cơ bản, vì vậy mode mới có thể xuất hiện trong control surface mà không cần hard-code thêm nút start.

## Nền mở rộng mode 2.3

Mode mới nên ưu tiên hai đường:

1. **Mode Builder** nếu chỉ cần ghép command/GUI/movement/wait/condition/repeat từ capability sẵn có.
2. **Mode SDK** (`ManagedMode` + `ModeContext` + `TaskSupervisor`) nếu cần state machine/domain logic riêng như Mining/Farming/Combat.

Core dùng `ModeCatalog`, `RuntimeModeRegistry`, `CapabilityRegistry`, `ModeCoordinator`, `HealthRegistry` và `RuntimePlatformService`; không thêm `if (mode === ...)` vào fleet/recovery/control plane.

## Mục tiêu dài hạn

```text
Generic Minecraft automation framework
    │
    ├─ connection
    ├─ operations
    ├─ movement
    ├─ GUI
    ├─ inventory
    ├─ command
    ├─ storage
    ├─ crafting
    ├─ fishing
    ├─ combat
    └─ ...
         │
         ▼
Server profile / capability mapping
         │
         ▼
Modes / workflows
    ├─ Collector + B5
    ├─ Fishing
    ├─ Mining
    ├─ Farming
    ├─ Auction
    └─ future workflows
```

Mục tiêu là có thể thêm bot, server, capability và workflow mà không phải rewrite generic core.


### B5 thuần và bảo vệ kho

Từ 2.4.1, một lượt bảo vệ kho còn HIGH không chặn vô hạn engine chế B5. Mode tiếp tục vào B5Automation; mọi block -> base vẫn phải qua kiểm tra headroom và không bao giờ gọi /nung.

Từ 2.4.2, `/pv 2` không thể bị nhận nhầm thành `/kho` chỉ vì fallback capacity 800.000. B5 cũng tái sử dụng GUI `/pv 2` đang mở thay vì gửi lại command và chờ timeout.

### Đăng ký lệnh riêng cho từng Sky

Từ 2.6.12, trang **Công cụ → Lệnh riêng theo Sky** cho phép thêm/xóa/sửa lệnh như `/d`, `/autofarm`, `/spawn`, `/warp ...` riêng cho `sky1`, `sky2` hoặc selection khác đã cấu hình. Lệnh được áp dụng ngay khi lưu. MCbot chỉ gửi khi bot đang ở đúng Sky; HUB hoặc sai Sky sẽ bị chặn. Các lệnh này cũng xuất hiện trong Trung tâm lệnh và có module **Lệnh riêng theo Sky** trong Mode Builder.

### B5 campaign scheduler (2.6.13+)

`b1NormalizeIntervalMs` là chu kỳ kiểm lại B1 **khi mode đang thật sự chờ vật liệu**. Nó không còn cắt ngang một chuỗi B2/B3/B4 đang tạo tiến triển. Khi một `B5AutomationNext` trả `productive=true`, mode fresh re-plan ngay và tiếp tục campaign; chỉ một cycle không tạo thêm tài nguyên mới được đưa vào backoff/idle-normalization. Normalization vẫn bắt buộc khi bắt đầu generation mới và sau khi một B5 hoàn tất rồi hết cooldown.


## Local AI Agent trong Desktop (2.7.0)

MCbot Desktop có trang **AI Local** để dùng model chạy trên máy qua Ollama/OpenAI-compatible API. AI không được nhận raw filesystem/shell; model chỉ gọi các tool do MCbot kiểm soát.

- Provider mặc định: `http://127.0.0.1:11434/v1`.
- Workspace: người vận hành chọn thư mục source project. Toàn bộ source/docs/config đọc được trong workspace là nguồn cho agent; `.env*`, credential/secret data, `node_modules`, `data`, `out`, build/coverage bị loại.
- Quyền `READ`: search/read project, runtime snapshot, recent logs.
- Quyền `PATCH`: thêm `apply_patch` và `write_file`.
- Quyền `DEVELOP`: thêm validator/test/git status/diff theo allowlist; không có arbitrary shell.
- Quyền `ADMIN`: thêm runtime control whitelist (`connect`, `disconnect`, start/pause/resume/stop/restart mode, `/is` qua service hiện hữu). Không expose raw chat.
- Mọi kết luận về code phải dựa trên file/tool đã đọc; mọi claim sửa/test phải có tool evidence.

Ollama chỉ chạy ở loopback (`localhost`, `127.0.0.1`, `::1`) trong integration này. Desktop renderer không kết nối network trực tiếp; request Local AI đi qua IPC tới main process.
