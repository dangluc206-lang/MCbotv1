---
name: verification-before-completion
description: Gate completion claims, commits, PRs, releases, and status statements in MCbotv1 with fresh verification evidence. Use whenever work is about to be described as fixed, complete, passing, ready, merged, or releaseable.
---

# Verification Before Completion for MCbotv1

## Iron law

```text
NO COMPLETION CLAIM WITHOUT FRESH EVIDENCE.
```

A previous run, an agent's report, a clean-looking diff, or a plausible code path is not fresh verification.

## Gate

Before saying work is complete/fixed/passing/ready:

1. Identify the exact claim.
2. Identify the strongest command or observation that could prove it.
3. Run it fresh.
4. Read the complete relevant output and exit status.
5. Check that the output proves the exact claim, not a weaker nearby claim.
6. State the claim with its evidence, or report the actual status and gap.

## MCbotv1 verification command map

| Claim | Primary verification |
|---|---|
| Tests pass | `npm test` or the exact focused test command |
| Coverage threshold passes | `npm run test:coverage` |
| Architecture validation passes | `npm run validate` / `npm run inspect:architecture` |
| Config validation passes | `npm run inspect:config` |
| Quality fast lane passes | `npm run quality:fast` |
| Release quality passes | `npm run quality:release` |
| Desktop critical path passes | `npm run test:e2e:desktop` |
| Replay scenario passes | `npm run replay` or relevant replay command |
| B5 replay passes | `npm run replay:b5` |
| Side-effect ownership is clean | `npm run audit:ownership` |
| Error vocabulary contract passes | `npm run check:error-vocabulary` |
| SLO contract passes | `npm run check:slo` |
| Release artifact is valid | `npm run artifact:integrity` / `npm run artifact:verify` |

Use the project commands actually relevant to the changed contract. Never claim that running one gate proves another gate.

## Requirement verification

Tests passing do not automatically mean the task requirements are met.

For a task/plan/spec:

```text
requirement
→ changed artifact/code
→ test or observable evidence
→ result
```

Mark each requirement as:

- CONFIRMED — fresh evidence directly proves it;
- PARTIAL — some evidence exists but a material condition is not proven;
- UNKNOWN — not yet verified;
- BLOCKED — required verification could not run.

## VCS verification

Before commit/PR claims:

- inspect `git diff`/status;
- confirm the intended files changed;
- check for unintended generated or debug files;
- verify no credentials/secrets are present;
- confirm the changes correspond to the requested scope.

A clean diff does not prove behavior. Behavior verification and VCS verification are separate gates.

## Regression verification

For bug fixes, verify:

1. original symptom reproduces before the fix or a known red-capable regression test captures it;
2. the fix makes the regression test green;
3. the original end-to-end scenario is re-run;
4. broader relevant tests are run;
5. architecture/config/ownership gates are run when affected.

For changes that cannot reproduce the old bug, report what evidence remains and do not overstate certainty.

## Completion evidence

A strong completion note includes:

```text
CLAIM
COMMAND/OBSERVATION
EXIT STATUS
KEY RESULT
SCOPE VERIFIED
KNOWN GAPS
```

Do not use wording such as “should pass”, “looks fixed”, “probably done”, or “agent completed it” as evidence.

## Interaction with `.clinerules/01-verification.md`

`.clinerules/01-verification.md` governs Minecraft action postconditions (`BEFORE → ACTION → OBSERVE → AFTER → VERIFY`).

This skill governs a higher-level question:

```text
Can I claim the repository/task is complete based on fresh evidence?
```

Use both. Do not collapse them into one.
