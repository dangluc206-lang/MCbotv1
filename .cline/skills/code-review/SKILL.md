---
name: code-review
description: Review MCbotv1 changes before merge or handoff using separate Standards and Spec axes plus correctness, readability, architecture, security, performance, testing, scope, and regression checks. Use for branch/PR/WIP review, review-since-commit, refactors, bug fixes, migrations, and cross-cutting changes.
---

# Code Review for MCbotv1

## Review law

A code review is an evidence-based assessment of a change, not a rewrite and not a single overall score.

Keep these axes separate:

1. **Standards** — does the change follow documented repository rules and coding standards?
2. **Spec** — does it implement what the originating task/change specification asked for, and only that?
3. **Correctness** — does behavior and error handling work?
4. **Readability & simplicity** — can another engineer follow it without hidden context?
5. **Architecture** — does ownership, dependency direction and contracts remain valid?
6. **Security** — are trust boundaries and secrets handled safely?
7. **Performance** — did the change introduce avoidable hot-path or scalability regressions?
8. **Tests & verification** — do tests prove behavior, edge cases and regressions?
9. **Scope & regression risk** — did unrelated behavior change?

Do not merge these dimensions into a single “good/bad” score. A change can pass one axis and fail another.

## When to use

Use before:

- merging a branch/PR;
- handing off agent-generated code;
- closing a bug fix;
- accepting a refactor/migration;
- reviewing a WIP against a fixed commit/tag/branch.

## Step 1 — Pin the review point

If a comparison point is supplied, resolve it and capture:

```bash
git rev-parse <fixed-point>
git diff <fixed-point>...HEAD
git log <fixed-point>..HEAD --oneline
```

Use three-dot comparison against the merge-base.

If the fixed point is invalid, stop. If the diff is empty, report that there is nothing to review rather than manufacturing findings.

If no fixed point exists, review the current worktree diff/status and state that the comparison basis is the working tree.

## Step 2 — Identify intent and spec

Find the originating requirement in this order:

1. explicit user task/plan;
2. change-spec artifacts under `.cline/changes/`;
3. commit/PR issue references;
4. relevant repository docs/tests/contracts;
5. if none exists, state that the Spec axis has no authoritative spec.

Do not invent requirements to make the review look complete.

## Step 3 — Identify standards

Read the smallest relevant standards set:

- `.clinerules/00-core.md`;
- `.clinerules/01-verification.md`;
- `.clinerules/02-server.md` when server-specific;
- `.clinerules/03-crafting.md` when crafting;
- `.clinerules/ponytail.md`;
- `.cline/architecture.json`;
- `.cline/ownership.json`;
- `.cline/routing.json`;
- `architecture/catalog.json`;
- `.cline/skills/coding-standards/SKILL.md` when general code-quality rules apply.

Project standards override general heuristics.

## Step 4 — Standards axis

Check whether the diff violates documented rules. Cite the exact repository rule and changed file/hunk.

Apply these code-smell heuristics as judgement calls, not hard violations, unless the project explicitly says otherwise:

- unclear/mysterious names;
- duplicated code;
- feature envy;
- recurring parameter/data clumps;
- primitive obsession where a domain boundary is genuinely needed;
- repeated branching on the same discriminator;
- shotgun surgery;
- divergent change;
- speculative generality;
- long message chains that expose internal navigation;
- pass-through middle-man layers;
- inheritance that ignores most of the parent contract.

Do not flag a smell merely because a tool or linter already enforces it.

## Step 5 — Spec axis

For every requirement:

- implemented completely?
- partial?
- missing?
- behavior added that was not requested?
- implementation technically contradicts the intended behavior?

Check important negative space: what should **not** happen.

For change-spec artifacts, use requirement/scenario/task traceability:

```text
requirement → scenario → implementation → test/evidence
```

## Step 6 — Correctness axis

Inspect:

