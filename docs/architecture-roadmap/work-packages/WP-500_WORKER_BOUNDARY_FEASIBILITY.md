# WP-500 — Worker Boundary Feasibility

## Status

`DEFERRED — NOT ACTIVATED (2026-08-22): Phase 6 measurable scale/reliability driver is absent`

## Objective

Đo và quyết định liệu BotRuntime cần process/worker isolation; không implement distributed production runtime.

## Depends on

- Phase 5 gate.
- Concrete scale/reliability driver.

## In scope

- Current resource/crash/latency measurements.
- Candidate worker boundary.
- Serialization/ownership/security constraints.
- Cost/benefit/SLO ADR.

## Out of scope

- Production rollout.
- Message broker/database selection.

## Minimal steps

1. Define target bot count/SLO/failure tolerance.
2. Measure CPU/memory/event-loop/crash blast radius.
3. List objects that cannot cross boundary.
4. Map control/event/result protocol candidates.
5. Estimate operational complexity.
6. Compare alternatives: single process, process pools, workers, multi-host.
7. Produce GO/NO-GO ADR and revisit trigger.

## Acceptance criteria

- Decision based on measurements.
- Contract preserves bot/generation/operation/intent revision.
- No raw client/window/packet serialization.
- Security/secret distribution addressed.
- NO-GO is acceptable outcome.

## Stop conditions

- “Microservice is cleaner” is only driver.
- P0–P5 boundaries not stable.
- No owner for operations/on-call complexity.
