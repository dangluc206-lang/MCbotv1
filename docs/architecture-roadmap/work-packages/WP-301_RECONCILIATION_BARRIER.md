# WP-301 — Shared Reconciliation Barrier

## Status

`DONE — 2026-08-22 / MCbot 2.7.20`

## Objective

Tạo reusable semantics cho `UNCERTAIN` mutation: khóa conflict, fresh-read, classify và chỉ retry khi chứng minh an toàn.

## Depends on

- WP-300.
- Phase 1 gate.

## In scope

- Existing crafting reconciliation inventory.
- Common classifier/result/attempt semantics.
- Resource blocking/cancellation/generation.
- At least two real consumers hoặc one current + one imminent approved.

## Out of scope

- Generic workflow engine.
- Auto-retry every timeout.

## Minimal steps

1. Extract invariant from crafting without moving policy.
2. Define reconciliation input/evidence/outcomes.
3. Define fresh observation strategy and bounds.
4. Hold/release required resources.
5. Handle generation/cancel.
6. Adapt reference crafting path with parity.
7. Adapt second consumer or defer abstraction.
8. Add fault matrix/replay.

## Acceptance criteria

- `UNCERTAIN` blocks next conflicting mutation.
- No duplicate action inside barrier.
- Fresh evidence classified deterministically.
- Retry only when action-proven-not-applied.
- Stale/cancel abort safely.
- Attempts bounded/log suppressed.

## Tests

- action applied but response lost;
- action not applied;
- evidence incomplete;
- generation switch;
- cancellation;
- resource contention;
- repeated no-progress.

## Rollback

Reference consumer can return to local reconciler; do not remove `UNCERTAIN` safety semantics.

## Stop conditions

- Only one consumer and no approved imminent second.
- Barrier sends action itself.
- Timeout directly triggers retry.
