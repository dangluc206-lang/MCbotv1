# MCbotv1 Crafting Rules

## Purpose

This is the generic crafting contract for the project.

The system must be designed around **crafting as a capability/workflow**, not around one fixed product or one fixed tier.

No implementation may assume that the target is B5, `super_alloy`, or any other single item unless the current task explicitly selects that item.

## Separation of concerns

Keep these responsibilities separate:

```text
Recipe definition
→ Planning
→ Input acquisition
→ Craft action
→ Output verification
→ Settlement
→ Storage / handoff
```

### Recipe definition

Recipe data belongs in configuration/server-profile data.

Do not hard-code recipe quantities in workflow code.

### Planning

Planner code should be deterministic/pure where possible.

Planner responsibilities:

- determine required inputs;
- calculate executable quantity;
- account for available inventory/storage/vault state;
- produce blockers;
- choose safe action quantities;
- produce enough input metadata for later verification.

Planner must not:

- click GUI;
- send commands;
- move the bot;
- mutate inventory;
- wait on Minecraft events;
- own runtime timers.

### Input acquisition

Input acquisition is a separate capability.

The planner decides what is needed.

The acquisition flow decides how to obtain it using existing capabilities.

Do not let acquisition code implement recipe planning.

### Craft action

Craft execution must use the existing crafting capability.

The execution layer receives an exact recipe/item/quantity decision.

It must not silently re-plan a different recipe.

## Generic stage contract

Each crafting stage should follow:

```text
INPUT_READY
→ ACTION
→ OUTPUT_VERIFIED
→ SETTLED
→ HANDOFF_READY
```

A multi-stage recipe graph may repeat this contract for each stage.

The next stage must consume fresh, verified state from the previous handoff.

## Quantity

Quantity strategy is part of policy, not universal behavior.

Possible server capabilities may include:

```text
1
64
ALL
```

A capability may detect an available quantity action, but the workflow must decide whether it is safe.

Never assume `ALL` is safe simply because the GUI exposes it.

## Input safety

Before crafting:

- verify required inputs are observable;
- verify output capacity/headroom when relevant;
- preserve unrelated workflow resources;
- respect inventory/storage limits;
- use the configured acquisition strategy.

Do not withdraw more material than the plan requires.

Do not use `ALL`, `1 stack` or `full inventory` acquisition without an explicit contract proving it is safe.

## Verification

A crafting action is complete only after postcondition verification.

Minimum evidence should establish:

```text
expected output increased
AND
relevant input/output state settled
AND
same connection generation remained valid
```

If the server produces custom items, verify using the strongest configured item identity.

Do not rely on material/display name alone when stronger identity exists.

## Uncertain craft

If craft execution ends without conclusive evidence:

```text
CRAFTING_OUTCOME_UNCERTAIN
→ quarantine mutation
→ fresh observation
→ reconciliation
→ SUCCESS or NO_EFFECT
```

Do not click the same quantity action again merely because the first attempt timed out or produced no immediate delta.

## Multi-stage handoff

For:

```text
A → B → C → D
```

do not infer that B exists because the A→B action returned successfully.

The handoff into B requires:

```text
B observed
→ B settled
→ B available to the next stage
```

The next stage must not use stale input assumptions from before the previous mutation.

## Storage / vault handoff

When crafted output must be stored:

```text
craft
→ verify output
→ settle
→ transfer
→ verify destination
→ complete stage
```

A transfer click is not proof that storage succeeded.

## Failures and blockers

Distinguish:

- insufficient material;
- insufficient capacity;
- GUI identity failure;
- quantity action unavailable;
- crafting outcome uncertain;
- stale generation;
- cancellation;
- timeout;
- server rejection.

Do not convert a business blocker into an infrastructure retry loop.

## Extensibility

The same crafting capability must support different:

- products;
- recipes;
- recipe graphs;
- quantity policies;
- acquisition strategies;
- storage destinations;
- server profiles.

New crafting workflows should reuse the common planning/execution/verification infrastructure rather than clone an existing product-specific workflow.

## Tests

Every new crafting rule should have targeted tests for:

- recipe calculation;
- quantity selection;
- input acquisition;
- output verification;
- settlement;
- uncertain mutation/reconciliation;
- generation change;
- storage/vault handoff when applicable.

A passing action test without a postcondition assertion is not sufficient.
