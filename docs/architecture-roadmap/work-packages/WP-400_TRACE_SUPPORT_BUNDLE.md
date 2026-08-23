# WP-400 — Trace, Support Bundle and Redaction Convergence

## Status

`DONE — 2026-08-22 / MCbot 2.7.23`

## Objective

Chuẩn hóa correlation/trace/status/support evidence để operator thấy gọn, auditor replay được và secret không leak.

## Depends on

- WP-300.

## In scope

- Current logs/trace/health/support inventory.
- Additive TraceEnvelope/correlation.
- Operator projection/suppression.
- Support bundle manifest/allowlist/redaction.
- One B5/reconnect/update reference incident.

## Out of scope

- External telemetry SaaS.
- Full log rewrite.

## Minimal steps

1. Inventory sinks/fields/redaction gaps.
2. Define trace schema/version/correlation chain.
3. Add compatibility logger/trace adapter.
4. Standardize reference flow.
5. Define support bundle allowlist/size/retention.
6. Add secret/raw dump redaction.
7. Add operator summary projection.
8. Add health/evidence references.

## Acceptance criteria

- Intent → operation → decision → evidence traceable.
- Operator UI không spam full STEP/GUI/KHO/PV.
- Support bundle excludes env/tokens/password/raw client.
- Stable codes/structured fields; no message parsing.
- Bundle/replay schema versioned.

## Tests

- redaction nested cause/details;
- bundle allowlist/protected paths;
- size/retention bounds;
- correlation across reconnect;
- repeated blocker suppression;
- schema validation.

## Rollback

Keep old sinks while disabling new projection/bundle writer; do not remove redaction.

## Stop conditions

- Bundle copies entire runtime/data/log tree.
- Raw secrets in fixture.
- Trace creation mutates runtime decision.
