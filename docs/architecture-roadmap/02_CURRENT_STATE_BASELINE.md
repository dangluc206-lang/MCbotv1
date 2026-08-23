# Current State Baseline

## Snapshot scope

Baseline này dựa trên tài liệu và cấu trúc repository tại thời điểm tạo roadmap. Nó không thay thế audit source cho từng task.

Kho hiện có khoảng 285 file dưới `src/`, phân bổ lớn:

| Area | File count quan sát |
|---|---:|
| `server-features` | 54 |
| `modes` | 25 |
| `gui` | 24 |
| `shared` | 21 |
| `items` | 19 |
| `configuration` | 16 |
| `desktop` | 16 |
| `discord` | 14 |
| `movement` | 13 |
| `bootstrap` | 12 |
| `core` | 12 |
| `diagnostics` | 11 |
| `bot` | 10 |
| `commands` | 10 |

Số đếm chỉ giúp định tuyến; không dùng để đánh giá chất lượng hoặc quyết định refactor tự động.

## Nền móng CURRENT đã tốt

### Multi-bot/runtime

- `Application` + `BotRegistry` + `BotRuntime`.
- Bot-scoped context/state/service.
- Connection generation và stale-event protection.
- Connection/reconnect/session responsibilities đã tách.

### Operation và ownership

- `OperationManager`, queue/lock/cancellation/timeout primitives.
- `ModeCoordinator` lease cho primary mode.
- Raw command/GUI/connection side-effect owner đã được catalog hóa.

### Mode platform

- `ModeCatalog`.
- `RuntimeModeRegistry`.
- `ModeContext`.
- `ManagedMode`.
- Mode SDK/scaffold.
- Composable workflow foundation.
- `b5-craft`, `collector-b5`, `fishing` tồn tại với mức legacy/modern khác nhau.

### Domain/capability

- Command, GUI identity/click/session.
- Inventory/item normalization và custom identity.
- Movement/navigation.
- Storage, personal vault, smelting, crafting/B5, island, skyblock, fishing, authentication và các server feature khác.

### Planning/replay

- Crafting/B5 planner separation.
- B5 decision digest/replay input/trace.
- Reconciliation barrier đã bắt đầu xuất hiện cho crafting.

### Control plane

- Desktop và Discord.
- Durable desired intent.
- Fleet scheduler và runtime control service.
- Remote-only Discord policy.

### Update/config

- Configuration specs/schema/cross-reference validation.
- Runtime/application tree separation.
- Local ZIP update contract, backup và rollback foundation.

## Khoảng cách tới TARGET

### G-01 — Server boundary chưa rõ hoàn toàn

MinerUA command/GUI/item/recipe/storage/join knowledge vẫn phân tán giữa config và `src/server-features/**`. Generic namespace có nguy cơ mặc định hóa server hiện tại.

### G-02 — Mode maturity không đồng đều

Mode platform mới và legacy modes cùng tồn tại. Fishing/collector code có behavior hữu ích nhưng không nên làm template.

### G-03 — Capability contract chưa đồng nhất

Không phải mọi capability đều có cùng result envelope, evidence, stale/cancel semantics và introspection.

### G-04 — Resource claim chưa bao phủ mọi conflict tương lai

Primary mode lease đã rõ; inventory/gui/movement/command-exclusive chỉ nên formalize khi migration có evidence.

### G-05 — Planner/reconciliation mới sâu ở B5/crafting

Storage/sell/trade/auction tương lai chưa dùng chung decision/reconciliation model.

### G-06 — Scheduler domain recurring chưa thống nhất

Fleet scheduler, daily recovery và local mode timers có trách nhiệm khác nhau nhưng recurring domain workflow chưa có contract chung.

### G-07 — Observability chưa hoàn toàn thống nhất

Context/log/error/replay mạnh ở một số flow, nhưng không phải capability nào cũng có stable envelope và support evidence giống nhau.

### G-08 — Simulation/fault framework còn hẹp

Đã có replay/simulation foundation nhưng chưa thành scenario platform dùng chung cho command/GUI/storage/mode/reconnect.

### G-09 — Documentation governance

Architecture validator allowlist Markdown theo từng file. Thư mục roadmap mới cần catalog/tooling migration có chủ đích.

### G-10 — Transaction/update closure đang là reliability gate

Runtime config/update transaction cần đạt postcondition/ownership/fault matrix hoàn chỉnh trước feature expansion lớn.

## Debt không được xử lý bằng rewrite

- Không đổi module system.
- Không chuyển folder hàng loạt khi chưa có façade và parity test.
- Không tạo generic adapter khi mới có một implementation.
- Không copy legacy mode sang mode mới.
- Không sửa validator/test để che boundary violation.

## Baseline evidence cần tái xác nhận ở đầu mỗi phase

- `rg --files` và architecture catalog.
- Current public constructors/methods/events.
- Side-effect owner scan.
- Event scope/generation guards.
- Config specs/schema/cross-reference.
- Targeted tests của capability bị chạm.
- Known dirty worktree/branch state.

Mọi số liệu baseline trong roadmap có thể stale; work package phải refresh trước implementation.
