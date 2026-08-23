# WP-300 Evidence — Decision / Replay Envelope

Status: **DONE** on MCbot **2.7.19**.

## Implementation

- `src/shared/contracts/DecisionReplayEnvelope.js` defines the generic, versioned, immutable envelope.
- Canonical SHA-256 identity covers contract/version/domain/profile revision/policy revision/input/decision. Result and trace metadata do not change decision identity.
- Nested sensitive keys are redacted before persistence/digest. Runtime-only values such as `Date` and `Buffer` are rejected.
- `B5TraceRecorder` emits the envelope in parallel with the legacy B5 replay fixture.
- `B5PlannerReplay` accepts both the legacy fixture and the generic envelope during the migration window.
- Generic domain payload is unconstrained by B5-specific fields; tests exercise an independent `demo` domain.

## Compatibility / rollback

The legacy B5 fixture remains readable and is not reinterpreted. Unsupported versions fail with `REPLAY_VERSION_UNSUPPORTED`; digest mismatch fails explicitly.

## Verification

- `node --test tests/unit/shared/DecisionReplayEnvelope.test.js tests/unit/simulation/B5PlannerReplay.test.js tests/unit/server-features/B5TraceRecorder.test.js`
- `npm run baseline:check`
- `npm run validate`

No planner/executor behavior or gameplay policy is changed by this package.
