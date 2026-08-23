# WP-401 Evidence — Deterministic Simulation / Fault Matrix

Status: **DONE** on MCbot **2.7.24**.

## Existing foundation retained

- `VirtualClock` remains the test-boundary time owner; production scheduling is unchanged.
- `RuntimeReplayHarness` remains the single generic scripted runner.
- `SafetyReplayRuntime` continues to use real `BotContext`, `CommandExecutor`, `ClickExecutor` and `ModeCoordinator` contracts with fake client adapters only.
- The simulator never connects to a server or network and no test requires wall-clock sleep increases.

## Fault vocabulary

Fault matching is fail-closed and supports `id`, `kind`, `name`, `operation` and `path`. Unknown matcher keys are rejected. `times` may bound a scoped fault but is not used as a global call-order selector.

Supported semantic effects:

- `before-error`: reject before the matched adapter/handler executes.
- `after-error`: execute the real handler first, then surface an injected error; models applied side effect / lost response.
- `resolve-wrong`: execute the real handler, then replace the returned observation with a deterministic wrong value.
- `read-transient`: return a deterministic transient observation without invoking the read adapter.

Legacy deterministic `drop`, `delay`, `duplicate` and `error` effects remain compatible.

## Reference incidents covered

- stale callback after reconnect: existing `stale-side-effects.json` fixture;
- GUI click applied but response lost: `click-response-lost.json` fixture using `after-error`;
- storage sell uncertainty: classified by the production `ReconciliationBarrier` as `UNRESOLVED`, mutation-blocking and not replannable;
- config rename/copy boundary: path/operation-scoped `before-error` blocks rename while an adjacent copy executes;
- mode/task disable during retry backoff: production `TaskSupervisor` + `VirtualClock`, cancelled at virtual time with zero wall-clock wait;
- unowned cleanup collision: production `ModeCoordinator` rejects a foreign lease and preserves the real owner;
- multi-bot isolation: two independent safety runtimes retain separate connection generations and mode ownership.

## Fixture authoring

Scenario contract remains version `1` with top-level `name`, optional `clockStartMs`, optional `runtime`, optional `faults`, and `entries`.

Prefer an operation/path selector whenever the boundary has a concrete identity:

```json
{
  "id": "response-lost-after-click",
  "match": {
    "operation": "craft.quantity.click",
    "path": "window:ks/slot:12"
  },
  "effect": {
    "type": "after-error",
    "code": "RESPONSE_LOST"
  }
}
```

A fixture must describe observations/faults only. Planner decisions, server recipes, ownership rules and reconciliation policy stay in production contracts and are invoked by the harness rather than copied into scenario code.

## Verification

- `node --test tests/unit/simulation/ReplayHarness.test.js tests/unit/simulation/FaultMatrixContract.test.js`
- deterministic JSON fixture replay twice with byte-for-byte equal output;
- baseline, structure and architecture gates run before delivery packaging.
