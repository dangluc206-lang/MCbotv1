# WP-001 Architecture Baseline and Gap Inventory

Generated: 2026-08-23T21:27:42.830Z

Release: 2.7.67

## Capture scope

- Files: 686; source: 303; tests: 179; scripts: 30; config JSON: 34.
- Source tree: standalone; worktree metadata: STANDALONE.
- Safe-scope source fingerprint: `631c5d4178ab725c0a39f5b03827abe1e50e4fc3a23ae15395f33a3a9e583819` (bot-profile payload bytes excluded).
- Excluded from inventory/content capture: `.env*`, `data/**`, `node_modules/**`, `**/*.log`; bot profile payloads are not content-scanned.
- The manifest and generated gap report are excluded from `counts.files` to avoid self-referential count drift.

## Current evidence

- Architecture validator: PASS with 0 finding(s).
- Project source reachability: 303/303; runtime reachability: 298/303.
- Mode descriptors: 3; capabilities: 24; connection-scoped events: 31.
- Exclusive side-effect rules: 4; current owner violations: 0.

## Major source areas

| Area | Files | Owner | Layer | Classification |
|---|---:|---|---|---|
| `<root>` | 1 | `src/index.js` | runtime-entrypoint | CURRENT |
| `ai` | 5 | `src/ai/` | application-support | CURRENT |
| `bootstrap` | 12 | `src/bootstrap/` | composition-root | CURRENT |
| `bot` | 10 | `src/bot/` | bot-runtime | CURRENT |
| `commands` | 10 | `src/commands/` | command-capability | CURRENT |
| `configuration` | 16 | `src/configuration/` | application-configuration | CURRENT |
| `connection` | 7 | `src/connection/` | bot-connection | CURRENT |
| `core` | 13 | `src/core/` | platform-core | CURRENT |
| `desktop` | 14 | `src/desktop/` | control-plane-desktop | CURRENT |
| `diagnostics` | 13 | `src/diagnostics/` | observability | CURRENT |
| `discord` | 14 | `src/discord/` | control-plane-discord | CURRENT |
| `fleet` | 1 | `src/fleet/` | fleet-scheduling | CURRENT |
| `gui` | 24 | `src/gui/` | gui-capability | CURRENT |
| `items` | 19 | `src/items/` | item-inventory-capability | CURRENT |
| `modes` | 28 | `src/modes/` | mode-platform | CURRENT |
| `movement` | 13 | `src/movement/` | movement-capability | CURRENT |
| `operations` | 7 | `src/operations/` | operation-platform | CURRENT |
| `planning` | 7 | `src/planning/` | pure-planning | CURRENT |
| `recovery` | 2 | `src/recovery/` | durable-control | CURRENT |
| `server-features` | 54 | `src/server-features/` | server-domain-features | CURRENT |
| `server-profiles` | 4 | `src/server-profiles/` | server-profile-boundary | CURRENT |
| `shared` | 25 | `src/shared/` | shared-foundation | CURRENT |
| `simulation` | 4 | `src/simulation/` | simulation-replay | CURRENT |

## Gap inventory

| Code | Category | Evidence location | Follow-up | Summary |
|---|---|---|---|---|
| BASELINE_ARCHITECTURE_VALIDATOR | CURRENT | `scripts/validate-architecture.js` | WP-001 | Architecture validator is clean at capture time. |
| COMMON_CONTRACTS_ACTIVE | CURRENT | `src/shared/contracts/OperationResultContract.js` | WP-002 | Versioned operation result/error/event contracts are reachable and WP-002 closure is present. |
| SERVER_PROFILE_BOUNDARY_ACTIVE | CURRENT | `src/server-profiles` | WP-100, WP-101, WP-102, WP-103, WP-104, WP-105 | Server-specific command/GUI/item/recipe/storage/join facts are governed through the ServerProfile boundary; generic consumers may still exist under src/server-features. |
| MODE_LIFECYCLE_STRANGLER_DEBT | DEBT | `architecture/legacy-mode-debt.json` | WP-201, WP-203 | collector-b5, fishing remain intentional strangler-adapter modes; generic registry/control parity is closed and exit triggers are documented rather than forcing a gameplay rewrite. |
| CONFIG_TRANSACTION_CLOSED | CURRENT | `src/desktop/update/RuntimeConfigMigrator.js` | WP-003 | Runtime configuration transaction closure is implemented and reachable; WP-003 is no longer pending. |
| SIDE_EFFECT_OWNERSHIP_CLOSED | CURRENT | `architecture/artifact-ownership.json` | WP-004 | Raw side-effect and destructive artifact ownership are catalogued with zero current raw-owner violations. |
| GENERATION_CANCELLATION_GUARDS_ACTIVE | CURRENT | `src/core/events/EventEnvelope.js` | WP-005 | Generation/cancellation contracts are active with 68 source file(s) carrying generation-guard evidence. |
| RELEASE_ZIP_CONTRACT_ACTIVE | CURRENT | `scripts/release-zip-contract.js` | WP-402 | Release ZIP completeness/safety policy and real-ZIP verifier are present; source-only fast quality includes the pure contract test. |

## Reproduce

```bash
rg --files --hidden -g '!.env*' -g '!data/**' -g '!node_modules/**' -g '!*.log' -g '!architecture/baseline/current.json' -g '!docs/architecture-roadmap/baseline/WP-001_GAP_REPORT.md'
node scripts/inspect-architecture-baseline.js
node scripts/inspect-architecture-baseline.js --check
node scripts/validate-architecture.js --json
node --test tests/unit/architecture/ArchitectureBaseline.test.js
```

This report is evidence only. WP-001 does not change runtime/gameplay behavior and does not auto-fix any debt.
