# XP-000 — Product baseline và task inventory

Status: `DONE` (expert walkthrough baseline; operator feedback incorporated, no secret/runtime data captured)

## Journey baseline

| Journey | Persona / owner | Entry point | Screens / actions | JSON/docs needed | Failure and recovery baseline | Priority link |
| --- | --- | --- | ---: | --- | --- | --- |
| Launch and backend start | Operator mới / Desktop | App launch, Overview | 1 / 1 | No | Banner must retain sanitized boot stage and retry | XP-001, XP-015 |
| Add/configure bot | Operator mới / Profiles | Bots | 1 / 4–7 | No | Inline validation; secret state distinct from profile state | XP-016, XP-103 |
| Connect and start mode | Operator / bot card | Overview or Bots | 1 / 2 | No | Readiness/blocker and safe action visible | XP-013, XP-104 |
| B5 blocked recovery | B5 operator / B5 card | Overview | 1 / 1 | No | Guarded retry only for current episode/generation | XP-010, XP-014 |
| Reconnect and resume | Operator / runtime | Bot card | 1 / 1–2 | No | Durable intent remains in-process; stale effects discarded | XP-013, XP-403 |
| Emergency stop | Operator / fleet | Header destructive action | 1 / 2 | No | All bots attempted; partial/timeout per bot; retry failed subset | XP-012, XP-403 |
| Export support | Operator/maintainer / Diagnostics | Diagnostics | 1 / 2 | No | Preview privacy/size; corrupt optional entries become warnings | XP-011 |
| Local update/recovery | Maintainer / Updates | Updates | 1 / 2–4 | No | Integrity rejection/rollback evidence | XP-405 |

Three deterministic expert walkthrough passes are represented by the XP-001 critical-flow harness: stopped/start/navigation/stale-or-failure/shutdown. The current operator's repeated reports about B5 blocked recovery, timeout visibility and audit churn are treated as direct operator feedback. A separate usability study with a new operator remains a later validation activity; this baseline does not claim such a study occurred.

## Top friction inventory

1. B5 blocker had no safe public retry action.
2. Emergency stop could abort the fleet after one bot exception.
3. Diagnostics reader and writer disagreed about artifact layout.
4. Desktop support export bypassed the shared builder.
5. Startup failure existed mainly as transient toast/log text.
6. Secret corruption looked identical to not configured.
7. Common mode restart policy allowed excessive loops.
8. Error strings lacked one canonical operator/action vocabulary.
9. Current docs had behavior/version drift.
10. Desktop critical flows lacked an executable renderer safety net.

Privacy boundary: no usernames, chat, inventory/NBT, credentials, `.env`, `data/**` or runtime packet dumps are part of this evidence.
