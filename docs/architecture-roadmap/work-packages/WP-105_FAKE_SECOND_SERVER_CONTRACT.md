# WP-105 — Fake Second Server Contract Tests

## Status

`DONE`

## Objective

Chứng minh ServerProfile boundary là thật bằng một fake profile khác MinerUA, không nhằm hỗ trợ production server mới.

## Depends on

- WP-102.
- WP-103.
- WP-104.

## In scope

- Fake profile fixture/module.
- Generic bootstrap/profile selection.
- Command/GUI/item/recipe/storage capability contract tests.
- Import isolation assertions.

## Out of scope

- Network/live server.
- Full gameplay mode.
- Shipping fake profile to operator config nếu không cần.

## Fake differences bắt buộc

- command template khác;
- GUI title/fingerprint và semantic slot khác;
- item representation khác;
- recipe quantity/cooldown/capacity khác;
- join flow khác;
- ít nhất một capability unsupported.

## Minimal steps

1. Define fixture profile revision.
2. Bind fake adapters/capabilities.
3. Run same semantic contract suite as MinerUA.
4. Verify unsupported capability fail readiness.
5. Verify no MinerUA import/constant.
6. Verify per-bot mixed profiles isolate.

## Acceptance criteria

- Same generic consumer works with both profiles.
- No conditional `if profileId === minerua` in generic core.
- Unsupported feature fails closed.
- Mixed-profile bots do not share mutable knowledge.
- Profile revision captured in result/trace.

## Rollback

Fixture/tests removable without runtime behavior; nếu fail, profile boundary remains incomplete and P2 gate stays blocked.

## Stop conditions

- Fake simply copies MinerUA values.
- Test calls implementation directly instead of public binding.

## Completion evidence — 2026-08-22

- Fake second server differs in raw command, GUI titles/slots, item representation, recipe quantity, capacity, cooldown and join slots.
- The same public `CommandService` and `SkyblockJoinOperation` execute the fake profile.
- Unsupported `personalVault` capability fails closed.
- Mixed profiles retain separate immutable catalogs and trace evidence captures profile revision.
- Static contract rejects profile-id MinerUA branching in designated generic modules.
