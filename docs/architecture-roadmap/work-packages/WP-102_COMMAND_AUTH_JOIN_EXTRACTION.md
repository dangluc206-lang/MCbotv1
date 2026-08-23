# WP-102 — Command, Authentication and Join Profile Extraction

## Status

`DONE`

## Objective

Route command catalog, credential-sensitive auth và join/Sky flow through MinerUA profile bindings while preserving command owner/throttle/verification.

## Depends on

- WP-100.
- WP-101.

## In scope

- semantic command definitions/responses;
- auth/login capability binding;
- `/is`, `/sky`, HUB/Sky join behavior;
- profile readiness/status;
- compatibility config migration.

## Out of scope

- GUI/item/recipe extraction.
- Raw command from mode.

## Minimal steps

1. Select small command group/reference consumer.
2. Add profile catalog adapter.
3. Keep `CommandExecutor` raw owner.
4. Migrate auth/join service reads.
5. Preserve credential command restrictions.
6. Add MinerUA parity fixtures.
7. Add fake command/join profile fixture.
8. Deprecate direct global lookup with warning.

## Acceptance criteria

- Mode/service asks semantic command key.
- Profile provides server-specific template/behavior.
- Command still serialized/throttled/verified.
- Password never persisted/logged/profiled.
- Fake profile uses different raw command successfully in contract test.

## Fault tests

- missing command key;
- invalid credential command request;
- command sent but join not verified;
- generation switch during join;
- profile revision mismatch.

## Rollback

Compatibility catalog fallback for MinerUA only; no raw mode chat bypass.

## Stop conditions

- `bot.chat()` new caller.
- Profile stores password.
- Join success based only on send completion.

## Completion evidence — 2026-08-22

- Runtime command catalog, response rules, authentication binding and Sky join binding resolve through the selected immutable `ServerProfile`.
- Raw chat ownership remains `CommandExecutor`; no mode/service raw-chat bypass was introduced.
- Profile construction rejects credential-bearing fields and runtime password remains supplied only to `ServerLoginService`.
- Fake profile contract proves the same semantic `storage` key can resolve `/vault open` instead of MinerUA `/kho`.
- Existing Sky join verification/generation tests prove send completion alone does not establish join success.
