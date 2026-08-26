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
- EventEmitter có nhiều listener permanent hợp lệ phải dùng finite listener bound đã giải thích/test lifecycle; **CẤM:** `setMaxListeners(0)`, `Infinity` hoặc tắt warning để che leak. Full suite không được phát `MaxListenersExceededWarning`.
- **CẤM:** manager/service gọi `process.exit()`.

## Configuration

- **BẮT BUỘC:** host, port, username, auth, version, command, GUI title/layout/slot, item identity, recipe, timeout, retry, response, location và route nằm trong config.
- Constants chỉ dành cho enum, state và error code nội bộ.
- Mỗi config group đang hoạt động phải được đăng ký đúng một lần trong `ConfigSpecs`, có validator/schema thực (không `null`) và bị reject khi có key lạ ngoài contract.
- Config phải được đọc, parse, validate, kiểm tra toàn bộ cross-reference rồi mới đóng băng. Cross-validation tối thiểu bao gồm command/response, GUI/window/slot, item/recipe/tier, location/route, bot/server profile, threshold và daily window; recipe graph có cycle hoặc reference thiếu phải fail trước runtime.
- `loadAll`/`reload` phải dựng candidate snapshot đầy đủ, validate toàn graph rồi swap registry atomically. Nếu runtime apply/reconfigure bất kỳ group nào lỗi, phải rollback cả registry snapshot và mọi runtime đã apply; không được để trạng thái nửa cũ nửa mới.
- Config editor phải validate candidate và cross-reference trước atomic rename; lỗi ghi/apply phải giữ hoặc phục hồi file + registry + runtime trước đó.
- **CẤM:** secret thật trong JSON được commit.
- Desktop DEV phải resolve environment trước lần backend start đầu tiên theo thứ tự: copy process environment → `.env` chỉ điền key thiếu → encrypted Desktop secret store phủ cuối. Desktop packaged không đọc `.env` từ application tree. Restart backend phải resolve lại cùng contract và giữ marker `MCBOT_DESKTOP`.
- Desktop phải dùng `AppData/.../runtime-dev` hoặc `AppData/.../runtime` làm config authority sau migration; project/application `config/` chỉ là default. Chẩn đoán parity chỉ được expose trạng thái, số lượng và relative path khác biệt, không expose nội dung file hoặc giá trị environment/secret.

## Điều phối mode và control plane đa bot