- happy path and error path;
- null/empty/boundary values;
- cancellation and timeout behavior;
- stale state and duplicate observation;
- concurrent execution/races;
- retries and idempotency;
- state transitions;
- cleanup on success/failure/cancellation;
- whether the test asserts the actual bug/requirement rather than implementation details.

For MCbotv1 explicitly check:

- botId isolation;
- connectionGeneration validity;
- operation ownership;
- exclusive side effects;
- GUI session/window provenance;
- authoritative inventory/storage observation;
- crafting output verification;
- mode/resource leases;
- desktop main/preload/renderer contracts.

## Step 7 — Architecture axis

Compare the diff with `.cline/architecture.json`, `.cline/ownership.json` and `architecture/catalog.json`.

Check:

- dependency direction;
- side-effect ownership;
- planner purity;
- runtime scope boundaries;
- server-specific logic placement;
- config authority;
- duplicate implementations;
- new abstractions that merely relocate complexity;
- feature-specific logic leaking into shared modules;
- unnecessary bypasses around canonical services.

Prefer structural remedies that remove moving parts, such as:

- move logic to the real owner;
- separate orchestration from domain logic;
- delete pass-through wrappers;
- collapse duplicate branches;
- make a type/contract boundary explicit;
- split a large mixed-responsibility module only when the split clarifies ownership.

Do not automatically request refactoring because a file is long or a diff is large; judge against responsibility and contract boundaries.

## Step 8 — Security axis

Check:

- secrets/credentials in source, logs, fixtures or generated output;
- untrusted server/GUI/chat/config data flowing into execution;
- Electron main/preload/renderer trust boundaries;
- file/path operations;
- unsafe shell or script execution;
- dependency or network changes;
- authorization assumptions where applicable.

Use `.cline/skills/security-review/SKILL.md` when the change crosses a security-sensitive boundary.

## Step 9 — Performance axis

Check:

- unbounded loops;
- accidental polling/storms;
- synchronous operations on runtime-critical paths;
- repeated full inventory/GUI scans when a scoped observation exists;
- duplicate event listeners/timers;
- memory retained across connection generations;
- excessive renderer updates;
- N×M work introduced into hot paths;
- performance claims without a measurement.

A performance smell is not a defect without evidence of meaningful impact; ask for a measurement when the concern is consequential.

## Step 10 — Tests and verification

Review tests before giving confidence to the implementation.

Ask:

- Is there a regression test for the changed behavior?
- Does it fail for the old broken state or otherwise have a red-capable signal?
- Does it test observable behavior/postconditions?
- Are negative/error paths covered?
- Are timing/generation/cancellation cases covered where relevant?
- Were architecture/config/ownership checks updated if contracts changed?

Use `verification-before-completion` before stating any pass/completion claim.

## Step 11 — Change sizing and scope

Prefer focused logical changes.

Use these as inspection signals, not rigid limits:

- around 100 changed lines: usually easy to review;
- around 300: acceptable for one coherent change;
- around 1000: strong signal to split unless it is deletion/generated refactoring or otherwise mechanically verifiable.

Separate feature behavior from unrelated refactoring when practical.

For MCbotv1, a cross-cutting change spanning ownership boundaries should use `change-spec`.

## Step 12 — Report

Report each axis separately.

For each finding include:

```text
Severity: CRITICAL | HIGH | MEDIUM | LOW | INFO
Axis: Standards | Spec | Correctness | Readability | Architecture | Security | Performance | Tests | Scope
Location: file:line or hunk
Evidence: concrete observed code/diff behavior
Why it matters: contract/regression impact
Suggested remedy: smallest structural or local correction
```

Do not hide a Standards failure because the Spec is satisfied, or vice versa.

Do not invent positives. Absence of a finding means no material issue was found within the reviewed scope.

## Review result categories

The review itself should be descriptive:

- findings exist;
- no material findings in an axis;
- unresolved uncertainty;
- verification unavailable.

Any merge/approval decision belongs to the human workflow unless the user explicitly delegates that decision. Even then, report the evidence rather than a single blended score.
