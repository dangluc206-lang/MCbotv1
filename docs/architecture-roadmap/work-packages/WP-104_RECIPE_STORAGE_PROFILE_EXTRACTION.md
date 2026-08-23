# WP-104 — Recipe, Storage and Cooldown Profile Extraction

## Status

`DONE`

## Objective

Expose MinerUA recipe/quantity/storage/sell/smelting/conversion/cooldown facts through profile-bound semantic catalogs.

## Depends on

- WP-100.
- WP-101.

## In scope

- recipe identity/inputs/outputs/quantity actions;
- storage capacity/parse/sell semantics;
- smelting/conversion facts;
- B5 cooldown/server timing facts;
- capability bindings/readiness.

## Out of scope

- Change B5 policy/reserve values.
- Add auction/trade.
- Rebuild planners.

## Minimal steps

1. Separate server fact from bot policy in inventory.
2. Define profile catalog schemas and revisions.
3. Migrate read-only resolver paths first.
4. Bind storage/smelting/conversion/crafting capabilities.
5. Preserve current verification/action owners.
6. Add MinerUA parity fixtures.
7. Add fake profile with altered quantities/capacity/cooldown.
8. Add unknown fact fail-closed tests.

## Acceptance criteria

- Generic planner consumes semantic recipe/storage facts.
- B5-specific policy stays outside generic profile engine.
- `/kho`/`/ks`/`/nung` raw details only in MinerUA implementation/config.
- Fake profile can change facts without core edit.
- Current B5/storage behavior parity.

## Tests

- recipe resolution parity;
- quantity capability differences;
- storage parse/capacity;
- unknown cooldown/fact;
- profile revision changes decision digest;
- no movement introduced into B5.

## Rollback

Compatibility adapter for current config groups; no deletion until profile parity/reachability.

## Stop conditions

- Bot policy mislabeled server fact.
- Server UNKNOWN used for destructive mutation.
- B5 planner rewrite in extraction WP.

## Completion evidence — 2026-08-22

- Recipe/tier/storage/PV2/minerals/conversion/smelting/server-timing reads are profile-backed in bot construction.
- B5 target/reserve/optimization policy remains outside `ServerProfile`; only the 30-minute post-B5 timing fact is supplied by the profile timing catalog.
- Fake profile changes recipe quantities, quantity slots, storage capacity and cooldown without changing generic core.
- Missing required timing facts fail closed through `ServerProfile.requireCatalog`.
