# Codebase Decomposition

## Mục tiêu

Tài liệu này xác định boundary đích và nơi đặt code. Nó không yêu cầu di chuyển hàng loạt ngay lập tức. Mọi migration phải đi qua façade, contract test và work package tương ứng.

## Decomposition cấp cao

| Layer | CURRENT route | Trách nhiệm đích | Không được chứa |
|---|---|---|---|
| Entrypoint | `src/index.js`, Desktop entrypoints | process boot và chọn runtime | domain workflow |
| Bootstrap | `src/bootstrap/**` | dependency wiring, registration | B5/storage policy |
| Core | `src/core/**` | event/state primitives, application lifecycle | server command/GUI |
| Bot runtime | `src/bot/**` | bot isolation/context/registry | global mutable bot state |
| Connection | `src/connection/**` | connect/reconnect/session/client end | mode policy |
| Operations | `src/operations/**` | queue, lock, cancellation, timeout | server-specific recipe |
| Modes | `src/modes/**` | lifecycle và orchestration | raw chat/click/client |
| Capabilities/domain | `src/server-features/**` CURRENT | semantic server actions | operator control plane |
| Planning | `src/planning/**` | pure decision/compiler | timer/network/side effect |
| Commands | `src/commands/**` | command registry/serialization/execution | domain workflow |
| GUI | `src/gui/**` | identity/session/click/observation | B5 policy |
| Items/inventory | `src/items/**` | identity/normalization/reading | GUI mutation nếu capability khác sở hữu |
| Movement | `src/movement/**` | route/path execution | mode lifecycle |
| Control plane | `src/discord/**`, Desktop, fleet/recovery | intent, scheduling, UI/status | Minecraft workflow implementation |
| Diagnostics/simulation | `src/diagnostics/**`, `src/simulation/**` | trace/replay/fakes | production side effects |
| Configuration | `src/configuration/**`, `config/**` | schema/definition/policy | mutable runtime state |

## Target package map

Target là logical package map; physical migration thực hiện dần:

```text
src/
├── bootstrap/
├── core/
│   ├── events/
│   ├── lifecycle/
│   └── results/
├── bot/
├── connection/
├── operations/
├── modes/
│   ├── platform/
│   ├── composable/
│   └── implementations/
├── capabilities/
│   ├── contracts/
│   └── generic/
├── planning/
├── adapters/
│   ├── command/
│   ├── gui/
│   ├── inventory/
│   ├── movement/
│   └── connection/
├── servers/
│   ├── minerua/
│   └── fake-contract-server/
├── control-plane/
├── diagnostics/
├── simulation/
└── configuration/
```

Không tạo toàn bộ folder target trước khi có code cần migrate.

## Bootstrap decomposition

### Owner

`src/bootstrap/**`.

### Inputs

- validated config registry;
- application-scoped definitions;
- bot profile/server profile;
- factories.

### Outputs

- `Application`;
- registered bot runtime services;
- capability registry bindings;
- mode descriptors/implementations;
- control-plane bindings.

### Rules

- Không chứa loop gameplay.
- Không parse GUI/item/server response.
- Không dùng `if modeId` để wire control behavior.
- Server-specific wiring đi qua profile module.

## Core and bot decomposition

### Core

- Event envelopes/scopes.
- Application lifecycle primitives.
- Generic result/error primitives khi được formalize.
- Không import `src/modes/**` implementation hoặc `src/server-features/**` MinerUA.

### Bot

- `BotIdentity`, `BotContext`, `BotState`, `BotRuntime`, `BotRegistry`.
- Lifecycle/registry ownership.
- Không biết `/kho`, B5, fishing command hay GUI slot.

## Mode decomposition

### Platform modules

- catalog/descriptor;
- runtime registry;
- context;
- managed lifecycle;
- task supervisor;
- mode control contract.

### Implementation modules

- `b5-craft` là modern reference mode.
- `collector-b5` là compatibility/legacy.
- `fishing` có domain-specific observers nhưng không làm template.

### Migration target

Mode implementation chỉ chứa:

```text
policy orchestration
lifecycle reactions
capability calls
decision/result handling
status projection
```

## Capability decomposition

Một capability nên có:

```text
contract
implementation
input/output schema
required lower dependencies
resource requirements
verification semantics
error/result codes
contract tests
```

Ví dụ target:

```text
StorageCapability
├── inspectFresh(context)
├── stabilize(policy, context)
├── planSurplus(snapshot, policy)
└── sell(plan, context)
```

MinerUA implementation có thể tiếp tục nằm ở `server-features` trong migration đầu, nhưng phải được wire qua contract/profile.

## Planner decomposition

```text
Snapshot Builder (side-effect-free output)
-> Domain Planner (pure)
-> Execution Planner / compiler (pure)
-> Operation executor
-> Outcome classifier/reconciler
-> Trace recorder
```

Snapshot builder có thể gọi capability đọc trước khi tạo immutable snapshot; planner bản thân không gọi capability.

## Server profile decomposition

Server profile gồm các nhóm độc lập:

- identity/connection defaults;
- authentication/join flow;
- semantic command definitions;
- response/event patterns;
- GUI identities/transitions/actions;
- custom item identities;
- recipe/conversion facts;
- storage/sell behavior;
- cooldown/timing contracts;
- known quirks và knowledge status.

Profile không chứa bot desired state hoặc operator credentials.

## Control-plane decomposition

```text
Desktop / Discord adapter
-> common application control service
-> durable intent + fleet scheduler
-> runtime mode/connection control
-> typed status projection
```

Không tạo Desktop-only hoặc Discord-only gameplay implementation.

## Diagnostics decomposition

- `FlowError`/stable codes.
- Runtime failure recorder.
- Structured trace envelope.
- Planner replay.
- Support bundle builder/redactor.
- Health registry/runtime introspection.
- Scenario/fault runner.

## Config/data decomposition

### `config/**`

Validated static definition/policy. Có schema, cross-reference và ownership.

### Runtime state

In memory, bot-scoped, không ghi trực tiếp vào config.

### Durable intent/checkpoint

Logical/revisioned/versioned; không chứa raw client/window.

### Observation

Timestamp/generation/source/digest; có thể stale; không phải config authority.

## Decomposition migration rule

Mỗi lần di chuyển responsibility:

1. Chỉ ra CURRENT owner và callers.
2. Định nghĩa contract đích.
3. Thêm contract/parity test.
4. Tạo façade hoặc adapter.
5. Migrate một consumer.
6. So sánh behavior/trace.
7. Migrate consumer tiếp theo.
8. Xóa đường cũ khi reachability chứng minh không còn dùng.
9. Cập nhật catalog/docs.

Không move file trước rồi mới tìm trách nhiệm.
