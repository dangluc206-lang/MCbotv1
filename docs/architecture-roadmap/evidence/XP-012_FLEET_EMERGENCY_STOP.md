# XP-012 — Fleet emergency stop transaction

Status: `DONE`

`FleetControlService.emergencyStop()` owns the `fleet-emergency-stop-v1` transaction. It snapshots the bot set/generation, suspends reconnect and revokes all durable mode/connection intents with all-settled semantics before awaiting any slow disconnect. Every bot then runs through its existing mode/operation/movement/GUI/connection owners with an independent timeout. A failed durable write takes a direct owner-based safety fallback rather than bypassing lower-level side-effect boundaries.

The result exposes `SUCCESS`, `PARTIAL`, `TIMEOUT` or `FAILED` globally and terminal/status/code per bot. Duplicate idempotency keys share one bounded transaction. Non-terminal results publish a runtime failure through the bot-scoped publisher when available. Desktop delegates to this use case rather than serially issuing mode then connection actions.
