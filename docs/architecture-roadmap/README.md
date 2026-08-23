# MCbot Architecture Program

## Mục đích

Thư mục này biến tầm nhìn kiến trúc dài hạn của MCbot thành một chương trình triển khai có thể giao từng phần cho developer hoặc AI khác mà không làm trôi scope.

Đích của chương trình:

> Xây dựng MCbot thành nền tảng tự động hóa Minecraft đa bot, đa workflow và đa server; B5, fishing và các workflow khác là consumer của framework, không phải định nghĩa của framework.

Đây là tài liệu **TARGET và ROADMAP**. Nó không được dùng để khẳng định một capability đã tồn tại nếu `ARCHITECTURE.md`, source, config và test hiện tại chưa chứng minh điều đó.

## Thứ tự đọc bắt buộc

Trước khi dùng roadmap để sửa code:

1. Đọc `AGENTS.md`.
2. Đọc section CURRENT/TARGET liên quan trong `ARCHITECTURE.md`.
3. Nếu có command, GUI, item, recipe, cooldown hoặc server timing, đọc `SERVER_BEHAVIOR.md`.
4. Đọc file kiến trúc trong thư mục này liên quan đến task.
5. Chọn đúng **một work package chính** trong `work-packages/`.
6. Kiểm tra dependency và exit gate trước khi implement.
7. Không tự làm work package kế tiếp nếu task hiện tại chưa yêu cầu.

## Bản đồ tài liệu

### Tầm nhìn và kiến trúc

- [`00_NORTH_STAR.md`](00_NORTH_STAR.md): mục tiêu tối cao và tiêu chí framework hoàn thiện.
- [`01_ARCHITECTURE_PRINCIPLES.md`](01_ARCHITECTURE_PRINCIPLES.md): invariant và nguyên tắc ra quyết định.
- [`02_CURRENT_STATE_BASELINE.md`](02_CURRENT_STATE_BASELINE.md): baseline CURRENT và khoảng cách tới TARGET.
- [`03_TARGET_REFERENCE_ARCHITECTURE.md`](03_TARGET_REFERENCE_ARCHITECTURE.md): kiến trúc tham chiếu đích.
- [`04_CODEBASE_DECOMPOSITION.md`](04_CODEBASE_DECOMPOSITION.md): phân rã codebase theo layer/capability/owner.
- [`05_CONTRACT_CATALOG.md`](05_CONTRACT_CATALOG.md): contract tối thiểu giữa các tầng.
- [`06_DEPENDENCY_AND_OWNERSHIP_RULES.md`](06_DEPENDENCY_AND_OWNERSHIP_RULES.md): dependency direction, resource và side-effect ownership.
- [`07_STATE_CONFIG_AND_PERSISTENCE.md`](07_STATE_CONFIG_AND_PERSISTENCE.md): configuration, desired, observed, derived và persisted state.
- [`08_OPERATION_TRANSACTION_AND_RECOVERY.md`](08_OPERATION_TRANSACTION_AND_RECOVERY.md): operation, verification, reconciliation và recovery.
- [`09_SERVER_PROFILE_STRATEGY.md`](09_SERVER_PROFILE_STRATEGY.md): tách MinerUA khỏi generic framework.
- [`10_MODE_AND_WORKFLOW_PLATFORM.md`](10_MODE_AND_WORKFLOW_PLATFORM.md): Mode SDK và composable workflow.
- [`11_OBSERVABILITY_REPLAY_AND_SUPPORT.md`](11_OBSERVABILITY_REPLAY_AND_SUPPORT.md): trace, replay, support bundle.
- [`12_TESTING_AND_QUALITY_GATES.md`](12_TESTING_AND_QUALITY_GATES.md): tháp test, fault matrix và release gate.
- [`13_SECURITY_AND_UPDATE_SAFETY.md`](13_SECURITY_AND_UPDATE_SAFETY.md): secret, local update, artifact ownership và rollback.

### Chương trình triển khai

- [`14_IMPLEMENTATION_ROADMAP.md`](14_IMPLEMENTATION_ROADMAP.md): thứ tự P0–P6 và go/no-go gate.
- [`15_WORK_PACKAGE_INDEX.md`](15_WORK_PACKAGE_INDEX.md): dependency/status của từng WP.
- [`16_TRACEABILITY_MATRIX.md`](16_TRACEABILITY_MATRIX.md): từ mục tiêu → contract → WP → bằng chứng.
- [`17_DEFINITION_OF_DONE.md`](17_DEFINITION_OF_DONE.md): DoD chung và DoD theo loại thay đổi.
- [`18_RISK_REGISTER.md`](18_RISK_REGISTER.md): risk, trigger, owner và mitigation.
- [`19_GLOSSARY.md`](19_GLOSSARY.md): thuật ngữ chuẩn.
- [`20_DECISION_GATES.md`](20_DECISION_GATES.md): điều kiện cho phép đi tiếp hoặc dừng.

### Phase plan