- Mỗi `BotRuntime` có đúng một `ModeCoordinator` bot-scoped làm owner của primary-mode lease và resource lease. Collector/Fishing không tự đọc trạng thái nhau để loại trừ; enable chỉ được chạy sau khi acquire lease, và release phải khớp exact lease/owner để callback cũ không nhả ownership mới.
- Chuyển primary mode phải tuần tự: disable owner cũ, xác minh release/cleanup, rồi mới enable owner mới. Pause giữ ownership; disable/stop/destroy phải release idempotent. Snapshot/change notification phải immutable và lỗi observer không rollback ownership đã commit.
- Ý định điều khiển bền vững chỉ được lưu **desired state**: `CONNECTED|DISCONNECTED`, tối đa một mode `collector-b5|fishing`, và `ACTIVE|PAUSED`. **CẤM:** persist/replay raw command, click, packet, waiter, operation ID, in-flight task, client/generation hoặc credential.
- `DurableIntentStore` phải versioned, revisioned, serialized và optimistic-revision aware; đường dẫn chỉ relative an toàn trong project, không follow symlink/junction, giới hạn kích thước, reject unknown/malformed/corrupt document. Ghi phải dùng temporary regular file riêng, flush file rồi atomic rename; mutation fail phải giữ nguyên snapshot memory và file đã commit trước đó. Source/operator metadata phải được redact và giới hạn độ dài.
- Durable intent phải được tải **trước** khi tạo runtime startup policy. `DISCONNECTED` phải chặn auto-connect của profile enabled ngay từ đầu, không connect thoáng qua rồi mới stop. Không có intent thì giữ hành vi baseline. Profile disabled/missing phải block connect/mode; không tự sửa profile.
- Recovery chỉ reconcile state idempotently và hội tụ tới revision mới nhất. Intent `PAUSED` sau crash không được enable mode đang tắt chỉ để pause, vì như vậy sẽ replay startup side effect; trả trạng thái safe-paused và chờ operator resume. Intent disconnect phải disable mode, cancel operation, dừng movement/GUI rồi stop connection.
- Mọi đường điều khiển operator (Discord slash command, control panel và bot admin/fleet action) phải publish intent qua `FleetControlService`; fallback gọi service trực tiếp chỉ dành cho adapter/test không được inject control plane. Tắt một slash mode không được xóa intent của primary mode khác.
- `FleetScheduler` là application-scoped, có global concurrency bound, tối đa một task running cho mỗi bot, priority + fair rotation giữa bot, dedupe theo exact bot/key, bounded pending queue, task timeout, cancellation và bounded shutdown drain. Timeout/stop phải cancel token underlying; task fail của bot này không được chặn bot khác. Status không expose mutable queue/token/Promise.

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
- Một physical connection failure chỉ được tạo **một reconnect decision**: schedule đúng một retry, terminal non-retryable, exhausted đúng một lần, hoặc stale/obsolete ignore. `ReconnectManager` không được suy đoán event đã xử lý từ `timer`, `currentAttempt` hoặc timing của `finally`; production `ConnectionManager` phải đánh dấu canonical failure-signal contract trên error trước khi reject để catch không fallback lần hai.
- Failure `retryable=false` là terminal cho reconnect owner đó: không tạo/extend timer, không phát `reconnect:scheduled`, không hot-loop. `reconnect:scheduled`/`attempting`/`exhausted` phải mang `sourceGeneration` và/hoặc `sourceAttemptEpoch` đủ để consumer xác minh exact owner; `exhausted` của cùng owner chỉ được emit một lần.
- Replacement client luôn thắng pending attempt/timer cũ. Generation-owned reconnect chỉ actionable khi exact generation còn là generation hiện hành; attempt-owned reconnect chỉ actionable khi exact latest attempt epoch và chưa có current client. State binding phải ignore stale/duplicate attempt/reconnect event và không được hạ `CONNECTED` của replacement.
- Injected/custom connection manager không phát canonical failure event chỉ được dùng explicit catch fallback; fallback phải giữ owner metadata, tôn trọng `retryable=false`, stop/replacement guard và không dùng mutable `currentAttempt` để quyết định.
- Reconnect **source owner** và **success result owner** là hai identity khác nhau: `sourceGeneration`/`sourceAttemptEpoch` mô tả failure khởi phát retry, còn success phải thuộc exact client + exact generation + exact successful attempt của invocation reconnect. Generation `N → N+1` là success bình thường; **CẤM** so current result generation với source generation để xác nhận success.
- `reconnect:succeeded` chỉ được emit sau khi exact success result đã được validate. Production `ConnectionManager.connectWithResult()` giữ `connect()` raw-client compatibility nhưng trả internal immutable success metadata cho reconnect; returned client phải chính là `BotContext` current client, generation phải exact và attemptId/attemptEpoch phải thuộc attempt mà invocation đó trực tiếp khởi phát **hoặc exact in-flight attempt mà invocation thực sự join**. Chỉ return replacement có sẵn (`joinedExisting=true`, `joinedInFlight=false`) không tạo success ownership. Contextful injected manager muốn claim success phải cung cấp explicit equivalent result contract cùng metadata đầy đủ; resolve null/object khác, wrong/stale client, incoherent ownership flags hoặc completion sau stop phải bị ignore. Contextless legacy manager chỉ giữ compatibility cho explicit non-null success result. Success log/event/reset/ledger clear chỉ chạy sau validation này.
- Không reconnect khi shutdown chủ động; timer reconnect phải hủy khi stop.
- Callback bot cũ không được detach hoặc mutate bot mới.

## Movement và teleport

