# Conditional Work Package Review — 2026-08-22

This review follows completion of the mandatory P0–P5 roadmap on MCbot 2.7.25. It does **not** mark conditional packages DONE and does not invent activation evidence.

## WP-304 — Future Transaction Extension Point

Decision: **DEFERRED / NOT ACTIVATED**.

Evidence:

- README lists `auction/trading`, `farming`, and `mining` as `PLANNED` directions only.
- No approved second transaction/economy feature has a concrete behavior contract, source of truth, uncertain/destructive mutation semantics, or acceptance tests in the repository.
- Existing B5/storage consumers already use the shared reconciliation contracts; creating an auction/trade abstraction now would violate WP-304's own stop condition (“No second consumer”).

Revisit trigger: an approved concrete feature task whose domain operations cannot use existing planner/operation/reconciliation primitives without duplication.

## WP-500 — Worker Boundary Feasibility

Decision: **DEFERRED / PHASE 6 NOT ENTERED**.

P0–P5 gates are complete, but Phase 6 requires a measurable driver. The repository currently does not define:

- target bot count or capacity SLO;
- CPU/memory/event-loop threshold exceeded by the modular monolith;
- measured crash blast-radius requirement;
- multi-machine deployment requirement;
- rolling-restart/update SLO requiring process isolation;
- security isolation requirement that cannot be met in-process.

Without those measurements, starting a worker/process prototype would violate the Phase 6 entry criteria and Decision Gate 8.

Revisit trigger: a benchmark/incident/SLO supplies at least one quantified driver and an owner for the added operational complexity.

## WP-501 — Control Protocol Prototype / Go-No-Go

Decision: **DEFERRED / NOT ACTIVATED**.

WP-501 explicitly depends on a **WP-500 GO ADR**. No such ADR exists because WP-500 was not activated. A fake worker protocol would create an ungoverned dual architecture and violate the work package stop conditions.

Revisit trigger: WP-500 completes with a measured GO decision.

## Governed current outcome

The deployment target remains the modular monolith. All mandatory P0–P5 packages are DONE; WP-304, WP-500 and WP-501 remain intentionally conditional, with explicit revisit triggers rather than speculative implementation.
