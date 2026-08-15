# RULES.md

## Mức độ

- **BẮT BUỘC:** phải tuân thủ.
- **CẤM:** tuyệt đối không làm.
- **KHUYẾN NGHỊ:** chỉ khác đi khi có lý do kỹ thuật rõ.

## Kiến trúc đa bot

- **BẮT BUỘC:** `Application` sở hữu `BotRegistry`; registry lưu `BotRuntime` theo `botId` ổn định.
- **BẮT BUỘC:** mỗi runtime có context, state, lifecycle, connection, reconnect, event bus, queue, lock, GUI, movement, inventory và facade riêng.
- **CẤM:** global Mineflayer client, mutable singleton bot-scoped hoặc state dùng chung giữa hai bot.
- Callback connection cũ phải kiểm tra instance hoặc generation trước khi thay đổi state mới.

## Scope và dependency

- Application-scoped: configuration, logger factory, item/recipe/command definitions và bot registry.
- Bot-scoped: runtime state, context, connection, reconnect, operation, GUI, movement, inventory và server facade.
- Connection-scoped: listener, waiter và timer gắn với một Mineflayer client.
- Operation-scoped: cancellation, timeout, lock ownership, result và cleanup.
- Shared utility không được giữ bot, listener, timer hoặc mutable runtime state.
- Dependency đi từ bootstrap xuống capability và shared primitive. **CẤM:** dependency vòng hoặc tầng thấp import mode/server workflow.

## Lifecycle và cleanup

- `initialize`, `start`, `stop`, `destroy` phải có transition hợp lệ và idempotent khi contract yêu cầu.
- Startup lỗi phải rollback theo thứ tự ngược; shutdown phải cố cleanup mọi runtime bằng cơ chế tương đương `Promise.allSettled`.
- Mọi listener, timer, interval, waiter, queue task, lock và control state phải có owner và cleanup ở success, failure, timeout, cancel, disconnect và shutdown.
- **CẤM:** manager/service gọi `process.exit()`.

## Configuration

- **BẮT BUỘC:** host, port, username, auth, version, command, GUI title/layout/slot, item identity, recipe, timeout, retry, response, location và route nằm trong config.
- Constants chỉ dành cho enum, state và error code nội bộ.
- Config phải được đọc, parse, validate và đóng băng trước khi dùng.
- **CẤM:** secret thật trong JSON được commit.

## Command

- Chỉ `CommandExecutor` được gọi `bot.chat()` để gửi server command.
- Command phải resolve từ config; không tự thêm `/` hoặc fallback command hard-code.
- Command không thành công chỉ vì `bot.chat()` không ném lỗi; workflow phải xác minh bằng response, GUI, position, inventory hoặc event.
- `CommandService.send()` phải truyền cancellation xuống `CommandExecutor`; executor kiểm tra cancellation trước throttle, dùng delay cancellation-aware và kiểm tra lại ngay trước lấy client/gửi chat. Token đã cancel thì tuyệt đối không được gửi command muộn.
- Command generation-sensitive phải truyền `expectedGeneration`. `CommandExecutor` phải giữ exact client/generation đã capture trước throttle và từ chối send nếu generation/client đã thay thế; không được lấy replacement client sau throttle rồi gửi side effect của generation cũ.
- Waiter phải timeout, cancellation, lọc `botId`/generation và cleanup.

## GUI và click

- GUI tách detection, slot resolution, session, queue, guard, executor và verifier.
- Mỗi bot có `GuiSession`, `GuiState` và `ClickQueue` riêng.
- Chỉ `ClickExecutor` được gọi API click Mineflayer.
- Click phải qua queue → guard → executor → verifier.
- **CẤM:** coi click thành công chỉ vì Promise click resolve.
- Session cũ hoặc window đã đổi không được tiếp tục click.

## Slot và item identity

- **CẤM:** dùng GUI slot làm logical item ID, recipe ID hoặc tier ID.
- Recipe chỉ dùng logical item ID; slot chỉ là dữ liệu tương tác GUI từ config/resolver.
- Item identity phụ thuộc context. Ưu tiên NBT/server ID ổn định, sau đó material, lore có cấu trúc và cuối cùng display name.
- Matcher phải trả lý do và field được dùng.
- `/pv 2` phải scan toàn bộ 54 slot storage, không giả định item cố định.

