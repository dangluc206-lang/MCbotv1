# JS_RESPONSIBILITIES.md

Tài liệu này mô tả từng file JavaScript thực tế trong repository. Source dùng CommonJS; mọi ranh giới kỹ thuật tuân theo `RULES.md`.

**Tổng số file JavaScript:** 212

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
- **Trách nhiệm:** Composition root application: tải config, tạo shared services, profile và runtime.
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
- **Trách nhiệm:** Wiring toàn bộ dependency bot-scoped; đọc `app.diagnostics.runtimeFailures`/`circuitBreaker` đã validate, inject `connectionAggregationMs`, tạo `RuntimeFailurePublisher`/`RuntimeFailureRecorder`, và truyền policy để Collector/Fishing mỗi mode sở hữu breaker riêng. Lifecycle phải đặt mode trước teardown recorder/publisher theo reverse cleanup. Không chứa workflow runtime.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

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
- **Trách nhiệm:** Cung cấp capability nghiệp vụ qua Result contract. Forward `cancellationToken` và optional `expectedGeneration` xuống `CommandExecutor`; giữ `CANCELLED`/timeout/stale-generation diagnostic đủ để workflow cấp cao phân loại chính xác.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/commands/responses/CommandConfirmation.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Thực hiện trách nhiệm chuyên biệt của `CommandConfirmation` trong `src/commands/responses` theo RULES.md.
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
- **Trách nhiệm:** Validate app diagnostics contract: runtime failure enabled/safe relative directory/repeat+connection aggregation/quota/retention/cleanup semantics và circuit breaker backoff/jitter/failure budget/open duration. Phải reject quota quá nhỏ để record tối thiểu không thể ghi và giữ semantics `repeatWindowMs=0`, `cleanupIntervalMs=0`, `retentionDays=0` thống nhất với runtime.
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

### `src/configuration/schemas/commands.schema.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Validate hình dạng một nhóm configuration. Thành phần: `commands.schema`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/configuration/schemas/gui.schema.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Validate hình dạng một nhóm configuration. Thành phần: `gui.schema`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/configuration/schemas/items.schema.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Validate hình dạng một nhóm configuration. Thành phần: `items.schema`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/configuration/schemas/movement.schema.js`

- **Scope:** Stateless/shared
- **Trách nhiệm:** Validate hình dạng một nhóm configuration. Thành phần: `movement.schema`.
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
- **Trách nhiệm:** Tạo/attach connection, chờ spawn và cleanup connection hiện tại.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/connection/ReconnectManager.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Quản lý retry timer và backoff riêng của một bot.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

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

### `src/core/EventBus.js`

- **Scope:** Application-scoped
- **Trách nhiệm:** Abstraction EventEmitter với unsubscribe rõ ràng.
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
- **Trách nhiệm:** Sở hữu state/lifecycle và điều phối capability cùng scope. Thành phần: `GuiManager`.
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
- **Trách nhiệm:** Thực hiện trách nhiệm chuyên biệt của `GuiSession` trong `src/gui` theo RULES.md.
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
- **Trách nhiệm:** Nơi duy nhất gọi API clickWindow của Mineflayer.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/gui/click/ClickGuard.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Kiểm tra precondition và từ chối thao tác không an toàn. Thành phần: `ClickGuard`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/gui/click/ClickQueue.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Tuần tự hóa task và cô lập lỗi trong đúng scope. Thành phần: `ClickQueue`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/gui/click/ClickVerifier.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Xác minh hậu điều kiện sau side effect. Thành phần: `ClickVerifier`.
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
- **Trách nhiệm:** Theo dõi inventory/GUI lifecycle, debounce và lưu đồng thời các inventory view normalized để mode/service dùng chung và debug lỗi.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

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

- **Scope:** Operation-scoped
- **Trách nhiệm:** Thực thi workflow side-effect có timeout/lock/cleanup. Thành phần: `Operation`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/operations/OperationContext.js`

- **Scope:** Operation-scoped
- **Trách nhiệm:** Thực thi workflow side-effect có timeout/lock/cleanup. Thành phần: `OperationContext`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/operations/OperationLockPolicy.js`

