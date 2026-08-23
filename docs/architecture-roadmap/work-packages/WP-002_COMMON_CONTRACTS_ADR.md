# WP-002 — Common Event, Result and Error Contracts ADR

## Status

`DONE` — completed 2026-08-22; evidence: ADR-001 + contract tests

## Objective

Quyết định additive target contract cho `EventEnvelope`, `OperationResult`, stable errors và compatibility migration.

## Depends on

- WP-001.

## In scope

- Current contract inventory.
- ADR options/tradeoffs.
- Additive schema/factory façade nếu approved.
- One reference consumer/producer.
- Contract tests.

## Out of scope

- Migrate mọi service.
- Rename toàn bộ error codes.
- Event sourcing/distributed protocol.

## Minimal steps

1. Inventory FlowError/result/event shapes and consumers.
2. Identify fields already public in Desktop/Discord/tests.
3. Define outcomes and stale/cancel/uncertain semantics.
4. Define required vs optional fields.
5. Define versioning/backward aliases.
6. Decide factory/validator location without lower→upper dependency.
7. Add reference operation/event only.
8. Add serialization/redaction tests.
9. Document migration order.

## Acceptance criteria

- ADR approved.
- Existing public fields preserved.
- `UNCERTAIN`, `STALE`, `CANCELLED` semantics unambiguous.
- Message text not machine API.
- Connection event requires bot/generation.
- One real reference path proves usefulness.

## Required tests

- Valid/invalid envelope.
- Backward compatibility.
- Cause/error code preservation.
- Redaction/no raw client serialization.
- Stale generation result application rejection.

## Rollback

Remove reference façade/consumer while retaining ADR as rejected/superseded decision.

## Stop conditions

- Requires big-bang migration.
- Generic contract contains B5/MinerUA fields.
- UI breaks because old fields removed.
