# WP-302 — Storage Protection and Sell Planner Extraction

## Status

`DONE — 2026-08-22 / MCbot 2.7.21`

## Objective

Tách quyết định storage protection/sell thành pure planner với snapshot digest, policy, server profile facts và replay; executor/capability giữ side effects.

## Depends on

- WP-301.
- WP-104.

## In scope

- Fresh storage/inventory snapshot model.
- Reserve/surplus/normalization decisions.
- Smelt/compact/sell step plan theo contract.
- Replay fixtures.
- Executor parity adapter.

## Out of scope

- Change reserve default/policy.
- Add new sell command semantics.
- B5 full rewrite.

## Minimal steps

1. Capture current policy/executor decision points.
2. Separate server facts vs bot policy.
3. Define immutable snapshot/completeness/freshness.
4. Implement pure plan and blockers.
5. Attach input/policy/profile digest.
6. Adapt executor to consume plan with precondition recheck.
7. Add reconciliation for uncertain action.
8. Add replay/property/boundary tests.

## Core invariants

- Fresh observation before plan.
- Only raw iron/raw gold smelting where current selected contract requires.
- Fresh verify before compaction/sell.
- Sell only verified surplus block units.
- Retention floor policy exact.
- Inflow after plan deferred to next campaign unless explicit replan boundary.
- No blind repeat on uncertain sell.

## Acceptance criteria

- Planner pure and deterministic.
- Snapshot incomplete/stale blocks mutation.
- Executor does not silently change quantities/policy.
- Current storage/B5 behavior parity.
- Replay explains why each step/blocker selected.

## Tests

- reserve boundary/equality/rounding;
- raw/ingot/block combinations;
- capacity pressure;
- inflow after snapshot;
- uncertain sell;
- profile/policy revision;
- generation stale;
- no-progress bounded.

## Rollback

Compatibility adapter can call old decision path while retaining new snapshot/trace; parity fixture decides.

## Stop conditions

- Planner sends command/click/timer.
- Server raw command leaks into generic decision.
- Policy values changed without user task.
