# Phase 0 — Alignment and Baseline

## Outcome

Repository có một baseline kiến trúc được govern, có thể audit bằng máy, và các contract đích được quyết định trước khi migration source lớn bắt đầu.

## Entry criteria

- `AGENTS.md`, `ARCHITECTURE.md`, `SERVER_BEHAVIOR.md`, `RULES.md`, `JS_RESPONSIBILITIES.md` đọc được.
- Worktree/branch ownership được ghi trước edit.
- Không có emergency production task chồng cùng owner files.

## Mandatory work packages

- WP-000.
- WP-001.
- WP-002.

## Sequence

1. Quyết định governance cho roadmap Markdown.
2. Cập nhật catalog/validator/test theo decision.
3. Capture source/config/test/owner/event/mode/capability baseline.
4. Phân loại CURRENT/TARGET/DEBT/UNKNOWN.
5. ADR cho common event/result/error contract.
6. Chỉ tạo compatibility façade; chưa migrate toàn repo.

## Deliverables

- Documentation root/catalog policy.
- Machine-readable baseline/gap inventory.
- ADR common contracts/versioning.
- Updated work-package status/dependencies.

## Required verification

- Markdown governance validator tests.
- Architecture validator/reachability.
- Config registration baseline.
- No runtime behavior diff cho documentation-only changes.

## Exit criteria

- Mọi roadmap file được accept theo catalog rule hoặc có approved temporary exception với expiry.
- Baseline có revision/date và reproducible commands.
- Contract ADR approved.
- Không tạo runtime abstraction chưa có consumer.

## Stop conditions

- Validator change vô tình allow mọi Markdown/untrusted generated path.
- Baseline script đọc `.env`, `data`, `node_modules` trái policy.
- Documentation task sửa gameplay source.
- Contract ADR cố đổi toàn bộ public result trong cùng phase.
