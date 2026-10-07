# Crafting Refactor Progress

## Current Phase
G15 — Partial success / Reconciliation (core done; remaining: G12/G16/G18-G22/G24 hardening)

## Status
IN_PROGRESS

## Completed
- G1 scope freeze + baseline (validate-config PASS; structure/architecture FAIL only on 3 unauthorized task MDs — pre-existing)
- G2 B5 dependency trace (orchestration, tiers, item/target registries, config, desktop, architecture)
- G3 orchestration cut to single generic path: removed legacyCycle/B5 coordinators from CraftAutomationService; added CraftAutomationRuntimeDecorator; composition root exposes craftAutomation + procedureRegistry/procedureExecutor/quantityStrategy
- G4 tier removal from eligibility: dropped allowedTiers; targets = explicit allow-list or all craftables; validator fail-closed on legacy allowedTiers
- G5 item registry genericized (tier display-only, identity/recipe owned)
- G6 recipe schema: required `procedure` field; procedures.json added (minerals/forge/npc); ConfigSpecs 34 groups
- G7 recipe/procedure separation enforced by schema + cross-reference validator
- G8 procedure engine base: ProcedureRegistry + ProcedureContext ($request/$recipe/$execution) + ProcedureExecutor
- G9 dynamic context resolve fixed ($recipe.outputAmount before $recipe.output)
- G10 exact planner: removed CraftingPlanner.#quantityBatches hardcode; batches live in QuantityStrategy/CraftingService.executeStep
- G11 quantity strategy: button-batch/repeat/command-quantity/custom; verified 1/64/65/127/128/137/1000
- G13 procedure registry live in config + runtime facade
- G14 procedure execution: exact loop requested/planned/executed/actual/remaining
- G15 reconciliation: flaky/failure paths tested, never report success on failure
- G17 validation: schema + cross-ref (recipe→procedure, cycle detection, target policy)
- Representative recipe `my_item` added (item+recipe+procedure, no engine change)
- Procedure diversity: minerals/forge/npc shapes validated
- Config 34/34 PASS; focused tests PASS (planner, target registry, contracts, generic procedure/execution, cutover wiring)

## Changed
- config/server-data/recipes.json (procedure + my_item), procedures.json (new), items.json (my_item), crafting-targets.json (drop allowedTiers)
- src/configuration/ConfigSpecs.js, group.schemas.js, ConfigurationContractValidator.js
- src/items/CraftingTargetRegistry.js, CraftingItemRegistry.js (tier comment)
- src/planning/crafting/CraftingPlanner.js, CraftingStep.js, CraftingChainPlanner.js
- src/server-features/crafting/CraftAutomationService.js, CraftAutomationRuntimeDecorator.js (new), CraftingService.js
- src/server-features/crafting/quantity/QuantityStrategy.js (new), procedure/ProcedureRegistry.js, ProcedureContext.js, ProcedureExecutor.js (new)
- src/server-features/ServerFeatureFacade.js, src/bootstrap/registerBotServices.js
- architecture/catalog.json (pending-wiring for removed B5 runtime files)
- tests: B5ConfigPropagation, CraftProductionCutoverWiring, CraftingTargetRegistry, ConfigurationContracts, CraftGenericProcedure/Execution (new), ArchitectureValidation count

## Tests
- `node scripts/validate-config.js` -> PASS 34/34
- `node --test tests/unit/configuration/ConfigurationContracts.test.js tests/unit/items/CraftingTargetRegistry.test.js tests/unit/planning/Planner.test.js tests/unit/planning/CraftingChainPlanner.test.js` -> PASS 36
- `node --test tests/unit/server-features/CraftGenericProcedure.test.js tests/unit/server-features/CraftGenericExecution.test.js` -> PASS 7
- `node scripts/validate-architecture.js` -> only 3 pre-existing MD FAIL; B5 orphans declared as pending-wiring WARN

## Known Issues
- Pre-existing: 3 unauthorized task MDs fail structure/architecture gates (task docs, not refactor)
- B5 runtime files still on disk (b5/ stack, B5PlanningService, B5ExecutionPlanner, B5 decorator) — runtime-unwired, declared pending-wiring; full delete is G18
- collector-b5 mode, b5.json, crafting-tiers.json, desktop B5 UI still present — G18/G19
- CraftingQuantityResolver still only 1/64/ALL buttons (G12: generic resolution hardening pending)
- Storage/input still B5-named in places (G16 pending)
- Procedure Builder/Recorder (G20/G21), special procedures wiring (G22), final facade split (G24) pending

## Next Action
- G12 generic GUI resolution hardening, G16 storage/input genericization, G18 arch/config cleanup (delete B5 files), G19 desktop cleanup, G20/G21 builder/recorder, G22 special procedures, G23 full matrix, G24 final refactor

## Completion Evidence
- (pending full G1-G24)

