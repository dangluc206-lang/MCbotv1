# WP-400 Evidence — Trace / Support Bundle

Status: **DONE** on MCbot **2.7.23**.

- Added `trace-envelope/v1` with trace/parent/bot/generation/intent/operation/correlation/decision/evidence identity and nested redaction.
- B5 trace records the trace envelope beside the decision replay envelope; operator status projects only compact correlation/digest fields.
- Existing `DesktopLogPolicy` remains the operator projection/suppression owner; STEP/GUI/KHO/PV chatter stays hidden and repeated blockers are bucketed.
- Added allowlist-only in-memory `support-bundle/v1`. It cannot recursively read runtime trees and rejects `.env*`, `data/**`, `config/bots/**`, `node_modules/**`, `.git/**`, traversal and non-allowlisted paths.
- Per-entry, entry-count and total-byte bounds are contract-enforced.
- Nested causes/details/content are sanitized through the shared `Redactor`.

Targeted trace/log/support tests: 8/8 PASS.
