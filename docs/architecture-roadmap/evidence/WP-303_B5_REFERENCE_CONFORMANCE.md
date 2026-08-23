# WP-303 Evidence — B5 Reference Workflow Conformance

Status: **DONE** on MCbot **2.7.22**.

- `b5-craft` remains a `ManagedMode` registered through the Mode SDK with `primary-mode` ownership and no movement capability.
- Static conformance test rejects direct pathfinder/movement imports, `bot.chat()` and `clickWindow()` in the pure B5 mode service.
- Mandatory storage protection remains the batch gate before crafting and is re-armed after verified B5 completion before the next campaign.
- Uncertain craft mutations remain quarantined through WP-301 semantics; reconnect proof counters are generation-local and stale results are discarded.
- WP-302 immutable storage plan is executed by B1 protection without absorbing later inflow.
- B5 automation status now exposes versioned replay identity (contract/version/digest/domain/profile/policy) without dumping the full trace.
- The old `B1SmeltingTelemetrySoftFail` expectation conflicted with the verified-transaction contract: a successful smelt click with unchanged authoritative `/kho` state is now explicitly tested as `VERIFICATION_FAILED`/retryable. No production code was weakened to satisfy that stale assertion.

Reference conformance/storage/crafting/replay targeted suite: 113/113 PASS.
