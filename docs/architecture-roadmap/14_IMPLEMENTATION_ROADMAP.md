# Implementation Roadmap

## Nguyên tắc sequencing

```text
P0 Alignment
-> P1 Reliability
-> P2 Server boundary
-> P3 Mode/capability SDK
-> P4 Planner/transaction expansion
-> P5 Simulation/observability
-> P6 Optional fleet distribution
```

P2 và P3 có thể overlap sau khi contract nền P0/P1 đạt, nhưng không được cùng sửa một boundary/source owner không có migration plan.

## Phase 0 — Alignment and baseline

### Outcome

Tài liệu/catalog/baseline/contracts thống nhất; mỗi future task có owner, dependency và evidence.

### Mandatory WPs

- WP-000 Documentation catalog integration.
- WP-001 Architecture baseline and gap inventory.
- WP-002 Common result/event/error contract ADR.

### Gate

- Roadmap Markdown được validator governance công nhận.
- Baseline machine-readable và date/revision rõ.
- Contract decisions có ADR; không implementation big-bang.

## Phase 1 — Reliability foundation

### Outcome

Không mở rộng feature trên transaction/ownership/generation foundation chưa đóng.

### Mandatory WPs

- WP-003 Runtime config transaction closure.
- WP-004 Side-effect/artifact ownership audit.
- WP-005 Generation, cancellation and stale callback audit.

### Gate

- Critical update/config transaction fault matrix pass.
- Raw side-effect owner violations P0/P1 bằng 0 hoặc approved exception.
- Connection-scoped producers/consumers có generation proof.
- Cleanup không xóa unowned artifact.

## Phase 2 — Explicit server profile boundary

### Outcome

MinerUA là một server profile implementation; generic contracts được chứng minh bằng fake profile thứ hai.

### Mandatory WPs

- WP-100 ServerProfile contract and ADR.
- WP-101 MinerUA knowledge inventory.
- WP-102 Command/auth/join extraction.
- WP-103 GUI/item identity extraction.
- WP-104 Recipe/storage/cooldown extraction.
- WP-105 Fake second server contract tests.

### Gate

- Fake profile dùng generic bootstrap/capability path.
- Generic core không assume `/kho`, `/ks`, MMOItems.
- MinerUA B5/fishing parity giữ nguyên.
- Profile revision xuất hiện trong decision/trace.

## Phase 3 — Mode and capability SDK convergence

### Outcome

Mode mới qua một extension path; capability/result/resource/lifecycle đồng nhất.

### Mandatory WPs

- WP-200 Capability contract/registry convergence.
- WP-201 Mode lifecycle and ModeContext parity.
- WP-202 TaskSupervisor and resource claims.
- WP-203 Legacy mode adapters/migration.
- WP-204 Composable mode hardening.

### Gate

- Fake mode start/recover qua generic control path.
- Không thêm mode-name switch.
- Missing capability fail closed.
- Listener/timer cleanup proven.
- Legacy compatibility có sunset/debt record.

## Phase 4 — Planner and transaction expansion

### Outcome

Decision/reconciliation pattern của B5 được chuẩn hóa và áp dụng có chọn lọc cho domain mutation khác.

### Mandatory WPs

- WP-300 Decision/result/replay envelope.
- WP-301 Shared reconciliation barrier.
- WP-302 Storage protection/sell planner extraction.
- WP-303 B5 reference conformance.

### Optional

- WP-304 Future transaction extension point, chỉ khi có consumer thứ hai thật.

### Gate

- Planner pure/replay deterministic.
- Storage mutation không blind retry.
- B5 behavior parity và reserve/sell/protection invariants giữ.
- Shared abstraction có ít nhất hai consumer hoặc approved evidence.

## Phase 5 — Simulation and observability

### Outcome

Incident chính có thể tái hiện offline; operator/status gọn; CI chạy fault matrix có hệ thống.

### Mandatory WPs

- WP-400 Trace/support bundle/redaction convergence.
- WP-401 Virtual clock, fake capabilities, scenario and fault runner.
- WP-402 CI architecture/replay quality gates.

### Gate

- B5/storage/reconnect/update incident fixtures replay được.
- Common fault matrix reusable.
- Support bundle không leak secret.
- Health/status không parse log text.

## Phase 6 — Optional fleet scale/distribution

### Outcome

Quyết định bằng evidence có cần worker process/multi-machine hay tiếp tục modular monolith.

### Mandatory WPs để ra quyết định

- WP-500 Worker boundary feasibility and measurements.
- WP-501 Control protocol prototype and go/no-go ADR.

### Gate

Chỉ GO nếu có ít nhất một driver định lượng:

- crash isolation;
- event-loop/resource ceiling;
- bot count target;
- multi-machine deployment;
- rolling restart/update;
- security boundary.

Nếu NO-GO, giữ modular monolith và đóng prototype, không để dual architecture.

## Critical path

```text
WP-000
-> WP-001
-> WP-002
-> WP-003/WP-004/WP-005
-> WP-100
-> WP-101
-> WP-102/103/104
-> WP-105
-> WP-200/201/202
-> WP-203/204
-> WP-300/301
-> WP-302/303
-> WP-400/401/402
-> optional WP-500/501
```

## Parallel lanes

Sau P1 gate:

- Server-profile inventory có thể chạy song song với Mode SDK contract nếu không cùng đổi bootstrap registry.
- Observability schema design có thể bắt đầu sớm, nhưng rollout sau result envelope.
- Pure replay fixtures có thể thêm cùng domain planner WP.

Không parallel hai task cùng thay:

- bootstrap registration;
- ModeContext/runtime registry;
- OperationResult/error base contract;
- RuntimeConfigMigrator transaction core;
- architecture catalog/validator.

## Release cadence

Mỗi WP nên là một release/patch nhỏ khi có runtime migration risk. Có thể gom documentation/test-only WPs nếu dependency rõ và report tách evidence.

## Scope budget

Một WP nên giới hạn:

- 1 primary owner/layer;
- 2–8 source files thông thường;
- targeted tests;
- 1 migration façade;
- không feature behavior mới trừ WP nói rõ.

Nếu vượt, split WP trước khi code.
