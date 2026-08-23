# Pre-WP-500 Scale Baseline — 2026-08-23

## Decision status

`WP-500 remains DEFERRED / NOT ACTIVATED.`

This evidence removes the previous “no measurement” gap, but it does **not** invent a product SLO or fleet-size requirement. The repository still has no externally owned target bot count, latency SLO, memory SLO, or failure-tolerance budget, so Phase 6 entry criteria are not satisfied.

## Measurement model

The read-only harness in `scripts/measure-scale-baseline.js` uses current production core primitives: `Application`, `BotRegistry`, `BotRuntime`, `BotState`, `LifecycleCoordinator`, and `EventBus`. It intentionally excludes Mineflayer sockets, live Minecraft server work, GUI/pathfinding, and Discord network I/O.

Committed machine-readable evidence: `architecture/scale/current.json`.

Measured workload on the current execution environment:

| BotRuntime count | Start latency | Events | Event throughput | Event loss | p99 event-loop delay |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0.540 ms | 50 | 39,367/s | 0 | 10.584 ms |
| 8 | 0.149 ms | 400 | 213,382/s | 0 | 10.101 ms |
| 16 | 0.246 ms | 800 | 228,855/s | 0 | 10.093 ms |
| 32 | 0.874 ms | 1,600 | 207,398/s | 0 | 10.109 ms |
| 64 | 2.085 ms | 3,200 | 238,786/s | 0 | 10.207 ms |

Synthetic crash isolation at 64 runtimes: one injected runtime start failure produced **1 rejected runtime and 63 fulfilled runtimes**. `Application.start()` therefore contains the synthetic blast radius to one runtime in this model.

## Interpretation

The measurement does not show a core-level reason to split processes. Current evidence favors retaining the modular monolith until a real fleet target, SLO, incident pattern, live resource ceiling, rolling-restart requirement, or security/isolation requirement supplies the measurable driver demanded by WP-500.

These numbers are evidence, not permanent thresholds. CI validates schema, event delivery, crash-isolation semantics, and the non-speculative decision state; it does not fail builds on machine-dependent latency/memory values.