## Inventory

- Reader/scanner/counter chỉ đọc, chuẩn hóa, scan, đếm và snapshot.
- **CẤM:** inventory reader click, gửi command, mở GUI hoặc craft.
- Counter cộng toàn bộ stack match; snapshot không expose mutable Mineflayer object.

## Operations, locks, timeout và cancellation

- Hành động nhiều bước hoặc có side effect phải chạy như operation có ID, bot ID, status, timeout, cancellation, locks, result và cleanup.
- Operation chỉ success sau khi xác minh hậu điều kiện.
- Lock bot-scoped, có owner; **CẤM:** boolean global thay lock.
- Queue của click, command và operation không dùng chung tùy tiện.
- Không chờ event vô hạn. Timer và cancellation listener phải được dọn.
- Cancel idempotent và giữ reason đầu tiên.

## Connection và reconnect

- Mỗi bot có `ConnectionManager`, `SessionManager` và `ReconnectManager` riêng.
- Không có hai connection attempt đồng thời cho cùng bot.
- Không reconnect khi shutdown chủ động; timer reconnect phải hủy khi stop.
- Callback bot cũ không được detach hoặc mutate bot mới.

## Movement và teleport

- Movement state/control state bot-scoped; kết thúc operation phải tắt control state.
- Movement có destination, timeout, cancellation, safety guard và arrival verification.
- `/is` không có countdown nhưng phải xác minh teleport.
- `/d` dùng countdown từ config, mặc định 6000 ms trong config; phải khóa movement/teleport xung đột và xác minh teleport thật.

## Server features

- `ServerFeatureFacade` là API cấp cao cho controller/mode sau này.
- Facade không chứa raw slot, NBT hoặc click sequence.
- `/kho` là nguồn sự thật đầy đủ để đọc amount/capacity và tính coverage B1 trên cả raw/phôi/block. `/kho sell` chỉ mở Sell GUI của server; GUI bán có thể không hiển thị raw, nên tuyệt đối không dùng Sell GUI để suy ra full storage. Sell GUI chỉ được dùng để resolve/click/verify các form thực sự xuất hiện; left-click bán `1`, right-click bán `64`, Shift+left bán `ALL`, nhưng B1 production mặc định cấm `SELL ALL`. Lore Sell GUI còn có thể chứa số hướng dẫn click `1/64`, nên amount từ Sell GUI chỉ được coi là authoritative khi reader xác định được label storage thật; startup/pressure vẫn checkpoint bằng full `/kho`.
- `/nung` và nút nung trong `/ks` dùng cùng `SmeltingOperation`.
- Thành phẩm B2–B5 được xác minh trong player inventory.
- Quantity crafting hỗ trợ `1`, `64` và `ALL`. Sau khi storage safety xác nhận `/kho` ổn định, B1→B2 được phép dùng `ALL` cho material planner chọn; `ALL` chỉ là quantity strategy, không phải quyền craft mù. Nếu B1→B2 `ALL` làm inventory đầy, phải cất đúng một stack B2 của material hiện tại vào `/pv 2`, verify có ít nhất một slot trống, rồi B2→B3 dùng `ALL`. Carry stack này phải được planner nhìn thấy/rút lại ở batch sau thay vì để tích lẻ vô hạn trong PV2. B4/B5 vẫn theo lượng planner cần; không suy rộng `ALL` sang B4/B5; B5 cuối không dùng `ALL`.
- GUI observation tự động được phép ghi dữ liệu quan sát vào `data/runtime/gui`; số động trong lore/count không được coi là thay đổi cấu trúc GUI.
- Resource pack server phải được xử lý theo connection generation; khi `autoAccept` bật, bot gọi Mineflayer `acceptResourcePack()` ngay khi nhận event `resourcePack`, phát `resource-pack:ready`, và workflow Skyblock có thể dùng event này làm readiness gate.

## Mode nhặt + B5

