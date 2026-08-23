# Contract Catalog

## Mục tiêu

Catalog này định nghĩa contract đích tối thiểu. Tên field là định hướng; work package phải kiểm tra public API hiện tại và giữ backward compatibility.

## EventEnvelope

```js
{
  type,
  scope,                 // application | bot | connection
  botId,
  connectionGeneration,
  timestamp,
  correlationId,
  operationId,
  payload
}
```

Invariants:

- connection-scoped cần positive generation;
- subscriber fail closed khi bot/generation không khớp;
- payload không chứa raw client/window durable reference;
- event type/scope đăng ký trong registry.

## OperationContext

```js
{
  botId,
  connectionGeneration,
  operationId,
  correlationId,
  owner,
  resources,
  signal,
  deadline,
  serverProfileId
}
```

## OperationResult

```js
{
  outcome,               // SUCCEEDED | FAILED | UNCERTAIN | STALE | CANCELLED
  code,
  retryable,
  before,
  after,
  evidence,
  verification,
  operationId,
  correlationId,
  botId,
  connectionGeneration,
  durationMs,
  details
}
```

Rules:

- `SUCCEEDED` cần verified postcondition.
- `UNCERTAIN` không tự động retry mutation.
- `STALE` khi generation/snapshot owner không còn hợp lệ.
- `CANCELLED` không bị đổi thành generic failure.
- `details` không chứa secret/full dump ở operator surfaces.

## ObservationSnapshot

```js
{
  kind,
  source,
  botId,
  connectionGeneration,
  observedAt,
  expiresAt,
  digest,
  completeness,
  value,
  evidence
}
```

Planner phải kiểm tra generation/freshness/completeness trước mutation plan.

## DecisionEnvelope

```js
{
  plannerId,
  plannerVersion,
  decisionId,
  inputDigest,
  policyRevision,
  serverProfileRevision,
  action,
  blockers,
  assumptions,
  replayInput
}
```

Planner không đưa non-serializable runtime object vào envelope.

## ModeDescriptor

```js
{
  modeId,
  serviceName,
  label,
  requiredCapabilities,
  requestedResources,
  primary,
  durable,
  configurationGroup,
  statusContractVersion
}
```

## ManagedMode contract

```text
enable(context, options)
disable(reason)
pause(reason)
resume(reason)
status()
destroy()
```

Lifecycle rules:

- enable acquire readiness/resources;
- pause giữ ownership theo contract nhưng dừng mutation;
- disable/destroy cancel tasks, cleanup và release exact lease;
- idempotent ở các transition hợp lệ;
- stale callback không thay đổi owner mới.

## CapabilityDescriptor

```js
{
  capabilityId,
  version,
  scope,                 // application | bot | connection
  dependencies,
  resources,
  readiness,
  operations,
  serverSpecific
}
```

Capability registry fail closed khi missing/incompatible.

## ServerProfile

```js
{
  profileId,
  revision,
  connection,
  commandCatalog,
  guiCatalog,
  itemCatalog,
  recipeCatalog,
  cooldownCatalog,
  joinFlow,
  capabilityBindings,
  knowledgeStatus
}
```

Secrets chỉ được resolve runtime memory, không nằm trong profile.

## ResourceClaim

```js
{
  resource,
  mode,                  // exclusive | shared-read nếu thật sự cần
  ownerId,
  botId,
  generation,
  operationId,
  acquiredAt,
  leaseRevision
}
```

Release cần exact owner/revision.

## DurableIntent

```js
{
  botId,
  desiredConnection,
  desiredMode,
  desiredModeState,
  revision,
  updatedAt,
  source
}
```

Fresh process boundary có policy reset session-specific intent theo contract hiện hành.

## Health/Status contract

```js
{
  componentId,
  state,                 // READY | DEGRADED | BLOCKED | STOPPED
  reasonCode,
  since,
  botId,
  generation,
  dependencies,
  summary,
  evidenceRef
}
```

Desktop/Discord không tự suy state từ log text nếu status API tồn tại.

## TraceEnvelope

```js
{
  schemaVersion,
  timestamp,
  level,
  botId,
  serverProfileId,
  connectionGeneration,
  modeId,
  operationId,
  correlationId,
  step,
  action,
  outcome,
  errorCode,
  beforeDigest,
  afterDigest,
  evidenceRefs,
  details
}
```

## Error contract

Stable families:

```text
CONNECTION_*
COMMAND_*
GUI_*
INVENTORY_*
MOVEMENT_*
CRAFTING_*
STORAGE_*
SERVER_*
CONFIG_*
TIMEOUT_*
VERIFICATION_*
UPDATE_*
RECOVERY_*
```

Message text là human context, không phải public parsing API.

## Contract versioning

- Additive optional fields: compatible.
- Đổi semantic/outcome: tăng contract version và migration.
- Xóa/rename field: façade compatibility trong ít nhất một migration window.
- Durable/replay schema: versioned và có fixture migration/rejection test.
- Server profile revision phải có trong decision trace nếu fact ảnh hưởng planner.
