# ADR-001 — Common Event, Result and Error Contracts

## Status

Accepted — 2026-08-22

## Date and owners

- Date: 2026-08-22
- Decision owner: MCbot architecture
- Reviewers: automated contract tests and architecture validator

## Context

MCbot already exposes `EventEnvelope`, `Result`, `Status`, `FlowError` and multiple domain-specific stable codes. Replacing them in one migration would break Desktop, Discord, tests and runtime callers. The target therefore needs an additive compatibility boundary that can be adopted one path at a time.

## Decision drivers

- Preserve all existing public fields and call signatures.
- Make machine decisions depend on stable code/outcome, never message text.
- Distinguish uncertain side effects from stale generation and cancellation.
- Keep raw Mineflayer/client/window/packet values outside serializable contracts.
- Require connection identity (`botId`, positive `connectionGeneration`) at connection-scoped event boundaries.

## Decision

1. `EventEnvelope` remains the canonical event boundary. Connection-scoped events require `botId` and positive `connectionGeneration`.
2. Legacy `Result` remains the public compatibility object. `OperationResultContract` (`operation-result-v1`) is an additive façade for versioned/replay/control-plane consumers.
3. Stable outcomes are `SUCCESS`, `FAILED`, `UNCERTAIN`, `STALE`, and `CANCELLED`.
   - `UNCERTAIN`: a side effect may have applied; a conflicting mutation must not retry until fresh reconciliation evidence exists.
   - `STALE`: the result belongs to an obsolete bot/connection generation and must not mutate current state or release current ownership.
   - `CANCELLED`: the owning task was intentionally stopped; it is not success and may not be applied as domain evidence.
4. Stable error codes are machine API. `message` is operator-facing only and may change without contract versioning.
5. `ErrorContract` (`stable-error-v1`) serializes redacted code/cause metadata while retaining existing `FlowError` behavior.
6. Domain-specific fields remain in `data`/`meta`; common contracts must not contain MinerUA or B5 policy fields.

## Compatibility and migration

Existing callers keep `Result`/`FlowError`. New replay/profile/mode contracts may adapt with `OperationResultContract.fromLegacy()`. Migration is per boundary; there is no deadline requiring a big-bang conversion. Old public fields are not removed by this ADR.

## Verification

- `tests/unit/shared/contracts/OperationResultContract.test.js`
- Existing `tests/unit/core/EventEnvelope.test.js`
- Architecture validation and full test suite.

## Revisit triggers

- A second process/network protocol requires wire compatibility.
- A stable outcome cannot be represented without changing existing semantics.
- Public consumers need schema negotiation beyond additive versioned façades.

## Links

- WP-002
- `src/core/events/EventEnvelope.js`
- `src/shared/result/Result.js`
- `src/shared/errors/FlowError.js`
- `src/shared/contracts/OperationResultContract.js`
