# WP-103 — GUI and Item Profile Extraction

## Status

`DONE`

## Objective

Move server-specific GUI/item knowledge lookup behind profile catalogs while retaining identity confidence, transitions và click ownership.

## Depends on

- WP-100.
- WP-101.

## In scope

- GUI identity definitions/fingerprints/transitions;
- item identities/aliases/fixed/learn-once policy;
- profile revision in evidence;
- reference consumers and contract tests.

## Out of scope

- Change click semantics/slots without confirmed fact.
- Generic GUI engine rewrite.

## Minimal steps

1. Catalog current GUI/item consumers.
2. Define profile-backed read interface.
3. Adapt `GuiKnowledgeRegistry`/item resolver boundary.
4. Migrate one low-risk GUI/item reference.
5. Migrate `/kho`, `/pv 2`, `/ks`, `/nung` knowledge in bounded slices.
6. Preserve runtime observation vs confirmed config separation.
7. Add fake profile with different title/item evidence.
8. Add architecture import guard.

## Acceptance criteria

- Generic GUI engine has no MinerUA/B1/MMOItems assumptions in migrated path.
- Click requires semantic/transition evidence.
- Item confidence policy preserved.
- Observation cannot silently overwrite fixed identity.
- Profile revision appears in decision/trace.

## Tests

- MinerUA identity parity;
- fake GUI/title/layout;
- ambiguous confidence fail closed;
- stale generation GUI;
- fixed vs learned item;
- wrong profile rejection.

## Rollback

Read-only compatibility adapter to current registry/config; do not reintroduce command-regex-only GUI matching.

## Stop conditions

- Hard-code newly assumed GUI slot.
- Test weakened to first regex match.
- Click owner bypass.

## Completion evidence — 2026-08-22

- Per-bot item registry/resolver is constructed from selected profile item facts; GUI definitions, identity policy and slot registry are profile-backed.
- Runtime GUI observation remains a separate overlay and existing strong/fixed/learn-once identity tests remain unchanged.
- B5 trace records selected server profile id/revision.
- Fake profile contract proves different GUI title and item carrier can use the same generic identity engines.
- `ClickExecutor` remains the exclusive raw click owner.
