# WP-101 — MinerUA Knowledge Inventory

## Status

`DONE` — completed 2026-08-22; evidence: architecture/server-profiles/minerua-inventory.json

## Objective

Map mọi MinerUA-specific fact tới source/config/test/status trước extraction.

## Depends on

- WP-001.

## In scope

- commands/responses;
- auth/join/Sky/HUB;
- GUI titles/signatures/transitions/slots;
- items/NBT/MMOItems;
- recipes/quantities;
- storage/sell/smelting/conversion;
- cooldown/restart/quirks.

## Out of scope

- Observe live server nếu task không cấp quyền.
- Change facts.
- Move implementation.

## Minimal steps

1. Use `SERVER_BEHAVIOR.md` categories.
2. Search command keys/raw slash commands.
3. Search GUI/item/recipe identifiers.
4. Map config group/schema/consumer/test.
5. Assign `CONFIRMED/INFERRED/UNKNOWN/DEPRECATED`.
6. Identify generic namespace leaks.
7. Identify duplicate/conflicting authorities.
8. Produce extraction batches and owners.

## Inventory row

```text
factId
category
semantic meaning
current locations
status/evidence
consumers
mutation risk
target profile group
test coverage
notes
```

## Acceptance criteria

- Every current raw server command categorized.
- Every stateful GUI identity has owner/evidence.
- B1–B5/storage facts mapped.
- Unknown/conflict explicit; not guessed.
- Extraction WPs have bounded file lists.

## Verification

- Cross-check docs/config/source/tests.
- No env/data/node_modules/full logs.
- Review by server behavior owner.

## Stop conditions

- Inventory changes runtime behavior.
- Runtime observation promoted to confirmed without validation.
