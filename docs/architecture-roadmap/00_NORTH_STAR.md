# North Star Architecture

## Tuyên bố tầm nhìn

MCbot là một **Minecraft Automation Runtime** có khả năng:

- vận hành nhiều bot với state và lifecycle cô lập;
- chạy nhiều loại workflow qua contract thống nhất;
- thích nghi nhiều server bằng profile/capability riêng;
- chỉ công nhận mutation thành công khi có bằng chứng;
- phục hồi hoặc fail closed khi outcome không chắc chắn;
- phát lại quyết định offline để điều tra và regression;
- cung cấp control plane an toàn cho Desktop, Discord và API tương lai.

B5, fishing, farming, mining, auction hoặc quest là ứng dụng của runtime này.

## Giá trị cốt lõi

### 1. Safety trước throughput

Mất vật phẩm, bán quá mức, click lặp hoặc callback stale có chi phí lớn hơn chậm một vòng. Tối ưu tốc độ chỉ được thực hiện sau khi giữ verification và ownership.

### 2. Evidence trước assumption

```text
action sent != action succeeded
promise resolved != postcondition matched
promise rejected != side effect absent
```

### 3. Isolation trước convenience

Bot-scoped state, connection generation, GUI session, mode lease và operation owner không được dùng singleton mutable chung.

### 4. Contracts trước implementation cụ thể

Mode phụ thuộc capability. Capability implementation phụ thuộc server profile và adapter. Generic core không phụ thuộc MinerUA.

### 5. Replay trước đoán lỗi production

Planner decision và operation evidence cần đủ để tái hiện offline. Không dựa vào log text rời rạc hoặc chờ lỗi lặp lại trên server.

## North Star flow

```text
Operator declares desired intent
-> Control plane validates policy and target bot
-> Runtime resolves mode descriptor and required capabilities
-> Mode acquires explicit resources
-> Pure planner consumes fresh immutable snapshot
-> Transaction executor performs one bounded action
-> Server evidence is observed and classified
-> Result is verified, uncertain, stale, cancelled or failed
-> Runtime commits, reconciles or recovers
-> Trace/replay evidence is persisted with redaction
```

## Ba trục mở rộng

### Thêm bot

Chỉ cần bot/server profile và runtime registration. Không sửa mode implementation.

### Thêm workflow

Đăng ký mode/module, capability dependency và resource claims. Không sửa FleetControl bằng switch theo tên mode.

### Thêm server

Cung cấp ServerProfile và capability implementation phù hợp. Không hard-code command/GUI/item vào generic core.

## Tiêu chí kiến trúc đạt đích

- Bot mới được thêm mà không copy mutable runtime service.
- Mode mới được scaffold/đăng ký mà không sửa control-plane switch-case.
- Server giả thứ hai chạy contract tests mà không import MinerUA facts.
- Planner quan trọng chạy offline không có timer/network/GUI side effect.
- Mutation có typed outcome: `SUCCEEDED`, `FAILED`, `UNCERTAIN`, `STALE`, `CANCELLED`.
- Reconnect làm callback generation cũ fail closed.
- Resource conflict không phụ thuộc boolean global.
- B5 có thể replay từ snapshot/decision trace.
- Support bundle đủ tái hiện incident nhưng không chứa secret/raw client.
- Local update thất bại không để application/config ở trạng thái trộn.

## Non-goals

- Không thay Mineflayer khi chưa có task riêng.
- Không đổi framework/module system chỉ để “hiện đại hóa”.
- Không biến mọi capability thành microservice.
- Không tạo DSL tùy ý có thể chạy JavaScript/raw command.
- Không xây abstraction server thứ hai giả tạo mà không có contract test.
- Không rewrite B5 một lần; dùng strangler migration và replay parity.

## Chỉ số chương trình

Các chỉ số nên được đo theo phase:

- tỷ lệ source runtime reachable và boundary compliant;
- số raw side-effect owner vi phạm;
- số event connection-scoped thiếu generation;
- số mode cần control-plane special case;
- số server facts còn nằm trong generic namespaces;
- tỷ lệ planner/operation có replay fixture;
- tỷ lệ mutation có uncertain/reconciliation test;
- mean time từ incident đến replay tái hiện;
- số cleanup path không có ownership evidence;
- số config group được schema/cross-reference validate.

Chỉ số không được dùng để khuyến khích thêm abstraction hoặc test hình thức. Mỗi metric phải gắn với risk thực tế.
