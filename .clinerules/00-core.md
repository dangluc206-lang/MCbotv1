# MCbotv1 Core Rules

## Scope

These rules apply to every task in the repository.

## Architecture

Use the existing architecture. Do not create parallel implementations when an existing capability already owns the responsibility.

Dependency direction:

```text
bootstrap
→ core / bot
→ mode / workflow
→ service / capability
→ adapter / server feature
→ Mineflayer / Minecraft
```

Lower layers must not import higher-level workflows.

## Ownership

The following side effects have single owners:

- `src/commands/CommandExecutor.js` → `bot.chat()`
- `src/gui/click/ClickExecutor.js` → `clickWindow()`
- `src/connection/ConnectionManager.js` → connection shutdown
- `src/movement/navigation/RouteExecutor.js` → owned pathfinder stop

Do not bypass these owners.

## Multi-bot isolation

Every bot is isolated.

Never introduce:

- global Mineflayer clients;
- shared mutable bot state;
- bot-specific mutable singletons;
- cross-bot listeners or timers without explicit ownership.

All connection-scoped callbacks must validate the current `botId` and `connectionGeneration`.

## State ownership

Keep these distinct:

- configuration;
- runtime state;
- durable desired state;
- server observations;
- derived/planned state.

Do not persist raw Mineflayer clients, windows, packets, listeners, promises, timers, credentials or in-flight operations.

## Concurrency

Stateful GUI, inventory, command and movement actions must respect existing queues, operations and locks.

Do not use concurrency to overlap conflicting side effects.

Every listener, timer, waiter, queue task and lock must have an owner and cleanup path.

## Configuration

Use the existing configuration layer.

Do not hard-code:

- server command;
- GUI title/slot;
- item identity;
- recipe;
- timeout;
- retry policy;
- server location;
- server-specific behavior.

Config changes must pass schema and cross-reference validation.

Never commit real credentials or secrets.

## Generation safety

A result from an old connection generation must never mutate or be credited to a newer generation.

When a flow crosses a side-effect or verification boundary, preserve and validate the captured generation.

## Bug-fix method

Before changing code, identify:

1. observed behavior;
2. expected behavior;
3. root cause;
4. owning layer/file;
5. smallest safe fix;
6. verification;
7. regression risk.

Fix the root cause at its owner.

Do not hide races with:

- arbitrary sleep increases;
- infinite retries;
- removed timeouts;
- removed generation guards;
- removed verification.

## Change scope

Do not rewrite unrelated modules.

Do not change framework, Minecraft version, module system or dependency versions unless the task requires it.

Do not fix a future task while working on the current one.

## Done

A task is complete only when:

- the intended behavior is implemented;
- ownership boundaries remain valid;
- cancellation/cleanup remain valid;
- generation safety remains valid;
- verification remains present;
- relevant tests pass;
- config/docs/contracts are updated when the contract changed.
