# ADR-000 — Governed Documentation Roots

## Status

`ACCEPTED` — 2026-08-22

## Context

`architecture/catalog.json` historically used only `officialDocuments`. `scripts/validate-architecture.js` therefore rejected every Markdown file not listed one by one with `MARKDOWN_UNAUTHORIZED`.

The architecture program under `docs/architecture-roadmap/**` intentionally contains many governed Markdown files (phase plans, work packages, templates and ADRs). Listing every file in `officialDocuments` would make catalog maintenance noisy and would incorrectly imply that every roadmap file has the same authority as the repository's top-level source-of-truth documents.

## Decision

Add `governedDocumentRoots` to `architecture/catalog.json`.

Policy:

1. `officialDocuments` remains the exact allowlist for top-level authoritative documents.
2. `governedDocumentRoots` is a recursive Markdown authorization boundary, not an authority promotion.
3. The first governed root is `docs/architecture-roadmap`.
4. Paths are repository-relative and normalized to POSIX separators. Windows `\\` separators are accepted and normalized before validation.
5. Absolute paths, empty segments, `.` and `..` traversal segments are rejected.
6. Catalog path matching is case-sensitive even on case-insensitive filesystems.
7. A declared governed root must exist, use the exact on-disk casing, be a real directory, remain inside the repository and contain no symlink entries. Validation does not follow symlinks inside governed documentation roots.
8. Only `.md` files are authorized by this governance rule. Other file types remain governed by their own validators/policies.
9. Markdown outside `officialDocuments` and all governed roots remains `MARKDOWN_UNAUTHORIZED`.
10. Roadmap authority remains lower than the current user task, `AGENTS.md`/`RULES.md`, `SERVER_BEHAVIOR.md`, `ARCHITECTURE.md`, source, config and tests as defined by the roadmap README.

## Alternatives considered

### Enumerate every roadmap file in `officialDocuments`

Rejected because it creates large catalog churn and conflates “validator-governed” with “top-level source of truth”.

### Roadmap-local manifest referenced from the catalog

Valid future option, but unnecessary for the current directory size and adds a second manifest parser without a current consumer.

### Allow all `docs/**`

Rejected because unrelated Markdown would become silently authorized.

## Consequences

- Adding a Markdown file anywhere under the exact governed root is allowed without editing the top-level official-document list.
- Moving the roadmap outside the declared root makes validation fail until governance is deliberately updated.
- A missing, traversing, wrong-case or symlinked governed root fails with stable document-governance validation codes.
- Runtime behavior is unchanged.

## Rollback

Remove `governedDocumentRoots`, revert the validator/test changes and restore the roadmap README status to known unauthorized. Do not delete the roadmap as a rollback mechanism.
