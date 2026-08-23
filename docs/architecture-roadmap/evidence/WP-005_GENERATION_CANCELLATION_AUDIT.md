# WP-005 — Generation, Cancellation and Stale Callback Audit Evidence

Date: 2026-08-22
Closure release: 2.7.7

## Contract proof

- `EventBus` resolves scope before payload handling and fail-closes every connection-scoped event unless it carries a non-empty `botId` and positive `connectionGeneration`.
- `EventEnvelope` strips raw client/window/packet references and canonicalizes connection generation.
- `createConnectionEventBinding` captures client + generation, rechecks both before publishing late Mineflayer callbacks, and removes listeners only for the exact bound generation.
- `createConnectionStateBinding` rejects stale generation, stale attempt epoch and stale reconnect-owner events.
- Reconnect ownership uses generation/attempt epochs and a bounded decision ledger; explicit stop/suspension clears pending reconnect ownership so late completion cannot reschedule.
- `TaskSupervisor` owns a `CancellationSource` per task, awaits task settlement on stop/stopAll/close, unlinks parent cancellation and disposes the source on settle.
- B5 and Fishing mode tests prove stale-generation completion cannot count progress, publish replacement-generation state, reconnect the replacement, or release current ownership.

## Acceptance mapping

1. Every connection event carries bot/generation: enforced centrally by `EventBus`, covered by EventEnvelope/EventBus/binding tests.
2. Old generation cannot mutate/release new owner: connection state, GUI, command, B5 and fishing generation suites.
3. Explicit disconnect wins over pending reconnect/late client: reconnect manual-control and final-ownership suites.
4. Desired mode survives reconnect in same process: B5/fishing runtime state is bot-scoped while connection-bound work is generation scoped; reconnect suites and mode recovery tests cover continuation.
5. Mode disable cancels old tasks boundedly: `TaskSupervisor` plus managed/B5/fishing cancellation tests.

## Required evidence commands

```text
node --test tests/unit/bootstrap/ConnectionEventBinding.test.js tests/unit/bootstrap/ConnectionStateBinding.test.js tests/unit/connection/ReconnectManualControl.test.js tests/unit/connection/ReconnectOwnershipFinalContract.test.js tests/unit/connection/ReconnectSuccessOwnershipContract.test.js tests/unit/core/TaskSupervisor.test.js tests/unit/commands/CommandGenerationContract.test.js tests/unit/gui/GuiGenerationContract.test.js tests/unit/items/InventoryObservationGeneration.test.js tests/unit/server-features/ServerLoginGeneration.test.js
```

No reconnect timing policy or gameplay feature was changed in this WP.