- **Scope:** Operation-scoped
- **Trách nhiệm:** Thực thi workflow side-effect có timeout/lock/cleanup. Thành phần: `OperationLockPolicy`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/operations/OperationManager.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Thực thi workflow side-effect có timeout/lock/cleanup. Thành phần: `OperationManager`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/operations/OperationQueue.js`

- **Scope:** Bot-scoped
- **Trách nhiệm:** Tuần tự hóa task và cô lập lỗi trong đúng scope. Thành phần: `OperationQueue`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/operations/OperationStatus.js`

- **Scope:** Operation-scoped
- **Trách nhiệm:** Thực thi workflow side-effect có timeout/lock/cleanup. Thành phần: `OperationStatus`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.

### `src/operations/OperationTimeoutPolicy.js`

- **Scope:** Operation-scoped
- **Trách nhiệm:** Thực thi workflow side-effect có timeout/lock/cleanup. Thành phần: `OperationTimeoutPolicy`.
- **Dependency được phép:** module cùng capability, primitive tầng thấp hơn và dependency được inject.
- **Dependency bị cấm:** mode/controller tầng cao, global bot, secret và dữ liệu server hard-code.
- **Lifecycle/cleanup:** cleanup mọi listener, timer, lock, queue hoặc connection do file sở hữu; stateless không giữ tài nguyên.
- **Không được làm:** chiếm trách nhiệm của executor/manager/service khác hoặc expose mutable state nội bộ.


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
- **Lifecycle/cleanup:** đăng ký listener trong `initialize`; hủy delay/cancellation và gỡ listener trong `stop`/`destroy`; mỗi generation chỉ gửi một lần.
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
- **Trách nhiệm:** Thực thi `/is` side-effect có timeout/lock/cancellation và exact connection-generation verification. Capture expected generation trước command; normalize teleport event bằng `connectionGeneration ?? generation`; chỉ current connected generation được verify. Operation sở hữu internal `CancellationSource` liên kết parent token và truyền cả token + `expectedGeneration` xuống command layer; waiter timeout/stale/disconnect/cancel/failure phải cancel command branch đang throttle để `/is` không thể gửi muộn. Command/waiter race và mọi listener/timer/subscription phải settle/cleanup trong operation ownership.
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
- **Trách nhiệm:** Đọc dữ liệu nguồn và tạo biểu diễn chuẩn hóa, không side effect. Thành phần: `PersonalVaultReader`.
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
- **Trách nhiệm:** Mở plain `/kho sell`, giữ/reuse Sell GUI, resolve material qua `SellGuiReader`, thực thi click `1`/`64` (và chỉ cho `ALL` khi config explicit cho phép), chờ GUI update rồi verify amount/transition trước khi trả kết quả.
- **Không được làm:** gửi `/kho sell {item}`, dùng SELL ALL mặc định cho B1 production, tự sửa snapshot hoặc giả định click thành công.

### `src/server-features/crafting/B5PlanningService.js`
- **Scope:** Bot-scoped service.
- **Trách nhiệm:** Đọc `/kho`, `/pv 2`, inventory; lập plan B5 có tính stock B2-B5, theo dõi cả tổng B1 tương đương và B1 thực sự craftable; block B1 chỉ được tính dùng ngay khi block→phôi không vượt ngưỡng peak-capacity an toàn, hỗ trợ plan “tạo thêm B5” bỏ qua B5 đã có, công bố mode nguồn B1 và backpressure `/pv 2` từ số slot trống.
- **Không được làm:** tự click/craft/sell.

### `src/server-features/crafting/B5AutomationService.js`

- `prepare-b1 NOT_READY` do continuous input/state drift là wait-state, không phải automation failure; caller nhận `waitingForMaterials` để dùng poll interval.

