# WP-004 — Side-effect and Artifact Ownership Evidence

Date: 2026-08-22
Release: 2.7.6

- Raw side effects (`bot.chat`, `clickWindow`, `client.end`, raw fishing `_client`) are statically restricted to the architecture catalog owners.
- `architecture/artifact-ownership.json` catalogs every current `src/**` destructive/write filesystem caller with an explicit symbolic scope and cleanup policy.
- `scripts/audit-side-effect-ownership.js` fails closed when a new raw side effect bypass or destructive filesystem caller is introduced without an owner declaration.
- The manifest has zero exceptions. Future exceptions require owner, reason and expiry.
- Domain verification remains above raw actions: `CommandService` arms confirmation before send when configured; GUI flows use session/generation guards and `ClickVerifier`; transaction cleanup keeps ledger-proven ownership.
- Existing RuntimeConfigMigrator collision tests prove unowned sentinels/collisions are retained even when contents match expected artifacts.

Targeted evidence:
- `tests/unit/architecture/SideEffectOwnership.test.js`
- `tests/unit/commands/CommandContractCoverage.test.js`
- `tests/unit/gui/GuiContractCoverage.test.js`
- `tests/unit/desktop/RuntimeConfigMigrator.test.js` R8/R9/R10 ownership cases.
