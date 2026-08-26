# R2–R6 Adversarial QA Upgrade — 2026-08-25

## Phương pháp

Sau implementation pass, solution bị review lại theo identity, state transition, concurrency, symlink/path containment, byte/work quotas, stale revision, deterministic integrity, retention và release rollback. Happy-path pass không được xem là đủ.

## Điểm yếu tìm thấy và bản nâng cấp

| ID | Điểm yếu/lỗ hổng | Rủi ro | Nâng cấp đã áp dụng |
|---|---|---|---|
| QA2-01 | Backup retention dùng public list đã bị cap nên không thấy mọi entry cũ | Catalog tăng không giới hạn | Tách bounded public list khỏi private complete retention scan |
| QA2-02 | Restore chỉ overwrite file trong manifest, để lại JSON tạo sau backup | “Restore thành công” nhưng target tree không đúng snapshot | Preview `DELETE`, exact-tree apply và exact rollback |
| QA2-03 | Manifest chấp nhận duplicate path/bytes/hash shape yếu | Ambiguous apply, quota/digest bypass | Unique path, integer bytes, SHA-256 shape và total verification |
| QA2-04 | Tạo pre-restore backup có thể retention xóa source backup cũ | Restore bản cũ fail giữa transaction | Khóa transaction và đánh dấu source active trước pre-restore backup |
| QA2-05 | Manifest được đọc/JSON parse trước size bound; direct ID có thể trỏ directory symlink | Memory/IO abuse hoặc catalog escape | `lstat`/`realpath` containment, regular manifest và 1 MiB default cap |
| QA2-06 | Create/restore backup chạy song song | Retention/apply/rollback race | Single transaction owner; busy fail closed |
| QA2-07 | Incident action/state nằm trong nested diagnostic bị mất | UI thiếu remediation đúng | Hợp nhất các canonical/nested action surface đã validate |
| QA2-08 | Incident terminal có thể quay lại RECOVERING và vẫn giữ mutation action | Lịch sử sai, retry stale | Explicit transition graph; terminal chỉ giữ inspect/export |
| QA2-09 | Workflow normalize spread object gốc | Unknown/stale/prototype-shaped field tới persistence/executor | Rebuild theo declared module schema, strip mọi field không khai báo |
| QA2-10 | Custom mode list đọc file hai lần và không có byte cap | TOCTOU, boot/list memory spike | Single-buffer parse+digest và bounded sync/async read/write |
| QA2-11 | `.bak` custom mode có thể là symlink | Backup write theo link ra ngoài owner | Reject non-regular/symlink backup target |
| QA2-12 | Package verify chỉ so digest và modeId | Manifest capability/resource/schema bị tamper vẫn valid | Canonical exact manifest comparison |
| QA2-13 | Template thiếu compatibility/support/dependency/resource metadata | UI quảng bá template mà không nói readiness/risk | Versioned template presentation với BETA/limitations/claims |
| QA2-14 | Dry-run không nói nhánh nào không chạy và max expansion input không clamp | Operator hiểu nhầm coverage; resource abuse | Bounded 1..50000, selected/unreached path và explicit checks/effect estimate |
| QA2-15 | Operator mode summary fallback hard-code B5 | Mode mới không generic | Resolve `byId/available` từ ModeCatalog/status trước specialized extension |
| QA2-16 | Static gate chỉ quản lý 18 file mới | Nhiều regression không bao giờ bị gate thấy | Mở lên 86 file; legacy exact debt budget có owner/reason/expiry |
| QA2-17 | Canary policy chỉ tồn tại trong unit test, runtime graph coi orphan | Release rule không phải gate thật | Thêm deterministic canary script vào quality fast lane |
| QA2-18 | Renderer script được HTML load nhưng architecture graph coi orphan | Validator và runtime dependency model lệch nhau | Khai báo browser script làm runtime entrypoint chính thức |
| QA2-19 | Artifact mutation owner mới chưa có catalog entry | Filesystem side-effect governance fail | Khai báo backup, incident và runtime applier owner/scope/cleanup policy |
| QA2-20 | E2E initial timeout không surface renderer console error | Failure khó chẩn đoán, dễ audit lặp | Harness capture console/page error và in diagnostic khi critical selector fail |

## Kết quả safety review

- Không thay raw Mineflayer side-effect owner.
- Không thêm infinite retry/sleep hoặc bỏ verification.
- B5 boundary vẫn: fresh `/kho` → nung raw iron/raw gold → nén B1 → immutable baseline → sell `64` → giữ `<64` → verify `>=1.5 B5` → craft.
- Không đọc/đóng gói `.env`, `data/**` runtime hoặc `node_modules/**` trong audit/delivery evidence.
- Không commit/push.

Final adversarial regression: full repository `1104` tests với `0` fail; release lane `25/25` gate PASS, gồm installed graph và coverage.
