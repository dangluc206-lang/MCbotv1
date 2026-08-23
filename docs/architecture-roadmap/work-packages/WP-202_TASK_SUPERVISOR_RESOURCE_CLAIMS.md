# WP-202 — TaskSupervisor and Resource Claim Model

## Status

`DONE`

## Objective

Đưa background task/listener và conflict resources có evidence vào explicit owner model, không tạo global boolean locks.

## Depends on

- WP-201.
- WP-004.
- WP-005.

## In scope

- Current task/timer/listener inventory in selected mode.
- TaskSupervisor contract/parity.
- Resource conflict graph.
- Add only proven claims/order.

## Out of scope

- Generic distributed scheduler.
- Resource cho conflict chưa tồn tại.

## Minimal steps

1. Select one mode/flow with unsupervised task.
2. Map owner/generation/cancel/cleanup.
3. Migrate to supervisor with parity test.
4. Build conflict graph for GUI/inventory/movement/command.
5. Decide required claims/ordering via ADR.
6. Add acquisition/release/stale guard.
7. Add contention/deadlock bounded tests.
8. Repeat only approved slices.

## Acceptance criteria

- No orphan timer/listener in migrated slice.
- Disable/destroy awaits bounded cleanup.
- Stale task cannot release new resource.
- Claims match real conflict.
- Acquisition order prevents tested deadlock.
- Status shows blocked resource/owner safely.

## Tests

- cancel during delay/action;
- generation switch;
- two operations contend;
- partial multi-resource acquire failure;
- stale release;
- supervisor task exception isolation.

## Rollback

Compatibility wrapper can delegate old loop through supervisor; do not restore unmanaged timer after resource contract rollout.

## Stop conditions

- Add every candidate resource at once.
- Promise race leaves task unowned.
- Retry becomes unbounded.

## Completion evidence — 2026-08-22

- Collector+B5 unhandled-retry timer is now owned by `TaskSupervisor`; pause/disable await cancellation and destroy closes the supervisor.
- `architecture/resource-claims.json` records only proven mode/operation claims; no global boolean lock was added.
- ModeCoordinator atomic all-or-none acquisition and lease-id guarded release are covered for contention/partial acquire/stale release.
- Existing operation resource owners remain OperationManager; current production modes retain only the proven `primary-mode` cross-mode claim.
