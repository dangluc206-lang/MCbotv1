# JS_RESPONSIBILITIES.md

Tài liệu này mô tả từng file JavaScript thực tế trong repository. Source dùng CommonJS; mọi ranh giới kỹ thuật tuân theo `RULES.md`.

**Tổng số file JavaScript production/script:** 230 (`220` trong `src/`, `10` trong `scripts/`; test được mô tả khi có contract acceptance riêng).

## Quy ước

- Mỗi file có một scope chính và một trách nhiệm chính.
- Config phải được inject hoặc đi qua configuration layer.
- Không file nào được dùng global bot, hard-code server data hoặc chiếm trách nhiệm executor khác.


## `scripts/`

### `scripts/inspect-inventory.js`

- **Scope:** Script-only
- **Trách nhiệm:** Chuẩn hóa snapshot inventory offline.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `scripts/inspect-item.js`

- **Scope:** Script-only
- **Trách nhiệm:** Xuất material, display name, lore và NBT của item snapshot.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `scripts/inspect-window.js`

- **Scope:** Script-only
- **Trách nhiệm:** Chuẩn hóa snapshot GUI offline để hiệu chỉnh config.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `scripts/record-position.js`

- **Scope:** Script-only
- **Trách nhiệm:** Ghi một tọa độ vào locations config.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `scripts/test-command.js`

- **Scope:** Script-only
- **Trách nhiệm:** Resolve command config offline, không gửi tới server.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `scripts/validate-config.js`

- **Scope:** Script-only
- **Trách nhiệm:** Tải toàn bộ config bằng configuration layer để phát hiện lỗi.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `scripts/validate-structure.js`

- **Scope:** Script-only
- **Trách nhiệm:** Kiểm tra ba Markdown chính thức và các file/cấu trúc bắt buộc.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.


## `src/bootstrap/`

### `src/bootstrap/createApplication.js`

- **Scope:** Bootstrap-only
- **Trách nhiệm:** Composition root application: tải/cross-validate config và profile, khởi tạo durable intent trước khi tạo runtime, derive startup auto-connect policy, wire shared services, `FleetScheduler`/`FleetControlService`, bot runtimes, Discord adapter và lifecycle cleanup theo đúng scope.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/bootstrap/createBotRuntime.js`

- **Scope:** Bootstrap-only
- **Trách nhiệm:** Ủy quyền tạo một BotRuntime từ profile và dependency đã validate.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/bootstrap/loadBotProfiles.js`

- **Scope:** Bootstrap-only
- **Trách nhiệm:** Đọc, validate và bổ sung secret môi trường cho bot profiles.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/bootstrap/loadConfiguration.js`

- **Scope:** Bootstrap-only
- **Trách nhiệm:** Tải, validate và đăng ký các nhóm config chính thức.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/bootstrap/registerBotServices.js`

- **Scope:** Bootstrap-only
- **Trách nhiệm:** Wiring toàn bộ dependency bot-scoped; đọc `app.diagnostics.runtimeFailures`/`circuitBreaker` đã validate, inject `connectionAggregationMs`, tạo `RuntimeFailurePublisher`/`RuntimeFailureRecorder`, và truyền policy để Collector/Fishing mỗi mode sở hữu breaker riêng. Connection/login state mutation phải đi qua generation-aware binding; lifecycle phải đặt mode trước teardown recorder/publisher theo reverse cleanup. Không chứa workflow runtime.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.


### `src/bootstrap/createConnectionStateBinding.js`

- **Scope:** Bot-scoped connection-state adapter
- **Trách nhiệm:** Bind canonical connection/login events vào `BotState` với exact current/latest-known `connectionGeneration`; theo dõi latest attempt epoch cho pre-attach started/failed. `connection:attempt-started/connecting/attempt-failed` chỉ mutate khi exact attempt epoch còn current theo owner contract; duplicate/older attempt hoặc attempt tới sau replacement bị ignore. `reconnect:scheduled/attempting/exhausted` chỉ mutate khi `sourceGeneration` và/hoặc `sourceAttemptEpoch` còn actionable; stale reconnect tuyệt đối không hạ state/lastError của replacement đang `CONNECTED`.
- **Lifecycle/cleanup:** `stop`/`destroy` gỡ toàn bộ subscriptions idempotent.
- **Không được làm:** recapture replacement generation từ event cũ, coi generation thiếu là current, hoặc mutate reconnect state chỉ dựa trên `botId`.

### `src/bootstrap/registerModules.js`

- **Scope:** Bootstrap-only
- **Trách nhiệm:** Đăng ký các runtime đã tạo vào Application.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/bootstrap/registerSharedServices.js`

- **Scope:** Bootstrap-only
- **Trách nhiệm:** Tạo các dependency application-scoped dùng chung và immutable definitions.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/bootstrap/shutdown.js`

- **Scope:** Bootstrap-only
- **Trách nhiệm:** Đăng ký signal handler và bảo đảm shutdown idempotent.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.


## `src/bot/`

### `src/bot/BotContext.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Giữ Mineflayer client hiện tại và connection generation của một bot.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/bot/BotFactory.js`

- **Scope:** Application-scoped
- **Trách nhiệm:** Tạo raw Mineflayer client; require dependency theo kiểu lazy.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/bot/BotIdentity.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Thực hiện trách nhiệm chuyên biệt của `BotIdentity` trong `src/bot` theo RULES.md.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/bot/BotLifecycle.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Thực hiện trách nhiệm chuyên biệt của `BotLifecycle` trong `src/bot` theo RULES.md.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/bot/BotRegistry.js`

- **Scope:** Application-scoped
- **Trách nhiệm:** Đăng ký/tra cứu BotRuntime theo botId và phát `onChange` cho register/remove để consumer application-scoped như Discord reporter attach/detach runtime động. Listener exception phải được cô lập, không rollback/half-apply mutation registry.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/bot/BotRuntime.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Composition root và public capability của một bot.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/bot/BotState.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Lưu state scoped và trả snapshot bất biến. Thành phần: `BotState`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/bot/errors/BotAlreadyExistsError.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Biểu diễn lỗi chuyên biệt với code/details/cause. Thành phần: `BotAlreadyExistsError`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/bot/errors/BotNotFoundError.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Biểu diễn lỗi chuyên biệt với code/details/cause. Thành phần: `BotNotFoundError`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/bot/errors/BotNotReadyError.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Biểu diễn lỗi chuyên biệt với code/details/cause. Thành phần: `BotNotReadyError`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.


## `src/commands/`

### `src/commands/CommandExecutor.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Nơi duy nhất gửi server command bằng `bot.chat()`. Thực thi throttle cancellation-aware; kiểm tra token trước throttle và ngay trước send. Khi caller truyền `expectedGeneration`, capture exact client/generation trước throttle và từ chối send nếu client/generation thay đổi trước `chat()`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/commands/CommandGuard.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Kiểm tra precondition và từ chối thao tác không an toàn. Thành phần: `CommandGuard`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/commands/CommandRegistry.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Lưu và tra cứu definition/runtime theo key mà không expose collection mutable. Thành phần: `CommandRegistry`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/commands/CommandResolver.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Chuyển key hoặc input domain thành giá trị đã resolve. Thành phần: `CommandResolver`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/commands/CommandService.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Cung cấp capability nghiệp vụ qua Result contract. Capture/forward `cancellationToken`, `expectedGeneration`, `operationId` và `correlationId`; pre-arm `CommandConfirmation` trước khi executor có thể gọi `bot.chat()` để không miss fast response; send failure/cancel/stale phải cancel và observe waiter. Giữ P0 cancellation-aware throttle/exact-client guard và map stale-generation thành disconnect-compatible Result thay vì gửi command muộn.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/commands/responses/CommandConfirmation.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Sở hữu waiter xác nhận command. Arm listener trước side effect, lọc exact `botId` + `connectionGeneration`, re-check current connection trước resolve, matching `connection:ended` mới cancel và stale end bị bỏ qua. Cleanup timer/EventBus/cancellation ở mọi settle; observation Promise phải được gắn ngay lúc arm để early cancellation/send failure không tạo orphan rejection.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/commands/responses/ResponseMatcher.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Đối chiếu input với rule và trả kết quả giải thích được. Thành phần: `ResponseMatcher`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/configuration/ConfigLoader.js`

- **Scope:** Application-scoped
- **Trách nhiệm:** Thực hiện trách nhiệm chuyên biệt của `ConfigLoader` trong `src/configuration` theo RULES.md.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/configuration/ConfigRegistry.js`

- **Scope:** Application-scoped
- **Trách nhiệm:** Lưu và tra cứu definition/runtime theo key mà không expose collection mutable. Thành phần: `ConfigRegistry`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/configuration/ConfigResolver.js`

- **Scope:** Application-scoped
- **Trách nhiệm:** Chuyển key hoặc input domain thành giá trị đã resolve. Thành phần: `ConfigResolver`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/configuration/ConfigValidator.js`

- **Scope:** Application-scoped
- **Trách nhiệm:** Thực hiện trách nhiệm chuyên biệt của `ConfigValidator` trong `src/configuration` theo RULES.md.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/configuration/ConfigurationService.js`

- **Scope:** Application-scoped
- **Trách nhiệm:** Cung cấp capability nghiệp vụ qua Result contract. Thành phần: `ConfigurationService`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/configuration/errors/ConfigLoadError.js`

- **Scope:** Application-scoped
- **Trách nhiệm:** Biểu diễn lỗi chuyên biệt với code/details/cause. Thành phần: `ConfigLoadError`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/configuration/errors/ConfigRegistryError.js`

- **Scope:** Application-scoped
- **Trách nhiệm:** Lưu và tra cứu definition/runtime theo key mà không expose collection mutable. Thành phần: `ConfigRegistryError`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/configuration/errors/ConfigValidationError.js`

- **Scope:** Application-scoped
- **Trách nhiệm:** Biểu diễn lỗi chuyên biệt với code/details/cause. Thành phần: `ConfigValidationError`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/configuration/schemas/app.schema.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Strict-validate application contract gồm operation queue/timeouts, multi-bot connection cadence, durable `controlPlane` queue/file bounds và diagnostics runtime-failure/circuit-breaker. Reject unknown key, unsafe intent path, invalid bound và quota quá nhỏ; giữ semantics zero-window đã công bố.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/configuration/schemas/bot.schema.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Validate bot profile, bao gồm `id` filesystem-safe thống nhất với Discord admin theo `^[a-z0-9][a-z0-9_-]{1,31}$` để bot-scoped persistence không nhận slash/backslash/dot traversal/absolute path.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/configuration/schemas/server.schema.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Validate hình dạng một nhóm configuration. Thành phần: `server.schema`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.


## `src/connection/`

