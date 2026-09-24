---
name: change-spec
description: Plan and execute large or cross-cutting MCbotv1 changes with brownfield-first change artifacts: proposal, behavior deltas, design, task graph, implementation verification, and archive/update discipline. Use for architecture migrations, B5 decoupling/removal, new subsystems, contract migrations, and changes spanning ownership boundaries.
---

# Change Specification for MCbotv1

## Purpose

Cross-cutting changes fail when implementation starts before the intended behavior, ownership and migration boundaries are explicit.

This skill creates a small, version-controlled change package without requiring a complete specification of the entire existing repository.

## When to use

Use when a change:

- crosses multiple ownership boundaries;
- changes architecture/layering;
- changes a contract consumed by multiple modules;
- migrates/removes a subsystem such as B5-specific coupling;
- introduces a new subsystem or workflow;
- changes multiple config/source/test surfaces;
- has a migration or rollback concern;
- would be difficult to review as an unstructured implementation diff.

Do not use for a trivial local edit or a mechanical one-file fix.

## Brownfield rule

Document only the slice you are changing.

Do not back-fill the whole 889-file codebase with specs before using this skill.

Existing `.clinerules`, `.cline`, `architecture/`, source, config and tests remain the authoritative project context. The change artifacts are a temporary/working agreement describing the proposed delta.

## Change directory

Use:

```text
.cline/changes/<change-name>/
├── proposal.md
├── specs/
│   └── <area>.md
├── design.md
└── tasks.md
```

`design.md` may be omitted for a genuinely small cross-module change; `specs/` may contain multiple area files when a change affects distinct contracts.

The directory is version-controlled and can be reviewed before implementation.

## Step 1 — Explore the existing slice

Read the smallest relevant context:

- `.cline/context-index.json`;
- `.cline/routing.json`;
- `.cline/ownership.json`;
- `.cline/architecture.json`;
- `architecture/catalog.json`;
- relevant `.clinerules`;
- source/config/tests directly involved.

Before adding architecture, search for an existing owner/capability.

For uncertain behavior use `doubt-review` before freezing the spec.

## Step 2 — Write proposal

`proposal.md` must answer:

- what problem is changing?
- why now?
- what is in scope?
- what is explicitly out of scope?
- affected ownership boundaries;
- relevant constraints;
- migration/rollback concern;
- evidence status of important assumptions.

Keep it concrete. “Improve crafting” is not a usable scope; name the behavior/contract that changes.

## Step 3 — Write behavior deltas

Specs describe only the change relative to the current system.

Use:

```text
## ADDED Requirements
## MODIFIED Requirements
## REMOVED Requirements
```

Each requirement should be a testable behavior statement using SHALL/MUST language where practical.

For every important requirement add scenarios:

```text
### Scenario: <name>
- GIVEN <precondition>
- WHEN <action/event>
- THEN <observable postcondition>
- AND <additional invariant>
```

Include negative behavior and failure semantics where they matter.

### MCbotv1 requirement patterns

Prefer requirements that describe:

- ownership/boundary behavior;
- state transitions;
- generation safety;
- side-effect verification;
- config authority;
- cancellation/timeout behavior;
- server-specific vs generic behavior separation;
- desktop API/rendering contract;
- crafting stage contracts;
- migration/deletion criteria.

Do not turn inferred server behavior into a requirement without evidence.

## Step 4 — Build the design

For larger changes, `design.md` must explain:

- current architecture relevant to the change;
- target architecture;
- module/owner responsibility changes;
- data/control flow;
- contracts/interfaces affected;
- config changes;
- runtime lifecycle and cleanup;
- concurrency/generation concerns;
- migration sequence;
- compatibility/deletion plan;
- observability and diagnostics;
- test strategy;
- rollback or recovery strategy where applicable.

Prefer deletion or reuse over parallel implementations.

Use the actual files from `.cline/ownership.json` and `.cline/routing.json`; do not invent placeholder ownership.

## Step 5 — Create a dependency-aware task graph

`tasks.md` must:

- order work by dependency, not arbitrary file order;
- map each task to one or more requirements/scenarios;
- identify affected code/config/tests;
- separate preparation/migration from behavior changes when useful;
- identify deletion only after consumers are migrated and verification is complete;
- include validation commands appropriate to each task.

Example:

```text
T1 [REQ-1] add/confirm target contract
T2 [REQ-1] wire owner
T3 [REQ-2] migrate consumer
T4 [REQ-2] add regression test
T5 [REQ-1,2] remove obsolete implementation
T6 [ALL] architecture/config/full verification
```

Represent dependencies explicitly when a later task is blocked on earlier work.

## Step 6 — Review before implementation

Before touching production code, review the artifacts in this order:

1. proposal — is this the right problem and scope?
2. specs — is “done” defined precisely, including important scenarios?
3. design — is the architecture coherent and minimal?
4. tasks — does every task trace to a requirement and have a sane dependency order?

Red flags:

- scope creep;
- vague requirements;
- missing important scenarios;
- task without requirement;
- requirement without implementation/test path;
- design introducing a second owner;
- migration step that deletes before consumers move;
- “temporary” compatibility branch with no removal condition.

Correct the artifact before implementation. Iteration is expected.

## Step 7 — Apply in small slices

Implementation should follow the approved task graph, but the artifact can evolve when evidence changes the plan.

When implementation reveals that the design is wrong:

```text
STOP
→ update proposal/spec/design/tasks
→ re-review affected artifact
→ continue
```

Do not silently change the intended behavior only because the first design was inconvenient.

## Step 8 — Verify implementation against the change

After implementation, perform a verification pass:

### Completeness

- every required task is done or explicitly deferred;
- every requirement has an implementation path;
- every important scenario has a test or explicit runtime evidence.

### Correctness

- implementation matches the intended semantics;
- edge/error/cancellation/generation behavior is preserved;
- server-specific assumptions remain profile-backed;
- no weaker verification replaced a stronger contract.

### Coherence

- design decisions are visible in actual ownership and dependency flow;
- no accidental parallel implementation remains;
- config and architecture catalogs reflect changed contracts;
- dead compatibility artifacts are removed or explicitly tracked.

Use `code-review` for the final diff and `verification-before-completion` before claiming completion.

## Step 9 — Archive/close the change

A change may be closed when:

- implementation verification is complete;
- tests/quality gates required by the change are fresh;
- remaining uncertainty is documented;
- the change artifacts no longer contradict the repository behavior.

Before archiving, decide whether the behavioral delta belongs in the project's durable documentation/contract source. Do not automatically create a second permanent source of truth.

If a requirement was removed, verify that the corresponding old behavior/spec is actually retired and no runtime/test/script dependency remains.

## MCbotv1 deletion rule

For legacy/B5 removal, never use “no runtime `require`” as the only deletion test.

Check:

```text
runtime consumers
+ scripts
+ tests
+ architecture/catalog
+ contracts
+ migration intent
+ pending-wiring status
+ generated/reference artifacts
```

Only then decide whether the artifact is:

- wired and live;
- pending wiring;
- test-only verification support;
- deprecated;
- genuinely dead and safe to delete.

## Required output

A completed change-spec cycle should leave:

```text
proposal.md
specs/*.md
(optional) design.md
tasks.md
verification evidence in the task/review history
```

The change package is a planning/verification artifact. It does not replace `.clinerules`, `.cline`, `architecture/`, source code, config, or tests.
