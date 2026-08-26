# XP-010 Evidence — Runtime Failure Artifact Repository

Status: **DONE** on the current 2.7.67 source line.

## Closed mismatch

- Recorder and reader now share `RuntimeFailureArtifactLayout`; canonical layout remains `data/runtime/errors/<botId>/last-error.json` plus bounded `errors.jsonl`.
- Desktop no longer reads root-level `.json` files and no longer reads the obsolete `app.runtimeFailures` shape. It resolves `app.diagnostics.runtimeFailures`, including while backend is stopped by using the real `config/app.json` spec.
- UI receives opaque `rfa1.*` artifact IDs and bot/code/severity/time/size metadata; raw filesystem paths are not accepted as read IDs.
- Desktop support export uses the same repository read path; XP-011 will converge the remaining bundle builder/schema.

## Safety contract

- Bounded list: newest-first, optional bot filter, max 200 items, metadata hydration budget 8 MiB.
- `last-error.json`: non-symlink regular file, configured size guard capped for UI, descriptor-based bounded read.
- `errors.jsonl`: descriptor-based bounded tail, max 1 MiB / 200 entries, corrupt lines and concurrent partial tail line fail-soft with warnings.
- Traversal, absolute paths, unknown artifact kinds/suffixes, unsafe bot IDs, symlink bot directories/files and root escape are rejected.
- Atomic recorder temp files are never surfaced; shared layout keeps retention/rotation pattern aligned with the reader.

## Verification

- Repository + recorder targeted suite: 9/9 PASS.
- Desktop stopped-backend nested-layout integration: PASS.
- Existing Desktop support replay integration: PASS.
- XP-001 support harness contract: 9/9 PASS.
- `npm run validate`: structure 0 failures; architecture 310/310 source reachable, 0 failures.
- `npm run check:error-vocabulary`: PASS, 194 source codes / 3 compatibility message-parser locations.

## QA upgrades applied before closure

1. Fixed fractional `maxFileMb` byte guard instead of rounding to 1 MiB.
2. Apply list limit before JSON hydration and cap aggregate metadata I/O.
3. Tail uses actual `bytesRead` so truncate/append races do not create zero-filled fake corruption.
4. Content reads use file descriptors, `O_NOFOLLOW` where supported, re-`fstat` size/type and non-symlink fallback checks.
5. Added retention regression proving recorder rotation cleanup still matches shared layout.
6. Desktop lazily loads `createApplication`, allowing diagnostics tests/reads while backend is stopped without loading game runtime dependencies.
