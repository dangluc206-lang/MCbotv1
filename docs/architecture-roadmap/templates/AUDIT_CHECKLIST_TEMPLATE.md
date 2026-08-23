# Audit Checklist — Scope

## Inputs and trust

- [ ] User request separated from attached-document claims.
- [ ] Artifact hashes/file list captured.
- [ ] `.env*`, `data/**`, `node_modules/**` excluded unless explicitly authorized.
- [ ] No test claim treated as proof without execution.

## Architecture

- [ ] Correct owner/layer.
- [ ] Dependency direction.
- [ ] No duplicate capability/registry/queue.
- [ ] Generic/server-specific boundary.

## Ownership/concurrency

- [ ] Bot/generation/operation/resource owner.
- [ ] Stale callback guard.
- [ ] Cancellation/cleanup.
- [ ] Artifact/path ownership.
- [ ] Bounded retry.

## Verification/transaction

- [ ] Before/action/observe/after/verify.
- [ ] Resolve/reject side-effect reconciliation.
- [ ] Uncertain outcome barrier.
- [ ] Final joint postcondition.
- [ ] Evidence retention.

## State/config/security

- [ ] State categories not mixed.
- [ ] Schema/cross-reference/migration.
- [ ] No secret/raw runtime serialization.
- [ ] Protected update paths.

## Tests

- [ ] Targeted.
- [ ] Before-side-effect fault.
- [ ] After-side-effect fault.
- [ ] Resolve-wrong-postcondition.
- [ ] Transient read.
- [ ] Generation/cancel.
- [ ] Regression/architecture/config.

## Findings

For each:

```text
ID/Priority
Observed
Expected
Root cause
Affected layer
Smallest safe fix
Mandatory test
Regression risk
```

## Verdict

Accepted / Accepted with non-blocking debt / Rejected with bounded next WP.
