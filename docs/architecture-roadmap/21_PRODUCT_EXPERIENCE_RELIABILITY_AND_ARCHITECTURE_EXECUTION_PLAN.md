# Product Experience, Reliability and Architecture Execution Plan

## 0. Thông tin tài liệu

| Thuộc tính | Giá trị |
| --- | --- |
| Trạng thái | `AUDIT + TARGET + IMPLEMENTATION PLAN` |
| Ngày chốt ảnh | 2026-08-24 |
| Phiên bản checkout | 2.7.67 |
| Phạm vi | Desktop/operator UX, mode platform, B5 thuần, diagnostics, recovery, architecture, maintainability, quality gates |
| Ngoài phạm vi | `.env`, `data/**`, `node_modules/**`, secret thật, thử nghiệm với Minecraft server thật |
| Phương pháp | Static review source/config/docs/test topology; không chạy test và không khảo sát người dùng thật trong đợt này |
| Đối tượng đọc | Product owner, maintainer, reviewer, AI coding agent, QA, operator |

Tài liệu này là chương trình cải tiến, không phải mô tả rằng mọi capability TARGET đã tồn tại. Khi có mâu thuẫn, thứ tự authority vẫn là:

1. `AGENTS.md` và `RULES.md`;
2. `SERVER_BEHAVIOR.md` cho hành vi server;
3. `ARCHITECTURE.md`, source/config/test CURRENT;
4. tài liệu roadmap này.

Mọi nhận định về độ ổn định trong tài liệu là đánh giá tĩnh. Chỉ được nâng thành kết luận production sau khi có kết quả test, fault simulation và bằng chứng vận hành theo các gate ở cuối tài liệu.

---

## 1. Kết luận điều hành

MCbot hiện là một **nền tảng kỹ thuật có lõi tốt nhưng trải nghiệm vận hành chưa đạt mức sản phẩm chuyên nghiệp cao nhất**.

Điểm mạnh nhất nằm ở isolation theo bot, ownership theo connection generation, serialization side effect, verification sau hành động, config transaction, update rollback, server profile boundary và khả năng mở rộng mode. Đây là nền móng phù hợp để tiếp tục phát triển; không có lý do kiến trúc để rewrite toàn bộ hoặc đổi framework.

Điểm yếu lớn nhất không phải là thiếu thêm thật nhiều tính năng. Điểm yếu là khoảng cách giữa một engine an toàn và một sản phẩm mà operator bình thường có thể:

- thiết lập đúng ngay lần đầu;
- hiểu bot đang làm gì chỉ trong vài giây;
- biết lỗi có nguy hiểm hay không;
- biết hệ thống đang tự hồi phục hay cần người can thiệp;
- thực hiện một hành động sửa lỗi rõ ràng mà không phải đọc JSON/log;
- tạo hoặc cấu hình workflow mà không phải hiểu cấu trúc nội bộ;
- thu thập đúng bằng chứng khi lỗi nặng xảy ra.

### 1.1 Điểm trưởng thành tạm thời

Thang điểm dùng chuẩn nghiêm ngặt: `5` là dùng được nhưng còn nhiều ma sát; `7` là tốt cho dự án production nhỏ; `9` là sản phẩm vận hành chín; `10` đòi hỏi bằng chứng thực địa và gần như không có khoảng trống đáng kể.

| Nhóm | Điểm / 10 | Nhận xét ngắn |
| --- | ---: | --- |
| Boundary và multi-bot isolation | 8.5 | Phân tầng và ownership tốt, generation guard rõ |
| An toàn side effect/transaction | 8.2 | Có queue, lock, timeout, verify, reconciliation; vẫn cần fault policy đồng nhất |
| Security và local update | 8.8 | Electron hardening, secret boundary và update rollback mạnh |
| Config safety | 8.1 | Schema/cross-validation/backup tốt; recovery UI và corruption UX còn thiếu |
| Extensibility kiến trúc | 8.0 | Mode SDK, capability và server profile có nền tảng tốt |
| Tính đa năng thực tế của sản phẩm | 6.2 | Kiến trúc rộng hơn số workflow/profile production hiện có |
| Onboarding/khả năng học | 4.8 | Thiếu wizard, readiness checklist và progressive disclosure |
| Thao tác vận hành hằng ngày | 6.4 | Có đủ control, nhưng còn kỹ thuật, dày và thiếu action-oriented status |
| Mode Builder | 5.3 | Có module catalog nhưng editor còn gần raw JSON, chưa thật sự no-code |
| Diagnostics và support | 5.0 | Có nền tảng tốt nhưng tồn tại mismatch đường dẫn làm mất bằng chứng Desktop |
| Khôi phục lỗi nhẹ/trung bình | 7.3 | Retry, reconnect, cancellation khá tốt |
| Khôi phục lỗi nặng | 6.0 | Thiếu circuit/fault contract thống nhất, fatal recovery và fleet partial-failure handling |
| Maintainability | 6.3 | Boundary tốt nhưng một số file quá tập trung và thiếu static quality gate |
| Backend/unit/contract quality | 8.0 | Test topology rộng; bằng chứng release trước đây tích cực nhưng chưa chạy lại ở audit này |
| Desktop UI/a11y/E2E quality | 3.5 | Chưa có lớp kiểm thử giao diện/accessibility/visual đủ mạnh |
| Tài liệu và tính nhất quán sản phẩm | 4.5 | Version và B5 behavior đang có mô tả mâu thuẫn |

**Điểm tổng hợp tạm thời: 6.7/10.** Mục tiêu hợp lý là `8.5+` sau khi hoàn tất P0/P1, đóng các luồng vận hành quan trọng và có bằng chứng field SLO. Không nên tự tuyên bố `9+` chỉ dựa trên unit test.

### 1.2 Phán quyết kiến trúc

- **Có nên rewrite?** Không.
- **Có nên chuyển microservice/worker ngay?** Không. Chỉ mở Phase 6 khi scale benchmark thực tế chứng minh modular monolith không đạt SLO.
- **Có nên tiếp tục thêm feature trước?** Chỉ feature không làm tăng blast radius. Ưu tiên đóng recovery, diagnostics, onboarding và B5 operator flow trước.
- **Lõi có ổn định không?** Lõi transaction/lifecycle khá ổn về thiết kế; độ ổn định production chưa được chứng minh đủ ở Desktop, persistent fault và failure escalation.
- **Có dễ xử lý lỗi không?** Dev có thể lần lỗi nhờ structured log/replay; operator vẫn khó vì bằng chứng chưa được trình bày thành nguyên nhân và hành động rõ ràng.

---

## 2. North Star sản phẩm

Tên trạng thái mục tiêu trong tài liệu này là **MCbot Operator Platform**.

### 2.1 Tuyên bố mục tiêu

> Một operator không cần hiểu Mineflayer, JSON hay kiến trúc nội bộ vẫn có thể cài đặt, kết nối, chạy B5, nhận biết rủi ro, xử lý lỗi phổ biến và xuất gói hỗ trợ chính xác; trong khi developer vẫn có đủ trace/replay, contract và extension point để sửa lỗi nặng mà không phá isolation.

### 2.2 Bảy lời hứa sản phẩm

1. **Một nguồn sự thật:** UI, docs, config và runtime không mô tả cùng một hành vi theo nhiều cách mâu thuẫn.
2. **Trạng thái có ý nghĩa:** mọi bot luôn ở một trong các trạng thái operator hiểu được: `Sẵn sàng`, `Đang làm`, `Đang chờ`, `Cần xử lý`, `Đã dừng`.
3. **Mỗi lỗi có đường ra:** lỗi hiển thị chuyện gì xảy ra, mức an toàn, hệ thống đã thử gì, bước tiếp theo và correlation ID.
4. **Không đột biến inventory không xác minh:** action gửi đi không bao giờ được đồng nhất với action thành công.
5. **Không bắt người mới dùng giao diện của developer:** thiết lập cơ bản dùng preset/form; JSON, trace và raw config nằm trong Advanced/Developer.
6. **Mở rộng không phá core:** mode/profile mới khai báo capability và presentation contract, không thêm nhánh server-specific vào generic runtime.
7. **Lỗi nặng vẫn để lại bằng chứng:** process crash, startup failure, config corruption và update rollback đều tạo artifact tối thiểu, đã redaction và có thể truy xuất.

### 2.3 SLO/Outcome mục tiêu

Các con số dưới đây là TARGET; phải đo trước khi dùng làm cam kết release.

| Outcome | Mục tiêu |
| --- | --- |
| Time-to-first-success | Người mới hoàn tất profile, secret, connect và start mode đầu tiên trong `<= 10 phút` |
| Common-task completion | `>= 95%` tác vụ thường ngày không cần mở raw JSON hoặc tài liệu ngoài app |
| UI reaction | p95 phản hồi thao tác local `< 100 ms`; snapshot render p95 `< 50 ms` ở fleet size được hỗ trợ |
| Stale status | UI phát hiện snapshot stale trong `<= 5 giây` và phân biệt UI stale với backend offline |
| Incident visibility | Lỗi P0/P1 xuất hiện trong Incident Center trong `<= 2 giây` kể từ khi recorder nhận lỗi |
| B5 safety | `0` mutation lặp không xác minh; sell chỉ quantity `64`; giữ phần dư `<64`; reserve sau sell `>=1.5 B5` |
| B5 blocked UX | Persistent blocker được phân loại, ngừng side effect lặp và đưa action hợp lệ trong `<= 5 giây` |
| Emergency stop | Mọi bot trong snapshot đều được attempt; kết quả từng bot hiển thị, không bỏ bot sau khi một bot lỗi |
| Recovery | Không có crash-loop vô hạn; mọi circuit open có cooldown/action và artifact |
| Support bundle | Manifest/version/hash/size limit/redaction đầy đủ; operator xem được nội dung loại dữ liệu trước export |
| Accessibility | Critical journeys đạt WCAG 2.2 AA cho keyboard, focus, contrast, labeling và text scaling |
| Release confidence | Critical Desktop flows có E2E; fault matrix có bằng chứng; docs behavior/version gate pass |

---

## 3. Người dùng và hành trình phải tối ưu

### 3.1 Persona

| Persona | Nhu cầu | Không nên bị buộc phải biết |
| --- | --- | --- |
| Operator mới | Thêm bot, nhập secret, chọn mode, biết đã chạy đúng | JSON schema, operation generation, GUI fingerprint |
| Operator thường xuyên | Xem fleet, xử lý blocker, cập nhật app, export support | Source tree, stack trace, internal service name |
| Power user | Tinh chỉnh B5/fishing, tạo custom mode, xem trace | Electron IPC implementation, Mineflayer raw client |
| Maintainer/QA | Replay lỗi, so sánh snapshot, test fault, rollback | Secret thật và server public trong test mặc định |
| Extension developer | Thêm mode/profile/capability | Bypass side-effect owner hoặc nhúng server behavior vào core |

### 3.2 Sáu critical journeys

#### Journey J1 — First run

1. App kiểm tra runtime/config/secret/profile.
2. Wizard giải thích đúng một quyết định mỗi bước.
3. Secret được lưu qua OS store, không hiển thị lại giá trị.
4. Test cấu hình không kết nối server nếu chưa được người dùng yêu cầu.
5. Readiness checklist cho biết rõ mục nào pass/fail và cách sửa.
6. Người dùng connect bot đầu tiên và thấy trạng thái xác nhận.

#### Journey J2 — Chạy B5 thuần

1. Chọn bot và `b5-craft`.
2. UI tóm tắt policy bắt buộc trước khi start.
3. Timeline hiển thị đúng boundary:
   `fresh /kho -> nung raw iron/raw gold -> nén B1 có block -> chốt sell baseline -> sell 64 -> verify reserve >=1.5 -> craft`.
4. UI hiển thị campaign, batch, phase, progress, blocker và lần retry theo ngôn ngữ operator.
5. Inflow sau baseline không bị bán trong episode hiện tại.
6. Nếu blocked, UI giữ nguyên bằng chứng và đưa đúng action `Thử lại bảo vệ kho`, `Xem bằng chứng`, `Dừng mode`.

#### Journey J3 — Xử lý lỗi nhẹ

1. Runtime tự retry có giới hạn.
2. UI hiển thị `Đang tự khôi phục`, không dùng màu đỏ như lỗi cần người can thiệp.
3. Không spam toast/log Desktop.
4. Khi hồi phục, incident được đóng với duration và kết quả.

#### Journey J4 — Xử lý lỗi dai dẳng

1. Circuit/fault policy ngừng side effect nguy hiểm.
2. Bot chuyển `Cần xử lý`, không âm thầm restart hàng nghìn lần.
3. Incident chỉ ra resource/step/generation và postcondition cuối cùng biết được.
4. Operator có action được allowlist; action không bypass operation/GUI/command owner.

#### Journey J5 — Emergency stop

1. Người dùng xác nhận một lần bằng dialog trong app.
2. Desired state của toàn fleet bị revoke trước.
3. Stop/disconnect được attempt độc lập cho mọi bot.
4. UI hiển thị bot nào đã dừng, bot nào timeout, bot nào cần force cleanup.
5. App không báo hoàn tất nếu còn bot chưa ở terminal state.

#### Journey J6 — Báo lỗi cho maintainer

1. Incident Center chọn incident/correlation ID.
2. App preview các nhóm dữ liệu sẽ export.
3. Username được pseudonymize mặc định; secret luôn bị loại/redact.
4. Bundle có manifest, schema version, hashes, limits và replay references.
5. Maintainer có thể tái hiện planner/fault flow offline khi artifact cho phép.

---

## 4. Đánh giá trải nghiệm hiện tại

### 4.1 Những gì đang làm tốt

