# Crafting Phase Orchestration Rules

Persistent operating rules for the MCbotv1 crafting refactor roadmap (G1–G24).
These rules live in Git and govern every phase act until the roadmap is complete.

## B1. Phase state machine

Each phase has exactly one state:

- `PLANNED` — scoped but not started.
- `IN_PROGRESS` — work underway; the progress file records what is done, what
  remains, tests run, and blockers.
- `BLOCKED` — cannot proceed safely; the progress file records the exact
  blocker and the decision needed. Never silently mark `CLOSED`.
- `CLOSED` — acceptance criteria met, implementation + progress commits exist
  locally AND on `origin/main`, verified by fetch + rev comparison.

Phase state is distinct from overall project state (`G1–G24 IN PROGRESS` until
every phase is `CLOSED`).

A phase may be skipped only with evidence: the work is complete, the commit
exists, and it is verified on the remote. Never re-run a `CLOSED` phase merely
because a new session started or context was lost. If a phase is `IN_PROGRESS`,
continue from the actual remaining work; do not restart mechanically.

## B2. Anti-repeat rules

- A defect found before its phase closes is fixed inside that same phase.
- A new defect confirmed after its phase closed gets a corrective sub-phase
  `G<orig>.x` (e.g. `G19.1`), linked to the origin phase, scoped to the defect
  only — never a full replay of the origin phase.
- Never create `G.x` for hypothetical defects, minor metadata tidying, or work
  that belongs to the acceptance criteria of the currently open phase.
- A phase is never declared closed merely because code is written.

## B3. Phase acceptance

For each phase:

1. Read the actual acceptance criteria in the roadmap.
2. Inspect existing source to find what is genuinely incomplete.
3. Implement strictly within phase scope.
4. Run focused tests, required regression suites, and related quality/config gates.
5. Classify every failure as new regression, verified baseline, or
   inconclusive. Never label baseline without reproduction evidence.
6. Fix in-scope defects before closing.
7. Record progress in the same closing unit of work, with exact test commands
   and actual results.
8. One commit per phase; never merge multiple phases into one commit.

Never claim live-server or live-GUI verification from mock/unit tests alone.

## B4. Commit and push

When a phase meets acceptance:

1. Check `git diff --check`, the full diff, file list, and working tree.
2. Commit that phase separately, including required changes plus progress evidence.
3. Push to `origin/main` fast-forward or via safe integration. Never force-push.
4. Verify the remote `main` contains the commit and the remote source matches
   what was reviewed.
5. Only after successful verification move to the next phase.

If push is rejected because the remote advanced, fetch and integrate safely;
resolve conflicts only when clearly safe without data loss. Stop only on a
genuinely unresolvable conflict. Never discard remote changes.

## B5. Automatic phase transition

After closing and verifying a phase:

- Do not ask the user whether to continue.
- Do not wait for the next phase prompt.
- Read the roadmap, identify the next unclosed phase, and execute immediately.
- Never skip a phase for being complex.
- Never reorder the roadmap or invent phases beyond the `G.x` rule above.

## B6. Session-limit resume

Before transitioning, always ensure the previous phase is recorded and pushed.

If context or session time is insufficient for the current phase:

- Persist `IN_PROGRESS` with done/remaining/tests/blockers.
- If work must be preserved, create a clearly labeled checkpoint commit —
  never disguised as a phase completion.
- Never start a new phase while the current one is incomplete.
- On resume, continue the open phase; never re-run closed phases.

Never declare the roadmap complete while any phase is unclosed.

## B7. Stop conditions

Stop only for a genuine blocker: missing required permission, design
contradiction unresolvable from docs/code, Git data conflict that cannot be
integrated safely, or an environment that prevents verifying a critical
requirement.

A failing test is not automatically a stop reason: investigate and fix within
the granted scope first.

When forced to stop, update progress, keep changes safe, state the exact
blocker and the decision needed. Never silently mark `CLOSED`.
