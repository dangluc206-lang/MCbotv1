# WP-303 — B5 Reference Workflow Conformance

## Status

`DONE — 2026-08-22 / MCbot 2.7.22`

## Objective

Đưa `b5-craft` thành reference implementation của Mode SDK + pure planning + verified transaction + trace/replay, giữ nguyên user policy và không copy legacy collector.

## Depends on

- WP-302.
- WP-201.

## In scope

- Descriptor/capability/resource/lifecycle conformance.
- Campaign orchestration boundaries.
- Storage planner integration.
- Generation/cancellation/post-campaign gate.
- Replay/trace parity.

## Out of scope

- Movement/pathfinder/pickup.
- Change recipe/reserve/cooldown without separate user requirement.
- Remove collector compatibility.

## Required conceptual flow

```text
enable
-> protection/fresh normalization
-> snapshot + pure plan
-> verified crafting operations
-> uncertain reconciliation barrier
-> B5 completion verification
-> post-B5 storage protection gate
-> cooldown
-> next campaign fresh snapshot
```

## Minimal steps

1. Capture current B5 trace/replay/regression baseline.
2. Map every action to capability/operation owner.
3. Map tasks/listeners to supervisor.
4. Integrate storage planner output.
5. Recheck generation before/after side effects.
6. Standardize decision/result/trace envelope.
7. Add lifecycle/control/status tests.
8. Remove duplicate local decision only after parity.

## Acceptance criteria

- No movement capability/raw pathfinder.
- No raw command/click.
- Post-B5 protection gate before next craft.
- Later inflow handled by next bounded plan.
- Same blocker uses bounded backoff/suppression.
- Stale generation output discarded.
- Replay reproduces decision.

## Tests

- enable protection;
- campaign success/cooldown;
- B5 completion then protection failure;
- reconnect each major boundary;
- disable/pause during operation;
- uncertain craft/storage action;
- reserve/sell policy parity;
- generic mode control.

## Rollback

Feature flag/adapter back to prior B5 orchestration with trace comparison; never restore movement or blind retry.

## Stop conditions

- Collector copied/template.
- Gameplay policy silently changed.
- Verification removed for throughput.
