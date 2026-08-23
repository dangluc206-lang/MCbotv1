# Target Reference Architecture

## Logical view

```text
Operator Interfaces
  Desktop / Discord / CLI/API
            |
            v
Control Plane
  FleetControl / DurableIntent / Scheduler / Policy / Health
            |
            v
Application Runtime
  BotRegistry -> isolated BotRuntime per bot
            |
            v
Mode Platform
  ModeCatalog -> RuntimeModeRegistry -> ManagedMode + ModeContext
            |
            v
Domain Capabilities
  Storage / Crafting / Fishing / Navigation / Island / Vault / ...
            |
            v
Planning + Operation Engine
  pure decisions / resource claims / execute-once / reconciliation
            |
            v
Server Profile
  commands / GUI / items / recipes / cooldown / join / policy facts
            |
            v
Adapters
  Mineflayer command / click / inventory / movement / connection
```

Observability, trace, security và configuration governance cắt ngang mọi tầng.

## Deployment view — hiện tại

```text
Single desktop/backend process
├── Control plane services
├── Shared immutable definitions
└── N isolated BotRuntime instances
```

Đích gần vẫn là modular monolith. Không tách process trong P0–P5.

## Deployment view — tùy chọn Phase 6

```text
Control Plane Process
├── desired state
├── scheduling
├── profile distribution
└── observability index

Worker A
├── BotRuntime A1
└── BotRuntime A2

Worker B
└── BotRuntime B1
```

Chỉ triển khai khi evidence chứng minh một process không đáp ứng crash isolation, bot count hoặc rollout requirement.

## Layer responsibilities

### Operator interfaces

Được phép:

- gửi intent đã validate;
- hiển thị status/health/evidence đã redact;
- quản lý config qua validated control service.

Không được phép:

- gọi raw Mineflayer;
- ghi config JSON trực tiếp từ renderer;
- tự giữ Minecraft workflow state.

### Control plane

Sở hữu:

- authorization/policy;
- target bot selection;
- durable desired state/revision;
- fleet task scheduling/fairness;
- runtime reconciliation;
- operator status contract.

Không implement Minecraft side effect.

### Bot runtime

Sở hữu:

- bot identity/context/state;
- connection generation/session;
- capability registry;
- operation/resource ownership;
- runtime mode registry;
- cancellation/cleanup.

### Mode platform

Sở hữu:

- descriptor và dependency readiness;
- lifecycle enable/disable/pause/resume/status;
- primary/resource lease;
- background task supervision;
- orchestration của capability.

### Capability layer

Sở hữu semantic actions và domain verification. Capability không chứa operator UI và không quyết định fleet policy.

### Planning/operation layer

- Planner tạo decision thuần.
- Operation engine serialize/lock/cancel/timeout.
- Executor thực hiện side effect qua capability/adapter.
- Reconciler phân loại outcome sau evidence không chắc chắn.

### Server profile

Chứa server facts và server-specific implementation wiring. Generic core chỉ dùng interface semantic.

### Adapter layer

Là nơi duy nhất chạm raw API theo catalog. Adapter trả observation/result thấp hơn, không chứa workflow B5/fishing policy.

## Runtime request path

```text
Discord /mode b5-craft bot-02
-> ModeControlService validates modeId and bot target
-> DurableIntentStore writes revision
-> FleetControl schedules reconciliation
-> BotRuntime resolves descriptor
-> CapabilityRegistry checks dependencies
-> ModeCoordinator acquires resources
-> ManagedMode starts supervised campaign
-> Planner creates replayable decision
-> Operation executes capability
-> Evidence verifier classifies outcome
-> Status/trace propagates back to control plane
```

## Event path

```text
Mineflayer event
-> low-level listener/adapter
-> EventEnvelope(botId, generation, type, payload)
-> EventScopeRegistry validation
-> bot-scoped EventBus
-> capability/mode subscriber
-> operation correlation
```

## State path

```text
validated configuration
+ desired intent revision
+ fresh observed snapshot
-> derived plan
-> verified action result
-> runtime state update
-> optional durable logical checkpoint
```

## Extension tests that prove architecture

### New mode test

Một fake mode descriptor có thể bind/start/pause/resume/disable qua generic catalog/registry/control path mà không sửa control-plane switch.

### New server test

Một fake second server profile có command/GUI/item khác và chạy capability contract test mà không import MinerUA modules.

### Multi-bot isolation test

Hai runtime có cùng capability/mode nhưng generation, lock, GUI và events độc lập; callback A không tác động B.

### Uncertain operation test

Action side-effect xảy ra nhưng response timeout; reconciler fresh-read và không action lần hai trước khi phân loại.

## Architecture qualities

- Safety: fail closed, verified mutation, bounded recovery.
- Extensibility: new mode/server/bot qua descriptor/profile.
- Operability: structured status, trace, support bundle.
- Testability: pure planners, fake capabilities, deterministic time/events.
- Evolvability: modular monolith, strangler migrations, stable public contracts.
- Security: secret isolation, allowlisted modules, safe update artifacts.