### `src/connection/ConnectionFactory.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Tạo instance từ config/dependency đã validate. Thành phần: `ConnectionFactory`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/connection/ConnectionManager.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Tạo/attach connection, chờ spawn và cleanup connection hiện tại. Startup dùng internal `autoConnect` policy đã hợp nhất profile + durable intent; policy false chỉ chặn auto-connect, không cấm manual `connect()`. Mỗi attempt phải có immutable `attemptId`/`attemptEpoch` trước risky async work; pre-attach failure phát `connection:attempt-failed` bot/attempt-scoped với exact stage, không fake generation. Post-attach failure mới phát connection-scoped `connection:failed` với exact generation; acquired attempt lease release đúng một lần. Error reject sau canonical failure emit phải mang immutable diagnostic `details.failureSignal` theo `ConnectionFailureSignalContract` để `ReconnectManager` biết event path đã là authoritative và không fallback lần hai sau `currentAttempt` bị clear.
- **Success ownership capability:** `connect()` vẫn trả raw client như cũ. `connectWithResult()` là backward-compatible internal capability cho `ReconnectManager`: trả immutable `ConnectionSuccessResultContract` với exact returned client, attached generation, attemptId/attemptEpoch và flags cho biết invocation thật sự khởi phát attempt hay chỉ join existing/in-flight connection. Metadata chỉ được tạo sau spawn + current-session verification và raw client không được fan-out qua EventBus.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác, fake generation cho pre-attach failure hoặc dựa vào mutable reconnect state để phát duplicate failure decision.

### `src/connection/ConnectionFailureSignalContract.js`

- **Scope:** Stateless connection contract constant.
- **Trách nhiệm:** định danh version của canonical ConnectionManager failure-signal path dùng trong error diagnostic để phân biệt production event-authoritative rejection với injected/custom manager fallback.
- **Không được làm:** giữ bot/client/timer/listener hoặc chứa reconnect policy.

### `src/connection/ConnectionSuccessResultContract.js`

- **Scope:** Stateless internal result contract.
- **Trách nhiệm:** chuẩn hóa immutable success metadata cho reconnect correlation mà không đổi return shape của `ConnectionManager.connect()`. Contract tách source failure owner khỏi result owner và giữ exact client nội bộ, connection generation, attemptId/attemptEpoch cùng `startedByInvocation`/join flags.
- **Không được làm:** emit raw client qua EventBus, giữ timer/listener hoặc quyết định reconnect policy.

### `src/connection/ReconnectManager.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Quản lý retry timer/backoff và **một quyết định cho mỗi physical failure owner**. Canonical `connection:attempt-failed`/`connection:failed` là authoritative; catch của `ConnectionManager.connect()` có `failureSignal.contract` không được schedule lại. `retryable=false` terminal thật. Generation owner phải exact generation; attempt owner phải exact latest attempt epoch khi chưa có current client. Equivalent signal cùng owner được dedupe; richer signal chỉ có thể extend cùng pending timer mà không emit scheduling decision thứ hai. `reconnect:scheduled/attempting/exhausted` luôn carry source owner metadata và exhausted cùng owner emit tối đa một lần. Injected/custom manager không có canonical marker mới dùng explicit catch fallback, vẫn giữ owner/retryable/replacement/stop guard.
- **Success ownership:** `sourceGeneration`/`sourceAttemptEpoch` chỉ là trigger owner, không phải result identity. Reconnect success phải validate exact returned/current client và exact successful result generation/attempt; `N→N+1` là normal. Production dùng `ConnectionManager.connectWithResult()`; contextful custom manager chỉ được claim success khi cung cấp equivalent explicit `connection-success-result-v1` với coherent ownership: `startedByInvocation=true` cho attempt do invocation mở, hoặc `joinedInFlight=true` cho exact attempt đang chạy mà invocation thực sự join. Existing-only replacement (`joinedExisting=true`, `joinedInFlight=false`), malformed ownership, null/wrong/stale client hoặc completion sau stop phải bị ignore. `reconnect:succeeded` payload giữ source fields riêng và result fields `connectionGeneration`/`resultGeneration` + `successfulAttemptId`/`successfulAttemptEpoch`; success log/event/attempt reset/failure-ledger clear chỉ chạy sau exact validation.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** `stop`/`destroy` clear timer, pending owner, bounded decision ledger và toàn bộ event subscriptions; late rejection sau stop không được schedule lại.
- **Không được làm:** suy đoán failure đã được xử lý từ `!timer`, `!currentAttempt` hoặc timing của `finally`; schedule attempt-owned retry trên replacement client; phát duplicate `reconnect:exhausted`.

### `src/connection/SessionManager.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Theo dõi client và generation thuộc session connection hiện tại.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/core/Application.js`

- **Scope:** Application-scoped
- **Trách nhiệm:** Điều phối lifecycle application và nhiều BotRuntime.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/core/events/EventEnvelope.js`

- **Scope:** Shared internal event contract
- **Trách nhiệm:** Tạo detached canonical event metadata (`eventId`, `eventType`, `emittedAt`, `botId`, `connectionGeneration`, optional operation/correlation) và là **boundary duy nhất** được đọc legacy alias `generation`. Connection-scoped envelope thiếu positive generation bị từ chối; bot/application event được phép generation null. Clone không expose raw bot/client/window/packet và không mutate producer input.
- **Compatibility:** Live internal producer chỉ phát `connectionGeneration`; legacy alias chỉ được normalize khi đọc ở helper này. `failureId` và historical generation được bảo toàn cho diagnostic fan-out nhưng không được dùng để mutate current runtime.

### `src/core/events/EventScopeRegistry.js`

- **Scope:** Shared internal event-scope contract
- **Trách nhiệm:** Explicit allowlist/schema xác định connection-scoped event và các producer scope override tương thích đã đăng ký. Không suy diễn theo prefix. `connection:ended` synthetic khi chưa có client chỉ được bot-scope qua explicit override; operational consumer vẫn phải ignore generation-less event.
- **Không được làm:** cho caller tùy ý downgrade connection event sang bot scope.

### `src/core/EventBus.js`

- **Scope:** Application-scoped
- **Trách nhiệm:** Abstraction EventEmitter với unsubscribe rõ ràng; resolve scope qua `EventScopeRegistry` và fail closed malformed connection-scoped event **trước fan-out/eventFactory**. Connection event chỉ nhận plain object với non-empty `botId` + positive integer raw `connectionGeneration`; null/undefined/primitive/array/function và legacy-only `generation` không được tới factory/listener. EventEmitter dùng finite listener bound (`64`) để vẫn phát hiện leak; không dùng unlimited listeners.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/core/LifecycleCoordinator.js`

- **Scope:** Application-scoped
- **Trách nhiệm:** Thực thi lifecycle theo thứ tự, rollback và cleanup ngược.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/core/StateStore.js`

- **Scope:** Application-scoped
- **Trách nhiệm:** Sở hữu state và trả snapshot bất biến.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/core/constants/LifecycleState.js`

- **Scope:** Application-scoped
- **Trách nhiệm:** Lưu state scoped và trả snapshot bất biến. Thành phần: `LifecycleState`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.


## `src/diagnostics/`

### `src/diagnostics/CommandDiagnostics.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Quan sát và xuất snapshot chẩn đoán, không mutate runtime. Thành phần: `CommandDiagnostics`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/diagnostics/DiagnosticsManager.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Sở hữu state/lifecycle và điều phối capability cùng scope. Thành phần: `DiagnosticsManager`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/diagnostics/GuiDiagnostics.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Quan sát và xuất snapshot chẩn đoán, không mutate runtime. Thành phần: `GuiDiagnostics`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/diagnostics/ItemDiagnostics.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Quan sát và xuất snapshot chẩn đoán, không mutate runtime. Thành phần: `ItemDiagnostics`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/diagnostics/MovementDiagnostics.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Quan sát và xuất snapshot chẩn đoán, không mutate runtime. Thành phần: `MovementDiagnostics`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/diagnostics/SlotDiagnostics.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Quan sát và xuất snapshot chẩn đoán, không mutate runtime. Thành phần: `SlotDiagnostics`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/diagnostics/runtime/RuntimeFailureRecorder.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Ghi lỗi runtime có cấu trúc cùng GUI/inventory snapshot vào `data/runtime/errors/<botId>/` để chẩn đoán deterministic.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.


## `src/gui/`

### `src/gui/GuiManager.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Sở hữu GUI state/session/waiter lifecycle cho exact client + exact `connectionGeneration`. GUI waiter capture current client/session/window trước side effect, lọc exact generation và matching disconnect, không polling replacement `currentWindow`, cleanup raw/EventBus listener, poll timer và cancellation. `gui:opened/updated/closed` phát canonical envelope metadata. `click()` capture exact session/window/client/generation trước enqueue và forward cancellation/operation correlation xuống click pipeline.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/gui/GuiRegistry.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Lưu và tra cứu definition/runtime theo key mà không expose collection mutable. Thành phần: `GuiRegistry`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/gui/GuiSession.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Đại diện GUI session của exact bot/client/window/generation. Canonical field là `connectionGeneration`; legacy getter `generation` chỉ read-only compatibility. Session snapshot không được dùng replacement client/window để hoàn tất operation cũ.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/gui/GuiState.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Lưu state scoped và trả snapshot bất biến. Thành phần: `GuiState`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/gui/click/ClickExecutor.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Nơi duy nhất gọi API `clickWindow` của Mineflayer. Trước side effect phải check cancellation, exact captured session/window/client/connectionGeneration và check cancellation lần cuối; không có await giữa final guard và `clickWindow()`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/gui/click/ClickGuard.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Kiểm tra precondition click đối với exact captured session/window/client/connectionGeneration; stale/replaced session phải bị từ chối trước executor.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/gui/click/ClickQueue.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Tuần tự hóa click bằng bounded/cancellable queue contract. Pending click bị cancel/queue-timeout phải không gọi executor; một task fail không chặn task tiếp theo.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/gui/click/ClickVerifier.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Xác minh hậu điều kiện click bằng GUI event/session đúng `connectionGeneration`; nhận cancellation token, matching disconnect cancel waiter, stale/genless event bị bỏ qua và mọi listener/timer/subscription được cleanup khi settle.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/gui/detection/GuiDetector.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Thực hiện trách nhiệm chuyên biệt của `GuiDetector` trong `src/gui/detection` theo RULES.md.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/gui/detection/LayoutMatcher.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Đối chiếu input với rule và trả kết quả giải thích được. Thành phần: `LayoutMatcher`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/gui/detection/SlotFingerprintMatcher.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Đối chiếu input với rule và trả kết quả giải thích được. Thành phần: `SlotFingerprintMatcher`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/gui/detection/TitleMatcher.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Đối chiếu input với rule và trả kết quả giải thích được. Thành phần: `TitleMatcher`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/gui/detection/WindowMatcher.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Đối chiếu input với rule và trả kết quả giải thích được. Thành phần: `WindowMatcher`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/gui/slots/SlotInspector.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Thực hiện trách nhiệm chuyên biệt của `SlotInspector` trong `src/gui/slots` theo RULES.md.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/gui/slots/SlotRegistry.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Lưu và tra cứu definition/runtime theo key mà không expose collection mutable. Thành phần: `SlotRegistry`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/gui/slots/SlotResolver.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Chuyển key hoặc input domain thành giá trị đã resolve. Thành phần: `SlotResolver`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/gui/slots/SlotValidator.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Thực hiện trách nhiệm chuyên biệt của `SlotValidator` trong `src/gui/slots` theo RULES.md.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.


