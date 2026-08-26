# XP-014 — B5 blocked recovery và finite fault lifecycle

Status: `DONE`

B5 now derives its supervised restart budget from `ModeFaultPolicy`; the prior `100000` restart allowance is removed. Repeated storage blockers stay in `WAITING_BLOCKED`, publish exactly one business-blocker incident per storage-protection episode and do not consume the crash-loop circuit.

`requestStorageProtectionRetry()` is the public guarded use case. It requires exact bot, current connection generation, episode, incident and bounded idempotency key; it rejects wrong/stale/duplicate-pending/unsafe-phase requests. It only grants one attempt through the existing protection episode and cannot call command/GUI/storage side effects itself. Status exposes a concise safe-state and catalog action IDs. Verified protection completion resolves the episode with batch/generation evidence before crafting can proceed.
