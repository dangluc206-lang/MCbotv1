# Defense-in-Depth for MCbotv1

Use after finding an invalid state that could enter through multiple paths.

## Principle

One check proves one path. Multiple legitimate checks can make an invalid state structurally harder to reintroduce.

## Apply by boundary

1. **Input boundary** — reject malformed or missing data at the public entry point.
2. **Domain/operation boundary** — validate the invariant again where the operation depends on it.
3. **Side-effect boundary** — validate assumptions immediately before the owned side effect.
4. **Verification boundary** — verify the postcondition from the authoritative observation.
5. **Generation boundary** — reject results from stale connection generations.
6. **Environment/test guard** — when an operation is dangerous in a test context, add a narrowly scoped guard.
7. **Diagnostics** — retain enough structured context to explain a future failure without exposing secrets.

Do not blindly duplicate checks. Every check should protect a distinct boundary or failure mode.

## MCbotv1 examples

- command intent → `CommandExecutor` → server observation;
- GUI resolution → `ClickExecutor` → GUI transition/postcondition;
- crafting plan → `CraftingOperation` → `CraftingResultVerifier`;
- reconnect result → `ConnectionManager` / `ReconnectManager` → generation check;
- renderer snapshot → desktop projection/delivery → renderer state validation.

The project already has many of these protections. Add only the missing layer that blocks the evidenced failure.