## `src/index.js/`

### `src/index.js`

- **Scope:** Bootstrap-only
- **Trách nhiệm:** Entry point: tạo application, khởi động lifecycle, đăng ký shutdown và đặt exit code.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.


## `src/items/`

### `src/items/ItemInspector.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Thực hiện trách nhiệm chuyên biệt của `ItemInspector` trong `src/items` theo RULES.md.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/items/ItemNormalizer.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Thực hiện trách nhiệm chuyên biệt của `ItemNormalizer` trong `src/items` theo RULES.md.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/items/ItemRegistry.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Lưu và tra cứu definition/runtime theo key mà không expose collection mutable. Thành phần: `ItemRegistry`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/items/ItemResolver.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Chuyển key hoặc input domain thành giá trị đã resolve. Thành phần: `ItemResolver`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/items/inventory/InventoryCounter.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Cộng tổng số lượng mọi phần tử phù hợp. Thành phần: `InventoryCounter`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/items/inventory/InventoryReader.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Đọc dữ liệu nguồn và tạo biểu diễn chuẩn hóa, không side effect. Thành phần: `InventoryReader`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/items/inventory/InventoryScanner.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Quét tập dữ liệu theo identity/rule. Thành phần: `InventoryScanner`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/items/inventory/InventorySnapshot.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Value object bất biến chụp trạng thái tại một thời điểm. Thành phần: `InventorySnapshot`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/items/inventory/observation/InventoryObservationStore.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Ghi snapshot inventory normalized theo bot bằng atomic write vào runtime data.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/items/inventory/observation/InventoryObservationService.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Theo dõi inventory/GUI lifecycle theo exact captured client + current connection generation + GUI session/window ownership, debounce và lưu các inventory view normalized. Capture chỉ commit `latest`/emit sau async store write khi exact owner vẫn current; delayed old-generation completion không overwrite current snapshot. Delta callback mang chính generation lúc bind; stale callbacks no-op. `eventsSince` hỗ trợ exact-generation filter; legacy saved snapshot thiếu generation chỉ historical. Stale/genless `gui:*` hoặc `connection:ended` không được tháo listener/capture current generation.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/items/inventory/sync/InventorySyncService.js`

- **Scope:** Bot-scoped inventory verification primitive
- **Trách nhiệm:** Chờ post-action inventory ổn định cho exact captured client/generation; mọi event evidence lọc exact operation generation và owner được re-check sau tick/poll trước read/return. Replacement giữa sync phải fail `INVENTORY_SYNC_STALE_GENERATION`, không dùng evidence generation cũ để xác minh generation mới. Stable persistence chuyển exact generation vào `InventoryObservationService.capture`.
- **Không được làm:** recapture replacement generation sau await hoặc nuốt persistence rejection.

### `src/items/matching/CompositeItemMatcher.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Đối chiếu input với rule và trả kết quả giải thích được. Thành phần: `CompositeItemMatcher`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/items/matching/ItemMatcher.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Đối chiếu input với rule và trả kết quả giải thích được. Thành phần: `ItemMatcher`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/items/matching/LoreMatcher.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Đối chiếu input với rule và trả kết quả giải thích được. Thành phần: `LoreMatcher`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/items/matching/MaterialMatcher.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Đối chiếu input với rule và trả kết quả giải thích được. Thành phần: `MaterialMatcher`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/items/matching/NameMatcher.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Đối chiếu input với rule và trả kết quả giải thích được. Thành phần: `NameMatcher`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/items/matching/NbtMatcher.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Đối chiếu input với rule và trả kết quả giải thích được. Thành phần: `NbtMatcher`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.


## `src/movement/`

### `src/movement/ControlStateManager.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Sở hữu state/lifecycle và điều phối capability cùng scope. Thành phần: `ControlStateManager`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/movement/MovementManager.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Sở hữu state/lifecycle và điều phối capability cùng scope. Thành phần: `MovementManager`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/movement/MovementState.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Lưu state scoped và trả snapshot bất biến. Thành phần: `MovementState`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/movement/PositionService.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Cung cấp capability nghiệp vụ qua Result contract. Thành phần: `PositionService`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/movement/RotationService.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Cung cấp capability nghiệp vụ qua Result contract. Thành phần: `RotationService`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/movement/navigation/ArrivalDetector.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Thực hiện trách nhiệm chuyên biệt của `ArrivalDetector` trong `src/movement/navigation` theo RULES.md.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/movement/navigation/DestinationResolver.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Chuyển key hoặc input domain thành giá trị đã resolve. Thành phần: `DestinationResolver`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/movement/navigation/NavigationManager.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Sở hữu state/lifecycle và điều phối capability cùng scope. Thành phần: `NavigationManager`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/movement/navigation/RouteExecutor.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Thực hiện trách nhiệm chuyên biệt của `RouteExecutor` trong `src/movement/navigation` theo RULES.md.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/movement/navigation/RouteRegistry.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Lưu và tra cứu definition/runtime theo key mà không expose collection mutable. Thành phần: `RouteRegistry`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/movement/safety/MovementGuard.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Kiểm tra precondition và từ chối thao tác không an toàn. Thành phần: `MovementGuard`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/movement/safety/PositionValidator.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Thực hiện trách nhiệm chuyên biệt của `PositionValidator` trong `src/movement/safety` theo RULES.md.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/operations/Operation.js`

- **Scope:** Operation definition
- **Trách nhiệm:** Immutable operation definition/executor. Per-run status thuộc `OperationContext`; class acquire/release lock bằng opaque context owner, chạy executor/cleanup và map FlowError/domain code bằng explicit central mapping sang Result status chuẩn (`TIMEOUT`, `CANCELLED`, `BUSY`, `VERIFICATION_FAILED`, `DISCONNECTED`, `INVALID_INPUT`, `FAILED`). Domain timeout và stale/disconnect không được collapse về `FAILED`.
- **Không được làm:** giữ mutable run status trên reusable definition hoặc nhận arbitrary lock-owner string.

### `src/operations/OperationContext.js`

- **Scope:** Bot-scoped per operation run
- **Trách nhiệm:** Authority-bearing run context do `OperationManager` cấp: operation/root/parent identity, bot, exact connection generation, correlation, per-run status/timestamps, queue/execution budget, shared cancellation, opaque lock owner, structured child trace và LIFO cleanup registry. Authority chỉ live khi context đang `RUNNING`, chưa settle/dispose/cancel và vẫn được manager/root active sở hữu; terminal/disposed context bị revoke cho child. Fake/foreign/stale context phải bị từ chối.
- **Lifecycle/cleanup:** parent cancellation propagate vào child; child không mở rộng parent deadline; cleanup errors bổ sung diagnostic nhưng không che primary result.
- **Không được làm:** expose raw Mineflayer object, Promise/timer/listener/cancellation source mutable hoặc arbitrary lock owner trong snapshot/Result.

### `src/operations/OperationLockPolicy.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Cấp opaque lock owner, deterministic multi-key acquire không partial và reentrant depth cho cùng root owner. Child release chỉ giảm depth; wrong owner không release; snapshot chỉ expose diagnostic owner ID bất biến.
- **Lifecycle/cleanup:** release idempotent theo lease/owner; shutdown không force-clear để che leak trước owned cleanup.

### `src/operations/OperationManager.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Tạo root operation qua serial `OperationQueue` và chạy validated **live** child inline để tránh nested-queue deadlock. Sở hữu active queued/running contexts, cancellation, bounded stop/drain, manager authority và operation policy config. Child chỉ hợp lệ khi exact parent object + root owner vẫn active/RUNNING; settled/disposed/stale context trả deterministic `OPERATION_CONTEXT_STALE` trước executor. Child cùng root dùng cancellation/owner/trace/deadline; child khác manager/bot bị từ chối.
- **Lifecycle/cleanup:** `cancel`/`cancelAll` tác động queued và running; stop đóng nhận task mới, cancel owned work và bounded drain, không force-clear lock để che leak.

### `src/operations/OperationQueue.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Bounded serial queue phân biệt pending/running. Hỗ trợ pending cancellation, queue-wait timeout, queue-full/closed deterministic codes, task failure isolation và immutable diagnostic snapshot; task pending hết hạn/cancel không được gọi executor.
- **Lifecycle/cleanup:** pending timer/subscription được clear khi task start/cancel/timeout/close; một task reject không làm hỏng continuation của queue.

### `src/operations/OperationTimeoutPolicy.js`

- **Scope:** Operation-scoped
- **Trách nhiệm:** Áp execution timeout lên underlying work và **cancel OperationContext trước khi public timeout settle**. Observe late third-party resolve/reject để không unhandled; timeout/cancellation không được để command/click/control side effect muộn.
- **Lifecycle/cleanup:** timeout/cancellation listener được clear khi work settle; timer vẫn referenced cho tới settle để public operation không biến mất trước deadline.


## `src/planning/`

### `src/planning/crafting/B5Planner.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Facade planner chuyên mục tiêu super_alloy.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/planning/crafting/CraftingPlan.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Thực hiện trách nhiệm chuyên biệt của `CraftingPlan` trong `src/planning/crafting` theo RULES.md.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/planning/crafting/CraftingPlanner.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Lập kế hoạch craft thuần dữ liệu, không thực thi.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/planning/crafting/CraftingStep.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Thực hiện trách nhiệm chuyên biệt của `CraftingStep` trong `src/planning/crafting` theo RULES.md.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/planning/crafting/MaterialCalculator.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Khai triển recipe graph thành tổng nguyên liệu gốc.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.


## `src/server-features/`

### `src/server-features/ServerFeatureFacade.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** API cấp cao cho storage, vault, minerals, smelting, crafting, island và dungeon.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/server-features/authentication/ServerLoginService.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Nghe `connection:spawned` của đúng bot, gửi command đăng nhập server bằng mật khẩu đã inject từ environment và lặp lại cho mỗi connection generation mới.
- **Dependency được phép:** `BotContext`, `EventBus`, `CommandService`, cancellation/timeout primitive, logger và config `serverLogin` đã validate.
- **Dependency bị cấm:** raw `bot.chat()`, global bot, đọc trực tiếp `.env`, ghi hoặc log mật khẩu, GUI, movement và planner.
- **Lifecycle/cleanup:** đăng ký listener trong `initialize`; hủy delay/cancellation và gỡ listener trong `stop`/`destroy`; mỗi generation chỉ gửi một lần. `server-login:failed` chỉ được emit nếu pending attempt generation vẫn là current; command rejection của generation cũ sau replacement không được fan-out failure vào runtime mới.
- **Không được làm:** hard-code `/login`, lưu mật khẩu vào config JSON, trả mật khẩu trong result/log, hoặc xử lý callback của connection cũ như connection hiện tại.