- **Scope:** Bot-scoped side-effect workflow.
- **Trách nhiệm:** Chạy B5 dưới OperationManager với ưu tiên B5>B4>B3>B2. B1→B2 được dùng `ALL` chỉ sau hard storage-safety guard; nếu `ALL` làm inventory đầy thì cất đúng một stack B2 hiện tại vào `/pv 2`, verify slot trống, rồi B2→B3 `ALL`; planner các lượt sau phải nhìn thấy/reuse carry B2 trong PV2. Sau mọi production pass kể cả mới tạo B2/B3/B4 phải đổi B1 dư về block trước khi trả quyền cho mode; B4/B5 vẫn theo lượng planner cần và B5 phải cất `/pv 2`.
- **Không được làm:** bắt đầu B1→B2 `ALL` khi storage pressure/unknown/unsafe, dùng `ALL` cho B5 cuối, cất ngẫu nhiên item khác thay carry B2, bỏ verification, hoặc gửi raw command ngoài CommandService.

### `tests/unit/server-features/resource-pack/ResourcePackAutoAcceptService.test.js`
- **Scope:** Test-only.
- **Trách nhiệm:** Xác minh auto-accept phát `resource-pack:ready` ngay và cleanup listener khi connection kết thúc.


## Mode collector + B5 và Discord mode command

### `src/modes/collector-b5/CollectorB5ModeService.js`
- **Scope:** bot-scoped mode/workflow.
- **Trách nhiệm:** điều phối `/is` qua `IslandService`, di chuyển tới điểm nhặt cấu hình, giữ bot tại điểm nhặt, chạy `/nung` trước planning và sản xuất liên tục không cooldown; hễ B2/B3/B4/B5 đủ điều kiện thì đẩy ngay theo ưu tiên `B5 > B4 > B3 > B2`, sau lượt chế chỉ yield `craftLoopDelayMs` rất ngắn rồi inspect tiếp; khi chưa actionable luôn chạy maintenance để nén phôi/B1 trước khi chờ, không phụ thuộc pressure hiện tại; trước craft nếu `/kho` đã ở sell/critical pressure phải stabilize trước. Runtime error dùng canonical failure publisher + breaker riêng; token cancellation và expected Result wait-state không tăng breaker/publish; retryable OPEN giữ `DEGRADED` và không được finally ghi đè; verified production success mới reset streak.
- **Không được:** gọi Mineflayer trực tiếp, tự parse GUI, tự craft hoặc hard-code tọa độ server.

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
- **Trách nhiệm:** publish canonical failure cho mode; aggregate legacy connection signals theo connection generation thành một physical failure cùng `failureId`, chọn candidate diagnostic giàu nhất và flush pending incident khi stop.
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
- **Trách nhiệm:** expose `/mode action:on|off|status`, resolve bot runtime và gọi `collectorB5Mode`.
- **Không được:** thao tác Minecraft trực tiếp hoặc chứa logic B5.

### `config/modes/collector-b5.json`
- **Trách nhiệm:** feature flag, pickup location, radius, timeout, `pollIntervalMs` khi chờ nguyên liệu và `craftLoopDelayMs` giữa các lượt sản xuất liên tục của mode collector+B5.

### `src/modes/fishing/FishingModeService.js`
- **Scope:** Bot-scoped high-level mode orchestration/state machine.
- **Trách nhiệm:** lifecycle `initialize/start/enable/pause/resume/disable/stop/destroy`, public status/config, collector mutual-exclusion check, AFK selection, island/world/movement/probe/fishing orchestration, bounded wait/retry, runtime-failure publication và breaker phase transitions.
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
- **Không được:** publish runtime failure hoặc mutate `FishingModeService` state.

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
- **Trách nhiệm bổ sung cho fishing:** AFK selection/teleport verification phải lọc botId + exact generation, hỗ trợ cancellation và reject stale generation; old forcedMove không được xác nhận session mới. Click task và teleport waiter đều thuộc `joinBestAvailable()`; public method settle phải dispose waiter ngay và vẫn observe late click rejection để không tạo orphan promise/unhandled rejection.