- Mode collector+B5 là workflow bot-scoped tầng cao; chỉ gọi capability (`island`, movement, B5 planning/automation), **CẤM:** gọi Mineflayer trực tiếp.
- Khi bật mode, mặc định `/is` phải được xác minh teleport trước khi đi tới `pickupLocation` trong config.
- Collector không đuổi item rơi; bot đứng tại điểm nhặt cấu hình và để cơ chế pickup Minecraft/server thu item.
- Mode phải kiểm tra lệch vị trí và quay lại điểm nhặt khi vượt `reanchorRadius`.
- Mode B5 chạy liên tục không có tổng target/batch và **không có cooldown B5**: hễ tier nào đủ điều kiện thì chế ngay, luôn ưu tiên đẩy `B5 > B4 > B3 > B2`. Mỗi lần explicit `enable`, trước production phải chạy đúng một startup storage-safety gate: đọc full `/kho`, tính coverage raw+phôi+block theo nhu cầu B1 thật cho một B5, giữ `3 B5` là hard reserve nhưng chỉ trim tương đối về vùng khoảng `3.25 B5` bằng block-sale `64`; không đuổi chính xác 3.000. Gate bán theo các checkpoint full `/kho` có giới hạn và không được báo COMPLETE nếu sau checkpoint vẫn còn block surplus có thể bán an toàn. Material chưa đủ reserve hoặc surplus chỉ nằm ở raw/phôi thì bỏ qua. Gate này không chạy lại khi pause/resume hoặc reconnect; chỉ chạy lại sau disable rồi enable mới. Sau gate, B1→B2 có thể dùng guarded `ALL`; B2→B3 dùng `ALL`; B5 cuối không dùng `ALL`.
- Với nguồn B1 liên tục, snapshot planner và snapshot execution có thể lệch do NPC/craft/conversion. `prepare-b1` gặp `NOT_READY` vì B1 hiện tại không còn đủ là trạng thái chờ nguyên liệu bình thường: không phát lỗi recovery, không chạy vòng craft 250ms; trả về WAITING_MATERIALS và dùng material poll interval rồi re-plan.
- Với nguồn B1 liên tục, `/kho` là buffer có đầu vào NPC độc lập ở dạng raw/phôi/khối. Bảo vệ kho là hard gate đứng trước crafting: đọc capacity, ưu tiên bán **block surplus** đang có; tuyệt đối không bán phôi/raw trực tiếp. Nếu pressure còn cao, raw→phôi là 1:1 và phôi→block là capacity-reducing nên được phép chạy best-effort ngay trong protection để tạo block nén, rồi re-read và chỉ bán block. Lỗi `/ks` không được làm bật lại loose selling. Production config hiện dùng high-water 80%, low-water 70%, critical 92%; không được chờ tới 90% mới bắt đầu cứu kho. Dự báo tăng trưởng chỉ được nâng thành hard protection khi usage thực tế đã >= low-water 70%; dưới 70% dù extrapolation vượt 80% cũng chỉ là RISING, không được gắn HIGH/sellRequired.
- Khi phải bán, coverage phải lấy từ full `/kho`: raw + phôi + block quy đổi về effective B1, nhưng **sell candidate chỉ được là block**. Phôi/raw vẫn bảo vệ reserve 3 B5 nhưng bị bỏ qua ở executor; không bán phôi lẻ. Vì B1 được NPC cấp liên tục, production mặc định bán block thô theo `64`, không dùng click `1` để đuổi chính xác 3.000 B5; dừng khi một click 64 block tiếp theo sẽ làm family xuống dưới reserve. Runtime pressure bán theo burst có giới hạn, checkpoint full `/kho` giữa các burst; nếu inflow che mất delta hoặc làm pressure tăng, burst sau được tăng có trần thay vì restart mode/vòng vô hạn. `SELL ALL` vẫn cấm mặc định. Nếu surplus hiện chỉ nằm ở raw/phôi, startup bỏ qua; các maintenance pass sau nung/nén về block rồi protection mới bán block.
- Capacity reader phải xác minh nội dung telemetry thay vì tin cứng slot 49; nếu capacity item đổi vị trí thì quét slot khác. Với server này limit đã xác nhận là 800.000; nếu capacity telemetry tạm mất nhưng item amount vẫn đọc được, được phép derive `used=sum(items)` với fallback limit 800.000 để không vô hiệu hóa protection.

## Mode câu cá và ranh giới Mineflayer