### `src/server-features/resource-pack/ResourcePackAutoAcceptService.js`

- **Scope:** Bot-scoped/connection-aware lifecycle service.
- **Trách nhiệm:** Bind sớm vào Mineflayer client theo connection generation, tự gọi `acceptResourcePack()` khi server phát `resourcePack`, rồi phát `resource-pack:requested`/`accepted`/`ready` cho workflow readiness.
- **Dependency được phép:** `BotContext`, `EventBus`, Mineflayer client hiện tại, logger và config `resourcePack` đã load.
- **Dependency bị cấm:** global bot, command/click workflow, planner và secret.
- **Lifecycle/cleanup:** listener thuộc đúng client/generation và phải gỡ khi connection end/fail hoặc service stop/destroy.
- **Không được làm:** giả vờ resource pack thuộc connection mới, log URL/hash nhạy cảm hoặc tự chạy Skyblock workflow.

### `src/server-features/crafting/CraftingOperation.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Thực thi workflow side-effect có timeout/lock/cleanup. Thành phần: `CraftingOperation`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/server-features/crafting/CraftingOutcomeClassifier.js`

- **Scope:** Stateless crafting safety classifier.
- **Trách nhiệm:** Phân loại hậu quả sau quantity click thành VERIFIED/UNCERTAIN từ output/input/event/MMOItems evidence; UNCERTAIN luôn yêu cầu reconciliation và tuyệt đối không cấp quyền blind retry.
- **Dependency được phép:** dữ liệu verification thuần và primitive chuẩn hóa; không Mineflayer, GUI click, command hoặc mode state.
- **Không được làm:** tự retry, tự sửa inventory, suy diễn “không thấy delta = server không làm gì”, hoặc sở hữu lifecycle.

### `src/server-features/crafting/CraftingQuantityResolver.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Chuyển key hoặc input domain thành giá trị đã resolve. Thành phần: `CraftingQuantityResolver`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/server-features/crafting/CraftingRecipeRegistry.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Lưu và tra cứu definition/runtime theo key mà không expose collection mutable. Thành phần: `CraftingRecipeRegistry`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/server-features/crafting/CraftingResultVerifier.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Xác minh hậu điều kiện sau side effect. Thành phần: `CraftingResultVerifier`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/server-features/crafting/CraftingService.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Cung cấp capability nghiệp vụ qua Result contract. Thành phần: `CraftingService`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/server-features/dungeon/DungeonDestinationRegistry.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Lưu và tra cứu definition/runtime theo key mà không expose collection mutable. Thành phần: `DungeonDestinationRegistry`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/server-features/dungeon/DungeonService.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Cung cấp capability nghiệp vụ qua Result contract. Thành phần: `DungeonService`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/server-features/dungeon/DungeonTeleportOperation.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Thực thi workflow side-effect có timeout/lock/cleanup. Thành phần: `DungeonTeleportOperation`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/server-features/island/IslandService.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Cung cấp capability nghiệp vụ qua Result contract. Thành phần: `IslandService`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/server-features/island/IslandTeleportOperation.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Thực thi `/is` side-effect có timeout/lock/cancellation và exact connection-generation verification. `IslandService` capture generation tại public boundary trước root queue; operation nhận `expectedGeneration`/`operationContext` và không recapture generation sau await/queue. Chỉ exact current connected generation được phép gửi/verify. Operation sở hữu internal `CancellationSource` liên kết parent token và truyền cả token + exact generation xuống command layer; waiter timeout/stale/disconnect/cancel/failure phải cancel command branch đang throttle để `/is` không thể gửi muộn. Command/waiter race và mọi listener/timer/subscription phải settle/cleanup trong operation ownership.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/server-features/minerals/MineralConversionOperation.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Thực thi workflow side-effect có timeout/lock/cleanup. Thành phần: `MineralConversionOperation`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/server-features/minerals/MineralService.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Cung cấp capability nghiệp vụ qua Result contract. Thành phần: `MineralService`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/server-features/personal-vault/PersonalVaultReader.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Đọc dữ liệu nguồn và tạo biểu diễn chuẩn hóa, không side effect; snapshot item gồm count và `maxStackSize` khi GUI item cung cấp để workflow có thể chứng minh target-stack capacity. Thành phần: `PersonalVaultReader`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/server-features/personal-vault/PersonalVaultService.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Cung cấp capability nghiệp vụ qua Result contract. Thành phần: `PersonalVaultService`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/server-features/personal-vault/PersonalVaultSnapshot.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Value object bất biến chụp trạng thái tại một thời điểm. Thành phần: `PersonalVaultSnapshot`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/server-features/personal-vault/PersonalVaultTransfer.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Thực hiện trách nhiệm chuyên biệt của `PersonalVaultTransfer` trong `src/server-features/personal-vault` theo RULES.md.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/server-features/smelting/SmeltingOperation.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Thực thi workflow side-effect có timeout/lock/cleanup. Thành phần: `SmeltingOperation`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/server-features/smelting/SmeltingService.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Cung cấp capability nghiệp vụ qua Result contract. Thành phần: `SmeltingService`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/server-features/storage/KhoCapacityReader.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Đọc capacity `/kho` và tạo biểu diễn chuẩn hóa, không side effect. Không tin cứng slot cấu hình nếu nội dung không parse được; thử candidate theo slot, identity và scan-all để chịu được GUI layout thay đổi. Thành phần: `KhoCapacityReader`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/server-features/storage/KhoReader.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Đọc resource amount `/kho` và tạo `KhoSnapshot`; khi capacity telemetry tạm không đọc được, có thể derive used từ tổng item amount với fallback limit được cấu hình/đã xác nhận cho server, đồng thời đánh dấu `derivedFromItems`. Không side effect. Thành phần: `KhoReader`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/server-features/storage/KhoService.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Cung cấp capability nghiệp vụ qua Result contract. Thành phần: `KhoService`. Phải xác minh semantic `/kho` bằng capacity hoặc provenance/source đã được `/kho` command xác nhận; không được coi `/nung`, `/ks` hay crafting GUI là `/kho` chỉ vì chúng chứa item B1 parse được.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/server-features/storage/KhoSnapshot.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Value object bất biến chụp trạng thái tại một thời điểm. Thành phần: `KhoSnapshot`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.


## `src/shared/`

### `src/shared/cancellation/CancellationSource.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Thực hiện trách nhiệm chuyên biệt của `CancellationSource` trong `src/shared/cancellation` theo RULES.md.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/shared/cancellation/CancellationToken.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Thực hiện trách nhiệm chuyên biệt của `CancellationToken` trong `src/shared/cancellation` theo RULES.md.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/shared/errors/AppError.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Biểu diễn lỗi chuyên biệt với code/details/cause. Thành phần: `AppError`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/shared/errors/FlowError.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Chuẩn hóa lỗi workflow với code/subsystem/operation/step/action/resource/attempt/details/trace/cause và diagnostic serializable.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/shared/errors/ConfigurationError.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Biểu diễn lỗi chuyên biệt với code/details/cause. Thành phần: `ConfigurationError`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/shared/errors/OperationCancelledError.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Thực thi workflow side-effect có timeout/lock/cleanup. Thành phần: `OperationCancelledError`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/shared/errors/TimeoutError.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Biểu diễn lỗi chuyên biệt với code/details/cause. Thành phần: `TimeoutError`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/shared/flow/StepRunner.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Chạy một step có retry/cancellation/trace và chuyển lỗi hoặc Result thất bại thành `FlowError` có context.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/shared/logger/CompactLogFormatter.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Format log console dạng compact, rút gọn scope bot và metadata nhưng không làm thay đổi record JSON gốc.
- **Dependency được phép:** primitive shared và dữ liệu log đã sanitize.
- **Dependency bị cấm:** runtime bot, command executor, config server hard-code và secret thô.
- **Lifecycle/cleanup:** stateless, không giữ file handle hoặc listener.
- **Không được làm:** ghi file, thay đổi level, mutate record hoặc bỏ cơ chế redaction.

### `src/shared/logger/RuntimeLogOutput.js`

- **Scope:** Application/shared output
- **Trách nhiệm:** Route log record sang console compact theo console level và file JSONL đầy đủ theo file level.
- **Dependency được phép:** filesystem/path, `Logger.LEVELS`, formatter và config app đã validate.
- **Dependency bị cấm:** bot runtime cụ thể, server feature, Discord và dữ liệu server hard-code.
- **Lifecycle/cleanup:** không giữ stream lâu dài; tạo thư mục/file log theo nhu cầu.
- **Không được làm:** log secret chưa sanitize hoặc làm lỗi ghi file khiến application crash.

### `src/shared/logger/Logger.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Thực hiện trách nhiệm chuyên biệt của `Logger` trong `src/shared/logger` theo RULES.md.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/shared/logger/LoggerFactory.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Tạo instance từ config/dependency đã validate. Thành phần: `LoggerFactory`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/shared/result/Result.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Thực hiện trách nhiệm chuyên biệt của `Result` trong `src/shared/result` theo RULES.md.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/shared/result/Status.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Thực hiện trách nhiệm chuyên biệt của `Status` trong `src/shared/result` theo RULES.md.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/shared/time/Timeout.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Thực hiện trách nhiệm chuyên biệt của `Timeout` trong `src/shared/time` theo RULES.md.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/shared/utils/object.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Thực hiện trách nhiệm chuyên biệt của `object` trong `src/shared/utils` theo RULES.md.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.


## `tests/`

### `tests/integration/bootstrap/createApplication.test.js`

- **Scope:** Test-only
- **Trách nhiệm:** Xác minh contract, isolation, failure và cleanup của module tương ứng bằng Node test runner.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `tests/integration/multi-bot/isolation.test.js`

- **Scope:** Test-only
- **Trách nhiệm:** Xác minh contract, isolation, failure và cleanup của module tương ứng bằng Node test runner.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `tests/unit/bot/BotRuntime.test.js`

- **Scope:** Test-only
- **Trách nhiệm:** Xác minh contract, isolation, failure và cleanup của module tương ứng bằng Node test runner.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `tests/unit/commands/Commands.test.js`

- **Scope:** Test-only
- **Trách nhiệm:** Xác minh contract, isolation, failure và cleanup của module tương ứng bằng Node test runner.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `tests/unit/configuration/Configuration.test.js`

- **Scope:** Test-only
- **Trách nhiệm:** Xác minh contract, isolation, failure và cleanup của module tương ứng bằng Node test runner.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `tests/unit/connection/ConnectionManager.test.js`