- Desktop đã gom được các tác vụ quan trọng: Dashboard, Bots, Modes, Builder, Tools, Logs, Diagnostics, Local AI và Settings.
- Có disable action đang pending và confirmation cho delete/disconnect/update/emergency.
- Có live snapshot, freshness indicator, log filter, GUI inspector, config backup/update controls và support export.
- Electron dùng `contextIsolation`, tắt `nodeIntegration`, bật sandbox, có CSP, khóa navigation/window open và xác minh IPC sender.
- `focus-visible` và `prefers-reduced-motion` đã được cân nhắc trong CSS.
- Local AI đi qua permission/boundary, không được trở thành gameplay authority.
- B5 thuần đã có semantics an toàn quan trọng: immutable sell baseline, bounded slices, 64-only sell, reserve verification và stale-generation rejection.

### 4.2 Ma sát đang gặp

| ID | Vấn đề | Hậu quả với người dùng | Mức |
| --- | --- | --- | --- |
| UX-001 | Điều hướng phẳng trộn operator, power-user và developer tools | Người mới không biết bắt đầu ở đâu; dễ chạm config nguy hiểm | P1 |
| UX-002 | Không có onboarding wizard/readiness checklist | Setup phụ thuộc docs và thử-sai | P1 |
| UX-003 | B5 status quá kỹ thuật, thiếu stage/progress/next action | Operator thấy attempt/backoff/trace nhưng không biết phải làm gì | P0 |
| UX-004 | Toast tự biến mất nhanh, lỗi backend raw English/technical | Mất thông tin và khó báo lỗi chính xác | P1 |
| UX-005 | Không có Incident Center/history | Chỉ thấy trạng thái hiện tại/last error, khó theo timeline | P1 |
| UX-006 | Config thiếu dirty state, diff, reset, undo và impact preview | Dễ lưu nhầm; khó quay lại cấu hình tốt | P1 |
| UX-007 | Native `confirm/prompt` và action name nội bộ | Trải nghiệm không nhất quán, khó accessibility/automation | P2 |
| UX-008 | Font thường 9–11px, dark-only, thiếu text scaling/high contrast | Khó đọc và chưa đạt chuẩn accessibility cao | P1 |
| UX-009 | Không có global search/help/command palette | Chức năng nhiều nhưng khó khám phá | P2 |
| UX-010 | Vietnamese và English kỹ thuật trộn trực tiếp trong view | Khó hiểu, khó i18n và khó kiểm soát wording | P2 |
| UX-011 | Mode Builder dùng textarea JSON cho từng step | Không thật sự no-code; lỗi schema chỉ xuất hiện muộn | P1 |
| UX-012 | Builder không cho chỉnh `stop` flow dù definition có hỗ trợ | Lifecycle custom mode không hoàn chỉnh trong UI | P1 |
| UX-013 | Module catalog chưa có UI schema/field help | Không thể render form theo module một cách an toàn | P1 |
| UX-014 | Lưu custom mode yêu cầu restart backend | Feedback loop chậm và dễ làm gián đoạn fleet | P2 |
| UX-015 | Default `storage-protect` còn `allowSmelting:false` đã lỗi thời | Gây hiểu nhầm với contract nung bắt buộc hiện tại | P1 |
| UX-016 | Responsive CSS có nhưng app đặt min width 1080 | Không phù hợp màn hình nhỏ; nav rút còn số khó hiểu | P2 |

### 4.3 Tính đa năng

Kiến trúc có tiềm năng đa năng hơn sản phẩm thực tế:

- Mode platform đã hỗ trợ catalog/registry/context/capability.
- Composable mode có 17 loại module quan sát được.
- Có fake second-server contract để chứng minh boundary.
- Tuy nhiên production vẫn tập trung vào MinerUA và các workflow B5/fishing/legacy collector.
- Desktop có start/stop generic ở mức mode, nhưng config/status presentation vẫn hard-code nhiều cho B5, collector và fishing.

Kết luận: **framework extensible, sản phẩm chưa phải multi-server/multi-workflow hoàn chỉnh**. Không nên quảng bá đa server chỉ vì fake profile test pass. Phải có ít nhất một profile production thứ hai và một workflow không dựa B5/fishing, kèm support matrix, trước khi nâng claim.

---

## 5. Đánh giá kiến trúc tầng dưới

### 5.1 Điểm vững

| Khu vực | Đánh giá |
| --- | --- |
| Runtime ownership | `Application -> BotRegistry -> BotRuntime` tạo isolation đúng hướng |
| Connection safety | Session/attempt/generation được sở hữu rõ; callback stale có guard |
| Side-effect boundary | Command, GUI click và connection close có owner tập trung |
| Stateful operations | Queue/lock/timeout/cancel/cleanup và verification-first phù hợp Minecraft automation |
| Mode lifecycle | Catalog/registry/coordinator/context/supervisor tạo đường mở rộng tốt |
| Config | Schema, cross-contract validation, backup/rollback và immutable runtime config mạnh |
| Server isolation | ServerProfile và fake second server giúp ngăn MinerUA leak vào generic core |
| Update | Source trust, manifest/hash, staging, transaction, backup và rollback là điểm rất mạnh |
| Observability | Structured log, trace/replay/failure recorder là nền móng đúng |
| Security | Electron và Local AI đều fail-closed ở các boundary quan trọng |

### 5.2 Nợ kiến trúc và maintainability

| ID | Vấn đề | Root cause/ảnh hưởng | Mức |
| --- | --- | --- | --- |
| ARC-001 | Một số file orchestration quá lớn | Nhiều trách nhiệm, review khó, blast radius cao | P1 |
| ARC-002 | Renderer là file monolith và full re-render theo snapshot | Khó test page riêng, dễ regression và có nguy cơ scale kém | P1 |
| ARC-003 | `DesktopController` gom nhiều use case | IPC/application boundary khó version và khó fault-test độc lập | P1 |
| ARC-004 | `B5CraftModeService` vừa lifecycle, batch, retry, reconciliation, status | Fault policy và nghiệp vụ bị dính nhau | P0 |
| ARC-005 | `RuntimeConfigMigrator` quá tập trung | Migration/transaction/journal/recovery khó chứng minh riêng | P1 |
| ARC-006 | `registerBotServices.js` wiring dày và nhiều dòng cực dài | Composition root đúng owner nhưng khó audit dependency |
| ARC-007 | Thiếu lint/format/checkJs/complexity gate | Syntax pass chưa bắt được contract drift, dead code, complexity |
| ARC-008 | Legacy collector/fishing còn gameplay/recovery decisions cũ | Parity và thay đổi hành vi khó kiểm soát | P2 |
| ARC-009 | IPC surface rộng | Dễ tăng coupling nếu tiếp tục thêm method không có domain contract/version |
| ARC-010 | Scale baseline chưa bao gồm Desktop/Mineflayer/live GUI workload | Chưa thể khẳng định fleet scale production |

Các file có dấu hiệu concentration cao trong snapshot này gồm `RuntimeConfigMigrator.js`, `B5CraftModeService.js`, `B5AutomationService.js`, `renderer/app.js`, `DiscordPanelManager.js`, `CollectorB5ModeService.js`, `GuiManager.js`, `GuiKnowledgeRegistry.js`, `FishingModeService.js` và `DesktopController.js`. Line count không tự động là bug; chỉ được tách khi có seam/test và mục tiêu giảm responsibility rõ ràng.

### 5.3 Khả năng xử lý lỗi theo mức độ

| Mức | Ví dụ | Hiện tại | Khoảng trống |
| --- | --- | --- | --- |
| E0 — Expected wait | cooldown, GUI chưa sẵn sàng ngắn | Khá tốt | Cần wording không gây báo động |
| E1 — Transient | timeout đơn lẻ, reconnect | Khá tốt | Cần gom incident và suppression nhất quán |
| E2 — Persistent business blocker | B5 storage protection bị chặn | An toàn fail-closed nhưng UX yếu | Thiếu public retry/action và fault state chuẩn |
| E3 — Bot degraded | mode loop throw lặp, movement stuck | Không đồng nhất giữa mode | Thiếu common fault policy/publisher/circuit |
| E4 — Backend/config failure | startup validation, corrupt state | Có log/rollback một phần | Thiếu structured boot failure và recovery UI |
| E5 — Process/renderer failure | main crash, renderer gone | Chưa hoàn chỉnh | Thiếu crash marker/fatal drain/relaunch affordance |
| E6 — Fleet/systemic | emergency stop gặp một bot throw | Có control nhưng partial handling yếu | Cần two-phase revoke + all-settled + terminal verify |

---

## 6. Các lỗi/rủi ro cụ thể phải đóng trước khi mở rộng lớn

### P0-01 — Desktop Diagnostics có thể không thấy lỗi thật

**Bằng chứng CURRENT**

- `RuntimeFailureRecorder` ghi theo cấu trúc `errors/<botId>/last-error.json` và `errors.jsonl`.
- `DesktopController.diagnostics()` chỉ đọc file `.json` ngay ở root directory, không duyệt directory theo bot.
- `DesktopController.readDiagnostic()` dùng basename/root path nên không thể đọc identifier lồng an toàn.
- Controller lấy config theo `app.runtimeFailures.directory`, trong khi contract hiện tại nằm dưới `app.diagnostics.runtimeFailures.directory`.
- Unit test Desktop mock shape cũ, vì vậy có thể pass nhưng không tái hiện layout/config thật.

**Tác động**

Operator mở Diagnostics đúng lúc cần nhất nhưng có thể thấy danh sách rỗng. Support export Desktop cũng dùng nguồn này nên có thể thiếu failure artifact.

**Giải pháp bắt buộc**

1. Tạo `RuntimeFailureArtifactRepository` làm owner duy nhất của layout và lookup.
2. Dùng đúng config contract `app.diagnostics.runtimeFailures`.
3. Trả về opaque artifact ID hoặc relative path đã validate; không dùng raw user path.
4. Resolve path rồi kiểm tra containment; reject traversal, absolute path, symlink escape và sai allowlist.
5. Hỗ trợ ít nhất `last-error.json` theo bot; `errors.jsonl` chỉ đọc bounded tail.
6. Desktop list theo bot/time/code/severity, không chỉ filename.
7. Dùng fixture tạo từ ConfigSpecs/layout thật trong test, không mock object tùy ý.

**Definition of Done**

- Failure được recorder ghi cho `bot-01` xuất hiện trong Desktop trong `<2s` theo target polling.
- Có test nested layout, multiple bot, missing/corrupt file, traversal, symlink và retention.
- Diagnostics page không đọc ngoài configured root.
- Support bundle lấy cùng repository/builder, không có đường đọc riêng.

### P0-02 — Emergency stop có thể bỏ qua các bot phía sau

**Bằng chứng CURRENT**

`DesktopController.fleetAction('emergency-stop')` xử lý bot tuần tự. Nếu một stop/disconnect throw ra ngoài, vòng lặp có thể dừng và các bot sau không được attempt.

**Giải pháp bắt buộc**

1. Snapshot danh sách bot và generation tại thời điểm bắt đầu.
2. Phase A: revoke desired mode/connect intent cho toàn bộ danh sách trước bất kỳ await dài nào.
3. Phase B: chạy stop/disconnect theo per-bot task có timeout; dùng all-settled hoặc bounded concurrency.
4. Phase C: verify terminal state từng bot; late client/connect attempt phải bị owner cleanup.
5. Trả `fleetEmergencyStopResult` gồm status từng bot, duration, timeout/error code và remaining risk.
6. UI giữ banner/action trạng thái cho tới khi mọi bot terminal hoặc timeout rõ.
7. Không dùng `Promise.all()` cho GUI/inventory; ngoại lệ này chỉ là orchestration độc lập giữa các bot sau khi intent đã revoke.

**Definition of Done**

- Một bot throw không ngăn các bot sau được attempt.
- Test ít nhất: all success, first fail, middle timeout, late connection, repeated click/idempotency, backend stopping concurrently.
- Không báo `success:true` toàn fleet nếu có partial failure.

### P0-03 — B5 persistent fault chưa có lifecycle phục hồi cấp operator

**Bằng chứng CURRENT**

- B5 storage protection episode có retry bounded và chuyển `WAITING_BLOCKED`; đây là fail-closed đúng.
- Retry từ bên ngoài hiện chủ yếu gắn với reconfigure hoặc connection generation change; Desktop không có action rõ để yêu cầu thử lại episode.
- `B5CraftModeService` supervisor có restart budget rất lớn; B5 pure chưa hội tụ cùng circuit breaker/runtime failure publisher như một số mode khác.

**Rủi ro**

- Operator thấy warning kỹ thuật nhưng không biết hệ thống có còn tự chạy hay không.
- Unexpected loop exception có thể lặp quá lâu trước khi thành terminal fault.
- Nếu thêm nút retry sai layer, hệ thống có thể re-click/re-sell hoặc hấp thụ inflow mới, phá immutable episode.

**Giải pháp bắt buộc**

1. Chuẩn hóa `ModeFaultPolicy` dùng chung nhưng policy theo mode.
2. Phân biệt `EXPECTED_WAIT`, `TRANSIENT_RETRY`, `BUSINESS_BLOCKER`, `UNEXPECTED_FAULT`, `STALE_ABORT`, `CANCELLED`.
3. Business blocker không được tính như process crash; phải giữ evidence và ngừng side effect lặp.
4. Unexpected fault dùng sliding-window restart budget hữu hạn; open circuit chuyển `PAUSED_ERROR/DEGRADED` và publish runtime failure.
5. Thêm public use case `requestStorageProtectionRetry(botId, expectedGeneration, incidentId)` qua mode control/Desktop boundary.
6. Retry phải tạo episode mới chỉ khi precondition cho phép; không replay mutation không rõ kết quả.
7. UI có ba action allowlist: `Thử lại`, `Xem bằng chứng`, `Dừng mode`.
8. Trace phải liên kết campaign/batch/episode/operation/correlation ID.

**B5 invariant không được thay đổi**

`fresh /kho -> nung raw iron/raw gold -> nén mọi B1 family có block form -> immutable sell baseline -> sell đúng 64 -> giữ dư <64 -> verify >=1.5 B5 -> craft`.

