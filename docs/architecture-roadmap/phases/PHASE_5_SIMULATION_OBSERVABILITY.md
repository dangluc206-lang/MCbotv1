# Phase 5 — Simulation and Observability

## Gate status

`PASS — 2026-08-22 / MCbot 2.7.25`


## Outcome

Incident quan trọng có deterministic offline reproduction; operator status gọn; forensic/support evidence đầy đủ và an toàn.

## Entry criteria

- Common event/result/decision contracts.
- Reconciliation semantics ổn định.
- At least B5/reconnect/update reference incidents.

## Mandatory work packages

- WP-400 đến WP-402.

## Sequence

1. Normalize trace/correlation/redaction schema.
2. Build support bundle manifest/allowlist.
3. Introduce virtual clock/fake adapters/capabilities.
4. Scenario runner for events/observations/faults.
5. Convert representative incidents to fixtures.
6. Add CI gates without real server dependency.

## Reference scenarios

- reconnect with stale callback;
- GUI click uncertain outcome;
- B5/storage reserve/sell reconciliation;
- runtime config rename/copy failure;
- explicit disconnect vs late client;
- mode disable during background loop;
- server profile mismatch/missing capability.

## Exit criteria

- Scenario deterministic and bounded.
- Replay schema versioned.
- Support bundle redact test.
- Health/status uses contracts, not log parsing.
- CI runtime acceptable; slow matrix can split but remains required release gate.

## Stop conditions

- Simulator reimplements production logic instead of faking boundaries.
- Fixtures include secrets/raw runtime dumps.
- Test uses long real sleeps.
- CI silently skips critical fault cases.
