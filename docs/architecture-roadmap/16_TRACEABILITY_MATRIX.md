# Traceability Matrix

## Objective → work package

| Objective | Contracts/invariants | Work packages | Primary evidence |
|---|---|---|---|
| Docs governed và machine-auditable | authority order, catalog consistency | WP-000/001 | validator + baseline manifest |
| Verified recovery/update | operation/recovery, artifact ownership | WP-003/004 | fault matrix + artifact tests |
| Stale callbacks fail closed | EventEnvelope/generation | WP-005 | producer/consumer audits |
| Multi-server core | ServerProfile/capability binding | WP-100–105 | fake profile contract suite |
| Generic mode extension | ModeDescriptor/ManagedMode | WP-200–204 | fake mode lifecycle tests |
| Explicit workflow resources | ResourceClaim/owner revision | WP-202 | contention/cancellation tests |
| Pure/replayable decisions | DecisionEnvelope | WP-300/302/303 | replay fixtures/parity |
| No blind retry | OperationResult/reconciliation | WP-301/302 | uncertain outcome tests |
| Operator + forensic visibility | TraceEnvelope/health | WP-400 | redaction/status/support tests |
| Deterministic failure reproduction | fake adapter/clock/scenario | WP-401/402 | scenario CI suite |
| Scale without premature distribution | worker boundary/protocol | WP-500/501 | benchmark + ADR |

## North Star criteria → gates

| Criterion | Gate |
|---|---|
| Add bot without shared mutable state | multi-bot isolation/generation tests |
| Add mode without control-plane special case | P3 fake mode gate |
| Add server without generic-core edit | P2 fake profile gate |
| Planner offline | P4 planner purity/replay gate |
| Mutation has verified typed outcome | P1/P4 operation gate |
| Incident replay | P5 support/scenario gate |
| Update cannot mix state | P1 transaction gate |
| Optional worker split preserves contract | P6 protocol parity gate |

## Existing invariant → roadmap protection

| Existing invariant | Protected by |
|---|---|
| Command side effect owner | WP-004, architecture gate |
| GUI click side effect owner | WP-004, architecture gate |
| Connection generation | WP-005 |
| Mode lease exact release | WP-201/202 |
| Planner purity | WP-300/402 |
| Config validation/backup | WP-003/402 |
| B5 pure/no movement | WP-303 |
| Storage reserve/sell gate | WP-302/303 |
| Local ZIP protected paths | WP-003/004/402 |

## Required evidence types

- Source diff.
- Contract/schema diff.
- Architecture reachability/import scan.
- Targeted tests.
- Fault injection.
- Replay fixture.
- Migration/rollback result.
- Structured trace/status example.
- Artifact hash/manifest khi delivery ZIP.

Một objective không được đánh dấu đạt nếu chỉ có tài liệu hoặc chỉ có test mock không đi qua public contract.