Không nung resource khác, không sell `1`, không re-baseline giữa sell episode, không tính verified continuation là business failure.

**Definition of Done**

- Persistent timeout không spam vô hạn và không tạo mutation trùng.
- Operator retry không cần restart backend/config.
- Generation đổi làm kết quả cũ bị bỏ đúng contract.
- Có fault tests cho timeout trước/sau command, GUI ambiguous, partial sell, reconnect, retry click kép và inflow sau baseline.

### P1-01 — Desktop support bundle đi đường riêng

**Bằng chứng CURRENT**

Desktop tự ghép JSON từ snapshot/profiles/logs/diagnostics/replay, trong khi `SupportBundleBuilder` đã có manifest/allowlist/size-oriented contract ở đường CLI/test.

**Giải pháp**

- Mọi export gọi chung `SupportBundleBuilder`.
- Bundle có schema version, app version, createdAt, incident ID, artifact manifest, content hash, redaction result và per-entry/total size budget.
- Username/profile identifier được pseudonymize mặc định; secret và `.env` không bao giờ được đưa vào.
- UI preview nhóm dữ liệu và cảnh báo PII trước Save.
- Bất kỳ artifact lỗi/corrupt nào tạo manifest warning, không làm mất toàn bundle.

### P1-02 — Startup failure thiếu structured recovery

**Bằng chứng CURRENT**

Backend chuyển `FAILED` và log lỗi, nhưng snapshot không giữ một `lastStartFailure` đủ cấu trúc. Toast có thể biến mất trước khi operator xử lý.

**Giải pháp**

- Snapshot thêm sanitized `bootFailure` gồm code, stage, config group/file/path, safe summary, recoverability, correlation ID và allowed actions.
- Setup banner tồn tại cho tới khi resolve/dismiss có chủ đích.
- Action: mở đúng config editor, restore backup, revalidate, retry backend.
- Không expose secret/value nhạy cảm trong field error.

### P1-03 — Fatal/crash recovery của Desktop chưa thành contract

**Bằng chứng CURRENT**

Headless shutdown có signal/fatal handling; Electron main chưa thể hiện cùng mức bounded fatal drain. `render-process-gone` chủ yếu thông báo, chưa có recovery journey đầy đủ.

**Giải pháp**

- Main process ghi crash marker tối thiểu bằng atomic write, best-effort drain rồi exit; không tiếp tục chạy sau uncaught fatal.
- Khởi động sau crash hiển thị recovery banner và không tự khôi phục mode intent của process cũ trái session rule.
- Renderer gone có nút reload an toàn; nếu lặp quá budget thì chuyển safe screen.
- Relaunch policy bounded, không crash-loop.
- Artifact tuyệt đối không chứa raw secret/client/window/packet.

### P1-04 — Health contract chưa trở thành operator health

**Bằng chứng CURRENT**

`HealthRegistry` và platform health tồn tại nhưng số probe còn ít; Desktop snapshot dùng platform snapshot, chưa cung cấp health projection giàu ngữ nghĩa.

**Giải pháp**

- Tạo async health sampler/cache; không block synchronous snapshot.
- Probe theo bot: connection/reconnect, mode liveness/progress, operation queue age, GUI session age, recorder/persistence, storage protection, B5 no-progress dwell.
- Optional mode không chạy không được làm global health đỏ.
- UI tổng hợp `HEALTHY`, `WORKING`, `WAITING`, `NEEDS_ACTION`, `OFFLINE`, kèm remediation.

### P1-05 — Secret store có thể che corruption/decryption failure

**Bằng chứng CURRENT**

Đường đọc secret có thể fallback thành object rỗng khi JSON/decryption lỗi, làm UI trông giống "chưa cấu hình" thay vì "kho secret hỏng/không đọc được".

**Giải pháp**

- Trạng thái: `OK`, `UNAVAILABLE`, `CORRUPT`, `DECRYPT_FAILED`, `NOT_CONFIGURED`.
- Chỉ log metadata không nhạy cảm: provider, code, timestamp, recovery hint.
- UI cho backup/reset store có xác nhận; reset không ảnh hưởng config khác.
- Không bao giờ hiển thị hoặc export secret plaintext.

### P1-06 — Tài liệu đang mâu thuẫn hành vi B5 và version

**Bằng chứng CURRENT**

- `package.json` là 2.7.67 nhưng user guide/start-here còn header cũ.
- Một số đoạn nói B5 không nung hoặc có toggle `allowSmelting`; contract hiện tại bắt buộc nung chỉ raw iron/raw gold ở boundary.
- Một số flow cũ mô tả storage protection chỉ theo pressure, không khớp batch boundary hiện tại.

**Giải pháp**

- Chọn một canonical B5 behavior section trong `SERVER_BEHAVIOR.md`.
- User docs chỉ diễn giải từ canonical contract, không tự định nghĩa lại.
- Release gate kiểm tra version docs và denylist câu behavior lỗi thời.
- Chuyển release notes lịch sử ra changelog; không để README là chuỗi patch note mâu thuẫn.
- Builder/default config xóa field `allowSmelting` đã vô hiệu hoặc migration rõ ràng.

---

## 7. Kiến trúc mục tiêu

### 7.1 Luồng điều khiển

```text
Desktop Renderer
  -> versioned preload API
  -> validated IPC use cases
  -> Desktop application controllers
  -> RuntimePlatformService / ModeControl / Diagnostics / Config / Update
  -> BotRegistry
  -> BotRuntime per bot
  -> ModeContext + ModeCoordinator + OperationManager
  -> capability/service owner
  -> CommandExecutor / ClickExecutor / ConnectionManager
  -> Mineflayer / server
```

Không cho renderer, Local AI, custom mode hoặc Discord đi tắt tới raw bot/client/chat/click.

### 7.2 Luồng quan sát

```text
runtime events + health probes + operation results + failure artifacts
  -> canonical event/result/error contracts
  -> incident correlator
  -> compact operator projection
  -> Desktop summary

full trace/replay/snapshot
  -> bounded artifact repositories
  -> support bundle builder
  -> developer diagnostics
```

Desktop không cần nhận full internal graph mỗi 900ms. Summary projection phải nhỏ, versioned và ổn định; detail tải on-demand theo bot/incident.

### 7.3 Trạng thái mode chuẩn

```text
STOPPED
  -> STARTING
  -> RUNNING
      -> WAITING_EXPECTED
      -> RETRYING_TRANSIENT
      -> WAITING_BLOCKED
      -> DEGRADED
  -> STOPPING
  -> STOPPED

DEGRADED/WAITING_BLOCKED
  -> operator retry (guarded)
  -> recovered RUNNING
  -> STOPPING
```

Mỗi transition phải có owner, generation, reason code, timestamp và cleanup contract.

### 7.4 Error contract chuẩn

```js
{
  code,
  severity,
  category,
  retryClass,
  safeToRetry,
  operatorSummary,
  technicalSummary,
  botId,
  connectionGeneration,
  modeId,
  operationId,
  step,
  resource,
  correlationId,
  incidentId,
  occurredAt,
  evidenceRefs,
  allowedActions
}
```

`allowedActions` là danh sách use case có validator; không phải raw command hoặc callback tùy ý.

### 7.5 Information architecture mục tiêu

| Cấp | Nội dung |
| --- | --- |
| Operate | Overview, Bots, Modes, Incidents |
| Build | Mode Builder, Templates |
| Maintain | Updates, Backups, Diagnostics |
| Advanced | Raw config, GUI inspector, trace/replay, Local AI |

Mặc định mở `Operate`. `Advanced` bị thu gọn và có cảnh báo phạm vi. Quyền kỹ thuật không làm thay đổi runtime permission model; đây chỉ là progressive disclosure ở UI.

---

## 8. Nguyên tắc triển khai

1. Sửa correctness/recovery trước polish.
2. Không rewrite theo file; tách theo seam có test và contract.
3. Mỗi work package chỉ thay một behavior contract chính.
4. Giữ backward compatibility trừ khi có migration/version rõ.
5. Mọi action stateful giữ verification, generation guard, cancel và cleanup.
6. Không tăng sleep/retry budget để che root cause.
7. Không mở worker/microservice nếu chưa có SLO failure và benchmark driver.
8. Không thêm server/profile giả làm product feature; fake chỉ chứng minh boundary.
9. Không biến Mode Builder thành arbitrary code runner.
10. Mỗi P0/P1 phải có rollback path và failure-injection test trước release.
11. Không báo hoàn tất chỉ vì unit test pass; cần traceability và evidence gate.
12. Từng release phải giảm hoặc giữ nguyên blast radius, không tạo đường side effect thứ hai.

---

## 9. Lộ trình tổng thể và dependency

### 9.1 Thứ tự bắt buộc

```text
R0 Baseline & contracts
  -> R1 Recovery closure
      -> R2 Operator experience
          -> R3 Architecture decomposition
              -> R4 Extensibility/product breadth
                  -> R5 Field quality & release hardening
                      -> R6 Fleet scale (conditional only)
```

Không đảo R4 lên trước R1/R2. Thêm mode/profile mới khi incident, diagnostics và recovery còn thiếu sẽ nhân đôi chi phí sửa lỗi.

### 9.2 Các release train

| Release | Mục tiêu | Work package | Gate ra |
| --- | --- | --- | --- |
| R0 | Chốt baseline, persona, error vocabulary, SLO | XP-000..003 | Contract được review, không đổi gameplay |
| R1 | Đóng lỗ hổng quan sát và lỗi nặng | XP-010..017 | P0 fault matrix pass, bundle đúng, docs thống nhất |
| R2 | Biến trạng thái kỹ thuật thành trải nghiệm operator | XP-100..108 | Critical journeys không cần raw JSON |
| R3 | Giảm blast radius codebase | XP-200..207 | Parity evidence, file responsibility rõ, gate static pass |
| R4 | Builder và extension thực sự dùng được | XP-300..305 | Schema-driven UI, safe templates, extension conformance |
| R5 | Chứng minh chất lượng production | XP-400..407 | E2E/a11y/perf/fault/release evidence pass |
| R6 | Scale architecture có điều kiện | XP-500..501 | Chỉ mở nếu benchmark fail SLO và decision gate phê duyệt |

### 9.3 Dependency quan trọng

- XP-010 Diagnostics phải xong trước XP-011 Support Bundle và XP-102 Incident Center.
- XP-013 Error Contract phải chốt trước XP-014 B5 Fault Policy, XP-104 Operator Health và XP-102 Incident Center.
- XP-012 Emergency Stop độc lập về UI polish nhưng phải xong trước tuyên bố severe recovery ổn định.
- XP-014 B5 Fault Policy phải xong trước XP-105 B5 Journey UI.
- XP-103 Onboarding phụ thuộc XP-015 Boot Failure và XP-016 Secret Store State.
- XP-200 Renderer decomposition chỉ bắt đầu sau khi critical Desktop E2E harness tối thiểu ở XP-001 có sẵn.
- XP-203 B5 decomposition chỉ bắt đầu sau fault tests XP-014 và replay parity baseline.
- XP-301 Builder typed editor phụ thuộc XP-300 Module Presentation Schema.
- XP-500 worker feasibility không được bắt đầu nếu XP-406 scale benchmark chưa chứng minh bottleneck.

### 9.4 Ước lượng tương đối

Không dùng ngày cố định khi chưa biết số người. Dùng size để lập kế hoạch:

| Size | Ý nghĩa |
| --- | --- |
| XS | Một contract/file nhỏ, rủi ro thấp |
| S | Một use case + targeted tests |
| M | Nhiều module cùng layer, cần integration tests |
| L | Cross-layer, cần migration/rollback/fault matrix |
| XL | Chỉ được chia nhỏ tiếp trước implementation |

Không work package nào được bắt đầu ở size `XL`. Phải tách thành slice có thể merge/revert độc lập.

---

## 10. Work package chi tiết

## R0 — Baseline và contract

### XP-000 — Product baseline và task inventory

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P0-program |
| Status | `DONE` |
| Size | S |
| Owner role | Product owner + maintainer |
| Depends on | Không |

**Mục tiêu:** biến nhận định UX thành baseline đo được, tránh sửa theo cảm giác.

**Các bước nhỏ nhất**

1. Liệt kê tác vụ hiện có theo persona: setup, add bot, connect, start/stop mode, B5 blocked, reconnect, config, update, export support, emergency stop.
2. Với từng tác vụ, ghi entry point, số click, số màn hình, có cần JSON/docs hay không, failure path và recovery path.
3. Quay screen capture hoặc lưu ảnh từng critical journey bằng dữ liệu giả, không chứa secret.
4. Ghi baseline time-on-task và số lỗi thao tác với tối thiểu ba vòng tự thử nội bộ.
5. Phỏng vấn hoặc quan sát tối thiểu một operator mới và một operator quen nếu có thể.
6. Chốt top 10 ma sát theo impact/frequency, không theo độ dễ code.
7. Lưu artifact baseline dưới evidence roadmap hoặc hệ thống issue, không đặt trong runtime `data/**`.

**Nghiệm thu**

- Sáu critical journeys ở mục 3 có baseline và owner.
- Mỗi P0/P1 trong tài liệu này liên kết ít nhất một journey hoặc risk.
- Không có metric thu secret, chat content hay raw inventory/NBT.

### XP-001 — Desktop critical-flow harness tối thiểu

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P0-enabler |
| Status | `DONE` |
| Size | M |
| Owner role | QA + Desktop maintainer |
| Depends on | XP-000 |

**Mục tiêu:** có safety net trước khi sửa Desktop monolith.

**Các bước nhỏ nhất**

