# WP-201 — ModeContext and ManagedMode Lifecycle Parity

## Status

`DONE`

## Objective

Chứng minh mọi modern mode có lifecycle/status/resource semantics nhất quán qua `ModeContext`/`ManagedMode` và generic control path.

## Depends on

- WP-200.

## In scope

- Lifecycle state machine.
- Partial enable rollback.
- Pause/resume/disable/destroy.
- Status/health contract.
- Generic fake mode.

## Out of scope

- Full legacy mode migration.
- Domain planner changes.

## Minimal steps

1. Compare current ManagedMode/ModeContext/mode implementations.
2. Define transition table/idempotency.
3. Add compatibility hooks missing from context.
4. Add generic fake mode descriptor/service.
5. Exercise control service/fleet/runtime registry.
6. Add reconnect/readiness behavior.
7. Document legacy gaps for WP-203.

## Acceptance criteria

- Enable acquires dependency/resource before RUNNING.
- Partial failure cleans acquired items reverse order.
- Pause blocks new mutation.
- Resume revalidates readiness/generation.
- Disable/destroy idempotent and release exact lease.
- Status comes from common contract.

## Tests

- every valid/invalid transition;
- enable failure at each phase;
- double disable/destroy;
- reconnect while running/paused;
- stale lease release;
- generic Desktop/Discord mode control.

## Rollback

Additive base/context changes can be reverted per hook; keep fake tests as specification.

## Stop conditions

- Control plane special-cases fake/reference mode.
- Lifecycle state stored only in UI.
- Cleanup fire-and-forget.

## Completion evidence — 2026-08-22

- ManagedMode enable/resume now rechecks capability readiness and records the active connection generation.
- Existing lease acquisition occurs before RUNNING; SubscriptionBag cleanup is awaited in reverse registration order.
- Contract tests cover partial-enable rollback, readiness/generation revalidation and idempotent disable/destroy.
- Legacy collector/fishing remain explicitly deferred to WP-203 rather than being rewritten here.