- **Scope:** Test-only
- **Trách nhiệm:** Sở hữu state/lifecycle và điều phối capability cùng scope. Thành phần: `ConnectionManager.test`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `tests/unit/core/LifecycleCoordinator.test.js`

- **Scope:** Test-only
- **Trách nhiệm:** Xác minh contract, isolation, failure và cleanup của module tương ứng bằng Node test runner.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `tests/unit/gui/Gui.test.js`

- **Scope:** Test-only
- **Trách nhiệm:** Xác minh contract, isolation, failure và cleanup của module tương ứng bằng Node test runner.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `tests/unit/items/Items.test.js`

- **Scope:** Test-only
- **Trách nhiệm:** Xác minh contract, isolation, failure và cleanup của module tương ứng bằng Node test runner.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `tests/unit/operations/Operations.test.js`

- **Scope:** Test-only
- **Trách nhiệm:** Thực thi workflow side-effect có timeout/lock/cleanup. Thành phần: `Operations.test`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `tests/unit/planning/Planner.test.js`

- **Scope:** Test-only
- **Trách nhiệm:** Xác minh contract, isolation, failure và cleanup của module tương ứng bằng Node test runner.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `tests/unit/server-features/ServerLoginService.test.js`

- **Scope:** Test-only
- **Trách nhiệm:** Xác minh login được gửi đúng một lần cho mỗi connection generation, mật khẩu thiếu được báo lỗi và pending login bị hủy khi service dừng.
- **Dependency được phép:** fake `BotContext`, `EventBus`, fake `CommandService` và Node test runner.
- **Dependency bị cấm:** server Minecraft thật, credential thật, global bot và network ngoài.
- **Lifecycle/cleanup:** dừng service và cleanup timer/listener trong từng test.
- **Không được làm:** in mật khẩu vào output hoặc phụ thuộc thứ tự test.

### `tests/unit/server-features/ServerFeatures.test.js`

- **Scope:** Test-only
- **Trách nhiệm:** Xác minh contract, isolation, failure và cleanup của module tương ứng bằng Node test runner.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `tests/unit/shared/logger-output.test.js`

- **Scope:** Unit test
- **Trách nhiệm:** Kiểm tra console compact, level filtering và JSONL file output.
- **Dependency được phép:** temp filesystem và logger shared.
- **Dependency bị cấm:** network, Discord và Minecraft server thật.
- **Lifecycle/cleanup:** chỉ dùng thư mục tạm do test tạo.
- **Không được làm:** phụ thuộc thứ tự test hoặc thay đổi runtime config thật.

### `tests/unit/shared/primitives.test.js`

- **Scope:** Test-only
- **Trách nhiệm:** Xác minh contract, isolation, failure và cleanup của module tương ứng bằng Node test runner.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

## Ranh giới đặc biệt

- Chỉ `src/commands/CommandExecutor.js` gửi server command; command nhạy cảm phải trả kết quả đã redacted.
- Chỉ `src/gui/click/ClickExecutor.js` gọi click Mineflayer.
- `src/bot/BotRegistry.js` lưu `BotRuntime`; `src/bot/BotContext.js` giữ raw client.
- `src/server-features/ServerFeatureFacade.js` là API capability cấp cao; planner không thực thi.
- Recipe dùng logical item ID; GUI slot chỉ dành cho interaction.
- `/kho` chỉ đọc; `/pv 2` scan 54 slot; `/nung` và nung từ `/ks` dùng chung operation.

- `src/server-features/authentication/ServerLoginService.js` gửi `/login` sau mỗi spawn thông qua `CommandService`, lấy mật khẩu từ environment theo bot ID và không log secret.


## Bổ sung trách nhiệm cho GUI observation và B5 automation

### `src/gui/observation/GuiStructureNormalizer.js`
- **Scope:** Bot-scoped/stateless helper.
- **Trách nhiệm:** Chuẩn hóa GUI thành identity, structure và latest data; loại số động khỏi structural text.
- **Không được làm:** click, gửi command hoặc tự đặt logical GUI ID.

### `src/gui/observation/GuiObservationStore.js`
- **Scope:** Bot-scoped persistence.
- **Trách nhiệm:** Atomic upsert GUI observation vào `data/runtime/gui/<botId>` và duy trì revision/index.
- **Không được làm:** sửa config canonical hoặc thực hiện server action.

### `src/gui/observation/GuiObservationService.js`
- **Scope:** Bot-scoped lifecycle service.
- **Trách nhiệm:** Nghe `gui:opened`/`gui:updated`, debounce và lưu GUI; nhận source route từ Discord inspection khi có.
- **Lifecycle/cleanup:** hủy timer và listener trong stop/destroy.

### `src/server-features/storage/StorageTextParser.js`
- **Scope:** Stateless/shared trong storage capability.
- **Trách nhiệm:** Chuẩn hóa text/lore và parse số có dấu phân cách hàng nghìn.

### `src/server-features/storage/SellGuiReader.js`
- **Scope:** Bot-scoped Sell GUI reader.
- **Trách nhiệm:** Đọc identity/amount/slot của đúng các form sellable đang thực sự xuất hiện trong GUI `/kho sell`. Reader này không phải full storage reader và không được suy ra raw bị GUI bán ẩn. Khi parse amount phải loại các dòng hướng dẫn click/sell chứa số `1/64`; chỉ gắn `amountReliable=true` khi số lượng storage thật được nhận diện.
- **Không được làm:** dùng Sell GUI làm nguồn sự thật cho total B1 coverage hoặc phát minh slot raw.

### `src/server-features/storage/KhoSellOperation.js`
- **Scope:** Bot-scoped operation primitive.
- **Trách nhiệm:** Mở plain `/kho sell`, giữ/reuse Sell GUI, resolve material qua `SellGuiReader`, thực thi click `1`/`64`; Shift+left `ALL` chỉ được phép khi global compatibility flag bật hoặc exact logical ID nằm trong `fastDisposableSellAllIds`. Chờ GUI update rồi verify amount/transition trước khi trả kết quả.
- **Không được làm:** gửi `/kho sell {item}`, mở ALL cho resource không whitelist, tự sửa snapshot hoặc giả định click thành công.

### `src/server-features/crafting/B5PlanningService.js`
- **Scope:** Bot-scoped service.
- **Trách nhiệm:** Đọc `/kho`, `/pv 2`, inventory; lập plan B5 có tính stock B2-B5, theo dõi cả tổng B1 tương đương và B1 thực sự craftable; block B1 chỉ được tính dùng ngay khi block→phôi không vượt ngưỡng peak-capacity an toàn, hỗ trợ plan “tạo thêm B5” bỏ qua B5 đã có, công bố mode nguồn B1 và backpressure `/pv 2` từ số slot trống.
- **Không được làm:** tự click/craft/sell.

### `src/server-features/crafting/b5/support/B5ActionDiagnostics.js`
- **Scope:** Stateless/pure B5 support.
- **Trách nhiệm:** Chuẩn hóa blocker, productive action và action-summary cho B5 orchestration; không được gửi command/click/read GUI.

### `src/server-features/crafting/b5/support/B5RecipeResolver.js`
- **Scope:** Stateless/pure B5 recipe lookup support.
- **Trách nhiệm:** Resolve recipe theo final-step/registry/output và kiểm tra B5 direct readiness từ snapshot đã cấp; fallback chỉ log debug, không mutation.

### `src/server-features/crafting/B5AutomationService.js`

- `prepare-b1 NOT_READY` do continuous input/state drift là wait-state, không phải automation failure; caller nhận `waitingForMaterials` để dùng poll interval.

- **Scope:** Bot-scoped side-effect workflow.
- **Trách nhiệm:** Chạy B5 dưới OperationManager với ưu tiên B5>B4>B3>B2. B1→B2 được dùng `ALL` chỉ sau hard storage-safety guard; nếu `ALL` làm inventory đầy thì cất đúng một stack B2 hiện tại vào `/pv 2`, verify slot trống, rồi B2→B3 `ALL`; planner các lượt sau phải nhìn thấy/reuse carry B2 trong PV2. Re-evaluate PV2 backpressure trước từng chain, cân surplus B4 theo tỷ lệ cần cho một B5, và dùng inventory safety floor cấu hình khi tích B2. Nếu B5 đã tồn tại trong inventory thì recovery deposit+verify phải chạy trước mọi craft mới; final B5 chỉ được craft khi PV2 có target capacity đã chứng minh. Sau mọi production pass kể cả mới tạo B2/B3/B4 phải đổi B1 dư về block trước khi trả quyền cho mode; B5 chỉ được commit/counted sau khi cất `/pv 2` thành công.
- **Không được làm:** bắt đầu B1→B2 `ALL` khi storage pressure/unknown/unsafe, tạo B2 mới khi PV2 backpressure cấm, dùng `ALL` cho B5 cuối, craft B5 khi PV2 không có target capacity, bỏ qua B5 mồ côi trong inventory, cất ngẫu nhiên item khác thay carry B2, bỏ verification, hoặc gửi raw command ngoài CommandService.

### `tests/unit/server-features/resource-pack/ResourcePackAutoAcceptService.test.js`
- **Scope:** Test-only.
- **Trách nhiệm:** Xác minh auto-accept phát `resource-pack:ready` ngay và cleanup listener khi connection kết thúc.


## Mode collector + B5 và Discord mode command

### `src/modes/collector-b5/CollectorB5ModeService.js`
- **Scope:** bot-scoped mode/workflow.
- **Trách nhiệm:** điều phối `/is` qua `IslandService`, di chuyển tới điểm nhặt cấu hình và reanchor tại cycle boundary khi drift vượt `reanchorRadius`, chạy `/nung` trước planning và sản xuất liên tục không cooldown. Mỗi cycle capture một exact connection generation và truyền cùng mode cancellation token xuống `/is`, storage, planning và automation; stale cycle không được tiếp tục side effect. Hễ B2/B3/B4/B5 đủ điều kiện thì đẩy ngay theo ưu tiên `B5 > B4 > B3 > B2`, sau lượt chế chỉ yield `craftLoopDelayMs` rất ngắn rồi inspect tiếp; khi chưa actionable luôn chạy maintenance để nén phôi/B1 trước khi chờ, không phụ thuộc pressure hiện tại; trước craft nếu `/kho` đã ở sell/critical pressure phải stabilize trước. Runtime error dùng canonical failure publisher + breaker riêng; token cancellation và expected Result wait-state không tăng breaker/publish; retryable OPEN giữ `DEGRADED` và không được finally ghi đè; verified production success mới reset streak.
- **Không được:** gọi Mineflayer trực tiếp, tự parse GUI, tự craft hoặc hard-code tọa độ server. `skyblock:auto-join:succeeded`/`connection:ended` stale, generation-less hoặc foreign-bot không được mutate readiness/phase của current generation.

