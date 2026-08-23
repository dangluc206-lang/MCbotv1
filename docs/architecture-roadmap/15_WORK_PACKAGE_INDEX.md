# Work Package Index

## Status snapshot

Status được cập nhật theo evidence của từng delivery; không khẳng định implementation chỉ dựa trên code merge.

| ID | Title | Phase | Depends on | Current status |
|---|---|---:|---|---|
| WP-000 | Documentation catalog integration | P0 | — | DONE |
| WP-001 | Architecture baseline and gap inventory | P0 | WP-000 | DONE |
| WP-002 | Common event/result/error contract ADR | P0 | WP-001 | DONE |
| WP-003 | Runtime config transaction closure | P1 | WP-001 | DONE |
| WP-004 | Side-effect and artifact ownership audit | P1 | WP-001 | DONE |
| WP-005 | Generation/cancellation/stale callback audit | P1 | WP-001 | DONE |
| WP-100 | ServerProfile contract and ADR | P2 | WP-002, P1 gate | DONE |
| WP-101 | MinerUA knowledge inventory | P2 | WP-001 | DONE |
| WP-102 | Command/auth/join profile extraction | P2 | WP-100, WP-101 | DONE |
| WP-103 | GUI/item profile extraction | P2 | WP-100, WP-101 | DONE |
| WP-104 | Recipe/storage/cooldown profile extraction | P2 | WP-100, WP-101 | DONE |
| WP-105 | Fake second server contract tests | P2 | WP-102–104 | DONE |
| WP-200 | Capability contract and registry convergence | P3 | WP-002, P1 gate | DONE |
| WP-201 | ModeContext/ManagedMode lifecycle parity | P3 | WP-200 | DONE |
| WP-202 | TaskSupervisor and resource claim model | P3 | WP-201, WP-004/005 | DONE |
| WP-203 | Legacy mode adapter migration | P3 | WP-201/202 | DONE |
| WP-204 | Composable mode hardening | P3 | WP-200/202 | DONE |
| WP-300 | Decision/result/replay envelope | P4 | WP-002/200 | DONE |
| WP-301 | Shared reconciliation barrier | P4 | WP-300, P1 gate | DONE |
| WP-302 | Storage planner extraction | P4 | WP-301, WP-104 | DONE |
| WP-303 | B5 reference conformance | P4 | WP-302, WP-201 | DONE |
| WP-304 | Future transaction extension point | P4 | WP-301 + second consumer | DEFERRED — trigger absent |
| WP-400 | Trace/support bundle/redaction convergence | P5 | WP-300 | DONE |
| WP-401 | Simulation and fault-matrix runner | P5 | WP-301/400 | DONE |
| WP-402 | CI architecture/replay quality gates | P5 | WP-401 | DONE |
| WP-500 | Worker boundary feasibility | P6 | P5 gate | DEFERRED — measurable driver absent |
| WP-501 | Control protocol prototype/go-no-go | P6 | WP-500 GO evidence | DEFERRED — WP-500 GO absent |

## Package links

### P0/P1

- [`WP-000_DOCUMENTATION_CATALOG_INTEGRATION.md`](work-packages/WP-000_DOCUMENTATION_CATALOG_INTEGRATION.md)
- [`WP-001_ARCHITECTURE_BASELINE.md`](work-packages/WP-001_ARCHITECTURE_BASELINE.md)
- [`WP-002_COMMON_CONTRACTS_ADR.md`](work-packages/WP-002_COMMON_CONTRACTS_ADR.md)
- [`WP-003_RUNTIME_CONFIG_TRANSACTION_CLOSURE.md`](work-packages/WP-003_RUNTIME_CONFIG_TRANSACTION_CLOSURE.md)
- [`WP-004_SIDE_EFFECT_AND_ARTIFACT_OWNERSHIP.md`](work-packages/WP-004_SIDE_EFFECT_AND_ARTIFACT_OWNERSHIP.md)
- [`WP-005_GENERATION_CANCELLATION_AUDIT.md`](work-packages/WP-005_GENERATION_CANCELLATION_AUDIT.md)

