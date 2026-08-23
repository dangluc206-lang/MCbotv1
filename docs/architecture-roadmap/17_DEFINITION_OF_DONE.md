# Definition of Done

## DoD chung cho mọi work package

- Objective đạt, không chỉ code compile.
- Current/expected/root cause hoặc target gap được ghi.
- Scope thực tế khớp WP; ngoài scope không bị sửa.
- Dependency direction đúng.
- Side-effect/resource/cleanup owner rõ.
- Generation/cancellation/stale behavior không suy yếu.
- Verification/reconciliation tồn tại cho mutation.
- Public compatibility hoặc migration rõ.
- Targeted test pass.
- Affected regression pass.
- Architecture/config validators pass hoặc approved known limitation.
- Logging/status/trace đủ debug nhưng redact.
- Docs/catalog/config cập nhật nếu contract đổi.
- Rollback/recovery hoặc safe disable path có.
- Không secret/runtime dump/generated junk trong delivery.

## DoD cho contract/architecture

- ADR ghi options/tradeoffs/decision.
- Có ít nhất một consumer thật.
- Contract test chứng minh behavior.
- Không tạo circular/lower-to-upper dependency.
- Versioning/backward compatibility rõ.
- Catalog/reachability cập nhật.

## DoD cho server profile

- Fact inventory/source/status.
- MinerUA parity.
- Fake second profile chứng minh generic boundary.
- Unknown fact fail closed.
- Profile revision trong evidence.
- Secret không nằm trong profile.

## DoD cho mode

- Descriptor/schema/capabilities/resources.
- Managed lifecycle và status.
- Task/listener supervision.
- Enable partial failure rollback.
- Pause/disable/destroy/reconnect tests.
- Generic Desktop/Discord/control path.
- No raw Mineflayer side effect.

## DoD cho operation

- Before/action/observe/verify.
- Typed outcome.
- Uncertain strategy.
- Bounded retry/recovery.
- Fault before/after side effect.
- Generation/cancel test.
- Owned cleanup/evidence retention.
- Stable error/result fields.

## DoD cho planner

- Pure function/module.
- Immutable input/output.
- Input digest/version/replay input.
- Deterministic fixture.
- Boundary purity gate.
- Executor does not silently change policy.

## DoD cho config/update

- Schema/cross-reference.
- Candidate validate before swap.
- Backup/atomic replace.
- Runtime apply rollback.
- Protected path contract.
- Dependency/version manifest.
- Fault matrix/joint postcondition.
- No unowned cleanup.

## DoD cho diagnostics/support

- Stable schema/code.
- Correlation chain.
- Operator projection.
- Forensic detail.
- Redaction tests.
- Bounded retention.
- Replay/support artifact opens/validates.

## Completion evidence block

Mỗi WP khi DONE thêm:

```text
Completed at:
Owner:
Commit/delivery:
Changed files:
Targeted tests:
Regression tests:
Validators:
Migration result:
Rollback result:
Known limitations:
Follow-up WP (if any):
```

Không dùng “all tests pass” mà thiếu command/count.
