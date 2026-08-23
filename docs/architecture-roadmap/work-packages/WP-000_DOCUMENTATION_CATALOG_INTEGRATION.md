# WP-000 — Documentation Catalog Integration

## Status

`DONE` — 2026-08-22


## Completion evidence

- Baseline: MCbot Desktop `2.7.1`, reconstructed from the official 2.6.16 direct extract plus cumulative/patch chain through 2.7.1.
- Decision: [`ADR-000`](../adrs/ADR-000_DOCUMENT_GOVERNANCE_ROOTS.md), option 2 (`governedDocumentRoots`).
- Catalog: version 2 with exact governed root `docs/architecture-roadmap`.
- Validator: repository-relative POSIX normalization, Windows separator support, exact-case matching, traversal/absolute-path rejection, missing-root failure and symlink fail-closed behavior.
- Tests: authorized/unauthorized, nested boundary, case, Windows separators, missing root and traversal.
- Runtime behavior: unchanged.
- Verification on the 2.7.2 candidate:
  - `node --check scripts/document-governance.js` — PASS.
  - `node --check scripts/validate-architecture.js` — PASS.
  - `node --check scripts/validate-structure.js` — PASS.
  - `node --check tests/unit/architecture/ArchitectureValidation.test.js` — PASS.
  - `node --test tests/unit/architecture/ArchitectureValidation.test.js` — 3/3 PASS.
  - `npm run validate` — PASS, 0 validation failures.
  - `npm test` — 776 PASS / 1 FAIL. The sole failure is `tests/unit/server-features/B1SmeltingTelemetrySoftFail.test.js` (`false !== true`) and reproduces unchanged on reconstructed 2.7.1 baseline, so it is pre-existing and outside WP-000.

## Objective

Cho phép một documentation root được govern và validator chấp nhận mà không biến mọi Markdown trong repo thành official document vô điều kiện.

## Current evidence

- `architecture/catalog.json` có `officialDocuments` là danh sách file.
- `scripts/validate-architecture.js` reject mọi `.md` không nằm trực tiếp trong danh sách.
- `docs/architecture-roadmap/**` vì vậy hiện tạo `MARKDOWN_UNAUTHORIZED`.

## In scope

- ADR chọn governance model.
- Catalog/schema/validator change nhỏ nhất.
- Validator tests.
- Document authority/status rules.

## Out of scope

- Sửa nội dung architecture/gameplay.
- Allow toàn bộ `docs/**` không kiểm soát.
- Generated site/document system.

## Options cần quyết định

1. Liệt kê từng roadmap file trong `officialDocuments`.
2. Thêm `officialDocumentRoots`/`governedDocumentRoots` với exact normalized root.
3. Manifest riêng trong roadmap được catalog tham chiếu.

Khuyến nghị: option 2 hoặc 3, có traversal/symlink/extension rules.

## Minimal steps

1. Capture current validator/catalog tests.
2. Viết ADR với authority/ownership/update rule.
3. Thêm catalog field/schema nếu chọn root/manifest.
4. Normalize path bằng repository-relative POSIX path.
5. Allow `.md` chỉ dưới exact governed root.
6. Reject traversal, symlink escape, nested unlisted root nếu policy yêu cầu.
7. Giữ root official docs checks.
8. Thêm tests authorized/unauthorized/case/path traversal.
9. Update roadmap README validator status.

## Acceptance criteria

- Roadmap files được validator accept.
- Markdown ngoài root/official list vẫn reject.
- Missing governed root/manifest có stable validation failure.
- Windows path normalization test.
- Không runtime behavior diff.

## Verification

- Targeted architecture validation tests.
- `npm run validate:architecture`.
- `npm run validate` nếu scope cho phép.

## Rollback

Revert catalog/validator/test change; roadmap vẫn tồn tại nhưng known unauthorized. Không xóa roadmap để rollback.

## Deliverables

- ADR.
- Catalog/validator/test patch.
- Updated status/evidence.

## Stop conditions

- Implementation allow mọi Markdown.
- Overlap unresolved với dirty validator/catalog edits.
- Need broad validator rewrite.
