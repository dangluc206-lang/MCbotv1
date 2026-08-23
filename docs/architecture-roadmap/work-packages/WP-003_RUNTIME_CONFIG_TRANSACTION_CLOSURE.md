# WP-003 — Runtime Config Transaction Closure

## Status

`DONE` — completed 2026-08-22; evidence: evidence/WP-003_RUNTIME_CONFIG_TRANSACTION_CLOSURE.md

## Objective

Đóng transaction `RuntimeConfigMigrator`/update recovery theo joint postcondition, post-side-effect reconciliation và owned cleanup trước feature expansion.

## Depends on

- WP-001 baseline.
- Round 7 final closure audit requirements là detailed implementation input.

## In scope

- `RuntimeConfigMigrator` và targeted tests.
- Joint config+metadata gate.
- One bounded closure repair.
- `cp`/write/rename/rm reconciliation.
- Artifact ownership/cleanup.
- Structured recovery evidence.

## Out of scope

- B5/storage/gameplay.
- Dependency changes.
- Updater redesign.
- Unlimited retry.

## Minimal steps

1. Convert audit RF8 requirements to tests first.
2. Centralize path/digest observation with read-error distinction.
3. Centralize verified staging after resolve/reject.
4. Add operation-local artifact ownership registry.
5. Defer cleanup until final joint gate.
6. Add bounded closure repair for cross-component mutation.
7. Preserve original error when exact recovery succeeds.
8. Preserve verified sources on fatal failure.
9. Keep public contracts/version patch-only.
10. Run targeted/adjacent/regression/validators.

## Acceptance criteria

- No cached component boolean can yield mixed-state success.
- Throw-after-side-effect exact stage/source is recognized.
- Unowned collision is never removed.
- Retry/repair bounded.
- Stable prepare/rollback recovery codes and cause.
- Existing RF6/RF7 tests remain strong.

## Required fault tests

- Metadata recovery mutates config after config verify.
- Stage copy completes then throws.
- Verification read transient.
- Metadata source write completes then throws.
- `.failed-*` collision.
- `.rollback-current-*` collision.
- Repeated sabotage reaches fatal retained-evidence state.

## Rollback

Patch has local version/base contract; rollback to previous migrator only via verified update/installer policy. Never manually delete runtime config/backups.

## Deliverables

- Narrow source/test/package patch.
- Exact hashes/report.
- Test matrix mapping.

## Stop conditions

- Functional scope grows beyond migrator.
- Fix uses sleep/unbounded retry.
- Cleanup path has no ownership proof.
- Existing transaction test weakened.
