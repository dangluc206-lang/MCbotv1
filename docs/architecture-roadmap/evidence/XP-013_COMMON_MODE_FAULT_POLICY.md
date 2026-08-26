# XP-013 — Common mode fault policy

Status: `DONE`

`ModeFaultPolicy` composes the existing circuit breaker into a bot/mode-scoped primitive. It classifies expected wait, transient retry, business blocker, unexpected fault, stale abort and cancellation. Expected waits, business blockers, stale results and cancellation do not consume the crash-loop budget. Restart count/delay are derived from the validated application circuit-breaker policy, not hard-coded in the mode.

One incident is published per episode; verified recovery records resolution evidence. Policy state is visible as `mode-fault-snapshot-v1`, bounded to 16 recent episodes, and lifecycle close/reset is explicit. Unit tests use a small reference-mode instance before B5 adoption and prove finite OPEN behavior and non-counting classes.
