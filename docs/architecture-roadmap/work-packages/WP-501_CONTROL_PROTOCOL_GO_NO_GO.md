# WP-501 — Control Protocol Prototype and Go/No-Go

## Status

`DEFERRED — NOT ACTIVATED (2026-08-22): requires a WP-500 GO ADR, which does not exist`

## Objective

Nếu WP-500 GO, prototype tối thiểu control-plane ↔ worker protocol và chứng minh parity/failure semantics trước production roadmap.

## Depends on

- WP-500 GO ADR.

## In scope

- Intent command/status/event/result envelopes.
- Worker registration/health/shutdown.
- Duplicate/stale/out-of-order semantics.
- Local prototype only.

## Out of scope

- Production deployment/multi-host security hoàn chỉnh.
- Gameplay feature.

## Minimal steps

1. Define protocol schema/version.
2. Define delivery/idempotency/revision semantics.
3. Wrap one fake BotRuntime worker.
4. Route fake mode/control/status.
5. Inject worker crash/restart/stale messages.
6. Compare in-process parity/latency/complexity.
7. GO/NO-GO ADR.
8. Delete prototype if NO-GO.

## Acceptance criteria

- Duplicate command does not duplicate mutation.
- Stale worker/generation result rejected.
- Desired intent reconciles after restart.
- Shutdown/cancel bounded.
- No raw runtime object crosses wire.
- Measured benefit meets WP-500 threshold.

## Stop conditions

- Prototype becomes production by accident.
- Dual path lacks parity tests.
- Protocol depends on log text.
