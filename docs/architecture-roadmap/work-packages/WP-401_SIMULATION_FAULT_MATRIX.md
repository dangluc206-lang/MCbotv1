# WP-401 — Simulation, Virtual Time and Fault Matrix Runner

## Status

`DONE — 2026-08-22 / MCbot 2.7.24`

## Objective

Tạo deterministic scenario harness dùng fake adapters/capabilities/clock để tái hiện lifecycle, generation, GUI, transaction và recovery offline.

## Depends on

- WP-301.
- WP-400.

## In scope

- Current simulation/replay inventory.
- Virtual clock abstraction at test boundary.
- Scripted event/observation/fault runner.
- Reusable before/after-side-effect hooks.
- Reference scenarios.

## Out of scope

- Reimplement Mineflayer/server.
- Production scheduler replacement.

## Minimal steps

1. Select reference incidents and public boundaries.
2. Define scenario schema/version.
3. Add virtual clock/fake event source.
4. Add fake command/click/connection/capability adapters.
5. Add operation/path-aware fault hooks.
6. Add assertion/evidence collector.
7. Convert representative existing tests.
8. Document fixture authoring.

## Scenario concepts

```text
initial state
events
expected commands/actions
fault injections
clock advances
observations
expected outcomes/status/traces
```

## Acceptance criteria

- No real server/network.
- No long sleep.
- Same fixture deterministic.
- Fault before/after/resolve-wrong/read-transient supported.
- Multi-bot/generation isolation possible.
- Harness uses production contracts, not copied planner logic.

## Reference tests

- stale callback reconnect;
- click applied/response lost;
- storage sell uncertain;
- config rename/copy fault;
- mode disable during backoff;
- unowned cleanup collision.

## Rollback

Harness/tests are additive; keep existing tests until parity and reliability proven.

## Stop conditions

- Simulator embeds production decisions.
- Global call-count fault hooks dominate instead of path/operation-aware hooks.
- Flakiness requires sleep increase.
