# MCbotv1 Verification Rules

## Core rule

```text
action sent != action succeeded
```

Any stateful Minecraft action must use:

```text
BEFORE
→ ACTION
→ OBSERVE
→ AFTER
→ VERIFY
```

## Command

`bot.chat()` only proves that the client attempted to send the command.

Success must be verified using the strongest available postcondition:

- server response;
- GUI transition;
- position/teleport;
- inventory/storage change;
- domain event.

Expected generation must be preserved through generation-sensitive commands.

## GUI

A resolved or successful click is not success.

Production GUI flow:

```text
open / transition
→ identify GUI
→ observe
→ resolve live action
→ click
→ observe update / transition
→ verify postcondition
```

Do not treat a fixed slot as logical identity.

Use GUI provenance, identity evidence and current session/window.

## Inventory

Inventory changes must be verified from the correct source.

Examples:

- player inventory delta;
- current-window player section;
- vault/storage delta.

Do not double-count views of the same inventory.

If an uncertain mutation may already have happened, reconcile before retrying.

## Movement

Pathfinder completion is not arrival proof.

Verify the final position with the appropriate arrival/safety guard.

Teleport commands require actual teleport evidence, not command-send success.

## Storage

Opening `/kho` is not a successful storage read.

Success requires a readable snapshot with valid provenance and parsed state.

Do not use a partial Sell GUI as a full storage snapshot.

## Crafting

A craft-button click, quantity click or `craft()` resolution is not craft success.

A crafting stage is successful only after:

1. expected output is observed;
2. relevant input/output state is synchronized;
3. the relevant output is settled according to the configured quiet/stable rule;
4. the connection generation is still valid.

## Uncertain mutations

If an action may have happened but evidence is inconclusive:

```text
UNCERTAIN
→ RECONCILE
→ SUCCESS or NO_EFFECT
```

Do not blindly repeat the same side effect.

A later fresh read may be provisional evidence; do not convert one contradictory observation into confirmed success without the module's reconciliation contract.

## Stale generation

If `connectionGeneration` changes before the side effect, during the side effect, or before verification:

- discard the old result;
- stop the old flow where required;
- do not credit output to the new generation;
- let the current runtime reconcile.

## Timeout

A timeout means the expected postcondition was not established within the contract.

Never convert timeout into success with a fixed delay.

## Verification evidence

Prefer deterministic structured evidence over message text.

Keep verification scoped to the affected state. Unrelated inventory changes do not invalidate a correctly scoped stage when the affected state is stable and verified.