### `src/modes/fishing/FishingModeService.js`
- **Scope:** bot-scoped mode/workflow.
- **Trách nhiệm:** điều phối fishing/AFK/movement bằng capability hiện có; runtime error dùng canonical failure publisher + breaker riêng. Phải phân loại cả `Result.status` và cancellation token: operation-level CANCELLED/NOT_READY/NOT_ENOUGH_MATERIALS/WAITING_MATERIALS là bounded wait, lifecycle cancellation thoát sạch; retryable OPEN giữ `DEGRADED`, dừng movement/stow rod best-effort và không chạy business operation mới trước half-open; verified catch mới reset failure streak.
- **Không được:** phát error cho expected wait-state, hot-loop sau cancellation, chia sẻ breaker mutable với Collector hoặc tự restart Minecraft connection vì breaker.

## Runtime failure system

### `src/diagnostics/runtime/RuntimeFailureEvent.js`
- **Scope:** Stateless/shared canonical event factory.
- **Trách nhiệm:** tạo detached sanitized `runtime:failure`, sinh/giữ stable `failureId`, bảo toàn correlation/operation/phase/retry metadata và tạo fallback signature bot+generation+code+operation+step+resource+message.
- **Không được:** giữ raw Error/Mineflayer object hoặc mutable caller reference.

### `src/diagnostics/runtime/RuntimeFailurePublisher.js`
- **Scope:** Bot-scoped lifecycle bridge/publisher.
- **Trách nhiệm:** publish canonical failure cho mode; aggregate generation-scoped connection signals theo connection generation thành một physical failure cùng `failureId`, đồng thời publish pre-attach `connection:attempt-failed` như attempt-owned incident riêng (`connectionGeneration=null`, có attempt identity/stage). Không gom attempt incident vào generation mới; chọn candidate diagnostic giàu nhất và flush pending incident khi stop.
- **Lifecycle/cleanup:** unsubscribe connection listeners, clear timer/map và flush pending incident trong stop/destroy.
- **Không được:** xóa legacy connection events còn consumer hoặc dùng generic first event đè rich diagnostic.

### `src/diagnostics/runtime/RuntimeFailureRecorder.js`
- **Scope:** Bot-scoped diagnostic persistence.
- **Trách nhiệm:** chỉ consume canonical `runtime:failure`; race-safe failureId/signature dedupe trong serialized write queue dùng arrival timestamp chụp trước queue; full record + fixed-window repeat summary; atomic `last-error.json`; rotation/retention/max-total quota; safe truncation oversized record; path containment và regular-file-only cleanup. `enabled=false` là no-op hoàn toàn; zero repeat/cleanup và retention semantics phải theo RULES.
- **Lifecycle/cleanup:** timer phải unref, stop detach listener, flush repeat/write queue, cleanup quota và không để diagnostic I/O crash runtime.
- **Không được:** persist legacy event lần hai, recursive delete, follow symlink/junction, xóa `last-error.json`, file unrelated hoặc đường dẫn ngoài verified bot directory.

### `src/shared/resilience/FailureCircuitBreaker.js`
- **Scope:** Bot/mode-owned resilience primitive.
- **Trách nhiệm:** giữ CLOSED/OPEN/HALF_OPEN, consecutive failure timestamps/backoff/jitter/open window; cancellation không tăng; chỉ `recordSuccess({verified:true})` reset.
- **Không được:** singleton/global mutable state hoặc tự điều khiển Minecraft connection.

### `src/shared/security/Redactor.js`
- **Scope:** Stateless/shared security primitive.
- **Trách nhiệm:** sanitize recursive và idempotent secret trong object/array/Error và text JSON/log-like/header/Bearer/query/basic-auth, kể cả escaped quote/backslash và scalar numeric/boolean/null; luôn dùng `[REDACTED]` ổn định.
- **Không được:** để lộ suffix secret, raw authorization/credential hoặc mutate caller input.

### `src/shared/result/RuntimeResultClassifier.js`
- **Scope:** Stateless/shared result-control classifier.
- **Trách nhiệm:** phân biệt token lifecycle cancellation, operation-level expected cancellation, expected wait-state và real failure từ `Result.status`, code/meta/domain flags + Error.
- **Không được:** biến `CANCELLED`, `NOT_READY`, `NOT_ENOUGH_MATERIALS`, `WAITING_MATERIALS` hợp lệ thành breaker failure chỉ vì `error` null hoặc message được wrap thành Error.

### `src/discord/errors/DiscordErrorReporter.js`
- **Scope:** Application-scoped reporter.
- **Trách nhiệm:** chỉ consume canonical `runtime:failure`; attach runtime có sẵn và theo dõi BotRegistry add/remove/replacement; dedupe theo bot+failureId trước, fallback signature sau; gửi initial + fixed-window repeat summary, redact trước send và giữ code/operation/step/action/resource.
- **Lifecycle/cleanup:** repeated start không attach trùng; stop detach registry/runtime listeners, flush summary/send queue và clear timer/buckets. Khi runtimeFailures disabled không attach/resolve/send.
- **Không được:** phát `runtime:failure` khi Discord send lỗi hoặc spam một embed cho mỗi retry.

### `config/app.json`
- **Trách nhiệm:** cấu hình `diagnostics.runtimeFailures` (`enabled`, safe relative `directory`, `repeatWindowMs`, `connectionAggregationMs`, `maxFileMb`, `maxTotalMb`, `retentionDays`, `cleanupIntervalMs`) và `diagnostics.circuitBreaker` (`baseBackoffMs`, `maxBackoffMs`, `multiplier`, `jitterRatio`, `maxConsecutiveFailures`, `openDurationMs`).

### `src/discord/commands/CollectorB5ModeCommand.js`
- **Scope:** application Discord adapter.
- **Trách nhiệm:** expose `/mode action:on|off|status`; khi có control plane phải persist/reconcile `collector-b5` qua `FleetControlService`, kể cả yêu cầu bật lúc bot offline. Tắt chỉ clear durable intent khi collector là desired/active mode, không xóa fishing intent.
- **Không được:** thao tác Minecraft trực tiếp hoặc chứa logic B5.

### `config/modes/collector-b5.json`
- **Trách nhiệm:** feature flag, pickup location, radius, timeout, `pollIntervalMs` khi chờ nguyên liệu và `craftLoopDelayMs` giữa các lượt sản xuất liên tục của mode collector+B5.

### `src/modes/fishing/FishingModeService.js`
- **Scope:** Bot-scoped high-level mode orchestration/state machine.
- **Trách nhiệm:** lifecycle `initialize/start/enable/pause/resume/disable/stop/destroy`, public status/config, acquire/release primary lease qua `ModeCoordinator`, AFK selection, island/world/movement/probe/fishing orchestration, bounded wait/retry, runtime-failure publication và breaker phase transitions.
- **Không được:** nhận `BotContext`, raw bot/client, `_client`, packet/physics listener, `Vec3`, direct control state, raw movement algorithm, raw fishing API hoặc tự `end()`/reconnect connection.

### `src/modes/fishing/ConnectionStateView.js`
- **Scope:** Bot-scoped read-only connection capability.
- **Trách nhiệm:** expose connected/current generation snapshot và `isCurrentGeneration()` cho fishing owner mà không expose raw bot/client.

### `src/modes/fishing/ConnectionPacketObserver.js`
- **Scope:** Bot/connection-scoped protocol observer.
- **Trách nhiệm:** owner duy nhất của raw `bot._client` trong fishing subsystem; bind exact client+generation, normalize `entity_velocity`, giới hạn sample buffer, ignore stale callback và detach listener khi connection end/replacement/stop/destroy.
- **Không được:** emit raw packet, giữ mutable state giữa bot hoặc mutate mode trực tiếp.

### `src/modes/fishing/FishingMovementOperation.js`
- **Scope:** Bot/operation-scoped fishing movement session.
- **Trách nhiệm:** capture generation, operation ID/lock/cancellation/timeout, drive control qua `ControlStateManager`, rotate qua `RotationService`, verify progress/arrival, handle forcedMove/disconnect/stuck và cleanup listener/control/lock ở mọi exit path.
- **Không được:** publish runtime failure hoặc mutate `FishingModeService` state. Reference scan P1 correction xác nhận runtime caller hiện tại (`FishingModeService`, `FishingMovementProbeService`) đều dùng operation này như root; không thêm parent-context wrapper khi chưa có parent caller.

### `src/modes/fishing/FishingMovementProbeService.js`
- **Scope:** Bot-scoped bounded movement calibration/probe capability.
- **Trách nhiệm:** chạy danh sách profile đã validate qua `FishingMovementOperation`, giới hạn profile/total timeout, generation/cancellation, trả immutable selected/result/reconnect decision và reset active state sau mỗi run.
- **Không được:** raw bot/end/reconnect, unbounded retry hoặc publish expected probe failure.

### `src/modes/fishing/FishingPositionGuard.js`
- **Scope:** Bot-scoped position/anchor safety capability.
- **Trách nhiệm:** capture verified detached anchor, kiểm tra finite position, horizontal radius, vertical tolerance, destination arrival và generation invalidation.
- **Không được:** movement, control, command, retry hoặc expose mutable entity/Vec3.

### `src/modes/fishing/FishingWorldReadinessService.js`
- **Scope:** Bot/connection-aware low-level world readiness capability.
- **Trách nhiệm:** bounded wait cho entity/world/block readiness đúng generation, timeout/cancellation và cleanup; raw world inspection chỉ tồn tại ở capability này, không ở mode.
- **Không được:** reconnect hoặc mutate mode.

### `src/modes/fishing/FishingRecoveryPolicy.js`
- **Scope:** Stateless/pure recovery decision policy.
- **Trách nhiệm:** map failure/result/breaker/mode state sang structured WAIT/RETRY/REANCHOR/REJOIN_AREA/REQUEST_RECONNECT/PAUSE_ERROR/STOP decision cùng delay/phase/failure-publish semantics; non-retryable ưu tiên PAUSED_ERROR và OPEN giữ DEGRADED.
- **Không được:** I/O, Mineflayer, timer/listener, movement, connection mutation hoặc mutable singleton state.

### `src/modes/fishing/resolveFishingConfig.js`
- **Scope:** Configuration merge/validation helper.
- **Trách nhiệm:** merge shared fishing config với bot override được phép (`shoreFishingPitchDegrees`, x/y/z destination theo area ID), preserve server data mặc định và validate merged result bằng fishing schema trước runtime.

### `src/configuration/schemas/fishing.schema.js`
- **Scope:** Configuration validation.
- **Trách nhiệm:** strict validation cho fishing mode timeout/retry, movement, probe, world readiness, packet sample, position guard, recovery, rod/pitch và unique AFK area IDs/priorities/destination finite; reject unknown keys trong contract mới.