### P2

- [`WP-100_SERVER_PROFILE_CONTRACT.md`](work-packages/WP-100_SERVER_PROFILE_CONTRACT.md)
- [`WP-101_MINERUA_KNOWLEDGE_INVENTORY.md`](work-packages/WP-101_MINERUA_KNOWLEDGE_INVENTORY.md)
- [`WP-102_COMMAND_AUTH_JOIN_EXTRACTION.md`](work-packages/WP-102_COMMAND_AUTH_JOIN_EXTRACTION.md)
- [`WP-103_GUI_ITEM_PROFILE_EXTRACTION.md`](work-packages/WP-103_GUI_ITEM_PROFILE_EXTRACTION.md)
- [`WP-104_RECIPE_STORAGE_PROFILE_EXTRACTION.md`](work-packages/WP-104_RECIPE_STORAGE_PROFILE_EXTRACTION.md)
- [`WP-105_FAKE_SECOND_SERVER_CONTRACT.md`](work-packages/WP-105_FAKE_SECOND_SERVER_CONTRACT.md)

### P3

- [`WP-200_CAPABILITY_CONTRACT_CONVERGENCE.md`](work-packages/WP-200_CAPABILITY_CONTRACT_CONVERGENCE.md)
- [`WP-201_MODE_LIFECYCLE_PARITY.md`](work-packages/WP-201_MODE_LIFECYCLE_PARITY.md)
- [`WP-202_TASK_SUPERVISOR_RESOURCE_CLAIMS.md`](work-packages/WP-202_TASK_SUPERVISOR_RESOURCE_CLAIMS.md)
- [`WP-203_LEGACY_MODE_MIGRATION.md`](work-packages/WP-203_LEGACY_MODE_MIGRATION.md)
- [`WP-204_COMPOSABLE_MODE_HARDENING.md`](work-packages/WP-204_COMPOSABLE_MODE_HARDENING.md)

### P4

- [`WP-300_DECISION_RESULT_REPLAY_ENVELOPE.md`](work-packages/WP-300_DECISION_RESULT_REPLAY_ENVELOPE.md)
- [`WP-301_RECONCILIATION_BARRIER.md`](work-packages/WP-301_RECONCILIATION_BARRIER.md)
- [`WP-302_STORAGE_PLANNER_EXTRACTION.md`](work-packages/WP-302_STORAGE_PLANNER_EXTRACTION.md)
- [`WP-303_B5_REFERENCE_CONFORMANCE.md`](work-packages/WP-303_B5_REFERENCE_CONFORMANCE.md)
- [`WP-304_FUTURE_TRANSACTION_EXTENSION.md`](work-packages/WP-304_FUTURE_TRANSACTION_EXTENSION.md)

### P5/P6

- [`WP-400_TRACE_SUPPORT_BUNDLE.md`](work-packages/WP-400_TRACE_SUPPORT_BUNDLE.md)
- [`WP-401_SIMULATION_FAULT_MATRIX.md`](work-packages/WP-401_SIMULATION_FAULT_MATRIX.md)
- [`WP-402_CI_QUALITY_GATES.md`](work-packages/WP-402_CI_QUALITY_GATES.md)
- [`WP-500_WORKER_BOUNDARY_FEASIBILITY.md`](work-packages/WP-500_WORKER_BOUNDARY_FEASIBILITY.md)
- [`WP-501_CONTROL_PROTOCOL_GO_NO_GO.md`](work-packages/WP-501_CONTROL_PROTOCOL_GO_NO_GO.md)

## Status update rule

Khi đổi status:

- ghi ngày/owner/evidence link trong WP;
- không đánh dấu READY nếu dependency/gate chưa đạt;
- BLOCKED cần blocker cụ thể;
- DONE cần `17_DEFINITION_OF_DONE.md` và WP acceptance đạt;
- DEFERRED cần decision/trigger để xem lại.
