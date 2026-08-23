# WP-004 — Side-effect and Artifact Ownership Audit

## Status

`DONE` — completed 2026-08-22; evidence: architecture/artifact-ownership.json + ownership audit tests

## Objective

Chứng minh mọi raw side effect và destructive cleanup quan trọng có một owner, không có bypass và có stale/ownership guard.

## Depends on

- WP-001.

## In scope

- `bot.chat`, `clickWindow`, `client.end`, raw `_client`.
- Config/update filesystem write/rename/delete.
- GUI/inventory/movement mutations.
- Temp/stage/backup/quarantine ownership.
- Architecture catalog and tests.

## Out of scope

- Refactor domain behavior không có violation.
- Create locks without conflict evidence.

## Minimal steps

1. Search raw side-effect symbols.
2. Map caller → owner → verification.
3. Classify sanctioned/violation/unknown.
4. Map destructive path generation/normalization/ownership.
5. Add catalog rule/test before moving violations.
6. Fix one violation per safe slice through existing owner.
7. Add cancellation/generation/cleanup tests.
8. Remove bypass after reachability proof.

## Acceptance criteria

- Catalog matches actual owner callsites.
- No mode/Discord/renderer raw bypass.
- Cleanup only owned/allowed-root path.
- Action success verified at domain layer.
- Violation exceptions have owner/reason/expiry.

## Required tests

- Forbidden owner static scan.
- Bypass fixture rejection.
- Cleanup collision/unowned sentinel.
- Owner stale/release test.
- Side-effect throw-before/after.

## Rollback

Compatibility façade can restore old API routing but raw bypass must not be reintroduced without documented exception.

## Stop conditions

- Bulk moving files without caller tests.
- Catalog changed to hide violation.
- Deleting user/runtime paths during audit.