- Movement state/control state bot-scoped; kết thúc operation phải tắt control state.
- Movement có destination, timeout, cancellation, safety guard và arrival verification.
- `RouteExecutor` chỉ được gọi raw `pathfinder.stop()` khi đang sở hữu active route của exact captured client; active stop phải clear goal ngay. Idle cleanup không được gọi raw stop vì cờ `stopPathing` còn treo sẽ làm `goto()` kế tiếp fail `PathStopped`; timeout/cancellation phải dừng underlying pathfinder task trước khi operation settle, và cleanup route cũ không được stop replacement client.
- `/is` không có countdown nhưng phải xác minh teleport.
- `/d` dùng countdown từ config, mặc định 6000 ms trong config; phải khóa movement/teleport xung đột và xác minh teleport thật.

## Server features

- `ServerFeatureFacade` là API cấp cao cho controller/mode sau này.
- Facade không chứa raw slot, NBT hoặc click sequence.
- `/kho` là nguồn sự thật đầy đủ để đọc amount/capacity và tính coverage B1 trên cả raw/phôi/block. `/kho sell` chỉ mở Sell GUI của server; GUI bán có thể không hiển thị raw, nên tuyệt đối không dùng Sell GUI để suy ra full storage. Sell GUI chỉ được dùng để resolve/click/verify các form thực sự xuất hiện; left-click bán `1`, right-click bán `64`, Shift+left bán `ALL`, nhưng B1 production mặc định cấm `SELL ALL`. CURRENT executor chỉ có global gate `storage.sell.allowAll`; không có per-item whitelist và field legacy `fastDisposableSellAllIds` không cấp quyền. Lore Sell GUI còn có thể chứa số hướng dẫn click `1/64`, nên amount từ Sell GUI chỉ được coi là authoritative khi reader xác định được label storage thật; full-stock checkpoint luôn dùng `/kho`.
- `/nung` và nút nung trong `/ks` dùng cùng `SmeltingOperation`.
- Thành phẩm B2–B5 được xác minh trong player inventory.
- Quantity crafting hỗ trợ `1`, `64` và `ALL`. Sau khi storage safety xác nhận `/kho` ổn định, B1→B2 được phép dùng `ALL` cho material planner chọn; `ALL` chỉ là quantity strategy, không phải quyền craft mù. Nếu B1→B2 `ALL` làm inventory đầy, phải cất đúng một stack B2 của material hiện tại vào `/pv 2`, verify có ít nhất một slot trống, rồi B2→B3 dùng `ALL`. Carry stack này phải được planner nhìn thấy/rút lại ở batch sau thay vì để tích lẻ vô hạn trong PV2. B4/B5 vẫn theo lượng planner cần; không suy rộng `ALL` sang B4/B5; B5 cuối không dùng `ALL`.
- GUI observation tự động được phép ghi dữ liệu quan sát vào `data/runtime/gui`; số động trong lore/count không được coi là thay đổi cấu trúc GUI.
- Resource pack server phải được xử lý theo connection generation; khi `autoAccept` bật, bot gọi Mineflayer `acceptResourcePack()` ngay khi nhận event `resourcePack`, phát `resource-pack:ready`, và workflow Skyblock có thể dùng event này làm readiness gate.

## Mode nhặt + B5

