# WP-300 — Decision, Result and Replay Envelope

## Status

`DONE — 2026-08-22 / MCbot 2.7.19`

## Objective

Chuẩn hóa additive envelope cho pure planner decision, operation outcome và replay metadata dựa trên B5 foundation.

## Depends on

- WP-002.
- WP-200.

## In scope

- Inventory current B5 planner/trace/replay shapes.
- Common minimal envelope/versioning.
- Compatibility adapter.
- One non-B5 or storage reference consumer nếu có.

## Out of scope

- Rewrite planner/executor.
- Put domain values into generic envelope.

## Minimal steps

1. Map current decision/result/replay fields and consumers.
2. Separate generic envelope from domain payload.
3. Define schema/version/digest/profile/policy fields.
4. Define outcome compatibility with OperationResult.
5. Adapt B5 trace without behavior change.
6. Add deterministic serialization/digest tests.
7. Add schema migration/rejection fixture.

## Acceptance criteria

- Same input/version/profile/policy → same decision/digest.
- Domain payload extensible without generic B5 fields.
- No runtime object/timer/client in replay.
- Existing B5 replay works through adapter.
- Version mismatch explicit.

## Tests

- determinism/property order;
- immutable input/output;
- schema invalid/version mismatch;
- redaction;
- profile/policy revision affects digest as specified.

## Rollback

Retain adapter and old replay reader for migration window; do not silently reinterpret version.

## Stop conditions

- Envelope becomes dumping ground.
- Planner purity compromised.
- Existing fixtures rewritten to hide decision change.
