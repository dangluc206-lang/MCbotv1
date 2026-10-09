# Crafting Refactor Progress

## Current Phase
G14.2 — Procedure Runtime Integration (corrective subphase; G14 unit executor exists but was not wired into production)

## Status
IN_PROGRESS

## Completed
- G1 scope freeze + baseline
- G2 B5 dependency trace
- G3 orchestration cut to single generic path (CraftAutomationService + CraftAutomationRuntimeDecorator)
- G4 tier removal from eligibility (targets = explicit allow-list or all craftables)
- G5 item registry genericized (tier display-only)
- G6 recipe schema: required `procedure` field; procedures.json added (minerals/forge/npc)
- G7 recipe/procedure separation enforced by schema + cross-reference validator
- G8 procedure engine base: ProcedureRegistry + ProcedureContext + ProcedureExecutor
- G9 dynamic context resolve fixed
- G10 exact planner: batches live in QuantityStrategy/CraftingService.executeStep
- G11 quantity strategy: button-batch/repeat/command-quantity/custom
- G12 GUI resolution hardening (CraftingQuantityResolver/CraftingGuiNavigator: live GUI inspection first, configured slots as fallback; guiIdentityOverride authoritative)
- B5 runtime/config deletion completed separately (verified on HEAD 2de2dc6 + disk):
  - src/server-features/crafting/b5/B5CycleCoordinator.js — ABSENT (git + disk)
  - src/server-features/crafting/B5PlanningService.js — ABSENT (git + disk)
  - src/planning/crafting/B5ExecutionPlanner.js — ABSENT (git + disk)
  - config/server-data/b5.json — ABSENT (git + disk)
  - config/server-data/crafting-tiers.json — ABSENT (git + disk)
  - config/modes/collector-b5.json — ABSENT (git + disk)
  - Remaining B5 mentions are architecture/SLO/fault-matrix/static-quality metadata only (cleanup is a separate future phase, NOT runtime/config deletion)
- G13 procedure registry live in config + runtime facade
- G14 procedure execution: exact loop requested/planned/executed/actual/remaining (unit-level ProcedureExecutor)
- G14.2 procedure runtime integration (COMMITTED as HEAD 2de2dc6500a7b77b333c1659ec1b8dbf4f59c821):
  - CraftingProcedureRuntime hardened: no no-op fake-success steps (verify/wait-for-output/close-gui/unsupported now throw fail-closed); cancellation + generation guards on every step; command failures throw typed FlowError; GUI steps verify observable state
  - CraftingOperation: implemented missing #resolveProcedure + #runProcedureNavigation; procedure owns navigation prefix (command/open/find/click), operation keeps quantity click + verification + close; unsupported procedure shapes (forge/npc) fail closed; legacy recipes without procedure keep fixed path
  - registerBotServices: fixed `craftingService` undefined-variable wiring; `crafting.procedureRegistry/recipeRegistry` + `craftingOperation.procedureRuntime` now constructed with capability owners
  - CraftingService.executeStep: batch cap follows procedure capability via #procedureBatchPolicy (forge maxBatch 1 -> [1,1,1]); QuantityStrategy stays the pure planner
  - procedures.json minerals-crafting: added explicit entry find (menu_crafting) + corrected open-gui target (minerals); verification steps documented as operation-owned
- G15 reconciliation: flaky/failure paths tested, never report success on failure
- G17 validation: schema + cross-ref (recipe→procedure, cycle detection, target policy)

## Changed (G14.2 commit 2de2dc6)
- src/server-features/crafting/CraftingProcedureRuntime.js (hardened step ownership, guards, typed errors)
- src/server-features/crafting/CraftingOperation.js (#resolveProcedure, #runProcedureNavigation, navigation-prefix ownership, #adoptProcedureQuantitySession)
- src/server-features/crafting/CraftingService.js (procedure batch policy surfaced in executeStep result)
- src/bootstrap/registerBotServices.js (fixed composition-root wiring typo)
- config/server-data/procedures.json (minerals entry navigation made explicit)
- tests/unit/server-features/CraftProcedureRuntimeWiring.test.js (new, 8 tests)

## Tests (closeout act, actually run on HEAD 2de2dc6)
Full unit suite (242 files) was run in per-directory chunks because `node --test tests/unit/` is not accepted by this Node version and a single `npm test` run exceeds the 30s tool limit:
- G14.2 scope: CraftProcedureRuntimeWiring 8/8 PASS; 13 adjacent suites PASS (QuantityTiming, GuiIdentity, FixedMineralsMenuSlots, GenericProcedure, GenericExecution, ProcedureDiversity, ProcedureBuilder, ProductionCutoverWiring, GenericParity, GenericParity2, PlanningParity, VerificationParity, ConfigurationContracts)
- Passing groups: planning, release, shared, simulation (fault matrices, replay, gui-identity), desktop (all except 2 baseline failures), diagnostics (all except 1 baseline file), discord (all except 1 baseline file), fleet/gui/items/lifecycle/movement/overlay, bootstrap/bot/commands/connection, crafting modes + connection suites
- `node scripts/validate-config.js` -> PASS 31/31 schema + cross-ref PASS (2 bot profiles)
- Baseline failures (each reproduced identically on parent commit c8d37df via detached worktree; NOT caused by G14.2, NOT fixed in this act):
  - architecture: ArchitectureBaseline (stale counts), ArchitectureValidation (3 unauthorized task MDs + CraftingProcedureRuntime orphan), GenericConfigMutationTransaction (requires deleted CollectorB5ConfigEditor), RealContractFixture (16 vs 17), SideEffectOwnership (collector-config owner file missing)
  - configuration: CraftingConfigSeparation x2 (asserts deleted b5.json compat)
  - server-features: GenericCraftExecutionTarget + CraftStep2/3/4 + CraftStep5CycleParityB4ExactAll/SurplusRatio (require deleted b5/ coordinators); KhoWithdrawOperation metrics (extra batchCount counter)
  - server-profiles: FakeSecondServerContract WP-105 (MinerUA branch in WorkflowDefinitionValidator)
  - modes: ComposableWorkflowEngine WP-204 (renderer IPC pattern), LegacyModeTaskSupervision (TaskSupervisor pattern)
  - core: ApplicationStartupOrder (startup event order)
  - recovery: DurableIntentStore x4 (desiredMode validity); FleetControlService chunk exceeds 30s tool budget on both commits (long timers, no assertion result collected)
  - desktop: DesktopSupportReplay (B5 replay fixture), ModeConfigurationUseCases (collector-b5 removed)
  - diagnostics/discord: RuntimeFailureModeIntegration, DurableModeCommands (fail identically on parent)

## Known Issues
- Pre-existing: 3 unauthorized task MDs fail structure/architecture gates (task docs, not refactor)
- B5 architecture/SLO/fault-matrix/static-quality metadata cleanup still pending (future phase; runtime/config deletion is DONE, do not re-delete)
- CraftingQuantityResolver still only 1/64/ALL buttons (generic resolution hardening pending, out of scope for this act)
- Storage/input still B5-named in places (G16 pending, out of scope for this act)
- Procedure Builder/Recorder foundations exist but production Builder/Recorder wiring (G20/G21) pending
- Special procedures (forge/npc) validated at executor level only; GUI operation intentionally rejects them fail-closed until their owners exist

## Next Action
- G14.2 is committed (2de2dc6) and closeout-tested. No further action in this act. G16/G18 and later phases start only in a separate act with explicit instruction — do not auto-advance.

## Completion Evidence
- (pending full G1-G24)