1. Chọn Electron E2E runner tương thích CommonJS hiện tại; không chuyển module system.
2. Tạo isolated temp workspace/config và fake runtime; không kết nối Minecraft public.
3. Đóng gói fixture từ ConfigSpecs thật thay vì object mock thủ công.
4. Thêm smoke flow: launch, backend stopped, backend start fake, navigate pages, snapshot update, shutdown.
5. Thêm screenshot chỉ cho stable shells, không snapshot dynamic timestamp.
6. Thu console error, unhandled rejection và renderer crash thành test failure.
7. Tạo helper theo accessible role/label; không selector theo CSS layout ngẫu nhiên.

**Nghiệm thu**

- Chạy độc lập, deterministic, không cần network/secret.
- Có artifact khi fail: screenshot, console, main log, fixture version.
- Test chứng minh snapshot stale banner và backend failure banner render được.

Evidence thực thi: `tests/e2e/desktop/desktop-critical-flow.test.js`; Electron E2E thực tế đã PASS 1/1 trên Windows operator workspace.

### XP-002 — Canonical error, incident và action vocabulary

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P0-enabler |
| Status | `DONE` |
| Size | M |
| Owner role | Runtime maintainer + product |
| Depends on | XP-000 |

**Mục tiêu:** ngừng parse text và ngừng để mỗi mode tự định nghĩa ngôn ngữ lỗi.

**Các bước nhỏ nhất**

1. Inventory error code hiện có theo nhóm `CONNECTION`, `COMMAND`, `GUI`, `INVENTORY`, `MOVEMENT`, `CRAFTING`, `STORAGE`, `SERVER`, `CONFIG`, `TIMEOUT`, `VERIFICATION`.
2. Đánh dấu code trùng nghĩa, code thiếu và nơi đang parse message text.
3. Chốt severity, retry class và operator state mapping.
4. Chốt `allowedActions` catalog: use-case ID, required permission, generation guard, idempotency key, confirmation level.
5. Thêm schema/validator cho error envelope và incident projection.
6. Viết compatibility adapter cho error cũ; không sửa toàn repo trong một commit.
7. Thêm localized remediation catalog tách khỏi source exception message.

**Nghiệm thu**

- Mọi P0/P1 error có code ổn định, severity, retry class, safe-to-retry và operator action.
- Unknown error vẫn fail-safe và có correlation ID.
- Không action nào chứa raw slash command/callback tùy ý.

Evidence: `docs/architecture-roadmap/evidence/XP-002_ERROR_INCIDENT_VOCABULARY.md` và `architecture/error-vocabulary/current.json`.

### XP-003 — SLO và privacy measurement contract

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1-program |
| Status | `DONE` |
| Size | S |
| Owner role | Product + observability maintainer |
| Depends on | XP-000, XP-002 |

**Các bước nhỏ nhất**

1. Chọn metric tối thiểu: mode start success, B5 batch outcome, blocker dwell, retry count, reconnect outcome, incident MTTA/MTTR, operation queue age, UI render duration.
2. Định nghĩa cardinality budget; không dùng username, message, raw item name hoặc stack trace làm label.
3. Chọn local-only mặc định; remote telemetry phải opt-in và có privacy disclosure riêng.
4. Version metric schema.
5. Định nghĩa retention và export policy.
6. Thêm dashboard nội bộ/release evidence, chưa cần hệ thống telemetry ngoài.

**Nghiệm thu**

- Mỗi SLO mục 2.3 có nguồn đo hoặc được đánh dấu `NOT_MEASURABLE_YET`.
- Không có secret/PII trong metric dimensions.

---

## R1 — Recovery closure

### XP-010 — Runtime failure artifact repository

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P0 |
| Status | `DONE` |
| Size | M |
| Owner role | Diagnostics maintainer |
| Depends on | XP-001, XP-002 |

**Mục tiêu:** sửa triệt để mismatch Diagnostics và tạo một owner cho layout.

**Các bước nhỏ nhất**

1. Viết contract artifact ID và metadata trả về cho UI.
2. Tạo repository đọc config `app.diagnostics.runtimeFailures`.
3. Chuyển `RuntimeFailureRecorder` dùng repository/layout constants chung nếu không tạo dependency ngược.
4. Implement list bounded theo bot, newest first, với limit và file-size guard.
5. Implement read theo opaque ID; canonicalize/containment check trước I/O.
6. Reject symlink, traversal, absolute path, unknown suffix và file quá lớn.
7. Parse `last-error.json` fail-soft; bounded tail `errors.jsonl`; corrupt entry tạo diagnostic warning.
8. Chuyển `DesktopController.diagnostics/readDiagnostic` sang repository.
9. Sửa Desktop tests dùng real config fixture và actual nested directory layout.
10. Thêm retention/concurrent-write tests; reader không được đọc partial temp file.

**Verification bắt buộc khi implementation**

- `node --check` file sửa.
- Unit repository.
- Desktop diagnostics integration.
- Traversal/symlink/large-file/corruption fault tests.
- `npm.cmd run validate` nếu thêm catalog/config contract.

**Rollback**

- Giữ adapter API cũ trong một release nếu renderer đang phụ thuộc filename.
- Feature flag chỉ được dùng để quay lại reader cũ trong dev, không để production silently hide errors.

### XP-011 — Support Bundle convergence và privacy preview

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1 |
| Status | `DONE` |
| Size | M |
| Owner role | Diagnostics + Desktop maintainer |
| Depends on | XP-010, XP-003 |

**Các bước nhỏ nhất**

1. Định nghĩa bundle schema version và manifest entry schema.
2. Đưa Desktop export qua `SupportBundleBuilder` thay vì tự ghép payload.
3. Inject repository adapters cho runtime failure, B5 replay, log tail và platform snapshot.
4. Đặt per-entry/total size budget, timeout và cancellation.
5. Redact theo field-aware policy trước serialize; chạy final string scanner như lớp phòng thủ cuối.
6. Pseudonymize bot username/profile ID mặc định; giữ mapping chỉ khi operator chủ động chọn.
7. UI preview category, estimated size, PII level và warning.
8. Artifact thiếu/corrupt được ghi warning trong manifest, không abort toàn bundle.
9. Hash từng entry và toàn manifest.
10. Thêm reader/validator CLI để maintainer kiểm tra bundle offline.

**Nghiệm thu**

- Desktop và CLI tạo cùng schema.
- Bundle không chứa `.env`, secret store, runtime client/window/packet hoặc full unbounded log.
- Test secret canary, username pseudonymization, large artifact, corrupt JSON, cancellation và deterministic manifest.

### XP-012 — Fleet emergency stop transaction

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P0 |
| Status | `DONE` |
| Size | M |
| Owner role | Fleet/runtime maintainer |
| Depends on | XP-002 |

**Các bước nhỏ nhất**

1. Định nghĩa result schema từng bot và global outcome `SUCCESS/PARTIAL/TIMEOUT/FAILED`.
2. Snapshot bot IDs/generations trước action.
3. Revoke durable desired mode/connection intent toàn fleet bằng idempotency key.
4. Cancel mode/operations qua owner hiện hữu.
5. Dispatch disconnect per bot với bounded concurrency và timeout độc lập.
6. Dùng all-settled để thu mọi kết quả.
7. Reconcile late attempts/clients và verify terminal state.
8. Publish incident nếu partial/timeout.
9. Thay native confirm bằng destructive in-app dialog có summary số bot.
10. UI render kết quả từng bot và cho retry chỉ bot chưa terminal.

**Nghiệm thu**

- Không một exception per-bot nào cắt phần còn lại.
- Double-click/retry idempotent.
- ReconnectManager không tự bật lại bot sau explicit emergency stop.
- Failure matrix gồm late spawn/generation change/backend stop race.

### XP-013 — Common mode fault policy

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P0-enabler |
| Status | `DONE` |
| Size | L, phải merge theo slice |
| Owner role | Mode platform maintainer |
| Depends on | XP-002 |

**Slice A — Contract**

1. Định nghĩa fault classes và transition matrix.
2. Định nghĩa restart window/budget/cooldown từ validated policy, không hard-code trong mode.
3. Định nghĩa `ModeFaultSnapshot` và runtime failure publishing.
4. Xác định behavior cho cancel, stale generation và expected wait để không đếm sai.

**Slice B — Platform primitive**

1. Tạo primitive quanh `TaskSupervisor` hoặc mở rộng bằng composition.
2. Circuit state bot-scoped; không mutable singleton dùng chung.
3. Reset circuit chỉ theo start/reconfigure/reconnect policy rõ ràng.
4. Cleanup timer/listener qua supervisor/subscription owner.

**Slice C — Reference adoption**

1. Chọn một mode đơn giản làm reference.
2. Chứng minh status/error/recovery parity.
3. Sau đó mới áp dụng B5; collector/fishing đi sau theo migration riêng.

**Nghiệm thu**

- Fault lặp hữu hạn; no-progress blocker không biến thành crash-loop.
- Runtime failure được publish đúng một incident episode.
- Mode stop/destroy dọn circuit timer/listener.
- Không thay đổi command/gui/inventory owner.

### XP-014 — B5 blocked recovery và finite fault lifecycle

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P0 |
| Status | `DONE` |
| Size | L, phải chia slice |
| Owner role | B5 maintainer |
| Depends on | XP-010, XP-013 |

**Slice A — Pure state contract**

1. Tách state machine cho campaign, batch, storage-protection episode và fault.
2. Ghi invariant về baseline, slice, continuation, inflow và generation vào pure transition tests.
3. Định nghĩa khi nào `WAITING_BLOCKED` được phép tạo episode mới.

**Slice B — Public retry use case**

1. Thêm method trên B5 mode service; input gồm expected bot/generation/incident/episode.
2. Route qua generic mode control/Desktop IPC đã validate.
3. Reject stale, wrong mode, already-running, duplicate idempotency key và unsafe phase.
4. Không gọi raw command/gui từ controller.

**Slice C — Fault policy adoption**

1. Thay restart budget cực lớn bằng validated finite policy.
2. Publish unexpected fault vào recorder/incident.
3. Expected storage blocker giữ `WAITING_BLOCKED`, không tiêu restart budget.
4. Recovered episode đóng incident với before/after evidence.

**Slice D — Operator surface**

1. Status summary tiếng Việt, technical detail thu gọn.
2. Action `Thử lại bảo vệ kho` chỉ hiện khi allowed.
3. Hiển thị lần thử, cooldown, bước thất bại, an toàn hiện tại và artifact link.
4. Không hiển thị trace dump ở INFO card.

**Nghiệm thu**

- Tất cả invariant B5 mục P0-03 pass.
- Có replay/fault matrix ít nhất cho: `/kho` timeout, `/nung` ambiguous, compaction no progress, partial 64 sell, reconnect sau action, stale verify, inflow mới, user retry kép.
- Không có code path sell quantity `1`.

### XP-015 — Structured boot failure và recovery banner

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1 |
| Status | `DONE` |
| Size | M |
| Owner role | Bootstrap + Desktop maintainer |
| Depends on | XP-002, XP-001 |

**Các bước nhỏ nhất**

1. Định nghĩa boot stages: environment, secret provider, config parse, schema, cross-contract, migration, application create, runtime start.
2. Map exception thành sanitized boot failure envelope.
3. Persist trong controller memory/snapshot; không ghi raw secret/value.
4. UI banner không tự biến mất.
5. Link action tới đúng config group/editor hoặc backup flow.
6. Retry backend dùng idempotency/starting guard.
7. Clear failure chỉ sau successful start hoặc explicit dismiss có audit.
8. Support bundle vẫn export được minimal boot evidence khi backend chưa start.

**Nghiệm thu**

- Test malformed JSON, schema error, missing secret, migration failure, application start throw.
- Người dùng thấy file/path hợp lệ và cách sửa mà không cần mở log.

### XP-016 — Secret store state và recovery

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1 |
| Status | `DONE` |
| Size | S |
| Owner role | Security/Desktop maintainer |
| Depends on | XP-001, XP-002 |

**Các bước nhỏ nhất**

1. Thay fallback object rỗng bằng typed result state.
2. Phân biệt provider unavailable, file corrupt, decrypt fail và not configured.
3. Thêm non-secret diagnostic event.
4. UI remediation theo state.
5. Reset/delete secret store dùng destructive confirmation và exact path ownership.
6. Sau reset, chỉ secret state đổi; profile/config/runtime data khác giữ nguyên.
7. Thêm canary tests chống accidental logging/export.

### XP-017 — Documentation behavior/version closure

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1 |
| Status | `DONE` |
| Size | M |
| Owner role | Maintainer + product writer |
| Depends on | XP-014 |

**Các bước nhỏ nhất**

1. Inventory mọi câu mô tả B5/nung/nén/sell/reserve trong root docs và UI copy.
2. Chốt canonical contract trong `SERVER_BEHAVIOR.md`.
3. Sửa `START_HERE`, `USER_GUIDE`, README và builder defaults theo canonical contract.
4. Chuyển patch history dài ra changelog/versioned release notes.
5. Thêm script kiểm version public docs với `package.json`.
6. Thêm denylist/semantic fixture cho câu lỗi thời như "B5 không nung" hoặc toggle smelting không còn hiệu lực.
7. Thêm release checklist review docs khi server behavior/config contract đổi.

**Nghiệm thu**

- Không tài liệu CURRENT nào mâu thuẫn thứ tự B5 hoặc 64-only sell.
- Docs version gate pass.
- Historical notes được ghi rõ historical, không được hiểu là current behavior.

---

## R2 — Operator experience

> **Trạng thái triển khai 2026-08-25:** `ENGINEERING_CLOSED`; bằng chứng ở [R2_OPERATOR_EXPERIENCE_CLOSURE_2026-08-25.md](evidence/R2_OPERATOR_EXPERIENCE_CLOSURE_2026-08-25.md). Card sorting với người dùng mới, assistive-technology audit độc lập và số liệu field vẫn là bằng chứng ngoài repository, không được giả lập bằng unit test.

### XP-100 — Information architecture và progressive disclosure

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1 |
| Size | M |
| Owner role | Product/UX + Desktop maintainer |
| Depends on | XP-000, XP-001 |

