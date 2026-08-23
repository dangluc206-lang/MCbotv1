# State, Configuration and Persistence

## State taxonomy

### Configuration

Ví dụ:

- command keys;
- GUI bootstrap knowledge;
- recipes;
- mode policy;
- timeout/retry cap;
- server profile definitions.

Properties:

- schema validated;
- cross-reference validated;
- immutable theo revision sau load;
- write qua owner service và backup;
- không chứa runtime client/session.

### Desired state

Ví dụ:

- bot enabled/disabled;
- desired connection;
- desired mode;
- paused/running intent.

Properties:

- durable;
- revisioned;
- operator/control plane ownership;
- reconciliation-driven;
- session-bound fields reset theo process policy.

### Runtime state

Ví dụ:

- connection lifecycle;
- current generation;
- active lease;
- open GUI session;
- active operation/task;
- mode internal status.

Properties:

- bot-scoped;
- volatile;
- transition owner rõ;
- không ghi thẳng vào config.

### Observed state

Ví dụ:

- inventory snapshot;
- GUI snapshot;
- storage count;
- position;
- server response/event.

Properties:

- source;
- timestamp;
- generation;
- completeness/confidence;
- TTL/freshness;
- có thể stale.

### Derived state

Ví dụ:

- B5 plan;
- storage pressure;
- reserve amount;
- readiness;
- blockers.

Properties:

- pure/recomputable;
- gắn input digest/policy revision;
- không phải source of truth độc lập.

## Canonical flow

```text
Validated Configuration(revision)
+ Durable Intent(revision)
+ Fresh Observation(generation, timestamp, digest)
-> Derived Decision(inputDigest)
-> Verified Operation Result
-> Runtime transition / new observation
```

## Configuration write contract

```text
read current
-> construct candidate
-> schema validate
-> cross-reference validate
-> write owned temp
-> verify temp
-> atomic replace
-> reload candidate registry
-> apply runtime where supported
-> rollback file/registry/runtime on failure
```

Renderer không được bỏ qua pipeline này.

## Runtime config migration contract

- Capture exact prestate ownership/digest.
- Create verified rollback source before mutation.
- Treat metadata as transaction state, not best-effort note.
- Verify config + metadata jointly after final recovery mutation.
- Cleanup only owned artifacts after joint success.
- Fatal failure retains verified sources/diagnostics.
- Retry/recovery bounded.

## Durable intent contract

- CAS/revision hoặc serialized update.
- Source/timestamp.
- Supported mode IDs từ `ModeCatalog`.
- Reconcile không hard-code mode names.
- Fresh process resets prior session mode intent theo current contract.
- Same-process reconnect giữ valid desired mode.

## Observation contract

Mỗi observation quan trọng cần:

```text
botId
connectionGeneration
observedAt
source
digest
completeness/confidence
value
```

Planner mutation phải reject nếu:

- generation khác;
- quá TTL;
- thiếu required fields;
- GUI identity confidence thấp;
- source không phù hợp semantic action.

## Persistent checkpoint policy

Chỉ persist logical state:

- mode ID/state;
- cooldown deadline;
- workflow checkpoint ID;
- policy/profile revisions;
- last verified outcome reference.

Không persist:

- Mineflayer client;
- raw window;
- packet object;
- closure/promise/timer;
- unredacted secret;
- stale inventory object reference.

Checkpoint restore cần:

- schema version;
- compatibility check;
- profile/config revision validation;
- generation-independent logical reconstruction;
- fail closed nếu không hợp lệ.

## Config ownership matrix

Mỗi config group nên catalog:

| Field | Meaning |
|---|---|
| owner | service có quyền write |
| schema | validation module |
| consumers | runtime services |
| hotReload | none/reload/reconfigure |
| sensitive | redaction rule |
| serverScoped | profile binding |
| migration | version rule |
| backupPolicy | retention/rollback |

## Data retention

- Operator logs: bounded retention.
- Forensic JSONL: retention/configurable.
- Replay fixture: keep minimal/latest/incident-selected.
- Support bundle: explicit creation, redact, optional expiry.
- Backups: versioned retention, never packaged into local update.
- Observation cache: TTL/generation invalidation.

## Acceptance invariants

- Không group config không schema nếu được operator chỉnh.
- Không durable state không version.
- Không observation thiếu generation cho connection-scoped facts.
- Không derived decision thiếu input digest cho mutation quan trọng.
- Không config write bypass backup/validation owner.
