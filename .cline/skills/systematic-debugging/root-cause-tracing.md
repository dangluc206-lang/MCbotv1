# Root-Cause Tracing for MCbotv1

Use when the visible failure is downstream from the original bad state.

## Trace pattern

```text
symptom
→ immediate operation
→ caller
→ caller input/state
→ origin of that input/state
→ original trigger
```

At every hop record:

- input value/state;
- owning module;
- invariant expected;
- evidence observed;
- whether the value is current or stale;
- whether botId and connectionGeneration match.

## MCbotv1-specific trace questions

For runtime bugs ask:

- Did `BotContext` expose the current client/generation?
- Did a listener outlive its owning generation?
- Did a result cross an ownership boundary without preserving generation?
- Did `OperationManager` or `TaskSupervisor` retain stale work?
- Did a mode bypass an exclusive side-effect owner?
- Did GUI state come from the wrong `GuiSession` or window?
- Did inventory data come from the wrong source?
- Did server-profile facts get replaced with inferred behavior?

For architecture/catalog failures ask:

- Is the file unreachable, test-only, pending wiring, stale, or genuinely dead?
- Is the validator describing current source reality?
- Is the catalog itself stale?

Do not equate “unreferenced by runtime” with “safe to delete” without checking tests, scripts, catalogs, contracts and migration intent.

## Instrumentation

When manual tracing is insufficient, add one narrow log/assertion at the boundary that can distinguish the next two hypotheses. Remove it after the cause is established.
