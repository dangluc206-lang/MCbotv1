# Crafting Refactor Progress

## Current Phase
G18 — Architecture / Config Metadata Cleanup (CLOSED: implementation d41954c; closeout pending)

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
- G12.1 quantity batch execution (COMMITTED as 3046425 + closeout d6d4b1f):
  - CraftingQuantityResolver.describeActions: frozen verified GUI capabilities (live first, configured fallback; ALL never listed as a fixed batch)
  - CraftingOperation: ALL keeps single-click semantics; any positive integer runs a verified batch loop (observed 64/1 actions, greedy exact, per-batch click + output verification, single close at end, totals reported)
  - Navigation no longer resolves the full amount in batch mode (menu open only; per-batch slots resolved in-loop)
  - Partial failure surfaces the existing UNCERTAIN contract with reconciliation baseline; missing buttons fail closed with zero side effects
  - Verified by mock/unit tests only; live /ks GUI behavior remains unproven
- G16 storage/input genericization (CLOSED: 2fd73c4 + closeout ae805b2, pushed):
- G18 architecture/config metadata cleanup (this act, uncommitted working tree):
  - static-quality: removed dead B5PlanningService.js budget + nonexistent managedRoots (src/desktop/b5, src/modes/b5-craft/*)
  - slo: removed producer-less b5-batch-outcome + b5-blocker-dwell objectives (no src producer, no test asserts them; no invented replacement)
  - fault-matrix r1: generalized B5 wording to storage/craft trace (evidence tests untouched)
  - fault-matrix r5: renamed b5-protection-timeout/-verified-continuation to storage-* (same semantics, same evidence tests)
  - run-quality-gates: removed 4 gate entries pointing at deleted test files (kept existing B1StorageProtectionPlanner entry)
  - .cline/ownership: removed deleted B5PlanningService entry; B1 entry now says storage batch protection coupling
  - .cline/crafting-contract: executors point at existing generic coordinators; tierConfig + B5 consumer refs removed
  - Preserved: catalog forbiddenPatterns guards, legacy-mode-debt (fishing-only), crafting-targets (clean), routing (no B5), B1-named runtime (live concept, out of scope)
  - Runtime/config B5 deletion NOT repeated (verified absent on HEAD, untouched)
  - CraftInputSourcePolicy (new, pure): explicit inventory-vs-storage policy with default + per-material overrides; legacy b2InputSource mapped once at the boundary
  - CraftInputAcquisitionFlow: routes per-material via policy (storage = no-withdrawal readiness report; inventory = withdrawB1); `source` string + `sourceFor()` kept as compat
  - CraftBaseInventoryCoordinator: withdrawal Result failure now throws CRAFT_B1_WITHDRAW_FAILED (was silently treated as prepared input); post-withdrawal inventory reconcile via waitForIncrease; cancellation checked on entry
  - CraftAutomationService/CraftStorageFlow: generic `storageMaterials` key (same instance as b1Materials alias); `flows.inputAcquisition` alias shares the b2Input instance; composition root passes the generic key
  - Deliberately NOT changed: KhoService.withdrawB1 API + step names (shared storage primitive, case 3), B1StorageMaterialService batch-protection/targetId semantics (mode-level, not input acquisition), decompressionPolicy key (genuine capacity safety), quantity batching (G12.1 untouched)
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

## Changed (G16 commit 2fd73c4)
- src/server-features/crafting/support/CraftInputSourcePolicy.js (new, pure policy)
- src/server-features/crafting/flows/CraftInputAcquisitionFlow.js (per-material policy routing)
- src/server-features/crafting/coordinators/CraftBaseInventoryCoordinator.js (withdrawal-failure fail-closed, post-withdrawal reconcile, entry cancellation check)
- src/server-features/crafting/CraftAutomationService.js (storageMaterials key + inputAcquisition alias)
- src/server-features/crafting/flows/CraftStorageFlow.js (storageMaterials key, readiness-var fix)
- src/bootstrap/registerBotServices.js (generic storageMaterials key at composition root)
- tests/unit/server-features/CraftInputAcquisition.test.js (new, 9 tests)

## Tests (G18, actually run on working tree)
- Pre-edit baseline: validate-config 31/31 PASS; check-slo-contract PASS (9 objectives); check-static-quality FAIL x2 (B5PlanningService missing-entry [G18 target] + CraftingOperation 556>500 lines [pre-existing G12.1, out of scope])
- Post-edit: validate-config 31/31 PASS; check-slo-contract PASS (7 objectives); check-static-quality FAIL x1 (only the pre-existing CraftingOperation budget remains — G18 fixed its target failure)
- arch/config suites: SloMetricContract + StaticQualityAst + ConfigurationContracts + CraftGenericParity2 + CraftingModeService -> PASS 80/80
- fault-matrix suites (R1/R5/FaultMatrixContract) -> PASS 11/11
- `git diff --check` clean
- Mock/unit only; G19 NOT started.
- `node --test tests/unit/server-features/CraftInputAcquisition.test.js` -> PASS 9/9 (policy, sufficient-stock no-withdraw, missing-acquired + reconcile asserted, insufficient blocks, uncertain surfaces, storage-source, per-material routing, boundary aliases, cancellation)
- storage/crafting batch (13 files) -> PASS 92/96; 4 failures reproduced IDENTICALLY on detached worktree at d6d4b1f (pre-G16):
  - CraftStep2BaseInventory: MODULE_NOT_FOUND b5/B5B1InventoryCoordinator (line 8 require)
  - CraftStep3ReserveChain: MODULE_NOT_FOUND b5/B5ReserveChainCoordinator (line 7 require)
  - CraftStep4Intermediate: MODULE_NOT_FOUND b5/B5IntermediateCoordinator (line 7 require)
  - KhoWithdrawOperation 'withdrawal emits one aggregated metric': batchCount:1 counter drift (same diff on baseline)
  Classification: 4x reproduced baseline failure, 0x G16 regression, 0x inconclusive.
- planning/bootstrap/modes/quantity batch (8 files) -> PASS 96/96
- shared-storage suites (B1StorageMaterialService, Storage, KhoWithdrawActionModel + G16) -> PASS 62/62
- `node scripts/validate-config.js` -> PASS 31/31 schema + cross-ref PASS
- Mock/unit verification only; no live-server proof claimed. G16 is NOT fully green: the 4 baseline failures above remain.

## Tests (G12.1, actually run)
- `node --test tests/unit/server-features/CraftQuantityBatchExecution.test.js` -> PASS 10/10 (exact 1/9/64/65/137/1000, 1-button-only, no-buttons fail-closed, UNCERTAIN partial, capability listing)
- 10 adjacent suites -> PASS 40/40, zero regressions (incl. updated timing order + G14.2 wiring)
- `node scripts/validate-config.js` -> PASS 31/31 schema + cross-ref PASS
- Verified by mock/unit tests only; no live-GUI runtime proof claimed. Quantity behavior
  against the real /ks GUI is NOT proven — the new tests use stub GUIs with
  scripted inventory deltas.

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
- B5 architecture/SLO/fault-matrix/static-quality metadata cleaned (G18, this act); runtime/config deletion was already DONE and was not repeated
- CraftingQuantityResolver now reports verified button capabilities + executes exact batches (G12.1 committed); live-GUI proof still pending
- Storage/input genericized at the crafting boundary (G16 closed + pushed); shared storage primitives untouched
- Procedure Builder/Recorder foundations exist but production Builder/Recorder wiring (G20/G21) pending
- Special procedures (forge/npc) validated at executor level only; GUI operation intentionally rejects them fail-closed until their owners exist

## Next Action
- G18 is implemented (d41954c) + verified. Closeout commit pending, keep local (no push in this act). G19 starts only with explicit instruction — do not auto-advance.

## Completion Evidence
- (pending full G1-G24)


