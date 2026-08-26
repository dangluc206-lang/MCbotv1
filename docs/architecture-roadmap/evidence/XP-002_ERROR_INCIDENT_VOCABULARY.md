# XP-002 — Canonical error, incident và action vocabulary

Status: `DONE`

The runtime contract is `operator-error-v1` in `src/shared/contracts/OperatorErrorContract.js`; the machine-readable catalog is `architecture/error-vocabulary/current.json`.

The compatibility adapter accepts existing errors and maps stable prefixes to category, severity, retry class, safe-to-retry and catalog action IDs. Unknown errors fail closed (`safeToRetry=false`, no mutation action) and receive a correlation ID. Action definitions contain permission, generation guard, idempotency requirement and confirmation level; they cannot carry slash commands, callbacks or arbitrary JavaScript.

Verification:

- `node scripts/check-error-vocabulary.js`
- `node --test tests/unit/shared/OperatorErrorContract.test.js`

Migration is intentionally incremental: existing `stable-error-v1` remains compatible while operator-facing/new recovery surfaces use this richer envelope.
