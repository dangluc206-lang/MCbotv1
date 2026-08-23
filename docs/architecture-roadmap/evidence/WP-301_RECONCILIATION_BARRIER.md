# WP-301 Evidence — Shared Reconciliation Barrier

Status: **DONE** on MCbot **2.7.20**.

- Added `src/shared/reconciliation/ReconciliationBarrier.js`. It never sends the original mutation; it only acquires optional conflict resources, obtains fresh evidence, classifies `APPLIED / NOT_APPLIED / UNRESOLVED / STALE / CANCELLED / RESOURCE_BUSY`, and releases the lease.
- Only `NOT_APPLIED` authorizes a re-plan. `APPLIED`, unresolved, stale, cancelled and contention all keep duplicate mutation blocked.
- Attempts are bounded and unresolved logging is suppressed to first/last attempt.
- `b5-craft` now consumes the shared outcome semantics while retaining its proven generation-local evidence counters and pending-mutation quarantine.
- WP-302 is the approved imminent second consumer for uncertain storage/sell semantics.

Verification: barrier fault cases plus the complete B5 craft mode reconciliation suite pass.
