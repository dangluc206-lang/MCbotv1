# R2 Operator Experience Closure — 2026-08-25

## Kết luận

R2 đạt `ENGINEERING_CLOSED`: các critical journey có surface riêng, raw JSON được đẩy xuống Advanced, lỗi quan trọng tồn tại trong Incident Center, B5 có timeline nghiệp vụ, config/restore có transaction, và first-run/readiness không tự gây side effect. Trạng thái này không thay thế nghiên cứu người dùng hoặc accessibility audit độc lập.

## Bằng chứng theo work package

| Work package | Trạng thái | Implementation/evidence chính | Giới hạn không che giấu |
|---|---|---|---|
| XP-100 | IMPLEMENTED | `PageCatalog`, nhóm Operate/Build/Maintain/Advanced, alias route, `experienceLevel`, navigation contract | Card sorting với operator thật chưa có trong repo |
| XP-101 | IMPLEMENTED_AUTOMATED | design tokens, high contrast, reduced motion, accessible dialog, label/focus/keyboard structural E2E | Chưa có screen-reader audit độc lập trên máy operator |
| XP-102 | IMPLEMENTED | `IncidentIndexStore`, presenter/detail/actions, bounded correlation/timeline/retention, transition graph | Artifact detail vẫn được tải on-demand theo đúng thiết kế |
| XP-103 | IMPLEMENTED | six-step resumable first-run panel và read-only `DesktopReadinessService`; skip vẫn giữ checklist | Live spawn/readiness cần server lab, không giả lập thành field success |
| XP-104 | IMPLEMENTED | timeout/cached probe aggregation, stale/offline/not-applicable semantics | Probe synthetic không đo server latency thật |
| XP-105 | IMPLEMENTED | B5 stage timeline, reserve/baseline/remainder, blocker/retry/action và last verification | ETA cố ý không đoán khi thiếu dữ liệu |
| XP-106 | IMPLEMENTED | revision/digest workspace, dirty/diff/validation/conflict/undo, renderer sang backend write only | Một số config vẫn cần restart theo contract hiện tại |
| XP-107 | IMPLEMENTED_BASE | Vietnamese `MessageCatalog`, command palette allowlist, terminology/help metadata | Chưa tuyên bố full localization nhiều ngôn ngữ |
| XP-108 | IMPLEMENTED | hashed manifest, bounded catalog, exact-tree preview/restore, compatibility/integrity, rollback, retention | Selective restore không mở vì chưa có proof an toàn |

## Invariant vận hành đã giữ

1. Readiness chỉ đọc; không tự connect hoặc ghi config.
2. Renderer không nhận callback/path tùy ý và không ghi filesystem.
3. Incident action phải có trong `OperatorErrorContract.ACTION_CATALOG`.
4. Terminal incident không quay lại state active; chỉ evidence action còn được giữ.
5. B5 UI không gợi ý sell quantity khác `64`.
6. Restore chỉ commit sau integrity và configuration-tree verification; failure áp rollback pre-restore.

## Acceptance bên ngoài repository

- `OPERATOR_CARD_SORTING`: chưa đo.
- `SCREEN_READER_MANUAL_AUDIT`: chưa đo.
- `LIVE_FIRST_RUN_SERVER_EPISODE`: chưa đo.

Ba mục này không phải code defect đang bị bỏ ngỏ; chúng là bằng chứng người/môi trường cần có trước khi dùng từ “production-stable”.