- **BẮT BUỘC:** `FishingModeService` chỉ là bot-scoped orchestration/state machine. Mode giữ lifecycle/public status, chọn AFK area, điều phối `/is`, world readiness, movement/probe, position guard, fishing cycle, recovery policy, runtime failure và circuit breaker.
- **CẤM:** `FishingModeService` nhận `BotContext`, raw Mineflayer bot/client, `_client`, `Vec3`, raw entity/inventory/physics, packet listener, `bot.end()`, `bot.fish()`, `bot.look*()`, `bot.blockAt()`, pathfinder hoặc direct control-state API.
- Raw Mineflayer chỉ được sở hữu bởi capability tầng thấp có trách nhiệm rõ: `FishingService` sở hữu rod/equip/fishing primitive; `FishingMovementOperation` sở hữu movement session/control qua movement primitive; `FishingWorldReadinessService` sở hữu world/entity/block readiness; `ConnectionPacketObserver` là owner duy nhất của raw `_client` trong subsystem fishing.
- `FishingMovementOperation` phải capture expected connection generation, có operation ID/lock/timeout/cancellation, verify arrival/progress, bỏ callback generation cũ và clear control/listener ở mọi success/failure/timeout/cancel/disconnect.
- `FishingMovementProbeService` phải bounded theo profile count + total/profile timeout, không retry vô hạn, không publish expected probe outcome như runtime failure, không giữ listener/profile state sang lượt sau và trả snapshot detached/immutable.
- `ConnectionPacketObserver` là connection-scoped: bind exact client + generation, normalize packet trước fan-out, giới hạn sample buffer, ignore stale client/generation và detach listener khi end/replacement/stop/destroy.
- `FishingPositionGuard` sở hữu verified anchor, horizontal radius/vertical tolerance và generation validity; snapshot không expose mutable `Vec3`/entity. Guard không được movement/retry/send command.
- `FishingWorldReadinessService` phải bounded timeout/cancellation/generation, cleanup wait state và không tự reconnect.
- `FishingRecoveryPolicy` là pure logic, không side effect. Policy quyết định WAIT/RETRY/REANCHOR/REJOIN_AREA/REQUEST_RECONNECT/PAUSE_ERROR/STOP; non-retryable luôn PAUSED_ERROR; breaker OPEN giữ public phase `DEGRADED` và không chạy business operation trước HALF_OPEN.
- Lifecycle cancellation (pause/disable/stop/shutdown) không tăng breaker, không publish runtime failure và không restart loop. Operation-level expected `CANCELLED`, `NOT_READY`, `NOT_ENOUGH_MATERIALS`, `WAITING_MATERIALS` khi mode token còn active là bounded wait, không phải failure/hot-loop.
- Chỉ một fishing cycle được verify `caught=true` mới reset failure streak. Movement/probe/world-ready/wait success không được reset breaker.
- Ordinary fishing-cycle error/bite timeout không tự reset toàn route `/is -> /afk`; giữ rod/anchor hợp lệ và bounded recast/retry theo policy. Position loss/generation change mới invalidate route theo recovery decision.
- `/is` và AFK teleport dùng cancellation + exact connection-generation verification. Teleport waiter phải normalize `event.connectionGeneration ?? event.generation`, không được accept event thiếu generation, phải bind trước side-effect nếu cần tránh missed-fast-event, và phải cleanup listener/timer/cancellation ngay khi public operation settle. `/is` còn phải sở hữu internal cancellation source cho command branch: timeout/stale/disconnect/cancel/failure của operation phải hủy throttle/send chưa hoàn tất để command không thể được gửi muộn sang client cũ hoặc replacement client.
- Fishing connection callbacks (`connection:ended`/`connection:spawned`) chỉ được mutate mode state khi event generation hợp lệ và khớp generation hiện hành; stale hoặc generation-less event không được invalidate route/guard hoặc restart loop mới.
- Recovery side-effect của một Fishing business cycle phải carry `expectedGeneration` xuyên suốt failure handling/publish/cleanup/reconnect. Stale outcome không được tăng breaker, publish như generation mới, cleanup capability generation mới hoặc terminate client mới. `ConnectionManager.requestReconnect(reason, { expectedGeneration } = {})` phải no-op/false nếu generation không còn khớp; caller cũ chỉ truyền `reason` vẫn tương thích.
- Config fishing operator-tunable nằm trong `config/modes/fishing.json`, được `fishing` schema validate trước runtime và validate lại sau merge bot override. Bot override chỉ được thay `shoreFishingPitchDegrees` và destination x/y/z của area hiện có; không được phát minh area/slot/server data mới.
- **CẤM:** empty `catch {}` hoặc `.catch(() => {})` trong file fishing/movement/packet được thêm/sửa. Best-effort cleanup failure phải được log/sanitize hoặc biểu diễn bằng Result/diagnostic rõ mà không che failure gốc.
- **BẮT BUỘC chống tràn `/kho`:** khi không có craft actionable, trước khi vào `COLLECTING/WAIT` phải đổi toàn bộ B1/phôi có thể nén về block; sau mọi lượt craft B2/B3/B4/B5 thành công cũng phải nén B1 còn dư về block trước khi vòng tiếp. Khi craft/plan lỗi, mode phải best-effort nén B1 trước thời gian retry. Block→phôi là thao tác có thể bung toàn bộ stock nên chỉ được phép khi peak capacity dự kiến sau bung vẫn dưới `decompressionMaxRatio`; planner không được tính stock block bị chặn bởi safety này là B1 dùng ngay.
- `/mode` Discord phải cùng tồn tại với `/gui`; đăng ký slash command theo một danh sách chung, không được PUT riêng làm ghi đè command khác.
- Tắt mode phải cancel B5 operation đang chạy qua cancellation token và dừng movement.