### `src/server-features/fishing/FishingService.js`
- **Scope:** Bot-scoped low-level fishing action capability.
- **Trách nhiệm:** rod identity, cancellation/generation-aware stow/equip, aim qua `RotationService`, một `bot.fish()` cycle, bite timeout/server-auto completion/ordinary bounded retry, pre/during/post position guard và task timer cleanup.
- **Không được:** movement/probe/packet/mode-state/reconnect ownership.

### `src/server-features/afk/AfkAreaService.js`
- **Trách nhiệm bổ sung cho fishing:** AFK selection/teleport verification phải lọc botId + exact generation, hỗ trợ cancellation và reject stale generation; old forcedMove không được xác nhận session mới. `joinBestAvailable()` sở hữu linked internal `CancellationSource` chung cho click + teleport waiter; mọi terminal outcome phải cancel sibling branch/remove queued click **trước** public settle và observe/all-settle pending promise để không late `clickWindow()` hoặc orphan rejection.

### `src/connection/ConnectionManager.js`
- **Public capability bổ sung:** `requestReconnect(reason, { expectedGeneration = null } = {})` là boundary duy nhất để mode/policy yêu cầu reconnect; caller cũ chỉ truyền reason vẫn hợp lệ. Khi expected generation được cung cấp, stale request phải trả `false` và tuyệt đối không `.end()` replacement client. Synthetic `connection:ended` phải mang connection generation khi xác định được. Raw client `.end()` vẫn thuộc ConnectionManager, không được gọi từ FishingModeService/probe.

### `src/modes/fishing/FishingModeService.js` — generation correction contract
- `connection:ended` và `connection:spawned` chỉ consume canonical `connectionGeneration`; legacy alias normalization thuộc riêng `EventEnvelope`. Stale/generation-less event không được mutate active route/state.
- `expectedGeneration` của business cycle phải đi qua classification, recovery decision, canonical failure publish, cleanup và reconnect request. Stale async outcome phải bị discard trước breaker/state/cleanup/reconnect mutation; diagnostic của cycle cũ nếu được publish phải giữ generation của cycle đó.

### `src/bootstrap/registerBotServices.js`
- **Fishing wiring:** tạo owner bot-scoped riêng `connectionStateView`, `fishingPacketObserver`, `fishingPositionGuard`, `fishingWorldReadiness`, `fishingMovement`, `fishingMovementProbe`, `fishingRecoveryPolicy`; inject capability vào `FishingModeService` thay vì BotContext. Lifecycle phải dừng mode trước khi teardown owner phụ thuộc.

### `src/bot/BotRegistry.js`
- **Listener contract:** registry mutation không rollback khi change listener lỗi; listener sau vẫn chạy; lỗi listener được sanitize/log best-effort và không throw ra caller sau mutation.


- `KhoService`: trước `/kho` từ GUI khác phải close-confirm-settle; không gửi command khi Mineflayer còn currentWindow cũ.
### `src/server-features/storage/b1/B1StartupReserveTrimmer.js`
- **Scope:** Bot-scoped B1 startup safety workflow, được `B1StorageMaterialService` sở hữu.
- **Trách nhiệm:** Trim surplus block theo startup reserve/stop band của `config/storage/kho.json`, dùng burst bounded và full `/kho` checkpoint sau sell session; không sở hữu config B5 mode. Constructor cho phép storage test-double tối thiểu, capability `read/sell` được kiểm tại lúc run.

### `src/server-features/storage/B1StorageMaterialService.js`

- Storage pressure: projection dưới low-water 70% chỉ được báo RISING; hard protection/sellRequired chỉ khi actual >= high-water hoặc actual >= low-water và projectedHigh.


- **Trách nhiệm:** quản lý B1 trực tiếp trong `/kho`; startup reserve/trim có **một owner duy nhất** tại storage config. Fresh `/kho` snapshot có thể truyền qua các bước read-only tối đa 1 giây, nhưng mọi nung/đổi/bán phải invalidate/re-check trước side-effect tiếp theo. B5 batch protection giữ thứ tự cứng raw iron/raw gold → phôi, nén mọi family có block form, rồi mới chốt immutable sell baseline. Reserve sell chỉ dùng action `64`; phần dư dưới `64` được giữ lại. Budget lớn chạy qua bounded slice cùng episode với full `/kho` checkpoint; continuation không lặp nung/nén, không lập lại baseline, không hấp thụ inflow mới và không bị tính là business failure. Sell form luôn phải đúng `sellId`: block form cho mineral nén được, hoặc base 1:1 cho family không có block. Amount Sell GUI không đáng tin thì local model phải reconcile bằng fresh `/kho`; không suy quantity từ lore không đáng tin. Raw/phôi mineral nén được vẫn tính coverage/reserve nhưng không bao giờ là sell candidate. Mọi storage/mineral/smelting child call phải giữ parent cancellation, operation context và expected generation.
- **Không được:** rút B1 ra player inventory để nung/đổi block hoặc đưa `COPPER` vào mapping server này.

### `src/discord/admin/BotProfileAdminService.js`

- **Trách nhiệm:** Quản trị profile bot động từ Discord: tạo/clone/sửa profile, enable/disable, reload runtime mà không restart toàn ứng dụng; đồng bộ profile policy với `FleetControlService`, route connect/disconnect/fleet-stop qua durable intent và chỉ inject password vào runtime memory. File/profile/runtime update phải rollback khi replacement lỗi.

### `scripts/cleanup-stale.js`

- **Trách nhiệm:** Dọn đúng danh sách source/config đã audit là không còn được runtime load hoặc require; hỗ trợ dry-run và `--apply`.

## Architecture, configuration, replay và control-plane capabilities

### `scripts/replay-scenario.js`

- **Scope:** Script-only.
- **Trách nhiệm:** Chạy deterministic stale-side-effect fixture bằng safety replay runtime, in strict trace/invariant summary và exit non-zero khi scenario hoặc cleanup fail; không kết nối dịch vụ thật.

### `scripts/validate-architecture.js`

- **Scope:** Script-only architecture gate.
- **Trách nhiệm:** Đọc `architecture/catalog.json`, parse dependency graph và kiểm tra syntax/import/cycle/reachability, exclusive side-effect owner, boundary, event producer, config registration/schema, stale manifest và Markdown allowlist; hỗ trợ human/JSON report với exit code thật.

### `src/bootstrap/createConnectionEventBinding.js`

- **Scope:** Bot/connection-scoped adapter.
- **Trách nhiệm:** Sau canonical spawn, bind exact current client+generation cho raw message/move/forcedMove/death rồi phát `command:message`, movement và `player:death` envelope; stale callback bị ignore và toàn bộ raw listener được detach khi end/replacement/stop.

### `src/bootstrap/registerDiscordServices.js`

- **Scope:** Bootstrap-only.
- **Trách nhiệm:** Composition root Discord: dựng slash commands, panel manager và inject chung `BotRegistry`, configuration, allowlist, profile admin cùng `FleetControlService`; không chứa Discord business workflow.

### `src/configuration/ConfigSpecs.js`

- **Scope:** Application-scoped immutable catalog.
- **Trách nhiệm:** Nguồn đăng ký duy nhất cho 29 active config groups: group ID, relative JSON path và validator/schema; reject duplicate/missing schema bằng validation gate.

### `src/configuration/ConfigurationContractValidator.js`

- **Scope:** Stateless application contract validator.
- **Trách nhiệm:** Validate reference graph giữa command/response, GUI/slot, item/recipe/tier, routes/locations, bot/server profile, threshold/mode và daily windows; phát hiện recipe cycle và trả lỗi có path trước runtime/reload.

### `src/configuration/schemas/discord.schema.js`

- **Scope:** Stateless strict schema.
- **Trách nhiệm:** Validate Discord command names, default bot, allowlist env indirection và full panel/channel/store contract; reject unknown key và unsafe path/value.

### `src/configuration/schemas/group.schemas.js`

- **Scope:** Stateless strict schema collection.
- **Trách nhiệm:** Chứa validator thực cho các config group domain còn lại, dùng reusable primitive nhưng giữ contract riêng từng group; thay các generic schema rời/nullable đã xóa.

### `src/connection/ConnectionAttemptCoordinator.js`

- **Scope:** Application-scoped login gate.
- **Trách nhiệm:** Tuần tự hóa physical login/spawn handshake giữa bot, áp spacing/cooldown theo failure class và cấp release capability idempotent; không sở hữu bot connection hoặc reconnect policy.

### `src/diagnostics/GuiInspectionService.js`

- **Scope:** Bot/operation-scoped diagnostic workflow.
- **Trách nhiệm:** Capture exact generation, arm GUI wait trước command/click, chạy dưới OperationManager khi có, serialize snapshot và cleanup waiter/window; không coi replacement GUI là kết quả operation cũ.

### `src/diagnostics/GuiSnapshotSerializer.js`

- **Scope:** Stateless diagnostic serializer.
- **Trách nhiệm:** Chuyển window/item/NBT/component phức tạp thành bounded detached JSON-safe snapshot, xử lý circular/depth/array/string limits và giữ canonical generation; không expose raw session/client.

### `src/discord/commands/FishingModeCommand.js`

- **Scope:** Application Discord adapter.
- **Trách nhiệm:** Expose `/fishmode action:on|off|status`; persist/reconcile fishing desired state qua `FleetControlService` khi được inject và không xóa collector intent khi fishing không phải desired/active mode.

### `src/discord/commands/GuiInspectionCommand.js`

- **Scope:** Application Discord adapter.
- **Trách nhiệm:** Authorize/parse `/gui`, resolve target runtime và gọi `GuiInspectionService`; format artifact/result nhưng không gửi raw Minecraft command/click.

### `src/discord/config/CollectorB5ConfigEditor.js`

- **Scope:** Application configuration editor.
- **Trách nhiệm:** Đọc/cập nhật collector config từ Discord bằng candidate validation, cross-validation, atomic file write, registry reload và runtime reconfigure rollback.

### `src/discord/config/FishingBotConfigEditor.js`

- **Scope:** Application configuration editor.
- **Trách nhiệm:** Cập nhật phần override fishing được phép cho một bot/area, validate merged shared+override contract và rollback file/registry/runtime nếu apply fail.

### `src/discord/DiscordService.js`

- **Scope:** Application-scoped lifecycle owner.
- **Trách nhiệm:** Tạo/login Discord client khi enabled, đăng ký toàn bộ slash command atomically, route interaction tới commands/panel và cleanup client/listener trên stop/destroy; disabled mode không gọi network.

### `src/discord/panels/DiscordPanelManager.js`

- **Scope:** Application-scoped Discord UI coordinator.
- **Trách nhiệm:** Render/update control/config/admin panels đa bot, authorize interaction và route connect/mode/pause/resume/stop/restart qua durable fleet control; temporary GUI/operation recovery giữ bounded cleanup và không gọi Mineflayer side effect trực tiếp.

### `src/discord/panels/DiscordPanelStore.js`

- **Scope:** Application-scoped panel metadata store.
- **Trách nhiệm:** Persist message/channel identifiers bằng safe relative file và serialized atomic update để panel có thể edit lại sau restart; không lưu token hoặc Discord client object.