- Mode collector+B5 là workflow bot-scoped tầng cao; chỉ gọi capability (`island`, movement, B5 planning/automation), **CẤM:** gọi Mineflayer trực tiếp.
- Khi bật mode, mặc định `/is` phải được xác minh teleport trước khi đi tới `pickupLocation` trong config.
- Collector không đuổi item rơi; bot đứng tại điểm nhặt cấu hình và để cơ chế pickup Minecraft/server thu item.
- Mode phải kiểm tra lệch vị trí tại boundary giữa các cycle và quay lại điểm nhặt khi vượt `reanchorRadius`; không chen movement vào giữa GUI/crafting transaction. `/is`, planning, storage và B5 automation trong một cycle phải dùng cùng mode cancellation token và exact connection generation đã capture trước cycle; generation đổi thì bỏ kết quả cũ, không side effect sang client mới.
- Mode `b5-craft` chạy theo campaign/đợt. Mỗi explicit enable và mỗi lần một B5 mới hoàn tất phải arm đúng một storage-protection episode trước đợt kế tiếp; pause/resume không tạo episode mới, reconnect giữ episode nhưng mọi kết quả generation cũ phải bị loại. Boundary bắt buộc là fresh `/kho` → chỉ nung raw iron/raw gold → nén mọi B1 family có block form → chốt immutable sell baseline với sàn tính toán `1.5 B5` → bán block surplus bằng đúng quantity `64` → giữ phần dư dưới `64` → craft ngay khi mọi action baseline đã được acknowledgement. Không fresh-read hoặc verify lại mức `1.5 B5` sau sell; family thiếu tại baseline không tạo action bán và không giữ mode chờ. Sau khi một B5 mới được xác nhận chế và cất xong, mode chạy thêm một lượt nung raw iron/raw gold; lỗi lượt nung cuối được retry ở boundary đợt sau trước craft. B5 không có đường `SELL ALL` hoặc sell quantity `1`.
- Với nguồn B1 liên tục, snapshot planner và snapshot execution có thể lệch do NPC/craft/conversion. `prepare-b1` gặp `NOT_READY` vì B1 hiện tại không còn đủ là trạng thái chờ nguyên liệu bình thường: không phát lỗi recovery, không chạy vòng craft 250ms; trả về WAITING_MATERIALS và dùng material poll interval rồi re-plan.
- Với nguồn B1 liên tục, `/kho` là buffer có inflow độc lập ở dạng raw/phôi/khối. Immutable sell baseline chỉ chứa surplus đã tồn tại sau fresh read, nung và nén; inflow xuất hiện sau baseline không được hấp thụ vào episode hiện tại. Raw/phôi của family nén được vẫn tính coverage nhưng tuyệt đối không phải sell candidate. Trong sell episode, amount/delta quan sát sau click chỉ là diagnostics và không được thay đổi, mở rộng hoặc ngắt immutable action budget; mỗi right-click đã được semantic GUI transition xác nhận tiêu thụ đúng một action `64`. Không đọc `/kho` sau sell để kiểm tra amount, inflow hoặc reserve. Lỗi nung/nén/read trước baseline và lỗi GUI identity/transition khi thực hiện action vẫn fail-closed ở `WAITING_BLOCKED` sau retry hữu hạn, không được bật loose selling.
- Sell episode lớn phải chia bounded slice. Continuation chỉ xử lý remaining action budget của cùng baseline/episode, không chạy lại nung/nén, không rebaseline, không tính acknowledged continuation là business failure. Timeout/ambiguous GUI action phải reconcile trước khi có click tiếp theo. Khi tất cả full-stack surplus theo baseline đã bán, phần dư `<64` được giữ lại và episode COMPLETE mà không fresh-verify reserve.
- Khi chuyển material trong cùng Sell GUI, executor phải resolve lại slot từ GUI hiện tại. Target tạm không xuất hiện phải được refresh `/kho sell` đúng một lần; nếu vẫn thiếu, chỉ defer các action của exact material đó và tiếp tục những material khác trong immutable baseline. Episode vẫn fail-closed cho material chưa bán sau khi các action khả thi đã chạy; retry chỉ được thử phần pending, tuyệt đối không replay action đã acknowledgement.
- Trước khi chế B5 mới, automation phải reconcile B5 đang có trong player inventory: cất và verify vào `/pv 2`, rồi kết thúc lượt recovery mà không tăng cycle count và không chế thêm B5. Trước final B5 craft phải chứng minh PV2 còn slot trống hoặc target stack còn sức chứa đã biết; nếu chưa chứng minh được thì trả wait-state `pv2-target-capacity`, không craft B5 và không đẩy thêm intermediate vào PV2 đầy.
- Backpressure PV2 phải được re-evaluate từ inspection mới trước từng material chain; khi chạm `minEmptySlots`/`hardMinEmptySlots` thì cấm tạo B2 mới nhưng vẫn được phép promotion làm tăng mật độ B2→B3→B4. Surplus B4 dùng input chung phải được chia theo coverage chuẩn hóa `owned / nhu cầu B4 cho một B5`, không được vét hết input vào B4 đứng đầu cấu hình. Production hiện chỉ hỗ trợ `b1SupplyMode=continuous`, và surplus intermediate bắt buộc giữ trong PV2 (`keepSurplusInPv2=true`).
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
- `/is` và AFK teleport dùng cancellation + exact connection-generation verification. `/is` phải capture exact generation tại public request boundary **trước root queue**, truyền nguyên generation đó qua `OperationContext` → teleport operation → command/waiter và tuyệt đối không recapture replacement generation sau await/queue. Teleport waiter không accept event thiếu generation, phải bind trước side-effect nếu cần tránh missed-fast-event, và phải cleanup listener/timer/cancellation ngay khi public operation settle. `/is` sở hữu internal cancellation source cho command branch: timeout/stale/disconnect/cancel/failure phải hủy throttle/send chưa hoàn tất để command không thể gửi muộn sang client cũ hoặc replacement client. AFK `joinBestAvailable()` phải sở hữu linked cancellation source chung cho click + teleport waiter; bất kỳ terminal outcome nào phải cancel sibling branch **trước** public settle, remove queued click và observe/all-settle pending promise để không late `clickWindow()` hoặc unhandled rejection.
- Fishing connection callbacks (`connection:ended`/`connection:spawned`) chỉ được mutate mode state khi event generation hợp lệ và khớp generation hiện hành; stale hoặc generation-less event không được invalidate route/guard hoặc restart loop mới.
- Recovery side-effect của một Fishing business cycle phải carry `expectedGeneration` xuyên suốt failure handling/publish/cleanup/reconnect. Stale outcome không được tăng breaker, publish như generation mới, cleanup capability generation mới hoặc terminate client mới. `ConnectionManager.requestReconnect(reason, { expectedGeneration } = {})` phải no-op/false nếu generation không còn khớp; caller cũ chỉ truyền `reason` vẫn tương thích.
- Config fishing operator-tunable nằm trong `config/modes/fishing.json`, được `fishing` schema validate trước runtime và validate lại sau merge bot override. Bot override chỉ được thay `shoreFishingPitchDegrees` và destination x/y/z của area hiện có; không được phát minh area/slot/server data mới.
- **CẤM:** empty `catch {}` hoặc `.catch(() => {})` trong file fishing/movement/packet được thêm/sửa. Best-effort cleanup failure phải được log/sanitize hoặc biểu diễn bằng Result/diagnostic rõ mà không che failure gốc.
- **BẮT BUỘC chống tràn `/kho`:** khi không có craft actionable, trước khi vào `COLLECTING/WAIT` phải đổi toàn bộ B1/phôi có thể nén về block; sau mọi lượt craft B2/B3/B4/B5 thành công cũng phải nén B1 còn dư về block trước khi vòng tiếp. Khi craft/plan lỗi, mode phải best-effort nén B1 trước thời gian retry. Block→phôi là thao tác có thể bung toàn bộ stock nên chỉ được phép khi peak capacity dự kiến sau bung vẫn dưới `decompressionMaxRatio`; planner không được tính stock block bị chặn bởi safety này là B1 dùng ngay.
- `/mode` Discord phải cùng tồn tại với `/gui`; đăng ký slash command theo một danh sách chung, không được PUT riêng làm ghi đè command khác.
- Tắt mode phải cancel B5 operation đang chạy qua cancellation token và dừng movement.