- [`phases/PHASE_0_ALIGNMENT_AND_BASELINE.md`](phases/PHASE_0_ALIGNMENT_AND_BASELINE.md)
- [`phases/PHASE_1_RELIABILITY_FOUNDATION.md`](phases/PHASE_1_RELIABILITY_FOUNDATION.md)
- [`phases/PHASE_2_SERVER_PROFILE_BOUNDARY.md`](phases/PHASE_2_SERVER_PROFILE_BOUNDARY.md)
- [`phases/PHASE_3_MODE_CAPABILITY_SDK.md`](phases/PHASE_3_MODE_CAPABILITY_SDK.md)
- [`phases/PHASE_4_PLANNER_TRANSACTION_EXPANSION.md`](phases/PHASE_4_PLANNER_TRANSACTION_EXPANSION.md)
- [`phases/PHASE_5_SIMULATION_OBSERVABILITY.md`](phases/PHASE_5_SIMULATION_OBSERVABILITY.md)
- [`phases/PHASE_6_FLEET_SCALE_OPTION.md`](phases/PHASE_6_FLEET_SCALE_OPTION.md)

### ADR của chương trình

- [`adrs/ADR-000_DOCUMENT_GOVERNANCE_ROOTS.md`](adrs/ADR-000_DOCUMENT_GOVERNANCE_ROOTS.md): governed documentation root và authority rule.

### Templates

- [`templates/WORK_PACKAGE_TEMPLATE.md`](templates/WORK_PACKAGE_TEMPLATE.md)
- [`templates/ADR_TEMPLATE.md`](templates/ADR_TEMPLATE.md)
- [`templates/MIGRATION_PLAN_TEMPLATE.md`](templates/MIGRATION_PLAN_TEMPLATE.md)
- [`templates/AUDIT_CHECKLIST_TEMPLATE.md`](templates/AUDIT_CHECKLIST_TEMPLATE.md)
- [`templates/RELEASE_GATE_TEMPLATE.md`](templates/RELEASE_GATE_TEMPLATE.md)

## Cách dùng work package

Mỗi work package phải chứa tối thiểu:

- vấn đề CURRENT có bằng chứng;
- outcome mong muốn;
- phạm vi và ngoài phạm vi;
- dependency;
- contract/invariant không được phá;
- các bước nhỏ theo thứ tự;
- acceptance criteria có thể kiểm tra;
- test/fault matrix;
- migration và rollback;
- deliverable;
- stop condition.

Một task triển khai nên có cấu trúc:

```text
Selected WP
-> confirm baseline
-> write observed/expected/root cause
-> implement smallest vertical slice
-> targeted verification
-> architecture/config verification
-> update evidence/status
-> stop at WP boundary
```

## Status vocabulary

- `NOT_STARTED`: chưa bắt đầu.
- `READY`: dependency đã đạt, có thể nhận task.
- `IN_PROGRESS`: đang có một owner thực thi.
- `BLOCKED`: có blocker cụ thể và bằng chứng.
- `DONE`: acceptance criteria và exit gate đã đạt.
- `DEFERRED`: chủ động hoãn; có lý do/governance decision.
- `REJECTED`: hướng kỹ thuật không còn được chọn.

Không đánh dấu `DONE` chỉ vì code đã merge. Test, migration, docs, rollback và observability liên quan cũng phải hoàn thành.

## Quy tắc chống scope drift

- Một PR/delivery chọn một WP chính; WP phụ chỉ được làm nếu là dependency trực tiếp và được ghi rõ.
- Không tạo abstraction chỉ để đổi tên wrapper hiện hữu.
- Không thêm server thứ hai trước khi ServerProfile contract có fake-profile test.
- Không thêm mode bằng cách copy `collector-b5` hoặc `fishing`.
- Không tạo resource lock mới nếu chưa có conflict thật.
- Không phân tán thành microservice trước Phase 6 go/no-go.
- Không sửa server fact trong roadmap; cập nhật `SERVER_BEHAVIOR.md` sau khi quan sát/xác minh.
- Không coi test claim trong report là bằng chứng cho đến khi được chạy hoặc audit theo task.

## Trạng thái validator Markdown

[`WP-000`](work-packages/WP-000_DOCUMENTATION_CATALOG_INTEGRATION.md) đã hoàn thành ngày 2026-08-22. `architecture/catalog.json` khai báo `docs/architecture-roadmap` trong `governedDocumentRoots`, và `scripts/validate-architecture.js` cho phép Markdown đệ quy chỉ bên dưới exact root này.

Roadmap được **governed** nhưng không được nâng lên cùng authority với `officialDocuments`. Markdown ngoài `officialDocuments` và ngoài governed root vẫn bị `MARKDOWN_UNAUTHORIZED`; root thiếu, traversal, sai casing hoặc symlink đều fail-closed. Quyết định nằm tại [`ADR-000`](adrs/ADR-000_DOCUMENT_GOVERNANCE_ROOTS.md).

## Authority order

Khi có mâu thuẫn:

```text
User task hiện tại
-> AGENTS.md / RULES.md
-> SERVER_BEHAVIOR.md cho server facts
-> ARCHITECTURE.md cho CURRENT structure
-> source + config + tests
-> roadmap TARGET trong thư mục này
```

Roadmap phải được cập nhật nếu source of truth cấp cao hơn thay đổi.

## Trạng thái baseline kiến trúc

[`WP-001`](work-packages/WP-001_ARCHITECTURE_BASELINE.md) đã hoàn thành ngày 2026-08-22. Baseline machine-readable nằm tại `architecture/baseline/current.json`, được inspect/kiểm bằng `npm run baseline:inspect` và `npm run baseline:check`; gap report nằm tại [`baseline/WP-001_GAP_REPORT.md`](baseline/WP-001_GAP_REPORT.md). Baseline là evidence CURRENT, không tự sửa debt và không thay thế source/config/test.
