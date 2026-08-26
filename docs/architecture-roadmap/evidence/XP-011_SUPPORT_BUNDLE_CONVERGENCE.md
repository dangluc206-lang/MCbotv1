# XP-011 — Support Bundle convergence và privacy preview

Status: `DONE`

Desktop and CLI now emit `support-bundle` version 2 through `SupportBundleBuilder`. The manifest contains per-entry category, privacy level, byte count and SHA-256 plus a hash over the manifest. Identity-like fields are pseudonymized per Desktop bundle, field-aware redaction runs before serialization and a final text scan runs afterward.

The Desktop input adapters are bounded (20 runtime failures, 250 projected logs, latest B5 replay per runtime). Optional corrupt or oversized artifacts become manifest warnings instead of aborting the bundle. Protected paths, traversal, `.env`, `data/**`, `node_modules/**` and `config/bots/**` remain rejected.

Preview returns the same manifest metadata without entry content. Offline verification is available through `node scripts/validate-support-bundle.js <bundle.json>`.
