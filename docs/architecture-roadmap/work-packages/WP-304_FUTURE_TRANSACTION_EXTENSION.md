# WP-304 — Future Transaction Extension Point

## Status

`DEFERRED — NOT ACTIVATED (2026-08-22): no approved second transaction consumer with concrete requirements`

## Objective

Chỉ khi có consumer thứ hai thật (auction/trade/farming economy), xác định extension point tái dùng planner/reconciliation mà không hard-code domain mới vào B5/storage.

## Depends on

- WP-301.
- Approved feature consumer với concrete requirements.

## Activation trigger

- Có task feature thật.
- Domain action có uncertain/destructive semantics.
- Existing operation primitives không đủ mà không duplicate.

## In scope khi activate

- Consumer-specific snapshot/planner/executor.
- Shared contract gaps proven by comparison.
- Minimal extension to generic envelopes/barrier.

## Out of scope

- Speculative auction/trade implementation.
- Generic workflow language.

## Minimal steps

1. Document consumer behavior/source of truth.
2. Implement domain vertical slice locally first.
3. Compare with storage/crafting contracts.
4. Extract only shared semantic.
5. Add two-consumer contract tests.
6. Reassess abstraction.

## Acceptance criteria

- At least two real consumers.
- Shared layer has no B5/auction-specific fields.
- Both behavior suites pass.
- No new raw side-effect bypass.

## Stop conditions

- No second consumer.
- Abstraction only renames existing classes.
