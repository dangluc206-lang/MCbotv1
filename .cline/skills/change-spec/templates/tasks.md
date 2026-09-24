# Tasks: <change-name>

- [ ] T1 [REQ-<id>] <task> — depends on: none — verify: <command/evidence>
- [ ] T2 [REQ-<id>] <task> — depends on: T1 — verify: <command/evidence>
- [ ] T3 [REQ-<id>] <task> — depends on: T2 — verify: <command/evidence>
- [ ] T4 [REQ-<id>] <migration/deletion> — depends on: T2,T3 — verify: <command/evidence>
- [ ] T5 [ALL] final quality/architecture/contract verification — depends on: T1,T2,T3,T4 — verify: <command/evidence>
