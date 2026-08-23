# Post-WP-203 Legacy Mode Convergence — 2026-08-23

## Scope

This hardening pass does not reopen WP-203 or rewrite Collector+B5/Fishing gameplay. It closes two remaining strangler-boundary weaknesses with parity evidence.

## Public control boundary

`BotRuntime.services.collectorB5Mode` and `BotRuntime.services.fishingMode` now resolve to `LegacyModeAdapter`, the same implementation bound into `RuntimeModeRegistry`. Discord/Desktop/config editors therefore cannot obtain the raw legacy gameplay service through the public service name. `reconfigure()` and `publicConfig()` remain compatibility methods on the adapter. The raw state-machine instances remain lifecycle-internal only.

## Shared lease lifecycle

`src/modes/ModeLeaseSession.js` is now the single lease primitive used by:

- `ManagedMode`;
- `CollectorB5ModeService`;
- `FishingModeService`.

The primitive preserves exact lease identity and delegates acquire/pause/resume/release/isHeld/status/owner semantics to `ModeCoordinator`. Collector/Fishing no longer maintain independent copies of those operations.

## Shared restart supervision

Collector+B5 and Fishing now use `src/core/TaskSupervisor.js` for both main-loop cancellation lifetime and bounded restart scheduling. Neither legacy mode creates its own `CancellationSource` or raw restart `setTimeout`; compatibility fields remain observable while cancellation tokens and task cleanup are owned by the shared supervisor. Recovery/classification remains inside each mode so gameplay decisions are unchanged.

The remaining debt is domain-specific gameplay/recovery decision making, not task lifetime, cancellation-source, lease, public-control, or restart-timer ownership.

## Remaining debt

The remaining debt is orchestration-specific, not lease/public-control ownership:

- Collector+B5 still owns its proven gameplay/retry/task state machine.
- Fishing still owns its proven gameplay/retry/task state machine.
- Raw fishing protocol remains the catalogued `ConnectionPacketObserver` exception until a second proven protocol consumer plus ADR exists.

No B5 policy, command semantics, GUI behavior, fishing packet semantics, or server timing changed.
