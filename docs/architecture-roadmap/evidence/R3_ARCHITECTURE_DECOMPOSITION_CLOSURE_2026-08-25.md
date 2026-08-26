# R3 Architecture Decomposition Closure — 2026-08-25

## Kết luận

R3 đạt `STRANGLER_BOUNDARIES_CLOSED`: dependency seam, DTO và pure component cần cho migration đã tồn tại, được runtime/script reachability quản trị và có contract tests. Các façade lớn được giữ để bảo toàn behavior, nhưng bị khai báo thành legacy debt với budget không được tăng; vì vậy đây không phải tuyên bố “mọi monolith đã biến mất”.

## Work package map

| Work package | Kết quả |
|---|---|
| XP-200 | Renderer có `core/components/pages/features`; preload surface freeze; incidents/B5/builder/mode generic đã đi qua presenter/view-model. `app.js` còn là compatibility façade và có frozen debt budget. |
| XP-201 | `DesktopApiContract` versioned; IPC dispatch dùng envelope; Custom Mode, runtime bootstrap/environment provenance, profile CRUD, Collector/Fishing config và fleet control đã được tách thành use case; controller giữ façade tương thích. |
| XP-202 | `OperatorSnapshotV1`, digest/revision, bot detail on-demand và coalescing/backpressure; benchmark 1/8/16/32/64. |
| XP-203 | B5 campaign, batch, storage episode, fault adapter, status projection đã tách; façade giữ generation/verification/side-effect order. |
| XP-204 | B5Automation flows read/plan/sell/storage/craft/deposit/withdraw tiếp tục là capability-owned flow; không tạo side-effect owner mới. |
| XP-205 | Version reader, pure planner, journal, filesystem applier, verifier và recovery coordinator đã tách và được façade dùng. |
| XP-206 | Bootstrap installers và Discord interaction router đã tách; Discord vẫn chỉ gọi control plane. |
| XP-207 | Static gate quản lý 91 file; façade legacy có exact non-growth budget, owner, reason và expiry; architecture reachability fail closed. |

## Dependency/ownership evidence

```text
renderer presenter -> preload DTO -> Desktop use case -> capability/service
B5 state/policy component -> B5 façade -> registered capability
migration planner/verifier -> migrator transaction owner -> owned filesystem applier
Discord router -> FleetControl/Desktop use case -> runtime registry
Electron main -> DesktopRuntimeBootstrap -> migrator/environment/secret/provenance owners
DesktopController compatibility method -> profile/mode-config/fleet use case -> existing domain owner
```

- Raw server command, GUI click, client end và fishing protocol owner không đổi.
- File mutation owner mới được khai báo trong `architecture/artifact-ownership.json`.
- 355/355 source files reachable tại lần acceptance.
- Không chuyển CJS/ESM, không đổi Mineflayer/protocol và không tạo worker boundary.

## Legacy debt đã đóng băng

`architecture/static-quality/current.json` ghi exact ceiling cho `DesktopController`, renderer `app.js`, `RuntimeConfigMigrator`, `RuntimeConfigMigrations`, `B5CraftModeService` và `FleetControlService`. Follow-up first-start slice đã hạ `DesktopController` từ ceiling 1128 xuống 986 dòng và `main.js` từ 588 xuống 587, đồng thời chuyển responsibility sang file runtime-reachable có test. Gate fail nếu debt tăng trở lại. Các façade khác chỉ được xóa sau parity evidence; không được xem line count giảm đơn thuần là bằng chứng behavior đúng.