**Các bước nhỏ nhất**

1. Gom navigation thành `Operate`, `Build`, `Maintain`, `Advanced` như mục 7.5.
2. Giữ route alias cũ trong ít nhất một release để không phá deep link/state.
3. Dashboard mặc định chỉ hiển thị health, bot activity, incidents và primary actions.
4. Raw config, GUI inspector, trace/replay và Local AI nằm trong Advanced.
5. Thêm preference `experienceLevel` chỉ điều khiển presentation, không thay permission runtime.
6. Thử card sorting với ít nhất một operator mới và một power user.
7. Đảm bảo mọi function hiện có vẫn reachable; thêm navigation contract test.

**Nghiệm thu**

- Người mới xác định được `Thêm bot`, `Kết nối`, `Chạy B5`, `Xử lý lỗi` mà không mở docs.
- Không chức năng nào biến mất sau regroup.
- Advanced state được nhớ per desktop preference, không nằm trong gameplay config.

### XP-101 — Design system và accessibility foundation

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1 |
| Size | M |
| Owner role | Desktop/UX maintainer |
| Depends on | XP-001 |

**Các bước nhỏ nhất**

1. Inventory màu, spacing, typography, radius, elevation và status icon hiện có.
2. Chuyển thành design tokens; không đổi toàn layout trong cùng commit.
3. Đặt body text mặc định tối thiểu phù hợp desktop, target `>=14px`; metadata nhỏ vẫn phải đọc được khi scale 125–200%.
4. Thêm theme contract: dark hiện tại, high-contrast; light chỉ làm nếu có nhu cầu.
5. Xây component chuẩn cho button, field, select, dialog, toast, banner, status chip, table và empty state.
6. Thay native confirm/prompt trong critical journeys bằng accessible in-app dialog.
7. Kiểm heading hierarchy, label/description/error association, keyboard order, escape behavior, focus restoration và live region.
8. Giữ `prefers-reduced-motion`; không dùng màu là tín hiệu duy nhất.

**Nghiệm thu**

- Critical journeys dùng keyboard hoàn toàn.
- Focus không bị mất sau snapshot re-render/dialog close.
- Contrast và zoom/text scaling đạt target WCAG 2.2 AA.
- Không còn text vận hành chính ở 9–11px.

### XP-102 — Incident Center và persistent notification model

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1 |
| Size | L, chia data/UI/action slice |
| Owner role | Diagnostics + Desktop maintainer |
| Depends on | XP-010, XP-002, XP-011 |

**Slice A — Incident model**

1. Correlate cùng bot/mode/resource/blocker signature trong bounded episode.
2. Lưu lightweight incident index; artifact detail vẫn ở repository riêng.
3. State: `OPEN`, `RECOVERING`, `NEEDS_ACTION`, `RESOLVED`, `ACKNOWLEDGED`.
4. Retention/version/migration rõ; không lưu raw client object.

**Slice B — Presentation**

1. List theo severity, bot, thời gian, trạng thái.
2. Detail trả lời: chuyện gì, an toàn không, đã thử gì, bước tiếp theo, evidence.
3. Toast chỉ là tín hiệu ngắn; incident quan trọng tồn tại tới khi resolve/acknowledge.
4. Technical stack/meta nằm trong expandable section.

**Slice C — Actions**

1. Render chỉ `allowedActions` từ validated catalog.
2. Mỗi action có generation/idempotency/permission/confirmation guard.
3. Result của action nối vào cùng incident timeline.

**Nghiệm thu**

- Một transient retry không tạo 20 incident.
- Một persistent blocker không bị toast biến mất.
- Không parse exception message để quyết định action.

### XP-103 — First-run wizard và readiness checklist

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1 |
| Size | L, chia theo step |
| Owner role | Product + Desktop/config maintainer |
| Depends on | XP-015, XP-016, XP-100, XP-101 |

**Các bước nhỏ nhất**

1. Tạo readiness service read-only: runtime version, writable config root, valid config, secret provider, profile, bot enabled state, backend state.
2. Step 1: chọn mục tiêu sử dụng/preset.
3. Step 2: tạo/chọn server profile và bot profile.
4. Step 3: lưu secret qua OS store.
5. Step 4: validate và hiển thị fix action.
6. Step 5: connect có xác nhận; quan sát spawn/readiness.
7. Step 6: chọn mode và giải thích policy tóm tắt.
8. Cho skip wizard nhưng Dashboard vẫn có checklist.
9. Resume wizard sau app restart mà không lưu secret plaintext hoặc transient client state.
10. Analytics local chỉ lưu completion state/duration, không lưu credential.

**Nghiệm thu**

- Người mới hoàn tất J1 không mở raw config.
- Mọi failure step quay lại được và không mất dữ liệu đã validate.
- Không tự connect server chỉ vì chạy readiness check.

### XP-104 — Operator health projection

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1 |
| Size | M |
| Owner role | Runtime platform + Desktop maintainer |
| Depends on | XP-002, XP-013 |

**Các bước nhỏ nhất**

1. Định nghĩa probe taxonomy và aggregation rule.
2. Tạo async sampler với timeout/cancellation và cached result age.
3. Bổ sung probe tối thiểu: reconnect, mode progress, operation queue age, GUI session age, failure recorder, persistence, B5 blocker dwell.
4. Phân biệt `not applicable`, `unknown`, `healthy`, `degraded`, `unhealthy`.
5. Optional capability không có/không chạy không làm global health fail.
6. Tạo compact projection cho Dashboard; detail on-demand.
7. Mỗi unhealthy probe có evidence ref/remediation hoặc ghi rõ chưa có action.

**Nghiệm thu**

- Health sampling không làm snapshot loop block.
- Probe timeout không crash backend.
- UI phân biệt backend offline, stale UI, bot disconnected có chủ đích và bot reconnect failure.

### XP-105 — B5 operator journey

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P0-product |
| Size | M |
| Owner role | B5 + Desktop maintainer |
| Depends on | XP-014, XP-102, XP-104 |

**Các bước nhỏ nhất**

1. Định nghĩa B5 presentation DTO, không gửi full internal service object.
2. Hiển thị campaign/batch và stage timeline theo invariant thật.
3. Hiển thị reserve coverage, immutable sell baseline, remaining sell stacks và retained remainder bằng đơn vị người dùng hiểu.
4. Tách `Đang chạy`, `Đang tự thử lại`, `Đang chờ điều kiện`, `Cần xử lý`.
5. Hiển thị last verified postcondition, không chỉ last action sent.
6. Thêm action từ XP-014 và deep link tới incident/replay.
7. Advanced expander chứa operation ID, generation, attempts, backoff.
8. Nếu ETA không đủ dữ liệu, hiển thị `Chưa đủ dữ liệu`, không đoán.

**Nghiệm thu**

- Operator trả lời được trong 5 giây: bot đang ở bước nào, có an toàn không, có tự chạy tiếp không, cần làm gì.
- Sell UI không bao giờ gợi ý quantity khác 64 trong current contract.

### XP-106 — Safe configuration workspace

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1 |
| Size | L, chia editor/transaction/recovery |
| Owner role | Config + Desktop maintainer |
| Depends on | XP-001, XP-015 |

**Các bước nhỏ nhất**

1. Track loaded revision/digest và dirty state.
2. Field editor hiển thị unit, range, default, recommended preset và dependency.
3. Basic view chỉ có policy-level fields; raw JSON ở Advanced.
4. Validate local khi gõ và full contract trước Save.
5. Trước Save hiển thị semantic diff và impact: live reconfigure/backend restart/reconnect/next session.
6. Save tiếp tục qua validator + backup + atomic write; renderer không ghi file trực tiếp.
7. Detect external modification bằng revision conflict; không overwrite im lặng.
8. Có reset field/section/default và undo về bản vừa lưu.
9. Migration preview khi schema version đổi.
10. Error focus tới field đầu tiên và giữ mọi edit hợp lệ chưa lưu.

**Nghiệm thu**

- Không thể lưu config invalid hoặc stale revision mà không resolve conflict.
- Người dùng biết chính xác thay đổi có hiệu lực khi nào.
- Secret không xuất hiện trong generic config editor.

### XP-107 — Help, search và ngôn ngữ

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P2 |
| Size | M |
| Owner role | Product writer + Desktop maintainer |
| Depends on | XP-100, XP-002 |

**Các bước nhỏ nhất**

1. Tách UI string thành message catalog; giữ fallback rõ khi thiếu key.
2. Chuẩn hóa thuật ngữ Việt cho mode, batch, blocker, retry, reserve, incident.
3. Technical identifier giữ nguyên trong code/detail, không dùng làm primary label.
4. Thêm contextual help cho form/module/status.
5. Thêm global search/command palette chỉ gọi allowlisted route/action.
6. Search kết quả hiển thị permission/state requirement.
7. Link docs dùng version phù hợp app.

### XP-108 — Backup/restore catalog

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1 |
| Size | M |
| Owner role | Config/update maintainer |
| Depends on | XP-106 |

**Các bước nhỏ nhất**

1. Chuẩn hóa backup manifest: reason, app/schema version, timestamp, hashes, file allowlist.
2. Lập catalog bounded; không scan không giới hạn mỗi snapshot.
3. UI list backup, source action, age, compatibility và integrity state.
4. Preview diff trước restore.
5. Selective restore chỉ khi contract chứng minh an toàn; mặc định transaction toàn bộ nhóm liên quan.
6. Verify post-restore rồi mới start backend lại.
7. Retention policy theo count/age/size; không xóa backup đang được transaction sở hữu.
8. Restore failure rollback về pre-restore snapshot.

---

## R3 — Architecture decomposition

> **Trạng thái triển khai 2026-08-25:** `STRANGLER_BOUNDARIES_CLOSED`; bằng chứng ở [R3_ARCHITECTURE_DECOMPOSITION_CLOSURE_2026-08-25.md](evidence/R3_ARCHITECTURE_DECOMPOSITION_CLOSURE_2026-08-25.md). Follow-up first-start đã tách vật lý Desktop runtime bootstrap, environment/provenance, profile CRUD, mode config và fleet control; ceiling `DesktopController` giảm 1128 → 986. Các façade tương thích còn lại chưa bị xóa; static gate khóa không cho debt tăng và ghi rõ owner/điều kiện hết hạn.

### XP-200 — Renderer decomposition theo page và state boundary

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1-maintainability |
| Size | L, bắt buộc chia page |
| Owner role | Desktop maintainer |
| Depends on | XP-001, XP-101, XP-100 |

**Target responsibility**

```text
renderer/
  core/        api-client, store, router, error-presenter, i18n
  components/  dialog, toast, status, form, table, empty-state
  pages/       overview, bots, modes, incidents, builder, maintain, advanced
  features/    b5, config, update, diagnostics
```

**Các bước nhỏ nhất**

1. Freeze public preload API used by renderer bằng contract test.
2. Extract pure formatters/escaping trước.
3. Extract state store và selector; snapshot update không trực tiếp mutate DOM nhiều nơi.
4. Extract router/navigation.
5. Di chuyển từng page, mỗi commit giữ screenshot/interaction parity.
6. Thay full `innerHTML` rebuild bằng keyed update cho list/card quan trọng.
7. Sanitize/escape mọi server-derived text; không nới CSP.
8. Sau mỗi page, xóa dead handler trong monolith.
9. Chỉ xóa file cũ khi route parity matrix hoàn tất.

**Nghiệm thu**

- Không page module sở hữu IPC raw ngoài api client.
- Test page được với fixture snapshot riêng.
- Focus/scroll/expanded state không mất không cần thiết sau snapshot.
- Không tăng bundle/runtime dependency nếu chưa có lý do.

### XP-201 — Versioned Desktop use-case API và controller split

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1-maintainability |
| Size | L |
| Owner role | Desktop/application maintainer |
| Depends on | XP-002, XP-010, XP-012 |

**Target responsibility**

- Backend lifecycle controller.
- Fleet/bot use cases.
- Mode control use cases.
- Config/backup use cases.
- Diagnostics/support use cases.
- Update use cases.
- Local AI use cases.

**Các bước nhỏ nhất**

1. Catalog toàn bộ preload/IPC method, input/output, permission và owner.
2. Group theo domain; đánh dấu duplicate/raw convenience method.
3. Tạo versioned DTO schema và common result envelope.
4. Main process `safeHandle` chỉ validate/dispatch/translate error.
5. Extract một domain ít rủi ro trước, giữ façade `DesktopController` tương thích.
6. Extract fleet/emergency và diagnostics sau khi tests tương ứng đã có.
7. Deprecate method cũ có telemetry local/warning dev; xóa ở major boundary hoặc migration rõ.
8. Thêm exact sender validation cho mọi channel mới.

**Nghiệm thu**

- Không controller mới gọi raw Mineflayer side effect.
- IPC input fail-closed, output versioned, error không leak stack/secret sang renderer mặc định.
- Preload surface không tiếp tục tăng tuyến tính cho mỗi field nhỏ.

### XP-202 — Compact operator projection và snapshot performance

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1-scale |
| Size | M |
| Owner role | Runtime platform + Desktop maintainer |
| Depends on | XP-104, XP-200, XP-201 |

**Các bước nhỏ nhất**

1. Đo kích thước/serialize/render time snapshot hiện tại ở 1/8/16/32/64 fake bots.
2. Định nghĩa `OperatorSnapshotV1` chỉ gồm fleet summary, bot summary, open incidents và current task.
3. Detail mode/operation/trace tải on-demand theo ID và revision.
4. Thêm snapshot revision/digest; renderer bỏ update trùng.
5. Thêm backpressure/coalescing để renderer chậm không tạo queue vô hạn.
6. Version API và giữ compatibility adapter một release.
7. Benchmark visible/hidden window intervals.

**Nghiệm thu**

