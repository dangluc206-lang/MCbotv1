# Phase 3 — Mode and Capability SDK

## Outcome

Một đường chuẩn duy nhất để register/control mode mới; capability readiness/result/resources/lifecycle thống nhất.

## Entry criteria

- P1 gate đạt.
- WP-002 contract decision.
- Server profile contract đủ cho capability binding hoặc scope mode độc lập rõ.

## Mandatory work packages

- WP-200 đến WP-204.

## Sequence

1. Catalog capability contracts/current bindings.
2. Add additive descriptor/readiness/result façade.
3. ModeContext/ManagedMode lifecycle parity.
4. Supervisor/resource claim migration.
5. Adapt one legacy mode vertical slice.
6. Harden composable builder/module catalog.
7. Generic control-plane/fake-mode tests.

## Required tests

- Descriptor bind/reject.
- Missing capability fail closed.
- Enable partial failure rollback.
- Pause/resume/disable/destroy idempotency.
- Generation switch cancels old task.
- Resource contention and stale release.
- Invalid custom mode visible-for-repair, backend still boots.
- No control-plane `if modeId` growth.

## Exit criteria

- New mode scaffold uses SDK path.
- Control plane resolves from catalog/runtime registry.
- Background loops supervised.
- Legacy modes có adapter/status/migration plan.
- Composable modules validated/allowlisted.

## Stop conditions

- Copy legacy mode làm template.
- Expose raw bot/client qua ModeContext convenience.
- Add global boolean lock.
- Custom arbitrary JS/raw command.
