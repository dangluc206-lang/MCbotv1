# WP-001 — Architecture Baseline and Gap Inventory

## Status

`DONE` — 2026-08-22

## Completion evidence

- Baseline release: MCbot Desktop `2.7.3`.
- Machine-readable manifest: `architecture/baseline/current.json`; schema contract: `architecture/baseline/schema.json`.
- Reproducible read-only inspector/check: `scripts/inspect-architecture-baseline.js` + `scripts/architecture-baseline.js`; tool chỉ xuất stdout/đọc manifest và không mutate repo.
- Human gap inventory: `docs/architecture-roadmap/baseline/WP-001_GAP_REPORT.md`.
- Capture on 2026-08-22: 288 source / 143 test / 22 script files; 288/288 source project-reachable, 284 runtime-reachable; 32 config groups; 31 connection-scoped events; 24 capability bindings; 3 mode descriptors.
- Scope exclusions are explicit for `.git/**`, `.env*`, `data/**`, `node_modules/**`, `**/*.log`; `config/bots/**` is path/count-inventoried but never content-scanned. Packaged baselines without `.git` record Git as unavailable and include a safe-scope SHA-256 source fingerprint instead of inventing a revision.
- Architecture validator is embedded as comparison evidence and reports 0 failures for this baseline. Findings are classified CURRENT/TARGET/DEBT/UNKNOWN and linked to later WPs; WP-001 does not auto-fix them.
- Targeted WP-001 test: 4/4 PASS; `npm run baseline:check`: 0 failures; `npm run validate`: 0 failures.
- Full suite: 780/781 PASS. The sole failure is the pre-existing `B1SmeltingTelemetrySoftFail.test.js`; the same case fails on the untouched 2.7.2 baseline and is outside WP-001.
- Runtime/gameplay source behavior: unchanged; no `src/**` files or dependencies changed.

## Objective

Tạo baseline machine-readable/current evidence để migration không dựa vào tài liệu stale hoặc cảm giác.

## Depends on

- WP-000.

## In scope

- source/test/config/script counts/routes;
- runtime entrypoints/reachability;
- side-effect owners;
- event scopes/producers;
- mode/capability descriptors/bindings;
- server-specific fact locations;
- current architecture failures/debt classification.

## Out of scope

- Sửa debt.
- Đọc `.env*`, runtime `data/**`, `node_modules/**`.
- Full log scan.

## Minimal steps

1. Record git revision/worktree scope/date.
2. Inventory files bằng `rg --files` với exclusions.
3. Read architecture catalog and validators.
4. Map runtime entrypoints to bootstrap/application/runtime.
5. Map ModeCatalog/CapabilityRegistry/RuntimeModeRegistry.
6. Map raw side-effect callsites/owners.
7. Map connection-scoped event producers/guards.
8. Map MinerUA facts by command/GUI/item/recipe/storage/join.
9. Map config groups to schema/consumers/hot reload.
10. Run/read approved inspection commands.
11. Classify each finding CURRENT/TARGET/DEBT/UNKNOWN.
12. Store bounded machine-readable inventory plus human summary.

## Acceptance criteria

- Baseline reproducible từ documented commands.
- Every major source area has owner/layer.
- No sensitive/runtime payload captured.
- Known validator findings have code/category/file.
- Gaps link to work packages; no auto-fix.

## Tests/verification

- Baseline schema validation.
- Path exclusion tests.
- Architecture inspection comparison.

## Rollback

Delete only baseline artifacts created by this WP; no source behavior changed.

## Deliverables

- Baseline manifest/inventory.
- Gap report.
- Updated WP dependencies/status.

## Stop conditions

- Inventory starts reading secrets/data/logs.
- Script mutates repo.
- Finding is “fixed” without its own WP.
