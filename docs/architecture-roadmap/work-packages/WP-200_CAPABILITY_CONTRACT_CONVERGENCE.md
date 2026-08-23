# WP-200 — Capability Contract and Registry Convergence

## Status

`DONE`

## Objective

Chuẩn hóa additive descriptor/readiness/result semantics để mode resolve capability qua registry thay vì dependency ad hoc.

## Depends on

- WP-002.
- Phase 1 gate.

## In scope

- Current capability inventory/bindings.
- Descriptor/version/scope/dependencies/readiness.
- Additive registry introspection.
- One reference capability migration.

## Out of scope

- Rewrite all server features.
- New domain feature.

## Minimal steps

1. Inventory names/APIs/scopes/results.
2. Define descriptor and compatibility façade.
3. Add readiness/status API.
4. Add dependency resolution/fail-closed behavior.
5. Bind one reference capability through bootstrap/profile.
6. Add contract tests/fake implementation.
7. Document migration batches.

## Acceptance criteria

- Registry detects missing/incompatible dependency.
- Capability remains bot/connection scoped đúng owner.
- Result supports typed outcome without breaking legacy consumer.
- Introspection usable by mode/control plane.
- No raw Mineflayer exposed as capability convenience.

## Tests

- register/duplicate/missing/version mismatch;
- readiness degradation;
- bot isolation;
- generation stale result;
- compatibility API.

## Rollback

Remove reference binding/facade consumer; retain inventory/ADR. Không duplicate registry.

## Stop conditions

- Create second capability registry.
- Descriptor stores mutable runtime state.
- Big-bang signature changes.

## Completion evidence — 2026-08-22

- The existing single `CapabilityRegistry` now supports additive version, scope, dependency, readiness and result-contract metadata.
- Missing/incompatible dependencies fail at seal and optional compatible/ready resolution remains backward compatible with `require(id)`.
- Bot-scoped registry snapshots expose immutable introspection only; providers/runtime state are not embedded in descriptors.
- `storage` is the reference migrated capability with connection scope and explicit command/GUI/inventory dependencies.
