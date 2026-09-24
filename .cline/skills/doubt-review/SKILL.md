---
name: doubt-review
description: Stress-test non-trivial MCbotv1 decisions with an adversarial fresh-context review before they become code, architecture, migration, server-behavior, or completion assumptions. Use when correctness depends on hidden context or assumptions the compiler/tests cannot prove.
---

# Doubt Review for MCbotv1

## Purpose

Confidence is not evidence. This skill creates a bounded adversarial pass before a non-trivial decision becomes expensive to undo.

This is an **in-flight challenge**, not a final code review.

## When to use

A decision is non-trivial when one or more are true:

- changes branching/state-machine logic;
- crosses a module/service/desktop/server boundary;
- depends on ordering, idempotency, concurrency, cancellation or invariants not proven by the type system;
- depends on server behavior that is not fully evidenced;
- changes architecture or ownership;
- removes legacy/B5 code whose future wiring status is uncertain;
- changes a contract used by multiple modes/services/UI surfaces;
- has irreversible or large blast radius.

Do not use for:

- formatting/renaming/file moves;
- mechanical edits;
- obvious one-line corrections;
- pure file listing/test execution;
- a clear user instruction whose meaning and scope are unambiguous;
- situations where the user explicitly prioritizes speed over verification.

## Step 1 — CLAIM

Write the decision as a compact claim plus why it matters.

Example:

```text
CLAIM: The proposed removal of X cannot break a runtime path.
WHY THIS MATTERS: removal is difficult to recover after dependent cleanup lands.
```

The claim is the orchestrator's hypothesis. Do not send the claim to the adversarial reviewer.

## Step 2 — EXTRACT

Provide the reviewer the smallest unit it needs:

- code: relevant diff/function;
- architecture decision: proposal plus constraints;
- deletion: candidate files plus runtime/script/test/catalog evidence;
- server behavior: observed evidence plus the behavior contract.

Strip the journey and your conclusions.

The reviewer gets:

```text
ARTIFACT
CONTRACT
```

not your reasoning and not the CLAIM.

## Step 3 — DOUBT

Use a fresh-context reviewer/delegated task/session when the active tooling supports it.

Prompt shape:

```text
Adversarial review. Find what is wrong with this artifact.
Assume the author may be overconfident.
Look for:
- unstated assumptions;
- missing edge cases;
- hidden coupling/shared mutable state;
- ways the contract can be violated;
- stale generation or lifecycle leakage;
- existing project conventions this breaks;
- server behavior being confused with bot policy;
- test-only evidence being mistaken for runtime reachability;
- irreversible deletion or migration risks.

Do not summarize the artifact.
Do not validate it.
Find concrete issues, or state that none were found after examination.

ARTIFACT: <artifact>
CONTRACT: <contract>
```

For Cline, a separate task/session or different model can provide the fresh-context boundary. Do not claim it is independent if it received the original reasoning.

## Step 4 — RECONCILE

Treat findings as evidence, not verdicts.

For each finding classify in this order:

1. **Contract misread** — the reviewer lacked a required contract detail. Strengthen the contract.
2. **Valid + actionable** — change the artifact/plan/code.
3. **Valid trade-off** — real concern, deliberately accepted and documented.
4. **Noise** — reviewer missed authoritative context; record what context disproved it.

Re-read the artifact itself before classifying. Fresh context can be wrong because it lacks project-specific evidence.

## MCbotv1 evidence checks

When reviewing a runtime/architecture claim, check:

- `.cline/ownership.json` for the actual owner;
- `.cline/architecture.json` for boundaries;
- `.cline/routing.json` for relevant source/test/config scope;
- `architecture/catalog.json` for reachability/catalog facts;
- `.cline/server-profile.json` for server fact status;
- `.cline/crafting-contract.json` for crafting contracts;
- `.clinerules/01-verification.md` for postcondition rules;
- tests and scripts for actual consumers.

For legacy removal distinguish:

```text
unreferenced
≠ unused
≠ test-only
≠ pending wiring
≠ deprecated
≠ safe to delete
```

Deletion requires runtime, scripts, tests, contracts, catalog and migration intent to be considered.

## Evidence status

Use:

- CONFIRMED — directly established by source/test/runtime evidence;
- OBSERVED — seen in runtime behavior but not yet generalized;
- INFERRED — reasoning from evidence, not directly established;
- UNKNOWN — insufficient evidence;
- DEPRECATED — formerly true/used but no longer authoritative.

Never silently upgrade INFERRED or UNKNOWN to CONFIRMED.

## Step 5 — STOP

Bound the doubt loop.

Stop when:

- only trivial/already-considered findings remain;
- three review/reconciliation cycles have completed;
- the user explicitly says to proceed.

Do not continue a fourth cycle just to search for more criticism.

If substantive issues remain after three cycles, escalate rather than pretending the artifact is settled.

## Cross-model option

A second model can expose shared blind spots. In interactive Cline usage, present it as an explicit option when meaningful and let the user choose whether the extra cost is warranted.

Do not silently invoke external CLIs, network tools, or additional model providers.

## Fallback when fresh context is unavailable

A self-review is not equivalent to a fresh-context review.

When delegation is unavailable:

- label the review as **DEGRADED SELF-DOUBT**;
- strip the original reasoning from the artifact;
- re-read from the contract outward;
- apply the adversarial prompt;
- do not claim fresh-context independence.

## Common traps

Stop when you notice:

- “I know the cause; I can just patch it.”
- deleting because a file has no runtime `require` without checking tests/scripts/catalog;
- treating a server inference as a confirmed server fact;
- treating a passing unit test as proof of end-to-end behavior;
- approving a plan because it sounds clean without checking the actual artifact;
- asking a reviewer “is this good?” instead of “find what is wrong”;
- passing the CLAIM/reasoning to the adversarial reviewer;
- letting an old reviewer finding survive after the artifact has changed without re-reviewing the changed artifact.

## Required record

For non-trivial decisions keep:

```text
CLAIM
ARTIFACT
CONTRACT
REVIEW CONTEXT
FINDINGS
RECONCILIATION
EVIDENCE STATUS
STOP CONDITION
REMAINING UNCERTAINTY
```