## Event identity, generation và operation ownership

- `connectionGeneration` là field canonical duy nhất cho generation trên **live internal event**. Producer mới không được phát đồng thời alias `generation`. Compatibility với event cũ chỉ được đọc tại `normalizeConnectionGeneration()` trong `src/core/events/EventEnvelope.js`; operational consumer khác không được tự rải `event.connectionGeneration ?? event.generation`.
- Event connection-scoped bắt buộc có `botId` và `connectionGeneration` là số nguyên dương hữu hạn. `EventBus` phải resolve scope qua allowlist/schema trung tâm, **không** suy diễn mù theo prefix; malformed connection event phải fail closed trước fan-out. Payload connection-scoped không phải plain object (`null`/`undefined`/primitive/array/function), botId rỗng hoặc generation không phải positive integer phải bị reject **trước eventFactory và trước mọi listener**. Event bot/application-scoped không gắn exact client được phép có `connectionGeneration=null`; không dùng `0` hoặc generation đoán để lấp chỗ trống. Compatibility đặc biệt như synthetic `connection:ended` khi chưa có client chỉ được dùng explicit producer override đã đăng ký, và operational consumer vẫn phải ignore generation-less event. Event metadata canonical gồm `eventId`, `eventType`, `emittedAt`, `botId`, `connectionGeneration`, optional `operationId`/`correlationId` và business fields hiện có. `failureId` vẫn là identity của physical failure và không được thay bằng `eventId`.
- Scope registry phải audit theo **literal internal event name**. `command:message`, `inventory:observed`, `inventory:delta`, `mode:fishing:catch` là connection-scoped. `connection:attempt-started`/`connection:attempt-failed`, reconnect scheduling, runtime failure và mode lifecycle/config events là bot/attempt-scoped theo owner semantics; không đổi scope chỉ vì prefix. `mode:fishing:catch` phải mang exact generation đã capture cho fish cycle và không phát catch của cycle cũ sau replacement.
- Mỗi connection attempt phải có immutable `attemptId` + positive `attemptEpoch` **trước** acquire-turn/create/pathfinder/attach. Failure trước attach không được fake `connectionGeneration`; phải phát attempt-scoped failure có stage rõ, tới runtime failure + retry policy. Failure attempt cũ sau replacement phải bị ignore, không schedule reconnect/end replacement/hạ state. Post-attach `connection:failed` vẫn connection-scoped exact generation.
- Event envelope phải detached khỏi mutable producer input và không được fan-out raw Mineflayer bot/client/window/packet. Position phải là plain snapshot `{x,y,z}`. Operational consumer (waiter, GUI session/click, login/autojoin, reconnect, mode state, connection binding, operation completion) chỉ được mutate/resolve khi bot + expected generation + exact captured client/session/window còn khớp; stale/generation-less connection event phải bị bỏ qua. Diagnostic/historical consumer được giữ failure của generation cũ nhưng không được mutate runtime hiện hành hoặc gán failure đó cho generation mới.
- Waiter có thể nhận fast response/event phải được **arm trước side effect**. Nếu side effect fail/cancel/stale/timeout thì owner phải cancel/observe waiter ngay; không để orphan Promise, unhandled rejection hoặc listener/timer sống sau public operation settle.
- Command confirmation phải capture exact client/generation trước send, arm `command:message` waiter trước `bot.chat()`, lọc exact generation và matching `connection:ended`, cleanup timeout/cancellation/listener ở mọi nhánh. P0 cancellation-aware throttle và exact captured client/generation guard của `CommandExecutor` vẫn bắt buộc; parent timeout/cancel/stale không được để command chat muộn.
- Inventory capture/delta phải giữ exact captured client + generation xuyên read/persist/commit/emit. Snapshot chỉ trở thành `latest` sau khi persistence hoàn tất và exact owner vẫn current; delayed completion generation cũ không được emit/overwrite generation mới. `inventory:observed`/`inventory:delta` luôn mang canonical generation; event evidence cho crafting/sync phải filter exact operation generation. Snapshot disk cũ thiếu generation chỉ là historical, không tự được xem là current.
- `FlowError.wrap` phải giữ known leaf domain code/cause để `Operation.statusForError()` nhìn thấy stale/disconnect/cancel/verification; outer wrapper chỉ bổ sung workflow diagnostic. Generic `TIMEOUT` chỉ được chuyên biệt thành explicit domain `*_TIMEOUT`, không được bị đổi thành `*_FAILED`; generic plain Error mới nhận outer generic failure code.
- `GuiSession` canonical field là `connectionGeneration`; read-only getter `generation` chỉ được giữ tạm cho compatibility caller cũ. `GuiManager` bind exact client+generation; GUI waiter và click flow phải carry expected generation/cancellation. Queued click capture exact session/window/client/generation trước enqueue và re-check toàn bộ ngay trước `clickWindow()`; cancel/stale/timeout không được click old hoặc replacement client muộn. `ClickVerifier` chỉ nhận GUI event đúng generation và cleanup matching disconnect/cancellation.
- Public side-effect workflow nhiều bước phải chạy bằng root `OperationContext` do `OperationManager` cấp; khi nhận validated parent context cùng manager/bot thì chạy child inline, **không enqueue lại** vào root serial queue. Child dùng cùng root cancellation/owner/trace, không mở rộng parent deadline và không đổi sang replacement generation. Parent context chỉ có authority khi chính object đó vẫn `RUNNING`, `settledAt=null`, chưa dispose, chưa cancel, còn nằm trong `OperationManager.active` và root owner tương ứng vẫn active. Context sau SUCCESS/FAILED/CANCELLED/TIMED_OUT/dispose bị revoke vĩnh viễn cho child execution; fake/foreign/stale context phải bị từ chối trước executor.
- Trạng thái operation thuộc từng run/context: `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED`, `TIMED_OUT`; không lưu status mutable trên reusable `Operation` definition. Snapshot phải detached/immutable, phân biệt queued/running và không expose token, Promise, timer, listener hoặc raw lock state.
- `queueWaitTimeoutMs` và execution `timeoutMs` là hai budget khác nhau. Queue pending bị cancel phải bị remove/no-op trước executor; queue full trả `BUSY`/`OPERATION_QUEUE_FULL`; queue-wait hết hạn trả `TIMEOUT`/`OPERATION_QUEUE_WAIT_TIMEOUT`; enqueue sau close trả deterministic `OPERATION_MANAGER_CLOSED`. Execution timeout phải cancel underlying `OperationContext` ngay, propagate vào child/waiter/command/click và chặn mọi late side effect.
- Operation lock owner là opaque owner do `OperationManager`/`OperationLockPolicy` cấp, không phải arbitrary string. Multi-key acquire theo thứ tự deterministic và không partial. Reentrant acquire của cùng root owner dùng depth accounting: child release không được nhả lock parent còn giữ; wrong owner release không được làm mất lock. Shutdown phải cancel/cleanup owner thật, không force-clear lock chỉ để che leak.
- Cleanup registry chạy LIFO ở success/failure/timeout/cancel/disconnect/shutdown. Một cleanup fail không được ngăn cleanup khác hoặc che primary error; cleanup error chỉ bổ sung sanitized diagnostic. Result mapping dùng explicit domain mapping, không dùng broad string matching: verified success→`SUCCESS`, domain/verify timeout→`TIMEOUT`, cancellation→`CANCELLED`, queue/lock conflict→`BUSY`, verification fail→`VERIFICATION_FAILED`, stale generation/disconnect→`DISCONNECTED`, invalid input/context→`INVALID_INPUT`, còn lại→`FAILED`. Root và child managed phải map cùng một code ra cùng status.
- B5 root operation phải truyền validated `operationContext`, cancellation và expected generation xuống crafting/storage/PV/mineral/smelting child side effect; child không được enqueue phía sau parent. Việc này chỉ chuẩn hóa ownership/timeout/trace, **không** thay recipe, storage safety, B5 priority hoặc quantity policy.

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
- Replay/simulation phải deterministic bằng virtual clock và fake side-effect boundary, không dùng Minecraft/Discord/network thật. Trace phải strict/versioned; fault injection drop/delay/duplicate/error phải chứng minh stale generation, cancellation và cleanup không tạo late command/click/end hoặc pending task.
- `validate:architecture` phải fail non-zero khi có unresolved relative import, dependency cycle, source/script không reachable, side-effect ngoài owner, mode/planner boundary violation, connection event không có runtime producer, config group thiếu registration/schema, stale-manifest sai hoặc Markdown ngoài allowlist.
- Xóa stale path chỉ được thực hiện từ manifest đã audit, mặc định dry-run; không xóa dynamic runtime path chỉ vì static scan không thấy. Mọi file source còn lại phải reachable từ runtime entrypoint hoặc script entrypoint.
- Full suite và coverage gate phải có exit code `0`; threshold hiện hành tối thiểu line `80%`, branch `65%`, function `80%`. Không được giảm threshold hoặc exclude source mới để che thiếu test.

