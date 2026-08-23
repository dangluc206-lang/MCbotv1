# Dependency and Ownership Rules

## Dependency matrix

`A -> B` nghĩa là A được phép phụ thuộc B.

| A | Được phụ thuộc | Không được phụ thuộc |
|---|---|---|
| Entrypoint | bootstrap | domain implementation trực tiếp |
| Bootstrap | application/runtime, profile factories | gameplay workflow logic |
| Control plane | runtime control/status contracts | raw Mineflayer, GUI click |
| Bot runtime | core, connection, operations, registries | specific B5/server facts |
| Mode | ModeContext, capability contracts, planner | raw client/chat/click |
| Planner | immutable domain models/policy | timer, network, GUI, adapters |
| Capability | lower capability/adapter/profile | Desktop/Discord/mode implementation |
| Server profile | capability bindings/config knowledge | operator desired state |
| Adapter | external library/raw server API | mode/control policy |
| Diagnostics | result/event contracts, read-only projections | production mutation |

## Forbidden dependency examples

- `src/core/**` import `src/modes/b5-craft/**`.
- `WorkflowStepExecutor` import Mineflayer bot để chat/click.
- Discord command gọi `bot.chat()`.
- Planner import `CommandService`, `GuiManager`, `setTimeout`.
- Generic inventory utility assume MMOItems/B1.
- Connection manager biết `/sky` hoặc server join GUI.

## Side-effect ownership

### Raw command

Owner: command executor/serialization path.

Required controls:

- command registry/validation;
- throttle/serialization;
- cancellation/generation;
- response or domain verification.

### GUI click

Owner: click executor.

Required controls:

- GUI identity evidence;
- session/generation;
- click queue;
- post-click observation;
- uncertain outcome handling.

### Connection close

Owner: connection manager.

Explicit disconnect phải suspend reconnect đúng bot và xử lý late client/attempt.

### Movement

Owner: route/movement executor. Mode chỉ yêu cầu semantic route/action.

### Inventory mutation

Owner: capability transaction tương ứng. Reader/counter không được mutation.

### Filesystem/config/update

Owner: validated configuration/update service. Renderer không ghi trực tiếp. Temp/backup/delete cần operation ownership.

## Resource ownership model

CURRENT primary resource:

- `primary-mode` qua `ModeCoordinator`.

Candidate resources chỉ thêm khi conflict thực tế:

- `gui`;
- `inventory`;
- `movement`;
- `command-exclusive`;
- `storage-session`;
- `crafting-session`.

Mỗi resource cần:

- owner identity;
- bot scope;
- generation/lease revision;
- acquisition order;
- cancellation cleanup;
- stale release guard;
- tests cho contention và owner death.

## Lock ordering

Nếu operation cần nhiều resource, định nghĩa một thứ tự toàn cục trước khi thêm lock để tránh deadlock. Candidate:

```text
primary-mode
-> movement
-> command-exclusive
-> gui
-> inventory
```

Đây chưa phải CURRENT contract. WP-202 phải xác minh conflict graph và chỉ formalize thứ tự cần thiết.

## Task/listener ownership

- Timer/loop thuộc `TaskSupervisor` hoặc `SubscriptionBag`.
- Disable/destroy cancel và await cleanup bounded.
- Callback giữ generation/owner token lúc đăng ký.
- Callback cũ không release task/lease mới cùng tên.

## Artifact ownership

Một filesystem path chỉ được cleanup khi:

- nằm trong root do operation `mkdtemp` thành công tạo; hoặc
- được exclusive-create bởi operation; hoặc
- rename/copy postcondition chứng minh operation tạo destination và không có collision trước đó.

PID/timestamp trong tên không phải bằng chứng ownership.

## Ownership review checklist

- Ai tạo resource/artifact/listener?
- Owner ID/revision/generation nằm ở đâu?
- Ai được release/delete?
- Release có idempotent không?
- Callback stale bị chặn ở đâu?
- Nếu acquire thành công một phần thì rollback thứ tự nào?
- Nếu cleanup fail, evidence nào được giữ?
- Có code path khác bypass owner không?

## Architecture enforcement

Nên enforcement dần qua:

- architecture catalog side-effect owners;
- forbidden import patterns;
- planner purity scan;
- event producer scope audit;
- runtime contract tests;
- resource contention tests;
- cleanup ownership fault tests.

Không dựa duy nhất vào tài liệu.