- Đạt SLO render ở fleet size được công bố.
- Không bỏ event critical; summary có lastUpdated/stale semantics.
- Synthetic scale report ghi rõ vẫn không đại diện server live.

### XP-203 — B5CraftModeService decomposition

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P0-maintainability |
| Size | L, nhiều slice |
| Owner role | B5 maintainer |
| Depends on | XP-014 và replay parity baseline |

**Target components**

- `B5CampaignSession`: identity/lifecycle immutable context.
- `B5BatchCoordinator`: phase transitions, không side effect trực tiếp.
- `StorageProtectionEpisode`: bounded blocker/backoff state.
- `B5FaultPolicyAdapter`: mapping supervisor/fault/incident.
- `B5StatusProjection`: operator/developer DTO.
- `B5CraftModeService`: façade/lifecycle owner.

**Các bước nhỏ nhất**

1. Chụp characterization tests/replay cho các transition hiện tại.
2. Extract pure status projection trước.
3. Extract episode state/policy không I/O.
4. Extract campaign/batch identity and transition reducer.
5. Giữ side effect call order trong façade/coordinator bằng contract test.
6. Inject clock/random/backoff policy; không thêm sleep rải rác.
7. So sánh decision/replay digest trước/sau mỗi slice.
8. Chỉ xóa private legacy state sau parity evidence.

**Nghiệm thu**

- Không thay behavior B5 ngoài fault/retry contract đã duyệt.
- Planner vẫn pure; generation guard và verification không suy yếu.
- Mỗi component có một reason-to-change rõ.

### XP-204 — B5AutomationService flow decomposition

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1-maintainability |
| Size | L |
| Owner role | Crafting/B5 maintainer |
| Depends on | XP-203 |

**Các bước nhỏ nhất**

1. Inventory public methods, shared mutable fields và operation ownership.
2. Tách planning/input normalization khỏi execution.
3. Tách preflight, reserve work, craft batch, deposit, compaction và postcondition verify thành flow object đã có owner.
4. Không tạo executor mới nếu capability đã tồn tại.
5. Mỗi flow nhận immutable input + operation context; trả structured result.
6. Reconciliation barrier nằm ở boundary chung, không duplicate mỗi flow.
7. Characterization/fault tests trước khi di chuyển call order.
8. Xóa helper duplicate sau architecture reachability validation.

### XP-205 — RuntimeConfigMigrator decomposition

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1-maintainability |
| Size | L |
| Owner role | Config/update maintainer |
| Depends on | XP-108 |

**Target components**

- discovery/current-version reader;
- pure migration planner;
- transaction/journal owner;
- filesystem applier;
- post-apply verifier;
- rollback/recovery coordinator.

**Các bước nhỏ nhất**

1. Lập state machine migration và crash points.
2. Extract pure plan generation với golden fixtures.
3. Chuẩn hóa journal schema/version và ownership marker.
4. Tách file applier; exact target allowlist và symlink containment.
5. Tách verifier; apply success chỉ sau contract validation.
6. Fault inject tại before backup, after backup, mid-apply, before verify, after verify-before-commit.
7. Chứng minh startup recovery idempotent cho mỗi journal state.
8. Giữ public API qua façade cho tới khi update/desktop paths migrate hết.

### XP-206 — Bootstrap và Discord decomposition

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P2 |
| Size | M |
| Owner role | Bootstrap/Discord maintainer |
| Depends on | XP-201 |

**Các bước nhỏ nhất**

1. Chia `registerBotServices` thành installer theo capability nhưng composition root vẫn wire dependency.
2. Mỗi installer khai báo required config/capability và output registration.
3. Thêm bootstrap reachability test chống missing/duplicate service.
4. Tách Discord presentation, interaction routing, state projection và message scheduling.
5. Discord chỉ gọi control-plane use cases, không chứa gameplay workflow.
6. Xóa/encapsulate `remoteOnly` hoặc surface legacy sau khi usage inventory xác nhận.
7. Giữ rate-limit, permission và generation semantics.

### XP-207 — Incremental static quality và legacy strangler

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1-quality |
| Size | M, triển khai dần |
| Owner role | Architecture maintainer |
| Depends on | XP-001 |

**Các bước nhỏ nhất**

1. Chọn formatter/linter CommonJS-compatible; baseline existing violations, không format toàn repo cùng feature commit.
2. Gate chỉ file mới/sửa trước; giảm baseline theo module.
3. Bật rules cho unused vars, shadowing, promise misuse, unsafe catch, complexity và max line length hợp lý.
4. Thêm JSDoc typedef cho public DTO/contracts và `checkJs` theo folder pilot.
5. Không chuyển TypeScript/ESM toàn repo.
6. Với collector/fishing legacy, lập parity matrix và strangler seam.
7. Di chuyển một decision/recovery policy mỗi lần; replay/behavior test trước xóa path cũ.
8. Không dùng line count làm acceptance duy nhất; đo responsibility/coupling/coverage.

**Nghiệm thu**

- Không new/changed source bỏ qua lint/checkJs gate.
- Baseline debt chỉ giảm hoặc giữ nguyên có waiver; không tăng âm thầm.
- Legacy migration không làm B5 pure dùng collector làm template.

---

## R4 — Extensibility và product breadth

> **Trạng thái triển khai 2026-08-25:** `ENGINEERING_CLOSED`; XP-305 được đóng `NOT_OPENED_NO_FIELD_DEMAND`, không có tuyên bố multi-server hoặc workflow production thứ ba. Xem [R4_EXTENSIBILITY_CLOSURE_2026-08-25.md](evidence/R4_EXTENSIBILITY_CLOSURE_2026-08-25.md).

### XP-300 — Module presentation schema

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1 |
| Size | M |
| Owner role | Composable mode + Desktop maintainer |
| Depends on | XP-002, XP-201 |

**Mục tiêu:** renderer tạo form an toàn từ catalog thay vì hiểu thủ công từng module hoặc yêu cầu raw JSON.

**Contract tối thiểu cho mỗi module**

- stable `type` và schema version;
- label/description/help key;
- category và risk level;
- field definitions: type, unit, enum, range, default, required, sensitive;
- capability dependencies;
- validation/cross-field rules;
- side-effect class và confirmation requirement;
- preview/summary formatter;
- upgrade/migration contract;
- executor availability/reachability.

**Các bước nhỏ nhất**

1. Inventory 17 module hiện có và field thực tế.
2. Chọn 3 module reference: pure `wait/log`, command capability và `storage-protect` phức tạp.
3. Thêm schema validator fail-closed.
4. Tạo presentation descriptor tách khỏi executor implementation.
5. Catalog chỉ publish module nếu schema, capability dependency và executor reachability hợp lệ.
6. Custom file lỗi vẫn visible-for-repair và skip-at-runtime, không làm backend fail boot.
7. Xóa field stale `allowSmelting` bằng migration/version rõ.
8. Thêm contract tests cho mọi module catalog entry.

**Nghiệm thu**

- Không module được hiển thị nếu thiếu validator/executor/capability contract.
- Renderer không cần `if(type===...)` cho field cơ bản.
- Module side effect vẫn chỉ gọi capability trong `ModeContext`.

### XP-301 — Typed Mode Builder editor

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1 |
| Size | L, chia theo module category |
| Owner role | Desktop + composable mode maintainer |
| Depends on | XP-300, XP-101, XP-106 |

**Các bước nhỏ nhất**

1. Thay JSON textarea mặc định bằng typed form từ presentation schema.
2. Giữ raw JSON chỉ ở Advanced với diff/validation và warning.
3. Thêm step palette có search/category/capability badge/risk badge.
4. Drag/reorder hoặc move controls phải keyboard-accessible.
5. Inline validation trước Save; lỗi focus đúng field/step.
6. Step summary dùng formatter, không dump JSON.
7. Conditions editor hỗ trợ typed predicates catalog; không arbitrary expression/eval.
8. Repeat editor có bounded max/count/time; validator chống loop vô hạn.
9. Slash command chỉ qua `SlashCommandService`, bắt đầu `/`, deny credential command.
10. Save qua validator/contract/backup; renderer không ghi JSON trực tiếp.

**Nghiệm thu**

- Tạo workflow cơ bản không cần gõ JSON.
- Invalid module/condition không được start.
- Không thêm `eval`, `new Function`, arbitrary JavaScript hoặc raw bot access.

### XP-302 — Full lifecycle, dry-run và versioned custom mode

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1 |
| Size | L |
| Owner role | Composable mode platform maintainer |
| Depends on | XP-301, XP-013 |

**Các bước nhỏ nhất**

1. Expose editor cho `start`, `loop` và `stop` flow.
2. Chốt lifecycle/cancellation semantics từng phase.
3. Thêm schema version/revision/digest cho custom mode file.
4. Hot reload chỉ khi mode không active hoặc qua guarded transition; nếu chưa an toàn, UI nói rõ restart requirement.
5. Thêm static dry-run: dependency, resource claim, loop bound, unreachable step và forbidden action.
6. Thêm simulation bằng fake capabilities; không kết nối server thật.
7. Preview estimated side effects và requested resources trước enable.
8. Import/export package có manifest/hash, không chứa secret/arbitrary files.
9. Migration giữ bản backup và visible-for-repair nếu lỗi.

**Nghiệm thu**

- Stop flow chạy/cancel/cleanup đúng khi disable, destroy, reconnect và backend stop.
- Dry-run phân biệt static pass với live success; không quảng bá sai.
- Hot reload không tạo hai mode owner hoặc listener/timer mồ côi.

### XP-303 — Safe template gallery

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P2 |
| Size | M |
| Owner role | Product + QA + mode maintainer |
| Depends on | XP-302 |

**Các bước nhỏ nhất**

1. Chọn 3–5 workflow có nhu cầu thật, không tạo template để tăng số lượng.
2. Mỗi template ghi server profile compatibility, required capabilities, resource claims, risk và support status.
3. Template phải pass schema, dry-run, lifecycle/fault tests và architecture reachability.
4. Cài template bằng copy/versioned instance; update template không overwrite custom edits.
5. UI preview flow và diff trước install/update.
6. Community template nếu có phải unsigned/untrusted mặc định và không được auto-enable.

### XP-304 — Schema-driven mode presentation

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1-extensibility |
| Size | M |
| Owner role | Mode platform + Desktop maintainer |
| Depends on | XP-201, XP-104, XP-300 |

**Các bước nhỏ nhất**

1. Mở rộng ModeCatalog metadata cho icon/label/summary/config sections/status fields/help/capability requirements.
2. Desktop render generic mode card từ descriptor + status contract.
3. B5/fishing special view trở thành optional extension, không phải điều kiện để mode usable.
4. Config sections link tới schema-driven editor.
5. Unsupported capability hiển thị readiness reason trước Start.
6. Thêm conformance test: mode mới bind/start/status/config/help mà không sửa FleetControl generic.

**Nghiệm thu**

- Một fake mode mới xuất hiện và thao tác được bằng metadata/contract, không sửa hard-coded renderer branch cơ bản.
- Specialized presentation không bypass generic lifecycle/control.

### XP-305 — Product breadth decision gate

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P2/conditional |
| Size | Gate trước, implementation tách riêng |
| Owner role | Product owner + architecture maintainer |
| Depends on | XP-304, XP-303, field demand |

**Quy trình quyết định workflow/profile mới**

1. Thu bằng chứng nhu cầu: tần suất, người dùng, giá trị, server support burden.
2. Xác định capability nào generic, behavior nào server-specific.
3. Cập nhật `SERVER_BEHAVIOR.md` status: observed/verified/assumed.
4. Prototype bằng composable mode nếu đủ; chỉ tạo mode code riêng khi state machine/lifecycle yêu cầu.
5. Không dùng collector-b5 legacy làm template.
6. Thêm profile contract, fake/fixture, integration và operator docs.
7. Công bố support matrix: experimental/beta/stable, server version, limitations.

**Điều kiện để gọi sản phẩm đa năng hơn**

- Ít nhất một workflow production không phải B5/fishing.
- Nếu claim multi-server: ít nhất hai server profile production được duy trì, không tính fake profile.
- Incident, update, docs và support bundle bao phủ cả capability mới.

---

## R5 — Quality, evidence và release hardening

> **Trạng thái triển khai 2026-08-25:** `OFFLINE_ENGINEERING_ACCEPTANCE`; field SLO vẫn `NOT_MEASURABLE_NO_OPT_IN_EPISODES`. Không dùng trạng thái này để tuyên bố production-stable. Xem [R5_QUALITY_RELEASE_ACCEPTANCE_2026-08-25.md](evidence/R5_QUALITY_RELEASE_ACCEPTANCE_2026-08-25.md).

### XP-400 — Static quality gates

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1 |
| Size | M |
| Owner role | Architecture/CI maintainer |
| Depends on | XP-207 |

**Các bước nhỏ nhất**

1. Thêm formatter check cho changed files.
2. Thêm linter theo incremental baseline.
3. Thêm `checkJs`/JSDoc contract cho shared DTO/error/config/mode APIs.
4. Thêm complexity/report gate; waiver phải có owner, lý do và expiry.
5. Cấm dòng minified/multiple class methods trên một dòng trong source maintained.
6. Mở rộng architecture validator cho IPC contract, mode descriptor, module reachability và docs version.
7. Không để generated/vendor artifact lọt vào source gate.

### XP-401 — Real-contract fixtures và test pyramid repair

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P0-quality |
| Size | M |
| Owner role | QA + config/runtime maintainer |
| Depends on | XP-010, XP-002 |

**Các bước nhỏ nhất**

1. Tạo fixture factory từ actual ConfigSpecs/schema defaults.
2. Tạo runtime artifact layout fixture từ recorder/repository constants.
3. Loại bespoke mock shape sai ở Desktop/support/update tests.
4. Thêm contract test writer-reader-controller-renderer cho diagnostics.
5. Thêm consumer-driven contract cho preload/IPC DTO.
6. Mutation-test hoặc targeted negative cases cho validator/fault policy pure logic.
7. Theo dõi branch/decision coverage ở module rủi ro, không chỉ line coverage toàn repo.

