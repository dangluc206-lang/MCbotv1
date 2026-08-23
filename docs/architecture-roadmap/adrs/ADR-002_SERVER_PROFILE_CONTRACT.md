# ADR-002 — ServerProfile Contract Boundary

## Status

Accepted — 2026-08-22

## Decision

MCbot uses an immutable per-runtime `ServerProfile` selected by stable profile ID and deterministic revision. The profile owns server endpoint facts and semantic catalog/binding/capability declarations; it never owns bot secrets, mutable runtime state, B5 workflow state, timers, clients or windows.

The current `config/server.json` endpoint entries are wrapped as `minerua-compat` profiles without moving command/GUI/item/recipe/storage data in this WP. Those facts migrate in WP-102–104. Missing profiles, catalogs, bindings or declared capabilities fail closed with `SERVER_PROFILE_NOT_READY`.

`BotIdentity` records both selected profile ID and revision. Runtime services receive the immutable profile object through composition root, so later decision/trace envelopes can include the same revision without re-reading mutable config.

## Compatibility

- Existing `serverProfile` bot-profile selection remains valid.
- Existing server endpoint resolution is behavior-equivalent (`defaults + selected endpoint`).
- Password remains injected from environment into the bot runtime profile and is never stored in `ServerProfile`.
- Existing configuration groups remain source-of-truth until their extraction WP.

## Verification

- `tests/unit/server-profiles/ServerProfile.test.js`
- bootstrap/createApplication and configuration contract suites
- architecture validator and full suite

## Links

WP-100, WP-101, WP-102, WP-103, WP-104, WP-105.
