# WP-204 — Composable Mode Builder Hardening

## Status

`DONE`

## Objective

Đảm bảo custom/composable mode chỉ ghép module capability allowlist có schema/resource/cancellation và không mở arbitrary execution.

## Depends on

- WP-200.
- WP-202.

## In scope

- Workflow definition schema.
- Module catalog/descriptor.
- Capability/resource dependency validation.
- Executor/result/cancellation.
- Desktop validated write/repair visibility.

## Out of scope

- General programming language.
- Raw Mineflayer/client/chat.
- Complex B5 replacement.

## Minimal steps

1. Inventory current modules/schema/executor.
2. Define module descriptor contract.
3. Validate workflow graph/dependencies/resources.
4. Enforce command allowlist/credential ban.
5. Enforce bounded loops/retry/timeout.
6. Route side effects through ModeContext capabilities.
7. Ensure invalid file skipped runtime but visible for repair.
8. Add Desktop write validation/backup tests.

## Acceptance criteria

- No eval/new Function/arbitrary import.
- Missing capability/module fails validation/readiness.
- Module output typed/validated.
- Disable/cancel stops workflow.
- Invalid custom file cannot crash boot.
- Renderer cannot write raw JSON bypass.

## Tests

- unknown module;
- invalid schema/graph;
- forbidden credential/raw command;
- infinite/retry cap rejection;
- cancellation/reconnect;
- corrupt custom file repair visibility;
- architecture reachability.

## Rollback

Disable new module types; keep old validated definitions compatible. Never relax validator to restore compatibility.

## Stop conditions

- Arbitrary JavaScript requested.
- Module directly imports bot/client.
- Raw command path bypasses SlashCommandService.


## Completion evidence — 2026-08-22

- Static `WorkflowModuleCatalog` is the only module descriptor source; descriptors declare capability, transient resources, cancellability and typed output. No eval/new Function/dynamic require/import path exists.
- Workflow validation rejects unknown modules, malformed capability/resource IDs, credential commands, excessive nesting/repeat/wait bounds and derives required capabilities from descriptors.
- `WorkflowStepExecutor.executeSteps()` emits versioned typed output envelopes and cancellation propagates as CANCELLED.
- Invalid custom JSON remains boot-safe/list-visible; a valid repair writes atomically and preserves the previous file as `.bak`. Validation runs before any backup/write.
- Desktop renderer can only submit a definition through `mcbot:custom-mode:save`; backend `CustomModeStore` performs canonical validation/write.