### `src/fleet/FleetScheduler.js`

- **Scope:** Application-scoped bounded scheduler.
- **Trách nhiệm:** Chạy task đa bot với global concurrency, one-running-per-bot, priority/fair rotation, exact bot/key dedupe, queue limit, cancellation, task timeout và shutdown drain; timeout cancel underlying token và status trả immutable snapshot.

### `src/gui/detection/TitleTextExtractor.js`

- **Scope:** Stateless GUI text primitive.
- **Trách nhiệm:** Trích visible title từ string, JSON component và Prismarine-NBT wrapper với depth/cycle guard; không mutate component input.

### `src/gui/knowledge/GuiKnowledgeRegistry.js`

- **Scope:** Bot-scoped learned GUI registry.
- **Trách nhiệm:** Load/merge/persist semantic slot observations theo strong item identity, chống weak cross-context contamination, self-heal bootstrap mapping và cung cấp immutable resolution; không tự click/send command.

### `src/items/ItemIdentity.js`

- **Scope:** Stateless item identity contract.
- **Trách nhiệm:** Chuẩn hóa/canonicalize multi-signal item identity và strength để matcher/knowledge/persistence so sánh nhất quán; không giữ raw mutable item.

### `src/items/matching/IdentityMatcher.js`

- **Scope:** Stateless item matcher.
- **Trách nhiệm:** So khớp strong/weak identity có context và trả structured evidence/reason; không dùng slot làm identity hoặc silently accept conflict.

### `src/modes/ModeCoordinator.js`

- **Scope:** Bot-scoped primary-mode/resource owner.
- **Trách nhiệm:** Cấp exact immutable lease, enforce một primary mode và resource exclusivity, hỗ trợ reentrant same-owner acquisition có kiểm soát, exact release, immutable status/change notification và observer isolation.

### `src/movement/navigation/SprintJumpRouteExecutor.js`

- **Scope:** Bot/operation-scoped movement executor.
- **Trách nhiệm:** Điều khiển sprint/jump/forward qua `ControlStateManager`, verify progress/arrival, reapply bounded control sau forcedMove và cleanup raw listener/control ở mọi terminal path.

### `src/movement/navigation/RouteExecutor.js`

- **Scope:** Bot/operation-scoped pathfinder route owner.
- **Trách nhiệm:** Capture exact bot cho route đang chạy, thực thi bounded `pathfinder.goto`, verify arrival và chỉ gọi `pathfinder.stop()` khi executor thực sự đang sở hữu active route. Active stop phải clear goal ngay để `mineflayer-pathfinder` tiêu thụ cờ `stopPathing`; idle cleanup không được gọi raw stop vì sẽ làm lần `goto()` kế tiếp fail `PathStopped`. Cleanup của route cũ không được stop replacement client.

### `src/operations/OperationCancellation.js`

- **Scope:** Stateless cancellation helper.
- **Trách nhiệm:** Link parent token vào child source và trả explicit unlink capability; không sở hữu token lifecycle hoặc nuốt cancellation reason.

### `src/recovery/DurableIntentStore.js`

- **Scope:** Application-scoped durable desired-state store.
- **Trách nhiệm:** Load/validate/freeze versioned intent snapshot, serialize revision-aware mutation và atomic fsynced bounded write trong safe non-symlink path; chỉ persist connection/mode desired state và redacted source. Corrupt state fail closed, failed commit không đổi memory/disk trước đó.

### `src/recovery/FleetControlService.js`

- **Scope:** Application-scoped reconciliation control plane.
- **Trách nhiệm:** Nhận operator intent, schedule one-bot reconcile, hội tụ revision mới nhất, derive startup auto-connect, apply connect/disconnect/one-primary-mode idempotently và bind spawned event. Missing/disabled profile bị block; paused recovery không replay mode startup side effect.

### `src/server-features/afk/AfkAreaOccupancyParser.js`

- **Scope:** Stateless server-GUI parser.
- **Trách nhiệm:** Parse strict visible `x/30` occupancy từ normalized item/lore/component/NBT với bounded traversal; số lore khác không được ảnh hưởng chọn khu AFK.

### `src/server-features/skyblock/SkyblockAutoJoinService.js`

- **Scope:** Bot/connection-scoped lifecycle service.
- **Trách nhiệm:** Schedule bounded auto-join theo exact generation sau spawn/login/resource-pack và daily recovery window; dedupe generation, cancel stale timer/attempt và cleanup subscription khi end/stop.

### `src/server-features/skyblock/SkyblockJoinOperation.js`

- **Scope:** Bot/operation-scoped workflow.
- **Trách nhiệm:** Capture exact generation, arm GUI/teleport waiter trước command/click, chọn configured shared slots, verify readiness/teleport và cancel/observe mọi sibling waiter ở terminal outcome.

### `src/server-features/skyblock/SkyblockService.js`

- **Scope:** Bot-scoped capability facade.
- **Trách nhiệm:** Chạy join operation trực tiếp hoặc dưới root/child OperationManager contract, propagate generation/cancellation/correlation và map domain Result mà không recapture replacement owner.

### `src/shared/time/DailyRecoverySchedule.js`

- **Scope:** Stateless time policy.
- **Trách nhiệm:** Tính local date/window/wait/retry state từ validated timezone offset và sky/server schedule; không tạo timer hoặc side effect.

### `src/simulation/VirtualClock.js`

- **Scope:** Deterministic simulation primitive.
- **Trách nhiệm:** Cấp monotonic virtual now, cancellable scheduled delay, deterministic due-order advance/run-all và pending-task snapshot; cleanup không để unresolved timer.

### `src/simulation/RuntimeReplayHarness.js`

- **Scope:** Offline deterministic replay orchestrator.
- **Trách nhiệm:** Validate strict scenario/trace, schedule event/action bằng virtual clock, inject drop/delay/duplicate/error faults, ghi immutable trace và enforce invariant/cleanup; không dùng wall-clock/network.

### `src/simulation/SafetyReplayRuntime.js`

- **Scope:** Offline safety model dùng production capability thật.
- **Trách nhiệm:** Wire real `BotContext`, `CommandExecutor`, `ClickExecutor` và `ModeCoordinator` với fake side-effect sinks để chứng minh stale/cancelled generation không chat/click/end muộn; expose deterministic state/invariant snapshot.

### `src/server-features/crafting/b5/flows/B5ReadFlow.js`

- **Scope:** Bot/operation-scoped B5 read flow.
- **Trách nhiệm:** Đọc `/kho`, `/pv 2`, inventory hoặc composite planning snapshot; không bán/chế/rút/cất.

### `src/server-features/crafting/b5/flows/B5PlanningFlow.js`

- **Scope:** Stateless B5 step calculator.
- **Trách nhiệm:** Chuyển chain snapshot thành bước B1/B2/B3 tiếp theo, tách total stock khỏi immediately-executable stock và không phát side effect.

### `src/server-features/crafting/b5/flows/B5SellFlow.js`

- **Scope:** Bot/operation-scoped B5 sell action flow.
- **Trách nhiệm:** Thực thi storage-pressure sale/headroom sale đã được orchestration yêu cầu; không tự quyết định recipe/tier.

### `src/server-features/crafting/b5/flows/B5StorageFlow.js`

- **Scope:** Bot/operation-scoped B1 storage action flow.
- **Trách nhiệm:** Inspect pressure, prepare selected B1, compact khi được yêu cầu và tạo decompression headroom trước block -> base; không tính recipe chain.

### `src/server-features/crafting/b5/flows/B5CraftFlow.js`

- **Scope:** Bot/operation-scoped crafting action flow.
- **Trách nhiệm:** Gọi CraftingService cho exact recipe/quantity đã được orchestration tính và giữ verification của crafting stack; không tự re-plan.

### `src/modes/collector-b5/flows/CollectorMovementFlow.js`

- **Scope:** Bot/operation-scoped Collector movement flow.
- **Trách nhiệm:** Return-home, move-to-pickup và reanchor decision qua movement/island capability; Collector orchestration quyết định khi nào gọi flow.

### `src/server-features/crafting/b5/flows/B5KhoReadFlow.js`

- **Scope:** Bot/operation-scoped `/kho` reader flow.
- **Trách nhiệm:** Chỉ gọi storage read và trả snapshot `/kho`; không bán, convert hoặc craft.

### `src/server-features/crafting/b5/flows/B5Pv2ReadFlow.js`

- **Scope:** Bot/operation-scoped `/pv 2` reader flow.
- **Trách nhiệm:** Chỉ đọc Personal Vault snapshot dùng cho planning/verification.

### `src/server-features/crafting/b5/flows/B5InventoryReadFlow.js`

- **Scope:** Bot/connection-scoped inventory reader flow.
- **Trách nhiệm:** Chuẩn hóa các inventory views cho B5 planning mà không mutate inventory.

### `src/server-features/crafting/b5/flows/B5DepositFlow.js`

- **Scope:** Bot/operation-scoped PV2 deposit flow.
- **Trách nhiệm:** Chỉ cất exact logical item vào `/pv 2` theo bước orchestration giao.

### `src/server-features/crafting/b5/flows/B5WithdrawFlow.js`

- **Scope:** Bot/operation-scoped PV2 withdraw flow.
- **Trách nhiệm:** Chỉ rút exact logical item/maxStacks từ `/pv 2` theo bước orchestration giao.

## Lệnh riêng theo Sky

- `src/commands/sky/SkyCommandRegistry.js`: normalize/tra cứu snapshot lệnh custom theo Sky; không thực thi network.
- `src/commands/sky/SkyCommandService.js`: kiểm tra đúng Sky + readiness + generation, resolve `{args}` và gửi qua `SlashCommandService`.
- `config/commands/sky-commands.json`: dữ liệu do người vận hành quản lý; không chứa lệnh hệ thống bắt buộc của core.

## Local AI (2.7+)

- `src/ai/LocalAiService.js`: façade cho status/workspace/agent run; dựng system context từ official project docs.
- `src/ai/AgentSession.js`: vòng tool-calling bounded; giữ conversation/tool trace và feed tool result lại model.
- `src/ai/providers/OllamaProvider.js`: HTTP loopback OpenAI-compatible `/v1/models` + `/v1/chat/completions`; không biết project/runtime.
- `src/ai/knowledge/ProjectWorkspace.js`: workspace guard, file discovery/search/read, controlled atomic write; loại secrets/runtime/build output.
- `src/ai/tools/AiToolRegistry.js`: permission/tool definitions, allowlisted verification runner và DesktopController runtime boundary.
- `src/desktop/main.js`: trusted IPC owner cho `mcbot:ai:*` và folder picker; không implement reasoning/tool logic.
- `src/desktop/renderer/*`: AI page, model/workspace/permission selection, chat + tool trace; không gọi Ollama trực tiếp.
