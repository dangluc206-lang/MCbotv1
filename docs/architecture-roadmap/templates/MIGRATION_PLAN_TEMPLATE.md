# Migration Plan — Component/Contract

## Source and target

```text
CURRENT owner/path/contract
-> TARGET owner/path/contract
```

## Preconditions

- Approved ADR/WP.
- Baseline/parity fixtures.
- Dependency gates.

## Consumers

| Consumer | Current path | Target path | Risk | Migration order |
|---|---|---|---|---|

## Compatibility strategy

- Façade/adapter.
- Additive fields/methods.
- Deprecation warning.
- Version/revision.

## Slices

1. Contract/factory.
2. Reference consumer.
3. Parity tests.
4. Remaining consumers.
5. Remove fallback.
6. Reachability/catalog cleanup.

## State/data migration

Config/durable/replay schema changes and validation.

## Fault/rollback plan

Failure at each slice, rollback without data loss.

## Observability

How to compare old/new behavior, trace and health.

## Exit criteria

- All consumers migrated.
- No old reachability.
- Compatibility window complete.
- Regression and architecture gates pass.