### XP-402 — Desktop E2E, accessibility và visual regression

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1 |
| Size | L |
| Owner role | QA/Desktop maintainer |
| Depends on | XP-001, XP-101, XP-103, XP-105, XP-106 |

**Critical E2E matrix**

1. First run success và từng failure step.
2. Add/edit/delete bot với confirmation và conflict.
3. Backend start/stop/restart failure.
4. Start/stop B5, transient retry, blocked, manual guarded retry, reconnect.
5. Incident view/action/export support.
6. Emergency stop all success/partial/timeout.
7. Config dirty/diff/validation/conflict/restore.
8. Update check/download/apply guard/rollback bằng fixture local.
9. Renderer crash/reload và stale snapshot.
10. Keyboard-only, focus, high contrast, 200% zoom và reduced motion.

**Nghiệm thu**

- E2E không dùng live Minecraft/public server/real secret.
- Visual baselines chỉ cho stable components; dynamic data normalized.
- Accessibility violations critical/high làm release fail.

### XP-403 — Fault simulation matrix từ nhẹ đến nặng

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P0-reliability |
| Status | `OFFLINE_MATRIX_COMPLETE`; live-server and field episodes remain external evidence |
| Size | L |
| Owner role | Runtime/QA maintainer |
| Depends on | XP-012, XP-013, XP-014, XP-015, XP-205 |

| Fault class | Injection tối thiểu | Kỳ vọng |
| --- | --- | --- |
| Command | timeout, negative response, response ambiguous | bounded retry/verify; không coi send là success |
| GUI | wrong identity, stale window, click resolves no change | abort/reconcile; không click tiếp mù |
| Inventory | no progress, partial move, inflow concurrent | immutable input/baseline; verify/replan đúng boundary |
| Connection | generation change ở từng side-effect point | stale result discard; new owner không bị old cleanup |
| Mode | loop throw lặp, cancel race, double start | finite circuit; one owner; cleanup đầy đủ |
| Storage/B5 | `/kho` timeout, smelt ambiguous, partial 64 sell | WAITING_BLOCKED hoặc verified continuation, không sell 1 |
| Persistence | partial write, corrupt JSON, full disk/permission | atomic rollback/failure artifact/recovery action |
| Update | corrupt package, hash mismatch, crash mid-apply | reject/rollback/startup recovery |
| Desktop | renderer gone, IPC invalid, snapshot flood | safe reload/reject/coalesce |
| Fleet | one bot throw/timeout/late connect in emergency | all bots attempted, partial result explicit |

**Nghiệm thu**

- Mỗi fault có expected state, allowed actions, artifact và cleanup assertion.
- Không test nào tăng sleep để "ổn định" nếu có deterministic clock/event seam.

### XP-404 — Performance and resource benchmark

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1 |
| Size | M |
| Owner role | Performance/runtime maintainer |
| Depends on | XP-202, XP-403 |

**Các bước nhỏ nhất**

1. Xác định supported fleet target hiện tại thay vì mặc định 64 live bots.
2. Benchmark core primitives và Desktop projection ở 1/8/16/32/64 fake runtimes.
3. Đo event-loop lag, heap/RSS, handles/listeners/timers, operation latency, snapshot size/serialize/render, log throughput.
4. Thêm sustained soak với reconnect/mode status churn bằng fakes.
5. Thêm bounded Mineflayer integration lab nếu có môi trường riêng, không phụ thuộc server public mặc định.
6. Ghi exclusions và hardware/runtime version.
7. So sánh p50/p95/p99 với SLO, không chỉ average.

### XP-405 — Crash-safe release, canary và rollback evidence

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1 |
| Size | M |
| Owner role | Release/update maintainer |
| Depends on | XP-011, XP-015, XP-205, XP-403 |

**Các bước nhỏ nhất**

1. Mỗi delivery có manifest, base/target version, hashes, dependency-runtime compatibility và migration plan.
2. Canary trên fixture/operator lab trước broad release.
3. Backup target trước replace/delete; verify ownership/containment.
4. Post-update smoke: app launch, config validate, backend fake start, snapshot, diagnostics, rollback availability.
5. Nếu smoke fail, rollback tự động và lưu bounded incident artifact.
6. Release evidence ghi chính xác command, exit code, artifact hash và limitation.
7. Không bundle `.env`, runtime data/log/backups/secrets/custom mode user files.

### XP-406 — Field SLO và support feedback loop

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | P1-product maturity |
| Status | `NOT_MEASURABLE_NO_OPT_IN_EPISODES`; contract and local aggregation are ready, no field history is fabricated |
| Size | M |
| Owner role | Product + operations |
| Depends on | XP-003, XP-102, XP-404 |

**Các bước nhỏ nhất**

1. Thu local aggregate theo privacy contract hoặc support bundle opt-in.
2. Review hàng release: batch success, blocker dwell, crash/restart, MTTR, emergency result, update rollback.
3. Phân loại incident theo root cause owner, không theo raw message.
4. Chọn top incident driver cho release tiếp theo.
5. Archive/resolved code vẫn giữ regression fixture.
6. Chỉ nâng support status beta/stable khi SLO đạt qua số episode tối thiểu được chốt trước.

### XP-407 — Final professional acceptance review

| Thuộc tính | Giá trị |
| --- | --- |
| Priority | Release gate |
| Status | `OFFLINE_ENGINEERING_ACCEPTED_WITH_DECLARED_LIMITS`; production promotion still requires XP-406 field evidence and independent operator review |
| Size | S review, không phải implementation |
| Owner role | Reviewer độc lập + product owner |
| Depends on | Tất cả work package của release đang xét |

**Checklist**

- Journey evidence pass.
- P0/P1 incident/fault evidence pass.
- Architecture/dependency/side-effect ownership pass.
- Generation/cancel/cleanup/reconciliation pass.
- Security/privacy/update pass.
- Docs/version/server behavior pass.
- A11y/E2E/performance pass theo release scope.
- Rollback được thử, không chỉ mô tả.
- Known limitations và deferred items được công bố.
- Không dùng test count/coverage duy nhất để kết luận ổn định.

---

## R6 — Fleet scale chỉ khi có bằng chứng

> **Trạng thái quyết định 2026-08-25:** `NO_GO_MONOLITH_SUFFICIENT`. Synthetic OperatorSnapshot benchmark đạt p99 dưới 3 ms và payload dưới 28 KiB ở 64 fake bots trên máy audit; chưa có incident driver hoặc field SLO buộc process isolation. Không mở XP-501. Xem [R6_WORKER_BOUNDARY_NO_GO_2026-08-25.md](evidence/R6_WORKER_BOUNDARY_NO_GO_2026-08-25.md).

### XP-500 — Worker boundary feasibility gate

Chỉ mở work package này nếu XP-404/406 chứng minh ít nhất một vấn đề không giải quyết được hợp lý trong modular monolith:

- main event-loop/heap vượt SLO do số bot;
- một BotRuntime crash/freeze kéo toàn fleet dù fault containment đã hoàn thiện;
- update/restart blast radius không chấp nhận được theo use case production;
- có deployment/operator model thực sự cần process isolation.

Nếu bottleneck là full Desktop snapshot, log rendering, unbounded listener hoặc mode bug, phải sửa đúng owner trước; không dùng worker để che lỗi.

### XP-501 — Control protocol go/no-go

Nếu XP-500 pass:

1. Định nghĩa versioned control protocol và per-worker ownership.
2. Không serialize raw Mineflayer client/window/packet.
3. Chốt desired state, event ordering, generation và split-brain prevention.
4. Chốt crash/restart/reconciliation/rolling update semantics.
5. Prototype một bot worker với fake transport.
6. Benchmark chi phí IPC và failure isolation.
7. ADR go/no-go; mặc định `NO-GO` nếu lợi ích không vượt complexity/operational cost.

---

## 11. Traceability: vấn đề đến work package

| Vấn đề | Work package giải quyết | Bằng chứng đóng |
| --- | --- | --- |
| Diagnostics không thấy nested failure | XP-010, XP-401 | Writer-reader-Desktop integration + path security tests |
| Support bundle Desktop đi đường riêng | XP-011 | Same builder/schema/hash/redaction tests |
| Emergency stop bỏ bot sau exception | XP-012, XP-403 | Partial/timeout/late-client matrix |
| B5 blocked không có operator retry an toàn | XP-013, XP-014, XP-105 | Fault/replay + E2E blocked/retry |
| B5 restart budget quá lớn | XP-013, XP-014 | Finite circuit test và incident publication |
| Startup failure chỉ nằm trong toast/log | XP-015, XP-103 | Boot failure E2E + recovery action |
| Desktop fatal/relaunch chưa đầy đủ | XP-015, XP-402, XP-403 | Crash marker/drain/reload/relaunch tests |
| Health chưa được operator hóa | XP-104, XP-202 | Probe aggregation + stale/offline E2E |
| Secret corruption bị hiểu là not-configured | XP-016 | Typed state + corruption/decrypt tests |
| Docs/version/B5 mâu thuẫn | XP-017, XP-400, XP-405 | Docs behavior/version gate |
| Navigation quá dày | XP-100 | Journey/card-sort/navigation tests |
| Font/a11y yếu | XP-101, XP-402 | WCAG/keyboard/zoom evidence |
| Toast lỗi biến mất | XP-102 | Persistent incident lifecycle E2E |
| Config thiếu diff/undo/conflict | XP-106, XP-108 | Transaction/conflict/restore E2E |
| Builder raw JSON, thiếu stop flow | XP-300..303 | Typed editor/lifecycle/dry-run tests |
| Mode UI hard-code | XP-304 | Fake mode conformance without generic branch edit |
| Sản phẩm chưa thực sự multi-server | XP-305 | Second production profile/support matrix nếu demand pass |
| Renderer monolith/full rerender | XP-200, XP-202 | Page tests + render benchmark |
| DesktopController/IPC rộng | XP-201 | Versioned use-case contract tests |
| B5 services quá tập trung | XP-203, XP-204 | Replay parity + responsibility boundaries |
| Config migrator quá tập trung | XP-205 | Crash-point/journal recovery matrix |
| Bootstrap/Discord dày | XP-206 | Registration/control-plane parity tests |
| Thiếu lint/type/complexity gate | XP-207, XP-400 | Incremental static gate |
| Mock lệch contract thật | XP-401 | Fixture factory from actual specs/layout |
| Thiếu Desktop E2E/visual/a11y | XP-001, XP-402 | Critical flow suite |
| Scale evidence chưa đại diện live product | XP-404, XP-406, XP-500 | SLO benchmark + conditional ADR |

---

## 12. Ma trận xử lý lỗi chuẩn

| Class | Runtime tự làm | UI phải nói | Action cho operator | Artifact |
| --- | --- | --- | --- | --- |
| `EXPECTED_WAIT` | Chờ theo contract, không tăng failure count | Đang chờ gì và điều kiện tiếp tục | Thường không cần; có thể Stop | Lightweight timeline |
| `TRANSIENT_RETRY` | Retry bounded + backoff/jitter | Đang tự khôi phục, attempt/cooldown trong detail | Stop; retry thủ công chỉ khi circuit cho phép | Aggregated incident nếu vượt threshold |
| `BUSINESS_BLOCKER` | Dừng mutation, giữ verified state | Cần xử lý, mức an toàn, blocker cụ thể | Guarded Retry, Inspect, Stop | Failure artifact + trace/replay ref |
| `UNEXPECTED_FAULT` | Finite circuit, cleanup owner | Mode degraded/paused, không giả vờ chạy | Restart mode guarded, Inspect, Stop | Stack sanitized + runtime context |
| `STALE_ABORT` | Bỏ kết quả generation cũ, reconcile mới | Thường chỉ detail nếu tự hồi phục | Không action trừ khi lặp | Correlation trace, suppressed summary |
| `CONFIG_BOOT_FAILURE` | Không start partial runtime | Config nào lỗi và cách sửa | Edit, Restore, Revalidate, Retry | Boot artifact không chứa value nhạy cảm |
| `PROCESS_FATAL` | Best-effort drain, marker, exit | Recovery banner lần mở sau | Export, restore, safe start | Crash marker + bounded last logs |
| `FLEET_PARTIAL` | Continue all-settled, verify từng bot | Bot nào an toàn/chưa an toàn | Retry subset, Inspect, Force cleanup theo owner | Per-bot result + fleet incident |

### Quy tắc retry

- Retry count được reset theo episode/session contract, không theo mỗi loop tick.
- Same blocker signature dùng bounded backoff và log suppression.
- Retry thủ công có idempotency key, expected generation và expected state.
- Không retry mutation khi postcondition chưa biết; reconcile/observe trước.
- Không dùng `safeToRetry=true` nếu chỉ biết action send failed nhưng server outcome ambiguous.

---

## 13. Definition of Done theo cấp

### 13.1 Một issue nhỏ

- Có observed/expected/root cause/affected owner.
- Smallest safe fix ở đúng layer.
- Có negative/fault test tái hiện.
- Không giảm verification/generation/cancel/cleanup.
- Có operator message/remediation nếu behavior user-facing.
- Có node check/targeted tests/affected integration theo quy trình implementation.
- Có rollback hoặc lý do thay đổi không cần rollback.

### 13.2 Một work package

- Tất cả acceptance criteria pass.
- Public contract/version/migration đã chốt.
- Source/config/docs/test/catalog được cập nhật đúng authority.
- Không capability duplicate và không đường side effect mới.
- Traceability matrix cập nhật.
- Evidence artifact có command/exit code/version/hash/limitations.
- Reviewer độc lập kiểm happy path và ít nhất một failure path.

### 13.3 Một release

