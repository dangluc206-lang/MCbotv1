# R4 Extensibility Closure — 2026-08-25

## Kết luận

R4 đạt `ENGINEERING_CLOSED` cho Mode Builder/platform hiện có. XP-305 được đóng theo quyết định `NOT_OPENED_NO_FIELD_DEMAND`; project không tự nhận là multi-server và không thêm workflow chỉ để tăng số lượng.

## Contract đã hoàn thiện

1. Đủ 17 module có presentation schema, risk/category/field/capability/executor contract.
2. Typed editor hỗ trợ `start`, `loop`, `stop`, nested `if/repeat`, move controls bằng keyboard và raw JSON chỉ trong Advanced.
3. Validator rebuild object từ allowlist; unknown/stale/prototype-shaped field không đi vào executor hoặc persistence.
4. `storage-protect` có fixed contract; không còn `allowSmelting` để vô hiệu hóa nung sắt/vàng.
5. Slash command phải bắt đầu `/`, một dòng, bounded length và chặn credential command.
6. Dry-run validate schema/forbidden/loop/dependency/resource, mở rộng bounded, báo selected/unreached path và thực hiện đúng zero capability call.
7. Custom mode file có schemaVersion/digest/revision; stale writer bị conflict; file lỗi visible-for-repair và skip-at-runtime.
8. Package manifest deterministic; verify so sánh toàn bộ manifest, không chỉ digest/modeId.
9. Template có compatibility/support/dependency/resource/limitation metadata; cài không đồng nghĩa live success.
10. Generic mode presentation dùng ModeCatalog metadata; B5/fishing view chỉ là optional extension.

## Security và resource boundary

- Không `eval`, `new Function`, arbitrary import hoặc raw Mineflayer client.
- File custom mode/symlink/backup target bị fail closed; read/write có byte budget.
- Side-effect module chỉ gọi capability trong `ModeContext`.
- Repeat/depth/expanded dry-run có hard cap.
- Package không chứa secret/arbitrary file.

## XP-305 decision

Không có field evidence yêu cầu workflow production thứ ba hoặc server profile thứ hai. Do đó kết quả chuyên nghiệp là không mở breadth implementation, không dùng collector legacy làm template và không tuyên bố support vượt bằng chứng.