## Cấm tuyệt đối

Global bot; bot-scoped singleton; hard-code server data; mode gọi Mineflayer; planner thực thi; slot làm identity; click ngoài executor; command ngoài executor; waiter vô hạn; listener/timer rò rỉ; reconnect đồng thời; callback cũ phá connection mới; log secret; class/file rỗng; sửa test để che lỗi; dùng Markdown ngoài ba tài liệu chính thức làm nguồn sự thật.

- `/kho` semantic safety: GUI `/nung`, `/ks` hoặc crafting có thể chứa item B1 nhưng không được coi là `/kho` chỉ vì KhoReader parse được item. Một session chỉ được reuse như `/kho` khi có capacity telemetry hoặc source đã được `/kho` command xác nhận; nếu GUI khác đang mở thì phải close, xác nhận currentWindow đã thực sự null, settle riêng sau close rồi mới gửi `/kho`.

## B5 action-flow ownership

- **BẮT BUỘC:** B5 orchestration phải tách quyết định khỏi side effect. Reader chỉ đọc, planner chỉ tính bước, storage/sell/vault/craft/movement flow chỉ thực thi hành động được giao rồi trả kết quả.
- **BẮT BUỘC:** stock B1 tổng và stock B1 executable là hai khái niệm khác nhau. Block đang bị giới hạn headroom vẫn là stock đang sở hữu và phải tạo action `PREPARE_B1/FREE_STORAGE`, không được biến thành “không có nguyên liệu”.
- **BẮT BUỘC:** sau side effect làm thay đổi `/kho`, `/pv 2`, inventory hoặc tier craft, orchestration phải re-read/re-plan trước khi suy ra bước xa hơn.
- **CẤM:** compact toàn bộ B1 vô điều kiện ngay trước planning. Compaction/selling là storage-protection action và không được tự phá loose B1 đang executable cho bước B2 kế tiếp.
- **BẮT BUỘC:** block -> base của material đang được chọn có thể dùng transaction headroom tới critical storage envelope nếu flow tạo đủ headroom trước và vẫn giữ reserve; normal high-water protection vẫn giữ ngưỡng riêng.
- **BẮT BUỘC:** B5 batch protection phải hoàn tất nung raw iron/raw gold và nén mọi family có block form trước khi chốt immutable sell baseline.
- **BẮT BUỘC:** B5 reserve sell chỉ gửi quantity `64`; phần surplus dưới `64` được giữ lại và không phải blocker. Không được phát sinh sell quantity `1`.
- **BẮT BUỘC:** sell budget lớn phải continuation theo cùng episode/baseline qua bounded slice. Inflow sau baseline không mở rộng current budget; verified slice progress không tăng business-failure quota.

## Local AI invariants

1. AI output không phải verification evidence cho Minecraft side effect; core observation/postcondition vẫn là authority.
2. Local AI không được đọc `.env*`, secret/credential store, `data/**`, `node_modules/**` hoặc build output qua project tools.
3. Local AI không được arbitrary shell. DEVELOP chỉ có check allowlist.
4. Local AI không được raw chat/click/protocol. ADMIN runtime actions phải đi qua existing DesktopController/service boundary.
5. Permission mặc định là READ và tool registry fail-closed khi quyền không đủ.
6. Agent tool loop bounded; không chạy tool vô hạn.
