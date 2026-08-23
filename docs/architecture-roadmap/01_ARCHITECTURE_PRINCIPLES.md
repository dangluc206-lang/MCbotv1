# Architecture Principles

## P-01 — Dependency đi xuống

```text
bootstrap
-> application/runtime
-> mode/workflow
-> domain capability/service
-> command/gui/inventory/movement/connection adapter
-> Mineflayer/server
```

Tầng thấp không import mode/workflow tầng cao. Server facts không rò vào core/bot/operation generic.

## P-02 — Một owner cho mỗi raw side effect

- Server command: `CommandExecutor`.
- GUI click: `ClickExecutor`.
- Connection end: `ConnectionManager`.
- Raw protocol chỉ ở owner được catalog cho phép.

Facade/mode/Discord không được tạo đường tắt.

## P-03 — Bot runtime là isolation boundary

Mọi mutable state gắn bot phải nằm trong `BotRuntime` hoặc dependency bot-scoped của nó. Application-scoped object chỉ chứa immutable definition hoặc coordinator có partition theo bot.

## P-04 — Connection generation là identity vật lý

Event/callback/timer/task connection-scoped phải mang và kiểm tra `botId + connectionGeneration`. Generation cũ không được release owner hoặc ghi state generation mới.

## P-05 — Mode sở hữu orchestration, capability sở hữu action

Mode quyết định workflow và policy. Capability biết cách thực hiện semantic action. Adapter sở hữu raw API.

## P-06 — Planner thuần

Planner nhận immutable input và trả immutable decision/replay input. Planner không gửi command, click, chờ timer, đọc network hoặc mutate runtime.

## P-07 — Verification-first

Mọi mutation quan trọng theo chuỗi:

```text
BEFORE
-> ACTION ONCE
-> OBSERVE
-> AFTER
-> VERIFY
```

Nếu không đủ evidence, trả `UNCERTAIN`; không retry mutation mù.

## P-08 — Explicit ownership

Lease, lock, GUI session, route, task, temp artifact và durable revision đều phải có owner. Cleanup/release chỉ do đúng owner và đúng generation thực hiện.

## P-09 — Bounded concurrency và retry

- Không `Promise.all()` cho action tranh chấp GUI/inventory/movement.
- Retry có maximum, backoff, cancellation và reason.
- Polling không được trở thành busy loop.
- Không tăng sleep để che race.

## P-10 — State categories không trộn

- Configuration: policy/definition đã validate.
- Desired state: intent durable/revisioned.
- Runtime state: owner/lifecycle/session hiện tại.
- Observed state: snapshot từ server, có generation/timestamp.
- Derived state: plan/pressure/readiness, tính lại được.

## P-11 — Server-specific isolation

Command, GUI signature, custom item, recipe, cooldown và join flow nằm trong ServerProfile/knowledge của server. Generic core chỉ dùng semantic contract.

## P-12 — Backward-compatible migration

Public contract không đổi nếu task không yêu cầu. Migration dùng façade/adapter và parity test; không big-bang rewrite.

## P-13 — Fail closed khi dependency/evidence thiếu

Mode yêu cầu capability không tồn tại phải fail readiness. GUI identity confidence thấp không click. Snapshot stale không lập mutation plan.

## P-14 — Observability là contract

Operation quan trọng phải có stable error code, correlation, before/after/evidence và outcome. Operator log gọn; forensic trace chi tiết; support bundle redact.

## P-15 — Cleanup cũng là side effect

Không xóa path chỉ vì tên giống temp. Cleanup cần ownership, postcondition và policy. Failure cleanup sau commit là warning; failure recovery trước commit có thể là fatal.

## P-16 — Test đúng layer

- Pure policy/planner: unit fixture.
- Capability: fake adapter/server observation.
- Operation: fault injection trước/sau side effect.
- Runtime: generation/cancellation/ownership integration.
- Packaging/update: artifact overlay và rollback.
- Real server: smoke thủ công/opt-in, không phải mặc định CI.

## P-17 — Abstraction có evidence

Chỉ formalize interface/adapter generic khi có ít nhất hai consumer/implementation thật hoặc một conflict contract đã rõ. Không tạo folder/interface chỉ để đẹp sơ đồ.

## P-18 — Tách control plane và execution plane

Desktop/Discord/API gửi intent qua service chung. Chúng không trực tiếp chat/click/mutate Mineflayer. Runtime thực thi và trả typed status/result.

## P-19 — Secure by construction

Secrets không vào config/log/trace/update ZIP. Custom workflow dùng allowlist/schema. Runtime client/window/packet không serialize durable.

## P-20 — Phase gate trước feature expansion

Không thêm server thứ hai trước ServerProfile fake contract; không thêm workflow phức tạp trước Mode SDK/resource contract; không phân tán process trước Phase 6 evidence gate.