## Planner

- **CẤM:** planner gửi command, click, di chuyển, giữ lock, tạo timer hoặc đọc runtime trực tiếp.
- Planner nhận snapshot/input và trả plan theo logical item ID, không phụ thuộc GUI slot.

## Result, error và logging

- Public service/operation dùng result contract nhất quán: status, success, data, error, message, meta.
- Error kế thừa `Error`, có name/code/message/details/cause/stack.
- Không catch rồi bỏ qua hoặc đổi failure thành success.
- Log có timestamp, level, scope và metadata; che password, token, secret, authorization, API key và credential.
- Console production mặc định dùng format compact; metadata đầy đủ phải được giữ trong JSONL file log để debug mà không spam terminal.
- Console level và file level độc lập; `debug` có thể ghi file mà không xuất terminal.

## Runtime failure, redaction và failure budget

- `runtime:failure` là canonical runtime failure event duy nhất cho persistence và Discord error reporting. Event canonical phải có `failureId`, `botId`, connection generation khi có, source/subsystem/severity/code, operation/step/action/resource, message, retryable, correlation/operation ID, occurredAt, phase, retry delay và diagnostic/details đã sanitize/detach. **CẤM:** fan-out raw `Error`, Mineflayer object, credential hoặc mutable reference do caller sở hữu.
- Legacy event còn caller như `mode:collector-b5:error`, `connection:error`, `connection:kicked`, `connection:failed` và `connection:ended` được giữ để tương thích. Legacy mode failure phải mang cùng `failureId`; recorder và Discord reporter chỉ consume canonical `runtime:failure`, không persist/report lại legacy event. Connection publisher aggregate các signal cùng bot + generation thành một physical failure và chọn diagnostic giàu thông tin nhất, không dùng first-event-wins; intentional `connection:ended` không tạo canonical failure.
- Runtime failure dedupe ưu tiên `failureId`; event cũ thiếu ID chỉ được fallback theo signature gồm tối thiểu botId, connection generation, code, operation, step, resource và message trong `repeatWindowMs`. Mutation dedupe phải nằm trong serialized write critical section, nhưng arrival timestamp phải chụp trước khi enqueue để disk/inventory capture chậm không làm sai repeat window. Khác operation không được merge chỉ vì message giống nhau.
- Lần đầu của một signature được ghi đầy đủ; repeat trong cửa sổ được aggregate. Storm liên tục phải phát repeat summary theo fixed window định kỳ với `repeatCount`, `firstAt`, `lastAt`, `durationMs`, không dùng sliding debounce vô hạn. `stop` phải flush summary/write/send đang pending. `repeatWindowMs=0` tắt signature aggregation và repeat timer nhưng không tắt exact `failureId` dedupe.
- Runtime failure files phải rotate trước append nếu active + record vượt `maxFileMb`; record đơn lẻ quá lớn phải được sanitize/truncate thành JSON hợp lệ có marker `truncated`/`originalBytes` thay vì phá quota. Active + rotated JSONL phải nằm trong `maxTotalMb`; cleanup retention/quota chỉ xóa rotated runtime-failure regular files trong bot directory đã verify, không recursive delete, không follow symlink/junction, không xóa `last-error.json` hoặc file ngoài contract. `retentionDays=0` tắt age-based deletion; `cleanupIntervalMs=0` tắt periodic cleanup timer nhưng lifecycle cleanup vẫn chạy.
- `diagnostics.runtimeFailures.enabled=false` làm persistence/reporting no-op: recorder không mkdir/listener/timer/file; Discord reporter không resolve chỉ để báo lỗi, không registry/runtime listener, không send. Internal canonical publisher có thể vẫn tồn tại cho consumer khác, nhưng disabled không được mơ hồ thành “vẫn ghi/gửi”.
- `botId` dùng làm filesystem path phải match `^[a-z0-9][a-z0-9_-]{1,31}$`; schema và service phải cùng contract. Recorder phải defense-in-depth bằng resolve/relative/realpath containment và reject path traversal/absolute/drive-path trước mọi cleanup.
- Redaction phải recursive và idempotent cho sensitive key/value, Error message/stack/cause/details, JSON/log-like string kể cả escaped quote/backslash và numeric/boolean/null scalar, Bearer/header assignment, query-string credential và HTTP(S) basic-auth URL. Placeholder `[REDACTED]` không được bị redact lại thành output malformed hoặc để lộ suffix.
- Collector và Fishing dùng breaker riêng theo bot/mode, không share mutable singleton. Breaker giữ `CLOSED -> OPEN -> HALF_OPEN -> CLOSED`; retryable failure dùng backoff, non-retryable vào `PAUSED_ERROR`, OPEN phải giữ public phase `DEGRADED`, best-effort dừng movement/control và không chạy business operation mới trước half-open. Chỉ verified business success mới reset failure streak; breaker không tự restart Minecraft connection.
- Cancellation/wait-state phải phân loại cả `Result.status`, domain code/meta và cancellation token, không chỉ `error.code`. Token thật sự bị cancel do pause/disable/stop/shutdown phải thoát loop sạch, không tăng breaker, không publish failure và không restart. Operation-level `CANCELLED` khi token còn active và `NOT_READY`/`NOT_ENOUGH_MATERIALS`/`WAITING_MATERIALS` hợp lệ là expected wait-state: không tăng breaker/publish/Discord/persist, phải bounded delay bằng poll/error retry rồi thử lại, không hot-loop và không giả reset verified failure streak.

