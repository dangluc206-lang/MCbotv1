# WP-402 — CI Architecture, Replay and Quality Gates

## Status

`DONE — 2026-08-22 / MCbot 2.7.25`

## Objective

Đưa contract/architecture/replay/fault evidence quan trọng vào CI/release gate với kết quả rõ PASS/FAIL/BLOCKED.

## Depends on

- WP-401.

## In scope

- Test suite grouping/time budget.
- Architecture/config/replay/scenario gates.
- Artifact/report schema.
- Blocked installed gate semantics.

## Out of scope

- Cloud CI vendor migration nếu không cần.
- Lower quality thresholds.

## Minimal steps

1. Inventory scripts/runtime/flaky/installed dependencies.
2. Define fast targeted vs release matrix.
3. Add architecture/docs/profile/mode/planner gates.
4. Add replay/fault reference scenarios.
5. Standardize exit/report counts.
6. Mark environment-blocked distinctly.
7. Add artifact hashes/manifests for update delivery.
8. Document local reproduction.

## Acceptance criteria

- Critical gate cannot silently skip.
- BLOCKED is not PASS.
- No real server dependency default.
- Failure points to contract/WP/evidence.
- Runtime within agreed budget or explicitly split.
- Docs/catalog validation included.

## Required gates

- syntax;
- targeted unit/contract;
- architecture/structure;
- config schema/cross-reference;
- planner purity/replay;
- event generation audit;
- update safety;
- selected fault matrix;
- broader regression.

## Rollback

New slow gate can move to release lane temporarily with owner/expiry; critical safety assertions không được xóa.

## Stop conditions

- Tests changed to accept wrong implementation.
- Gate passes via catch/ignore exit code.
- Dependency installed/changed solely to hide environment blocker.
