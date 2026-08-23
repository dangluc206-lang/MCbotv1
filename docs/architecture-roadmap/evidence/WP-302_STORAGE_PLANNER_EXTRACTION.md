# WP-302 Evidence — Storage Protection / Sell Planner

Status: **DONE** on MCbot **2.7.21**.

- Extracted pure `B1StorageProtectionPlanner` from the immutable sell-budget logic previously embedded in the executor.
- Planner requires a confirmed fresh snapshot, rejects stale generation, preserves the exact 1.5-B5 reserve and emits only verified 64-item sell slices.
- Planner output is deterministic, immutable, profile/policy revision aware and carries a `decision-replay-envelope/v1`.
- `B1StartupReserveTrimmer` executes that plan without expanding it from later inflow; fresh reads after planning remain evidence only.
- Ambiguous sell evidence consumes shared WP-301 reconciliation semantics and stays blocked rather than being blindly repeated.
- Existing runtime order remains fresh `/kho` -> iron/gold smelt -> compact -> fresh immutable sell baseline -> verified 64-only sell -> final reserve verification.

Targeted planner/storage/B5 suite: 84/84 PASS.
