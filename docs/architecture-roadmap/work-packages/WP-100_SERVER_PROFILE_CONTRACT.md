# WP-100 — ServerProfile Contract and ADR

## Status

`DONE` — completed 2026-08-22; evidence: ADR-002 + ServerProfile contract tests

## Objective

Định nghĩa ServerProfile boundary tối thiểu và bootstrap selection mà không di chuyển MinerUA code hàng loạt.

## Depends on

- WP-002.
- Phase 1 gate.

## In scope

- Current server/config/profile consumer inventory.
- ADR contract/registry/selection/versioning.
- Per-bot profile resolution.
- Additive MinerUA façade binding.
- Fake minimal descriptor skeleton.

## Out of scope

- Move all commands/GUI/items/recipes.
- Support production second server.

## Minimal steps

1. Identify consumers of `config/server.json` and server facts.
2. Define profile ID/revision/readiness/capability binding.
3. Decide config vs JS registry ownership.
4. Define secret exclusion.
5. Add resolver/factory at bootstrap.
6. Bind current MinerUA defaults through façade.
7. Add missing/unknown profile fail-closed path.
8. Add status/trace profile context.

## Acceptance criteria

- Bot runtime knows selected profile ID/revision.
- Existing MinerUA behavior unchanged.
- Generic consumer can request semantic catalogs/bindings.
- Missing profile/capability yields structured readiness failure.
- No secrets in profile.

## Tests

- default/explicit profile selection;
- per-bot isolation;
- unknown profile rejection;
- revision/status projection;
- no generic import of specific implementation in designated module.

## Rollback

Keep façade optional and fall back to current MinerUA wiring for one migration window with warning; remove only after parity.

## Stop conditions

- Contract includes B5-specific workflow state.
- Physical mass move.
- Profile becomes mutable runtime singleton.
