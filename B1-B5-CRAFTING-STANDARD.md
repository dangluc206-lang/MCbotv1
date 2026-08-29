# B1 -> B5 Crafting Standard v1.0

Runtime contract for the B5-only crafting pipeline.

## Required state machine

Every stage must progress through:

`INPUT_READY -> ACTION -> OUTPUT_VERIFIED -> SETTLED -> HANDOFF_READY`

`B5 -> COMPLETE` adds final persistence verification in `/pv 2`.

## Stage gates

- B1 -> B2: required B1 quantity must be observable before B2 action.
- B2 -> B3: B2 output must be observed at the expected delta and the relevant B2 inventory count must settle before B3 can start.
- B3 -> B4: B3 output must be observed and settled before B4.
- B4 -> B5: B4 output must be observed and settled before B5.
- B5 -> next cycle: final B5 must be deposited and verified in `/pv 2` before the cycle is complete.

## Safety rules

1. A successful GUI click is not completion.
2. `craft()` success is not completion.
3. Output verification and inventory settlement are separate conditions.
4. A stale generation cannot hand off to another stage.
5. An uncertain mutation remains quarantined until reconciliation proves success or no effect.
6. A later stage must use a fresh state after the previous stage's handoff.
7. A timeout must never be converted into a successful handoff by a fixed delay.
8. Final B5 completion requires persistent-storage evidence.

## Relevant settlement

Settlement is scoped to the item affected by the stage. The whole inventory does not have to be globally quiet if an unrelated item is changing. The relevant output count must reach the expected threshold and remain unchanged for the configured quiet/stable window.

## QA acceptance

A complete B1 -> B5 cycle is PASS only when B1, B2, B3, B4 and B5 each satisfy their stage gate, the final B5 is verified in `/pv 2`, and the connection generation remains valid for the entire handoff chain.
