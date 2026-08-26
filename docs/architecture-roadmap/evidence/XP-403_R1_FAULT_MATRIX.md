# XP-403 — Fault simulation matrix, R1 closure slice

Status: `R1_SLICE_DONE`; update/R2-R3 cases remain owned by their later work packages.

`architecture/fault-matrix/r1.json` maps ten fault scenarios to expected state, catalog actions, artifact and cleanup assertion. Every entry points at a production-boundary test rather than a sleep-based happy path. The executed slice covers command ambiguity, stale GUI, concurrent inflow, generation changes, finite mode loop, partial 64 sale, corrupt/decrypt-failed persistence, boot/renderer fatal recovery, one-bot fleet failure and optional support evidence failure.

The matrix contract test verifies coverage and action safety. Behavioral gates execute the referenced B5/storage/fleet/Desktop/diagnostics suites. Full XP-403 must remain open until its declared XP-205/update dependencies are implemented; this evidence does not claim R2/R3 completion.