## JavaScript và test

- CommonJS, `'use strict';`, Node.js >=22.
- Một file có một trách nhiệm chính; không tạo Manager và Service trùng nghĩa.
- Public API nhỏ, không expose mutable Map/Set/state nội bộ.
- Unit test dùng fake bot/mock/fixture, không kết nối dịch vụ thật.
- Module bot-scoped phải test isolation; reconnect test stale callback; operation test timeout/cancel/lock release; GUI test wrong window/stale session.

## Cấm tuyệt đối

Global bot; bot-scoped singleton; hard-code server data; mode gọi Mineflayer; planner thực thi; slot làm identity; click ngoài executor; command ngoài executor; waiter vô hạn; listener/timer rò rỉ; reconnect đồng thời; callback cũ phá connection mới; log secret; class/file rỗng; sửa test để che lỗi; dùng Markdown ngoài ba tài liệu chính thức làm nguồn sự thật.

- `/kho` semantic safety: GUI `/nung`, `/ks` hoặc crafting có thể chứa item B1 nhưng không được coi là `/kho` chỉ vì KhoReader parse được item. Một session chỉ được reuse như `/kho` khi có capacity telemetry hoặc source đã được `/kho` command xác nhận; nếu GUI khác đang mở thì phải close, xác nhận currentWindow đã thực sự null, settle riêng sau close rồi mới gửi `/kho`.
