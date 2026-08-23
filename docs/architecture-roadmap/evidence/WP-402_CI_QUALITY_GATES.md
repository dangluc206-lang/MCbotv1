# WP-402 Evidence — CI Architecture / Replay / Quality Gates

Status: **DONE** on MCbot **2.7.25**. Phase 5 gate: **PASS**.

## Quality report contract

`scripts/run-quality-gates.js` emits `quality-gate-report/v1` with one of three aggregate/gate states:

- `PASS`: command/check completed successfully;
- `FAIL`: code/contract/test failure;
- `BLOCKED`: required environment prerequisite is unavailable.

Overall priority is `FAIL > BLOCKED > PASS`. Exit codes are `0`, `1`, and `2` respectively. Exit code `2` is treated as BLOCKED only for gates that explicitly declare it (currently the installed dependency graph); it is not globally forgiven.

## Fast lane

`npm run quality:fast` is offline/source-safe and includes all required critical boundaries:

1. JavaScript syntax for runtime/scripts/root entrypoints;
2. targeted shared result/capability/mode/task contracts;
3. structure/document governance;
4. architecture/reachability/generation catalog;
5. architecture baseline freshness;
6. side-effect/artifact ownership;
7. config schema/cross-reference;
8. MinerUA ServerProfile inventory;
9. planner purity/replay/B5 conformance;
10. event generation/stale callback contracts;
11. runtime config transaction/update safety;
12. deterministic WP-401 fault matrix.

Source-environment evidence at closure: **12 PASS / 0 FAIL / 0 BLOCKED**.

## Release lane

`npm run quality:release` contains the full fast lane plus:

- broader source regression (`npm test`);
- complete installed dependency graph (`scripts/run-tests.js --installed`);
- full coverage thresholds (`npm run test:coverage`) only after the installed graph passes.

In the source-only delivery environment the lane intentionally reports **BLOCKED / exit 2** because runtime dependencies are not installed. Observed closure result: **13 PASS / 0 FAIL / 2 BLOCKED** (`installed-regression`, then prerequisite-blocked `coverage`). This is evidence of correct blocked semantics, not a release PASS claim.

GitHub Actions executes `npm ci` before the release lane. The workflow uses `set -o pipefail` while teeing JSON, so a failed or blocked quality process cannot be converted to shell success by `tee`. The report is uploaded with `if: always()` for diagnosis.

## Delivery integrity

`scripts/release-artifact-integrity.js` provides `release-artifact-integrity/v1` with exact byte count and SHA-256. `create-local-update-package.js` writes both `<zip>.sha256` and `<zip>.manifest.json` after a successful update ZIP build.

## Local reproduction

```text
npm run quality:fast
npm run quality:release
npm run artifact:integrity -- <artifact-file>
```

Do not install/change dependencies merely to turn a BLOCKED local source package into PASS. The installed gate is intended for a normal installed workspace/CI after the repository's declared dependencies are installed.
