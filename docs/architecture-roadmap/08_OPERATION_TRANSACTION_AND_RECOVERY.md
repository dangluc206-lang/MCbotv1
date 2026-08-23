# Operation, Transaction and Recovery Model

## Operation lifecycle

```text
CREATED
-> VALIDATING
-> ACQUIRING_RESOURCES
-> CAPTURING_BEFORE
-> EXECUTING
-> OBSERVING
-> VERIFYING
-> SUCCEEDED

hoặc

-> UNCERTAIN
-> RECONCILING
-> SUCCEEDED | FAILED

hoặc bất kỳ phase phù hợp
-> CANCELLED | STALE | FAILED
-> RECOVERING
-> CLEANING_UP
```

## Precondition

Trước side effect:

- connection generation còn đúng;
- operation owner còn active;
- cancellation chưa xảy ra;
- required resource đã acquire;
- snapshot đủ fresh/complete;
- GUI identity/transition phù hợp;
- capacity/reserve/policy guard đạt;
- action idempotency/reconciliation policy tồn tại.

## Execute-once rule

Một mutation chỉ được gửi một lần cho mỗi operation attempt. Timeout/không thấy delta không tự tạo attempt mới.

Retry mới cần:

- fresh observation;
- classifier kết luận action không xảy ra;
- policy cho phép;
- attempt count còn;
- cùng owner/generation;
- recorded reason.

## Outcome classification

### SUCCEEDED

Verified postcondition với đủ evidence.

### FAILED

Action không đạt và state đủ rõ để kết luận.

### UNCERTAIN

Không đủ evidence biết side effect đã xảy ra hay chưa. Bắt buộc reconciliation trước mutation tiếp theo.

### STALE

Generation/owner/snapshot thay đổi làm result không còn hợp lệ.

### CANCELLED

Owner/operator/lifecycle hủy. Cleanup bounded và không retry tự động.

## Reconciliation barrier

```text
UNCERTAIN
-> stop further mutation on conflicting resources
-> fresh observation(s)
-> compare before/action semantics/after
-> classify succeeded, failed-safe-to-retry, or unresolved
-> release/replan/fail closed
```

Không click lại trong barrier.

## Recovery model

Recovery thành công chỉ khi final postcondition được quan sát sau mutation recovery cuối cùng.

```text
capture prestate
-> prepare verified sources
-> mutate
-> failure
-> recover component A
-> recover component B
-> final joint verification
-> cleanup owned disposable artifacts
```

Không tính success từ cached boolean trước component recovery khác.

## Fault windows bắt buộc

Mỗi fallible action cần xét:

1. reject trước side effect;
2. reject sau side effect;
3. resolve nhưng destination/postcondition sai;
4. verification read transient;
5. generation đổi giữa action và observe;
6. cancellation giữa các phase;
7. cleanup fail;
8. recovery source corrupt/missing;
9. collision/unowned artifact;
10. repeated blocker/retry exhaustion.

## Operation resource policy

Operation khai báo resources trước action. Manager serialize theo bot và conflict policy. Không acquire ad hoc trong callback khó cleanup.

## Error/result evidence

Tối thiểu:

```text
operation
step
action
resource
attempt
owner
botId
generation
beforeDigest
afterDigest
verification
outcome
errorCode
duration
recovery
```

## Cleanup policy

- Cleanup là side effect có owner.
- Release resource theo thứ tự ngược acquisition.
- Stale owner không release lease mới.
- Owned temp có explicit cleanup policy.
- Fatal recovery giữ verified source.
- Cleanup failure sau verified success là warning/health degradation, không giả vờ transaction chưa commit.

## Planner/executor handoff

Planner output cần chứa:

- action semantic;
- input digest;
- preconditions;
- required resources;
- expected evidence/postcondition;
- reconciliation hint;
- replay input.

Executor không tự thay đổi policy decision ngoài bounded safety adaptation đã contract hóa.

## Domain examples

### Crafting

Click quantity một lần; nếu output/input delta không rõ thì `UNCERTAIN`, fresh-read trước re-plan.

### Storage sell

Plan surplus từ fresh snapshot; sell exact verified plan; fresh-read; không bán inflow mới trong cùng transaction nếu policy nói để campaign sau.

### Teleport

Command sent chưa đủ; verify position/world/server state.

### Config update

Write/rename resolved chưa đủ; verify bytes/digest và ownership; joint config/metadata recovery.

## Exit criteria cho operation mới

- Có typed result.
- Có owner/resources.
- Có generation/cancel guard.
- Có before/action/observe/verify.
- Có uncertain strategy hoặc chứng minh action đồng bộ/idempotent.
- Có fault tests trước/sau side effect.
- Có structured trace.
- Không bypass raw side-effect owner.
