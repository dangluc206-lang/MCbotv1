# Phase 1 — Reliability Foundation

## Outcome

Transaction, side-effect/artifact ownership, generation và cancellation đạt mức đủ an toàn để mở rộng server/mode.

## Entry criteria

- Phase 0 gate đạt.
- Critical current audits/specs được tập hợp.
- Affected owners không có overlapping migration.

## Mandatory work packages

- WP-003.
- WP-004.
- WP-005.

## Workstreams

### Update/config transaction

- joint postcondition;
- throw-before/after-side-effect;
- owned cleanup;
- retained recovery source;
- stable diagnostics.

### Runtime side-effect ownership

- command/click/end/raw protocol;
- filesystem/update/config writes;
- bypass/caller reachability;
- cleanup owners.

### Generation/cancellation

- event producers/scopes;
- timers/listeners/tasks;
- operation result application;
- lease/session release;
- reconnect/explicit disconnect races.

## Required tests

- RuntimeConfigMigrator closure matrix.
- Local update overlay/protected paths.
- Raw side-effect architecture scan.
- Event scope/producer guard tests.
- Late client/callback/reconnect tests.
- Owner collision/cleanup tests.

## Exit criteria

- Không known P0/P1 false recovery success/mixed state.
- Không recursive cleanup unowned target.
- Connection-scoped action checks generation.
- Explicit stop/disconnect cancels owned work.
- Architecture/config/full relevant regression pass.

## Stop conditions

- Fix bằng sleep/retry vô hạn.
- Bỏ verification để pass test.
- Core rewrite không liên quan root cause.
- Delivery chạm B5/gameplay để sửa updater.


## Gate status

`PASS` — 2026-08-22 after WP-003, WP-004 and WP-005 evidence/validation.
