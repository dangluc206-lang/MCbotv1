# AGENTS.md

## Phạm vi

Repository này là framework Mineflayer đa bot. Mọi coding agent chỉ sử dụng ba tài liệu chính thức: `AGENTS.md`, `RULES.md` và `JS_RESPONSIBILITIES.md`. Không dùng Markdown khác làm nguồn sự thật.

## Thứ tự ưu tiên

1. Yêu cầu hiện tại của người dùng.
2. `RULES.md`.
3. `JS_RESPONSIBILITIES.md`.
4. `AGENTS.md`.
5. Source, test và config hiện tại.

Khi có mâu thuẫn, phải chỉ ra cụ thể thay vì tự chọn âm thầm.

## Trước khi sửa

1. Xác nhận workspace root.
2. Đọc ba tài liệu chính thức.
3. Đọc đầy đủ file liên quan và test của nó.
4. Tìm toàn bộ import, export, caller, config key và event liên quan.
5. Xác định scope: application, bot, connection, operation, stateless, listener hoặc script.
6. Giữ hành vi hợp lệ; chỉ thay đổi phần được yêu cầu.

Không tạo class rỗng, wrapper vô nghĩa, file dự phòng hoặc dependency chưa có caller.

## Cách làm việc

- Dùng tool thật để đọc, tìm, sửa, xem diff và chạy lệnh.
- Không giả lập output hoặc exit code.
- Không xóa code trước khi tìm toàn bộ reference.
- Không đổi public API hoặc config contract âm thầm.
- Không sửa test để che lỗi.
- Không kết nối Minecraft thật trong test mặc định.
- Không tự thực hiện phần việc tiếp theo ngoài yêu cầu.

## Kiểm tra bắt buộc

Với JavaScript đã sửa, chạy `node --check`. Sau đó chạy test liên quan, `npm test`, `npm run validate` và các script hiện có phù hợp. Chỉ báo thành công khi exit code bằng `0`.

## Xử lý lỗi

Dừng phần tiếp theo, đọc output đầy đủ, sửa nguyên nhân gốc trong phạm vi nhỏ nhất, rồi chạy lại syntax check và test. Không nuốt error, bỏ assertion hoặc nới validation chỉ để test pass.

## Bảo mật

Không commit `.env`, credential, token, password hoặc session. Không log secret. `.env.example` chỉ chứa tên biến và giá trị mẫu an toàn.

## Báo cáo

Báo ngắn: file đã đọc, tạo, sửa, xóa; reference đã kiểm tra; lệnh và exit code; test pass/fail; thay đổi API/config; lỗi còn lại.

## Vận hành nhanh

1. Chạy `npm install`.
2. Sao chép `.env.example` thành `.env` nếu cần secret.
3. Sửa `config/server.json` và từng file `config/bots/*.json`; đặt `enabled: true` cho bot cần chạy.
4. Chạy `npm run validate`, `npm run inspect:config`, `npm test`, rồi `npm start`.
5. Trước khi dùng crafting thật, dùng Discord `/gui command:/ks slots:<chuỗi-slot>` để bot đi qua GUI server và tự ghi observation vào `data/runtime/gui`; chỉ điền override trong `config/gui/slots.json` hoặc `config/minerals/menu.json` khi auto-detection còn mơ hồ; cập nhật identity mạnh trong `config/items/items.json`.
6. Trước khi bật `/mode action:on`, điền `pickupLocation.x/y/z` trong `config/modes/collector-b5.json`; mode sẽ `/is`, đi tới điểm này, đứng nhặt, `/nung` B1 cần thiết, đổi block↔phôi trực tiếp trong `/kho`, hễ B2/B3/B4/B5 đủ điều kiện thì chế ngay theo ưu tiên `B5 > B4 > B3 > B2`, cất B5 vào `/pv 2`, nén B1 và tiếp tục sản xuất không cooldown.