### `src/connection/ConnectionManager.js`
- **Public capability bổ sung:** `requestReconnect(reason, { expectedGeneration = null } = {})` là boundary duy nhất để mode/policy yêu cầu reconnect; caller cũ chỉ truyền reason vẫn hợp lệ. Khi expected generation được cung cấp, stale request phải trả `false` và tuyệt đối không `.end()` replacement client. Synthetic `connection:ended` phải mang connection generation khi xác định được. Raw client `.end()` vẫn thuộc ConnectionManager, không được gọi từ FishingModeService/probe.

### `src/modes/fishing/FishingModeService.js` — generation correction contract
- `connection:ended` và `connection:spawned` normalize `connectionGeneration ?? generation`; stale/generation-less event không được mutate active route/state.
- `expectedGeneration` của business cycle phải đi qua classification, recovery decision, canonical failure publish, cleanup và reconnect request. Stale async outcome phải bị discard trước breaker/state/cleanup/reconnect mutation; diagnostic của cycle cũ nếu được publish phải giữ generation của cycle đó.

### `src/bootstrap/registerBotServices.js`
- **Fishing wiring:** tạo owner bot-scoped riêng `connectionStateView`, `fishingPacketObserver`, `fishingPositionGuard`, `fishingWorldReadiness`, `fishingMovement`, `fishingMovementProbe`, `fishingRecoveryPolicy`; inject capability vào `FishingModeService` thay vì BotContext. Lifecycle phải dừng mode trước khi teardown owner phụ thuộc.

### `src/bot/BotRegistry.js`
- **Listener contract:** registry mutation không rollback khi change listener lỗi; listener sau vẫn chạy; lỗi listener được sanitize/log best-effort và không throw ra caller sau mutation.


- `KhoService`: trước `/kho` từ GUI khác phải close-confirm-settle; không gửi command khi Mineflayer còn currentWindow cũ.
### `src/server-features/storage/B1StorageMaterialService.js`

- Storage pressure: projection dưới low-water 70% chỉ được báo RISING; hard protection/sellRequired chỉ khi actual >= high-water hoặc actual >= low-water và projectedHigh.


- **Trách nhiệm:** quản lý B1 trực tiếp trong `/kho`: coi `/kho` là continuously-fed buffer có raw/phôi/khối, tính B1-equivalent và craftable an toàn, `/nung` raw cần thiết, đổi block↔phôi qua `/ks`, nén B1, `stabilizeStorage()` theo high-water/low-water với **pressure/sell được xử lý trước GUI compaction**, chặn block→phôi nếu peak capacity vượt `decompressionMaxRatio`, đo pressure/growth toàn kho và net growth từng B1, derive nhu cầu B1/1 B5 từ recipe tree, xếp hạng sale theo logical item thực tế đang chiếm kho + demand coverage + growth. Startup trim giữ hard reserve 3 B5 nhưng dùng relative stop band mặc định khoảng 3.25 B5, coarse `64`-only, **block-only sell** và full `/kho` checkpoint định kỳ; amount Sell GUI không đáng tin thì local model phải trừ theo action 64 thay vì thay cả stock bằng số lore sai như `1`. Pressure cleanup cũng block-only; raw/phôi vẫn tính coverage/reserve nhưng không bao giờ là sell candidate. Nếu pressure còn cao, raw→phôi 1:1 và phôi→block được chạy best-effort để tạo stock nén rồi protection re-read và chỉ bán block. Pressure chạy theo bounded sell bursts, re-read full `/kho` giữa burst, tăng burst có trần khi inflow outpace sale, và tuyệt đối không bán xuống dưới hard reserve 3 B5.
- **Không được:** rút B1 ra player inventory để nung/đổi block hoặc đưa `COPPER` vào mapping server này.

### `src/discord/admin/BotProfileAdminService.js`

- **Trách nhiệm:** Quản trị profile bot động từ Discord: tạo/clone/sửa profile, enable/disable, reload runtime, connect/disconnect mà không cần restart toàn ứng dụng. Không lưu secret vào config.

### `scripts/cleanup-stale.js`

- **Trách nhiệm:** Dọn đúng danh sách source/config đã audit là không còn được runtime load hoặc require; hỗ trợ dry-run và `--apply`.
