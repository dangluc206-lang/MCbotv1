# Mode and Workflow Platform

## Mục tiêu

Mode mới được thêm qua descriptor + capability contract + managed lifecycle, không qua special case trong control plane.

## Mode platform flow

```text
ModeCatalog
-> CapabilityRegistry readiness
-> RuntimeModeRegistry binding
-> ModeContext
-> ManagedMode lifecycle
-> TaskSupervisor / SubscriptionBag
-> ModeControlService / FleetControl
```

## Descriptor requirements

- unique `modeId`;
- service name/implementation binding;
- required capabilities;
- requested resources;
- primary/durable metadata;
- config group/schema;
- status contract;
- compatibility/deprecation metadata nếu cần.

## Lifecycle state machine

```text
DISABLED
-> ENABLING
-> RUNNING
-> PAUSING
-> PAUSED
-> RESUMING
-> RUNNING
-> DISABLING
-> DISABLED

bất kỳ transition hợp lệ
-> FAILED/DEGRADED
-> bounded cleanup
```

Rules:

- enable fail giữa chừng rollback resource/subscription theo thứ tự ngược;
- pause không phát mutation mới;
- disable/destroy idempotent;
- resume revalidate capability/generation;
- reconnect reconcile desired mode, không để task generation cũ chạy;
- status đến từ mode contract, không từ UI-only state.

## ModeContext boundary

ModeContext cung cấp:

- capability lookup;
- bot/generation identity;
- event declaration/emission/subscription;
- operation execution;
- resource claims;
- task supervision;
- structured logger/trace;
- cancellation signal;
- status/health update.

Không expose raw bot/client nếu capability đã tồn tại.

## TaskSupervisor

Background loop phải:

- có owner/mode instance ID;
- cancellation-aware;
- bounded retry/backoff;
- generation-aware;
- awaitable cleanup;
- suppress repeated identical blockers;
- report health/status.

## Capability readiness

Enable sequence:

```text
resolve descriptor
-> check config
-> resolve required capabilities
-> capability readiness
-> acquire resources
-> create supervised tasks
-> publish RUNNING
```

Không enable nửa vời khi dependency thiếu.

## Resource conflict

Descriptor khai báo nhu cầu dài hạn; operation có thể khai báo nhu cầu ngắn hạn. Platform cần phân biệt:

- mode lease;
- operation resource lock;
- read-only/shared observation khi được chứng minh an toàn.

## Composable workflow

### Phù hợp

- sequence ngắn;
- capability đã tồn tại;
- branch/timeout/retry bounded;
- không có planner phức tạp;
- không cần arbitrary code.

### Không phù hợp

- B5 planner/reconciliation phức tạp;
- raw protocol;
- custom dynamic JavaScript;
- workflow cần ownership mới chưa có contract.

### Module contract

Mỗi module cần:

- schema;
- required capability;
- resource claim;
- executor allowlist implementation;
- input/output validation;
- timeout/cancellation;
- targeted test;
- module catalog entry.

## Legacy mode migration

- Không copy legacy class thành template.
- Bọc behavior sau capability/ModeContext dần.
- Tạo parity tests cho lifecycle/status/side effects.
- Migrate listener/timer vào supervisor.
- Chỉ xóa compatibility path khi no consumer/reachability.

## B5 reference mode

`b5-craft` là reference vertical slice cho:

- dependency declaration;
- pure planner;
- storage protection orchestration;
- generation invalidation;
- reconciliation barrier;
- post-campaign cooldown/gate;
- trace/replay.

B5 facts/policy không được chuyển thành generic Mode SDK assumptions.

## New mode checklist

1. Có semantic objective rõ.
2. Search capability tương tự.
3. Descriptor/schema.
4. Required capabilities/resources.
5. Managed lifecycle.
6. Supervised tasks/subscriptions.
7. Typed status/result.
8. Generation/cancellation tests.
9. Generic control-plane test.
10. Architecture reachability.

## Exit gate

- Fake mode bind/start/recover qua generic path.
- Không control-plane special case.
- Disable/reconnect cleanup proven.
- Missing capability fail closed.
- Legacy modes có explicit adapter/debt status.
