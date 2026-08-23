# Observability, Replay and Support

## Ba audience

### Operator

Cần biết:

- bot/mode đang ở trạng thái nào;
- bị chặn vì sao;
- action quan trọng gần nhất;
- có cần can thiệp không.

Không cần full STEP/GUI/NBT dump.

### Developer/auditor

Cần timeline structured với generation/operation/evidence.

### Replay engine

Cần schema ổn định, deterministic input và version/revision.

## Correlation chain

```text
operatorIntentId
-> fleetTaskId
-> botId
-> modeInstanceId
-> operationId
-> decisionId
-> actionAttempt
-> evidence/result
```

## Required context

- timestamp;
- botId;
- serverProfileId/revision;
- connectionGeneration;
- modeId/mode instance;
- operationId/correlationId;
- step/action/resource;
- attempt;
- before/after digest;
- outcome/error code;
- duration;
- evidence reference.

## Log pipeline

```text
structured event
-> secret/data redaction
-> forensic sink
-> operator policy/filter/suppression
-> Desktop/Discord summary
```

## Stable error model

- Code là machine contract.
- Message là human context.
- Cause chain giữ leaf error.
- Details structured, bounded và redact.
- Repeated blocker có signature/suppression window.

## Replay package

Một replay fixture nên chứa:

```text
schemaVersion
plannerId/version
serverProfileId/revision
policy revision
input snapshot/replayInput đã redact
input digest
expected decision/blockers
optional observed outcome
```

Replay không cần Mineflayer/server online.

## Support bundle

### Include

- manifest/version;
- selected structured traces;
- health/status snapshots;
- config schema/version và safe policy subset;
- planner replay fixture;
- GUI identity evidence summary;
- architecture/test metadata nếu cần.

### Exclude/redact

- `.env`/credentials/tokens/password commands;
- raw session/client/window/packet;
- unrelated full logs;
- unbounded full inventory/NBT;
- runtime backups/secrets;
- operator personal data ngoài incident scope.

## Trace retention

- bounded file size/count;
- incident pinning explicit;
- replay latest-per-bot/per-flow có policy;
- cleanup owner và failure warning;
- support bundle có expiry/manual deletion policy.

## Health model

Health không đồng nghĩa lifecycle.

Ví dụ:

```text
Mode RUNNING + Storage capability DEGRADED
Connection CONNECTED + GUI knowledge BLOCKED
Bot DISCONNECTED + desiredConnection OFF = healthy idle
```

Health reason dùng stable code và dependency chain.

## Required dashboards/status

- fleet summary;
- bot connection/generation;
- active mode/resources;
- active operation/age;
- repeated blocker;
- capability readiness;
- last verified action;
- last uncertain/recovery incident;
- support/replay availability.

## Replay parity gates

- Same input/profile/policy/planner version → same decision.
- Schema incompatible → explicit rejection/migration, không silent fallback.
- Planner update có fixture diff review.
- Trace generation không thay đổi runtime decision.

## Exit gate

- Capability/mode mới dùng common context fields.
- B5 incident tạo replay/support evidence bounded.
- Operator surface không spam low-level details.
- Redaction tests chặn secrets.
- Error/result không cần parse message text.
