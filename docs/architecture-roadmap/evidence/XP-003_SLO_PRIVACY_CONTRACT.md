# XP-003 — SLO và privacy measurement contract

Status: `DONE`

`architecture/slo/current.json` defines the local-only measurement policy, objective coverage, retention and privacy/cardinality constraints. `src/diagnostics/metrics/SloMetricContract.js` is the executable metric vocabulary.

All requested metrics have a local source contract. Incident MTTA/MTTR are explicitly `NOT_MEASURABLE_YET` until XP-102 supplies acknowledgement/closure lifecycle. Remote telemetry is not enabled; any future remote path requires explicit opt-in and a separate disclosure.

Verification:

- `node scripts/check-slo-contract.js`
- `node --test tests/unit/diagnostics/SloMetricContract.test.js`
