# WP-005 — Generation, Cancellation and Stale Callback Audit

## Status

`DONE` — completed 2026-08-22; evidence: evidence/WP-005_GENERATION_CANCELLATION_AUDIT.md

## Objective

Đảm bảo callback/task/result từ connection hoặc owner cũ không tác động runtime/resource generation mới.

## Depends on

- WP-001.

## In scope

- connection-scoped event registry/producers/consumers;
- reconnect/late client;
- operation result application;
- mode tasks/listeners/timers;
- GUI/movement sessions;
- lease/resource release;
- explicit connect/disconnect.

## Out of scope

- Server reconnect policy tuning.
- New mode features.

## Minimal steps

1. Enumerate connection-scoped events and producers.
2. Trace generation capture/check at registration and callback.
3. Enumerate long-lived promises/timers/listeners.
4. Enumerate release/cleanup callbacks.
5. Build stale scenario matrix.
6. Add guards at owning boundary, not message-string workaround.
7. Migrate unsupervised tasks only where needed.
8. Update event scope/catalog tests.

## Acceptance criteria

- Every connection event carries bot/generation.
- Old generation cannot mutate state or release new owner.
- Explicit disconnect wins over pending reconnect/late client.
- Reconnect in same process retains valid desired mode.
- Mode disable cancels old tasks boundedly.

## Required tests

- generation switch between action and result;
- late spawned client after explicit stop;
- stale GUI callback;
- stale task attempts lease release;
- bot A callback cannot affect bot B;
- cancel during retry/backoff;
- destroy idempotency.

## Rollback

Guard changes are additive. Nếu compatibility issue, revert one producer/consumer slice, không tắt global generation enforcement.

## Stop conditions

- Fix bằng global boolean.
- Drop event để pass test mà không route replacement.
- Generation guard removed from existing flows.
