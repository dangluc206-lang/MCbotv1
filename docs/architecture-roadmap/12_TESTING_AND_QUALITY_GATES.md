# Testing and Quality Gates

## Test pyramid

```text
Real-server/manual smoke (opt-in)
Contract/integration simulation
Operation fault injection + replay scenarios
Pure unit/planner/config/architecture tests
```

CI mặc định không phụ thuộc public Minecraft server.

## Test categories

### Pure unit

- planner/policy/calculator;
- parser/normalizer/classifier;
- schema/result helpers;
- no filesystem/network/time dependency trừ injected abstractions.

### Contract

- capability implementation đáp ứng common contract;
- server profile parity/fake server;
- mode lifecycle/status;
- control-plane generic mode resolution.

### Operation fault injection

- reject trước side effect;
- reject sau side effect;
- resolve nhưng postcondition sai;
- transient observation error;
- cancellation;
- generation switch;
- cleanup failure;
- recovery source corruption/collision.

### Integration simulation

- scripted events/GUI/inventory;
- virtual clock;
- fake command/click/connection adapters;
- multi-bot isolation;
- restart/reconnect/durable intent.

### Artifact/update

- ZIP traversal/symlink/duplicate/size scan;
- manifest/version/dependency contract;
- protected path exclusion;
- backup/replace/delete/rollback;
- runtime config migration/recovery.

## Required command order

Khi JavaScript thay đổi:

1. `node --check` changed files.
2. Targeted unit tests.
3. Affected contract/integration tests.
4. `npm test` nếu scope đủ rộng.
5. `npm run validate` cho architecture/structure.
6. `npm run inspect:config` khi config/schema chạm.
7. Installed gate nếu môi trường có dependencies; nếu thiếu, báo BLOCKED.

Roadmap creation task này không chạy các command trên.

## Coverage policy

Coverage là signal, không phải acceptance duy nhất. Ưu tiên branch fault semantics hơn tăng line coverage hình thức.

Ngưỡng package hiện tại có script coverage riêng; work package không tự giảm threshold.

## Architecture gates

- official docs/catalog consistency;
- runtime reachability;
- forbidden import/side-effect owner;
- planner purity;
- config registration;
- event scope/generation guard;
- stale paths.

## Mode gate

- descriptor/schema;
- capability/resource declaration;
- lifecycle idempotency;
- pause/disable/reconnect cleanup;
- generic registry/control path;
- no raw side effect.

## Server profile gate

- MinerUA parity;
- fake second profile;
- generic core import isolation;
- profile revision in trace;
- unknown facts fail closed.

## Transaction gate

- before/action/observe/verify;
- uncertain outcome;
- no blind duplicate action;
- joint final recovery verification;
- artifact ownership;
- bounded retry/repair;
- retained evidence.

## Flaky test policy

- Không tăng sleep để qua.
- Dùng virtual clock/event barrier.
- Fault hook path/operation-aware thay vì global call number nếu có thể.
- Test không phụ thuộc thứ tự.
- Temporary path owned và cleanup.
- Failure phải có deterministic reproduction.

## Release evidence

Mỗi delivery report cần:

- exact changed files;
- commands/counts;
- skipped/blocked reasons;
- known failures;
- dependency diff;
- artifact hashes nếu packaging;
- migration/rollback evidence;
- scope no-change assertions cho invariant nhạy cảm.

## Phase exit gate

Phase chỉ DONE khi:

- mọi mandatory WP done;
- architecture/config gates pass hoặc approved exception có expiry;
- regression pass;
- migration/rollback documented;
- observability/support evidence có;
- không mở critical P0/P1 regression.