- Không P0 mở.
- P1 deferred phải có owner, reason, mitigation và target gate; không ghi chung chung.
- Critical journeys pass E2E.
- Fault matrix pass theo scope.
- Support bundle/rollback thực sự được thử.
- Docs/user copy đúng current behavior.
- Privacy/security/static/architecture gates pass.
- Field/canary evidence đủ để phát hành theo support status.

### 13.4 Mục tiêu 8.5/10

Chỉ đánh giá đạt khi:

1. XP-010..017 hoàn tất và có evidence.
2. J1–J6 hoàn tất không cần raw JSON ở basic path.
3. B5 P0 fault matrix pass, không duplicate mutation/sell 1.
4. Incident Center và health projection hoạt động.
5. Emergency stop partial failure được xử lý đúng.
6. Desktop critical E2E/a11y pass.
7. Static architecture/contract gate pass.
8. Field SLO đạt trong cửa sổ vận hành đã định nghĩa.
9. Tài liệu không mâu thuẫn current behavior.
10. Known limitations còn lại không nằm ở safety/correctness/recovery P0.

---

## 14. Risk register của chương trình

| Risk | Xác suất | Tác động | Mitigation |
| --- | --- | --- | --- |
| Tách file làm đổi thứ tự side effect B5 | Cao | Rất cao | Characterization/replay digest, slice nhỏ, parity gate |
| UI mới gọi action vượt owner | Trung bình | Rất cao | allowed-action catalog, IPC schema, use-case boundary |
| Circuit breaker đếm expected blocker như crash | Trung bình | Cao | fault taxonomy tests, separate budgets |
| Diagnostics path fix tạo traversal | Trung bình | Rất cao | opaque ID, containment, symlink/allowlist tests |
| Support bundle leak PII/secret | Trung bình | Rất cao | field redaction, canary scanner, preview, size/allowlist |
| Emergency concurrency tạo race | Trung bình | Cao | two-phase intent revoke, per-bot task, terminal verification |
| Config UX bypass atomic writer | Thấp nếu giữ boundary | Rất cao | renderer never writes, controller validator/backup only |
| E2E flaky làm gate mất giá trị | Trung bình | Cao | fake clock/runtime, accessible selectors, no live server |
| Format/lint rollout tạo diff khổng lồ | Cao | Trung bình | changed-files first, separate mechanical commits |
| Builder trở thành arbitrary automation code | Trung bình | Rất cao | schema modules only, no eval/raw chat/client |
| Thêm second server quá sớm | Trung bình | Cao | XP-305 demand/support gate |
| Worker architecture tăng complexity không cần thiết | Trung bình | Cao | XP-500 default no-go, measured SLO driver only |
| Docs lại drift sau một release | Cao | Cao | canonical behavior + automated version/phrase gate |
| Main process fatal handler cố tiếp tục | Thấp | Rất cao | best-effort drain then exit; bounded relaunch, no continue |

---

## 15. Những việc không làm trong chương trình này

- Không đọc, ghi hoặc đóng gói `.env`, secret thật, runtime `data/**` hay `node_modules/**`.
- Không đổi Mineflayer/Minecraft/protocol nếu không có task riêng.
- Không chuyển CommonJS sang ESM hoặc rewrite TypeScript toàn repo.
- Không bỏ verification để flow "chạy mượt".
- Không tăng timeout/retry vô hạn hoặc thêm sleep tùy ý.
- Không hard-code GUI/server observation chưa xác nhận.
- Không để Local AI/custom mode/Discord gọi raw bot chat/click/client.
- Không khôi phục desired mode từ process cũ trái operator-session rule.
- Không gọi fake second-server test là hỗ trợ multi-server production.
- Không tách worker/microservice chỉ vì file lớn.
- Không đóng P0 chỉ bằng unit test happy path.

---

## 16. Checklist bắt đầu triển khai ngay

Thứ tự ticket đầu tiên nên là:

1. **XP-001:** dựng Desktop critical-flow harness tối thiểu.
2. **XP-002:** chốt error/incident/action vocabulary đủ cho P0.
3. **XP-010:** sửa Runtime Failure Artifact Repository và Diagnostics.
4. **XP-012:** làm emergency stop two-phase/all-settled.
5. **XP-013:** thêm common finite fault policy theo slice contract/platform/reference.
6. **XP-014:** đưa B5 vào fault policy và public guarded retry.
7. **XP-011:** hội tụ Desktop support bundle lên builder chung.
8. **XP-015/016:** boot failure và secret corruption recovery.
9. **XP-017:** đóng toàn bộ mâu thuẫn docs/B5/version.
10. Chạy **XP-403** fault matrix cho toàn bộ R1 trước khi bắt đầu R2.

Không gom 10 ticket này vào một patch. Mỗi ticket phải có evidence/rollback riêng và được merge theo dependency.

---

## 17. Kết luận cuối

Project không thiếu nền móng kiến trúc. Điều còn thiếu là một lớp **product operations** đủ chín để biến safety primitive thành trải nghiệm dễ hiểu, và một chương trình decomposition/quality đủ có kỷ luật để giảm blast radius mà không làm thay đổi gameplay.

Mục tiêu đúng không phải là "thêm càng nhiều mode càng tốt". Mục tiêu đúng là:

- B5 thuần chạy có trạng thái rõ, lỗi hữu hạn, retry an toàn và không đột biến trùng;
- người dùng mới thao tác được mà không đọc source/JSON;
- operator xử lý lỗi từ E0 đến E6 theo một mô hình nhất quán;
- maintainer nhận được bundle/replay chính xác và redacted;
- mode/profile mới mở rộng qua contract, không sửa generic core;
- mọi tuyên bố ổn định đều có E2E, fault, performance và field evidence.

Hoàn tất R1 sẽ đưa project từ "có nhiều cơ chế an toàn nhưng còn điểm mù vận hành" sang "recovery có thể tin cậy". Hoàn tất R2–R3 sẽ đưa project thành một sản phẩm Desktop dễ vận hành và codebase dễ duy trì hơn. R4 chỉ nên tăng breadth sau đó. R6 vẫn là lựa chọn có điều kiện, không phải đích mặc định.

---

## 18. Evidence map của đợt audit

Danh sách này giúp reviewer kiểm lại nhận định mà không phải đọc toàn repository.

| Chủ đề | Nguồn CURRENT chính |
| --- | --- |
| Quy tắc/authority | `AGENTS.md`, `RULES.md`, `ARCHITECTURE.md`, `SERVER_BEHAVIOR.md`, `JS_RESPONSIBILITIES.md` |
| Product shell | `src/desktop/main.js`, `src/desktop/preload.js`, `src/desktop/renderer/index.html`, `src/desktop/renderer/app.js`, `src/desktop/renderer/styles.css` |
| Desktop use cases | `src/desktop/DesktopController.js`, `src/desktop/DesktopSecretStore.js` |
| Runtime ownership | `src/core/Application.js`, `src/bot/BotRegistry.js`, `src/bot/BotRuntime.js`, `src/bot/BotContext.js` |
| Mode platform | `src/modes/ModeCatalog.js`, `src/modes/RuntimeModeRegistry.js`, `src/modes/ManagedMode.js`, `src/modes/ModeContext.js`, `src/modes/ModeCoordinator.js` |
| Composable builder | `src/modes/composable/WorkflowModuleCatalog.js`, `WorkflowDefinitionValidator.js`, `WorkflowStepExecutor.js`, `ComposableModeService.js` |
| B5 mode | `src/modes/b5-craft/B5CraftModeService.js`, `src/server-features/crafting/B5AutomationService.js`, `src/server-features/crafting/b5/flows/**`, `src/planning/crafting/B5Planner.js` |
| Diagnostics | `src/diagnostics/runtime/RuntimeFailureRecorder.js`, `src/diagnostics/support/SupportBundleBuilder.js`, `src/core/HealthRegistry.js` |
| Config/update | `src/configuration/**`, `src/desktop/update/RuntimeConfigMigrator.js`, updater modules và config schemas liên quan |
| Emergency/fleet | `src/desktop/DesktopController.js`, `src/recovery/FleetControlService.js`, `src/fleet/FleetScheduler.js` |
| Security | Electron window/IPC setup, secret store, local AI permission/tool boundaries, update package verifier/applier |
| User docs | `README.md`, `START_HERE.txt`, `USER_GUIDE.txt` và root source-of-truth documents |
| Existing roadmap | `docs/architecture-roadmap/00_NORTH_STAR.md` tới `20_DECISION_GATES.md`, work packages và evidence tương ứng |
| Test topology | `tests/unit/**`, `tests/integration/**`, `tests/unit/simulation/**`, fixtures liên quan |

### 18.1 Snapshot định lượng hỗ trợ maintainability review

Tại thời điểm audit:

- Có `304` JavaScript source files dưới `src/**`.
- Có `180` JavaScript test files dưới `tests/**`.
- Có `21` Desktop unit test files, `3` integration test files và `4` simulation test files dưới `tests/unit/simulation`.
- Không tìm thấy suite được đặt tên/khai báo rõ cho Playwright, axe/accessibility, visual regression hoặc Electron E2E.
- Một số file tập trung trách nhiệm có kích thước quan sát được:

| File | Số dòng snapshot | Cách diễn giải đúng |
| --- | ---: | --- |
| `src/desktop/update/RuntimeConfigMigrator.js` | 2330 | Cần tách planner/transaction/recovery theo seam; không rewrite một lần |
| `src/modes/b5-craft/B5CraftModeService.js` | 1454 | Cần tách state/fault/status sau replay parity |
| `src/server-features/crafting/B5AutomationService.js` | 1414 | Cần tách flow responsibility, giữ execution order |
| `src/desktop/renderer/app.js` | 1312 | Cần page/store/component decomposition có E2E bảo vệ |
| `src/discord/panels/DiscordPanelManager.js` | 1209 | Cần tách presentation/routing/projection/scheduling |
| `src/modes/collector-b5/CollectorB5ModeService.js` | 1027 | Legacy strangler chỉ theo parity evidence |
| `src/gui/GuiManager.js` | 1020 | Chỉ tách khi owner/session contract không đổi |
| `src/gui/knowledge/GuiKnowledgeRegistry.js` | 894 | Cần giữ identity/profile authority rõ |
| `src/desktop/DesktopController.js` | 881 | Tách theo validated application use case |
| `src/modes/fishing/FishingModeService.js` | 860 | Legacy lifecycle/gameplay migration theo slice |

Số dòng chỉ là tín hiệu để review responsibility. Không dùng nó làm lý do duy nhất để tách file hoặc làm KPI giảm code.

### 18.2 Hạn chế bằng chứng

- Audit không chạy test, validator, Electron, Minecraft client hoặc server thật.
- Không đọc runtime observation/log dưới `data/**`; vì vậy không kết luận tần suất lỗi thực địa.
- Không đọc `.env`, secret thật hoặc credential.
- Không đọc dependency implementation dưới `node_modules/**`.
- Không có usability study chính thức; score UX là expert heuristic review cần được xác nhận bằng XP-000.
- Synthetic/fake scale evidence hiện có không đại diện đầy đủ socket, GUI, pathfinding, Discord và server latency thật.
- Mọi số liệu file/test là snapshot và phải được refresh khi implementation bắt đầu.

---

## 19. Protocol giao work package cho developer/AI

Không yêu cầu một agent "làm hết tài liệu" trong một delivery. Mỗi delivery chỉ nhận một work package hoặc một slice đã ghi rõ dependency.

### 19.1 Input bắt buộc

```text
Work package/slice:
Current repository version:
Dependencies đã hoàn tất:
Behavior không được thay đổi:
Files/areas được phép sửa:
Files/areas cấm đọc/sửa:
Verification được phép chạy:
Delivery format:
```

### 19.2 Agent phải báo trước khi sửa

```text
Observed behavior:
Expected behavior:
Root cause:
Affected owner/layer:
Smallest safe fix:
Public contract/migration impact:
Verification plan:
Regression risks:
Rollback plan:
```

Nếu chưa chứng minh root cause, agent tiếp tục audit; không được thay timeout/retry/sleep hoặc bỏ verify để thử vận may.

### 19.3 Quy tắc delivery

1. Không sửa task kế tiếp ngoài scope.
2. Không thay đổi unrelated user files trong dirty worktree.
3. Mọi file mới phải có architecture reachability/owner.
4. Mọi config field mới có schema, cross-validation, default/migration và UI/help impact.
5. Mọi module mới có validator, capability dependency, executor, catalog, targeted test và reachability.
6. Mọi IPC mới có exact sender check, input/output schema, permission và error translation.
7. Mọi stateful action có generation, cancel, timeout, cleanup và postcondition verify.
8. Mọi error user-facing có stable code/remediation/correlation ID.
9. Không claim PASS cho command/test không thực sự chạy exit code 0.
10. Report cuối liệt kê file đổi, behavior đổi, test/check đã chạy, failure còn lại và rollback.

### 19.4 Điều kiện reviewer trả lại delivery

- Patch gộp nhiều work package không có lý do.
- Fix symptom ở sai layer hoặc tạo capability duplicate.
- Bỏ verification/generation guard/cancellation.
- Retry vô hạn, sleep tùy ý hoặc parse message text thay structured code.
- Desktop/controller gọi raw Mineflayer side effect.
- Test mock lại shape tự chế thay contract/config/layout thật.
- Update/config writer không có backup/rollback/containment.
- UI hiển thị technical dump nhưng không có operator action.
- Docs/current behavior chưa cập nhật khi contract đổi.
- Không có negative/fault test cho P0/P1.

### 19.5 Mẫu báo cáo hoàn tất

```text
Work package/slice completed:
Root cause confirmed:
Files changed:
Behavior before -> after:
Contracts/migrations:
Verification commands and exit codes:
Fault cases covered:
Security/privacy checks:
Known limitations/deferred work:
Rollback instructions:
Evidence paths:
```

Reviewer phải đối chiếu báo cáo với patch và artifact thật; không coi nội dung báo cáo của agent là bằng chứng tự đủ.
