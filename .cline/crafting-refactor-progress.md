# Crafting Refactor Progress

## Current Phase
G23 — Architecture tests (CLOSED)

## Status
G16.1 CLOSED. G19 CLOSED. G20 CLOSED. G20.1 CLOSED. G21 CLOSED. G22 CLOSED.
G23 CLOSED (commit ecee64d, pushed + verified on origin/main: HEAD == origin/main).
Overall refactor G1–G24 remains IN PROGRESS; G24 next (PLANNED -> IN_PROGRESS).

## G21 — Procedure Recorder (CLOSED: commit 64b9823, verified on origin/main)
Scope (roadmap G21): a foundation for recording interaction sequences that maps
`user action -> logical procedure step` instead of raw slot clicks. Raw slots must
never become the sole contract; recording must not depend absolutely on one
session when identity can be normalized. G21 must be a production-flow
implementation, not just unit-test foundation.

Implementation:
- `src/server-features/crafting/procedure/ProcedureRecorder.js` (rewritten from the
  G8-adjacent foundation): 9 record event kinds (command/slash-command/open-gui/
  wait-for-gui/click/select-quantity/wait/wait-for-output/verify). Slot actions
  resolve through the injected `resolveLogicalId(raw, context)` at record time and
  emit `find-logical-item` when identity resolves, `find-slot` + `unresolved[]`
  report otherwise. `toProcedure()` validates through the same `ProcedureRegistry`
  the runtime consumes and returns `identityComplete` + per-step `unresolved`.
- `src/server-features/crafting/ProcedureRecordingRuntime.js` (new): binds the pure
  recorder to live per-bot capabilities — GUI knowledge identity first, item
  registry second, learning resolved quantity identity back into knowledge. Owns
  no Minecraft side effect; callers report performed actions. Hands off to the G20
  builder via `toBuilderDraft()` and saves into a live registry via `save()`.
- `src/bootstrap/registerBotServices.js`: per-bot `procedureRecording` constructed
  with `{ guiKnowledge, itemResolver, sessionProvider: () => guiManager.current() }`,
  exposed on `crafting.procedureRecording`, the BotRuntime services map, and
  `ServerFeatureFacade.procedureRecording()`.
- Tests: `ProcedureRecordingRuntime.test.js` (9 tests: journey mapping, unresolved
  reporting, session-independence, registry fail-closed, kind/param/id rejection,
  reset isolation, knowledge binding + learn-back, builder handoff + live save,
  capability-throw degradation); `CraftProcedureBuilder.test.js` recorder case
  updated from the stale pre-G21 constructor to the record-time identity contract;
  `CraftingModeRegistration.test.js` asserts the composition-root wiring.

## Tests (G21 so far, actually run)
- `node --test tests/unit/bootstrap/CraftingModeRegistration.test.js
  tests/unit/server-features/CraftProcedureBuilder.test.js
  tests/unit/server-features/CraftGenericProcedure.test.js
  tests/unit/server-features/ProcedureRecordingRuntime.test.js` -> PASS 20/20
  (3 bootstrap incl. new composition-root wiring test + 8 procedure incl. updated
  stale-constructor recorder case + 9 new recorder/runtime tests).
- Desktop regression (13 files incl. G20.1 use-cases, controller boundary,
  procedure bindings, API contract, renderer bindings/decomposition, operator
  contract, dev experience, crafting control, log policy, health, card presenter,
  mode config) -> PASS 98/98.
- `node --test tests/e2e/desktop/desktop-critical-flow.test.js` -> PASS 1/1.
- `node scripts/validate-config.js` -> 31/31 PASS. `check-slo-contract` -> PASS 7.
- `node scripts/check-static-quality.js` -> FAIL 1: only pre-existing
  CraftingOperation 556>500 (reproduced on stashed G20.1 baseline — 200 files,
  same single failure).
- `node scripts/validate-architecture.js` -> FAIL 3: only pre-existing
  MARKDOWN_UNAUTHORIZED roadmap docs (reproduced on stashed baseline; 422/422
  source reachable, procedureRecording wired, no orphans).
- `git diff --check` clean. Mock/unit + Electron-harness only; no live-server/GUI
  proof claimed.

## G22 — Special procedures (CLOSED: commit c9205d9, verified on origin/main)
Scope (roadmap G22): when a new recipe appears —
(A) sequence already expressible -> add recipe only, no source change;
(B) same procedure, different params -> add procedure param/config, no recipe-specific class;
(C) genuinely new capability -> add one reusable primitive/procedure capability many recipes share.
Forbidden: 1 recipe = 1 implementation class (except truly inexpressible cases).

Inventory (source-checked):
- All 21 shipped recipes reference existing items AND the shared
  `minerals-crafting` procedure; explorer probe found zero missing item/procedure refs.
- `forge-crafting` (repeat/1: command forge -> click -> wait -> verify-item) and
  `npc-crafting` (command-quantity: open-gui npc -> find -> verify-quantity) exist
  as EXECUTOR-level diversity proofs, but the shipped /ks GUI operation
  (`CraftingOperation.#runProcedureNavigation`) intentionally FAILS CLOSED on them:
  only command-driven procedures containing BOTH a command step and a
  find-logical-item step run; forge/npc shapes throw CRAFTING_PROCEDURE_NOT_SUPPORTED.
- Smelting (`SmeltingOperation`: /nung -> click material, no quantity GUI) is a
  separate source-owned service — NOT a crafting recipe/procedure consumer.
- So no Case C capability exists that the engine cannot already express, and no
  new recipe is demanded by any evidence. G22 therefore = Case A/B conformance
  proof: add the data (recipes reusing existing procedures) + tests, zero new
  capability classes, zero engine changes.
- First work: representative Case A recipe (reuses minerals-crafting, existing
  items only) + negative test pinning the fail-closed boundary + contract tests
  proving all recipes resolve through (recipeRegistry x procedureRegistry).

Implementation (no source change needed — that IS the G22 proof):
- `tests/unit/server-features/CraftSpecialProcedures.test.js` (new, 4 tests):
  Case A data-only recipe (`my_item`, already shipped) resolves through the same
  registries + plans exactly (3 crafts, no missing); Case B (20+ recipes share
  `minerals-crafting`, distinct menuSlots, zero recipe-specific classes in
  crafting/modes roots); Case C negative pin (forge/npc shapes fail the
  minerals-shape predicate; no shipped recipe references them).

## Tests (G22 closeout, actually run)
- `node --test tests/unit/server-features/CraftSpecialProcedures.test.js` -> PASS 4/4.
- Adjacent suites (GenericProcedure/Diversity/RuntimeWiring/Builder/Recording/
  GenericExecution/GenericParity/GenericParity2/PlanningParity/VerificationParity/
  ConfigurationContracts) -> PASS 61/61 total incl. the 4 new G22 tests.
- `node --test tests/e2e/desktop/desktop-critical-flow.test.js` -> PASS 1/1.
- `node scripts/validate-config.js` -> 31/31 PASS. `check-slo-contract` -> PASS 7.
- `node scripts/check-static-quality.js` -> FAIL 1: only pre-existing
  CraftingOperation 556>500 (same single failure as G20.1/G21 baselines).
- `node scripts/validate-architecture.js` -> FAIL 3: only pre-existing
  MARKDOWN_UNAUTHORIZED roadmap docs (422/422 reachable, no orphans).
- `git diff --check` clean. Mock/unit + Electron-harness only; no live-server/GUI
  proof claimed.

## G23 — Architecture tests (CLOSED: commit ecee64d, verified on origin/main)
Scope (roadmap G23): tests for recipe (valid/invalid/missing-item/missing-
procedure), planner (simple/nested/stock/missing/cycle/outputAmount>1), quantity
(1/64/65/127/128/137/1000), procedure (command/GUI/click/wait/transition/
verification/failure/timeout), exact execution (one-batch/multi-batch/partial/
retry/reconciliation/terminal), GUI resolution (configured/logical/learned/
fallback/window-change/stale-generation). Forbidden: send-only assertions,
unverified success claims.

Implementation:
- `tests/unit/server-features/CraftArchitectureConformance.test.js` (new, 11
  tests, one per roadmap bullet — deliberately reusing the SAME public
  registries/executor/planner/resolver/guard classes the production path uses,
  so the suite pins the roadmap shape without duplicating adjacent suites):
  recipe valid/invalid/missing-item/missing-procedure; planner full matrix;
  all 7 quantity amounts exact; executor across all 3 shipped procedures with
  actual==stock postcondition; failure/timeout never success; exact execution
  one/multi/partial/retry/terminal; GUI resolution logical-beats-configured +
  unknown-degrades + stale-window/stale-generation rejections.
- GUI-resolution learned/window-change legs: covered by adjacent suites
  (CraftingGuiIdentity, FixedMineralsMenuSlots, GuiKnowledgeRegistry,
  ClickGuard/ClickExecutor contracts) — cited, not duplicated.

## Tests (G23 closeout, actually run)
- New `CraftArchitectureConformance.test.js` -> PASS 11/11 (one test per roadmap
  bullet; 2 harness mistakes fixed during development, both test-side only).
- Adjacent suites (Conformance + SpecialProcedures + GenericProcedure/Diversity/
  RuntimeWiring/Builder/Recording + GenericExecution/Parity/Parity2/PlanningParity/
  VerificationParity + GuiIdentity/FixedMenuSlots/QuantityBatch/Timing/Resolver +
  ConfigurationContracts) -> PASS 99/99.
- Desktop + bootstrap regression (14 files: G20/G20.1 use-cases, controller
  boundary, bindings, API contract, renderer, operator, dev, crafting control,
  log policy, health, card, mode config, mode registration) -> PASS 102/102.
- `node --test tests/e2e/desktop/desktop-critical-flow.test.js` -> PASS 1/1.
- `node scripts/validate-config.js` -> 31/31 PASS. `check-slo-contract` -> PASS 7.
- `node scripts/check-static-quality.js` -> FAIL 1: only pre-existing
  CraftingOperation 556>500 (same single failure as every baseline since G20.1).
- `node scripts/validate-architecture.js` -> FAIL 3: only pre-existing
  MARKDOWN_UNAUTHORIZED roadmap docs (422/422 reachable, no orphans).
- `git diff --check` clean. Mock/unit + Electron-harness only; no live-server/GUI
  proof claimed.

## G24 — Final refactor and architecture cleanup (IN_PROGRESS, revised scope)
Scope (roadmap G24): once behavior is stable — split large facades only where
responsibility is clear (candidate: CraftRequestService / CraftingPlanner /
RecipeRegistry / ItemRegistry / ProcedureRegistry / ProcedureExecutor /
QuantityStrategy / CraftingVerification / CraftingReconciler). No abstraction
for line-count; no useless indirection; remove post-migration dead code +
unconsumed compat code; rename so no B5 trace remains in generic subsystems.

Preflight correction (evidence-driven): the Step2/3/4 + GenericCraftExecutionTarget
suites CANNOT load on a clean tree either — they require deleted `b5/` modules
at line 6-8 (pre-existing baseline failures, documented since G16). Rewriting
them to drop the legacy twin = scope explosion (parity matrices compare generic
vs deleted-legacy behavior) with regression risk far beyond "smallest safe fix".
Per B3 ("implement strictly within phase scope") + "do not fix a future task",
G24 does NOT touch those suites.
Revised G24 = string/comment-only B5-vocabulary cleanup in LIVE src files.
NO facade splits (all 9 candidates already separate modules), NO alias removals
(live consumers), NO B-chain renames (active stage semantics).

Live-src changes (behavior-neutral, string/comment only):
- `CraftTraceRecorder`: 'B5 TRACE CANCELLED'/'B5 TRACE FAILED' -> 'CRAFT TRACE ...'.
- `CraftCycleCoordinator`: 'recalculate B5 feasibility' -> 'recalculate craft
  feasibility'; 'prioritize B5/B4 and compress owned B2/B3...' -> generic;
  'final B5>B4>B3>B2 compaction sweep' -> 'final target>output>intermediate...';
  'recover-existing-b5'/'verify-recovered-b5'/'existing-b5-recovered'/
  'Existing B5 recovery...' -> target wording (+ 'existing-target-recovered'
  added to CraftActionDiagnostics PRODUCTIVE_TOKENS alongside the old token).
- `CraftReserveChainCoordinator`: 'B5 B1 SOURCE CONTRACT' -> 'CRAFT BASE SOURCE'.
- `CraftIntermediateCoordinator`: 'B5 promotion ...' (x4) + 'B5 reserve
  coordinator...' -> generic wording.
- `CraftChainAdapter` header comment: B5PlanningService reference -> generic.
- `CraftBaseInventoryCoordinator`: reason 'reserve one B1 transfer slot before
  B2' -> 'reserve one base transfer slot before intermediate craft'.

## Tests (G24 closeout, actually run)
- Adjacent suites (Conformance + SpecialProcedures + GenericProcedure/Diversity/
  RuntimeWiring/Builder/Recording + GenericExecution/Parity/Parity2/PlanningParity/
  VerificationParity + GuiIdentity/FixedMenuSlots/QuantityBatch/Timing/Resolver +
  InputAcquisition + ConfigurationContracts) -> PASS 117/117.
- `node --test tests/unit/modes/CraftingModeService.test.js` -> PASS 54/54
  (mode-level B5-vocabulary test NAMES untouched — they describe the mode's
  external contract, out of G24 source scope).
- Desktop + bootstrap regression re-run at closeout (14 files) -> PASS 102/102.
- `node --test tests/e2e/desktop/desktop-critical-flow.test.js` -> PASS 1/1.
- `node scripts/validate-config.js` -> 31/31 PASS. `check-slo-contract` -> PASS 7.
- `node scripts/check-static-quality.js` -> FAIL 1: only pre-existing
  CraftingOperation 556>500 (same single failure as every baseline since G20.1;
  G24 touched 0 lines of that file).
- `node scripts/validate-architecture.js` -> FAIL 3: only pre-existing
  MARKDOWN_UNAUTHORIZED roadmap docs (422/422 reachable, no orphans).
- Baseline failures (reproduced IDENTICALLY on stashed clean tree, NOT caused by
  G24, NOT fixed in this act): CraftStep2BaseInventory / CraftStep3ReserveChain /
  CraftStep4Intermediate / GenericCraftExecutionTarget (require deleted b5/
  modules at line 6-8; documented since G16).
- `git diff --check` clean. Mock/unit + Electron-harness only; no live-server/GUI
  proof claimed.

## G20.1 — Procedure Builder validation contract fix (CLOSED)
Linked defect (found after G20 closed in source review): `missingRequired()` in
`src/desktop/use-cases/ProcedureBuilderUseCases.js` skipped every non-required field
before type/min/max/pattern checks, so a provided optional value (e.g.
`command.timeoutMs: 99`, `1.5`, `"abc"`) passed validation. Reproduced before the fix:
all five probe cases validated `true`.
Scope: validation contract only — one pure authority, no second step schema, no UI
rewrite, no Recorder work, no new step types.

Implementation (staged; committing now):
- `src/desktop/use-cases/ProcedureParamValidator.js` (new pure module): single
  validation authority. Required missing/null/empty -> reject; optional absent ->
  accept; optional provided -> full type/min/max/pattern checks. Empty optional
  text drops as not-provided; canonical integer strings normalize to numbers;
  floats/NaN/Infinity/booleans/objects/hex/scientific/padded strings reject;
  bounds inclusive; unknown keys reject (Registry would silently drop them).
- `ProcedureBuilderUseCases.validate()`: delegates per-step to the validator,
  feeds ONLY canonical normalized steps into `ProcedureRegistry`.
- `DesktopController.procedureValidate/procedureDryRun/saveProcedure` already share
  `validate()` (verified in source) — invalid drafts now rejected before any config
  persistence on all three paths.

## Tests (G20.1, actually run)
- `node --test tests/unit/desktop/ProcedureBuilderUseCases.test.js` -> PASS 12/12
  (6 G20 + 6 new: optional-integer matrix incl. 100/30000 valid, 99/30001/1.5/NaN/
  Infinity/"abc"/"5.0"/"0x10"/"5e2"/""/bool/object/array invalid, string "5000"
  normalizes; wait.ms 0/3600000 valid, -1/3600001/0.5 invalid; verify-item.amount
  absent valid, 1 valid, 0/2.5 invalid; required/pattern/non-string rejects;
  empty optional text dropped; unknown field rejected; Registry round-trip clean)
- `node --test DesktopControllerActions + DesktopProcedureBuilder + DesktopApiContract`
  -> PASS 36/36 incl. new boundary test: invalid draft rejected on all three
  controller paths BEFORE any persistence call; valid draft validates/dry-runs/saves
  with "5000" persisted as number 5000; shipped procedures still validate.
- Server procedure suites (CraftProcedureBuilder/GenericProcedure/Diversity/
  RuntimeWiring) -> PASS 17/17 (incl. updated stale-constructor recorder test).
- `node scripts/validate-config.js` -> 31/31 PASS. `check-slo-contract` -> PASS 7.
- `node scripts/check-static-quality.js` -> FAIL 1: only pre-existing
  CraftingOperation 556>500 (reproduced on stashed baseline).
- `node scripts/validate-architecture.js` -> FAIL 3: only pre-existing
  MARKDOWN_UNAUTHORIZED roadmap docs (reproduced on stashed baseline).
- `git diff --check` clean. Mock/unit only; no live-server/GUI proof claimed.

NOTE (unstaged, kept for G21, NOT part of G20.1): `ProcedureRecorder.js` rewrite,
`ProcedureRecordingRuntime.js`, `ServerFeatureFacade.procedureRecording`,
`registerBotServices` recording wiring, recorder tests (9 passing). These remain in
the working tree after the G20.1 commit and belong to the G21 phase.

## G20 — Procedure Builder (CLOSED)
Scope (roadmap G20): operator can add / remove / reorder / edit parameters / validate /
save / dry-run a procedure, using the exact Procedure Engine schema. No second UI
schema; nothing the runtime rejects; no runtime step the builder cannot express.

Implementation:
- `src/server-features/crafting/procedure/ProcedureStepCatalog.js` (new): single
  source of truth for the operator surface, derived from `ProcedureRegistry.STEP_TYPES`
  with typed presentation fields in the workflow-module shape so `TypedModuleEditor`
  renders parameters without a second editor schema. Fail-closed at require time in
  BOTH directions (declared vs runtime sets compared); each entry records its runtime
  owner (`runtime` executes it, `operation` fails closed with
  `CRAFTING_PROCEDURE_STEP_NOT_OWNED` if run standalone).
- `src/server-features/crafting/procedure/ProcedureBuilder.js` (existing): domain
  add/edit/remove/reorder/validate/save; validation IS the runtime schema.
- `src/desktop/use-cases/ProcedureBuilderUseCases.js` (new): catalog / validate /
  dry-run. Dry-run is pure (`capabilityCalls: 0`, `simulatedOnly: true`) and reuses the
  existing `QuantityStrategy.plan` for the batch preview, so the builder previews the
  same batching the runtime executes.
- `src/desktop/DesktopController.js`: `procedureCatalog` / `procedureValidate` /
  `procedureDryRun` / `saveProcedure`. Save validates through `ProcedureRegistry`, then
  persists via the generic `saveConfigGroup('procedures', …)` path (schema +
  cross-reference + atomic backup + reload + `#configMutation` queue) and reports
  `restartRequired` — fail-closed, never claimed live, because per-bot
  `ProcedureRegistry` instances are built at boot. Use case is lazily constructed so
  the frozen constructor budget is unchanged.
- `src/desktop/contracts/DesktopApiContract.js` + `main.js` + `preload.js`: four new
  channels (`mcbot:procedure:catalog|validate|dry-run|save`) cataloged with
  READ/READ/READ/DEVELOP permissions; no channel outside the contract.
- `src/desktop/renderer/features/procedure/ProcedureBuilderBindings.js` (new renderer
  feature boundary, declared in `architecture/catalog.json` runtimeEntrypoints and
  loaded before app.js): owns the procedure builder DOM wiring.
  `RendererEventBindings.js` keeps only a 5-line delegating resolver, so the frozen
  legacy facade budget (463 file / 458 function lines) is respected and no procedure
  logic leaks into the shared facade.
- `src/desktop/renderer/app.js` + `index.html` + `RendererStore.js`: builder page panel
  (metadata, quantity strategy/maxBatch, step palette with search, reorderable step
  list, typed step editor, pure dry-run output, advanced raw JSON), state keys.

Contract checks (G20 "không được"):
- Builder cannot emit JSON the runtime rejects: validate() normalizes through
  `ProcedureRegistry`, and the config `procedures` schema re-validates on save.
- Builder can express every runtime step without code: catalog is derived from
  `ProcedureRegistry.STEP_TYPES`, drift throws at module load in both directions.

## Tests (G20, actually run)
- `node --test tests/unit/desktop/ProcedureBuilderUseCases.test.js` -> PASS 6/6
  (catalog/runtime parity + owner tagging, required-param/pattern/unknown-type
  rejection, all shipped procedures round-trip without drift, dry-run purity +
  exact 137 -> [64,64,1x9] plan, dry-run fail-closed on invalid draft/request,
  command-quantity single full-amount batch)
- `node --test tests/unit/desktop/DesktopProcedureBuilder.test.js` -> PASS 4/4
  (end-to-end boundary wiring incl. catalog runtimeEntrypoint + delegation-not-ownership,
  builder controls present, frozen module surface, deps forwarding + every control
  wired + `bind()` throws on missing deps — the regression the E2E caught)
- `node --test` desktop batch (14 files: DesktopApiContract, RendererEventBindings,
  RendererDecompositionContract, DesktopOperatorExperienceContract, DesktopDevExperience,
  DesktopControllerActions, CraftingRequestControl, DesktopLogPolicy, OperatorHealthService,
  BotCardPresenter, ProcedureBuilderUseCases, DesktopProcedureBuilder) + server-features
  procedure batch (CraftProcedureBuilder, CraftGenericProcedure, CraftProcedureDiversity,
  CraftProcedureRuntimeWiring) -> PASS 106/106
- `node --test tests/e2e/desktop/desktop-critical-flow.test.js` -> PASS 1/1 (real Electron)
- `node --test` modes/configuration/planning/items/shared (47 files) -> PASS 326 / FAIL 2,
  both reproduced IDENTICALLY on a clean stashed HEAD: ComposableModePlatform WP-204
  (`window.mcbot.saveCustomMode` expectedDigest regex) and LegacyModeTaskSupervision
  (`new TaskSupervisor(` in CraftingModeService). Classification: 2x verified baseline
  failure, 0x G20 regression, 0x inconclusive.
- `node scripts/validate-config.js` -> PASS 31/31 schema + cross-ref PASS
- `node scripts/check-slo-contract.js` -> PASS (7 objectives)
- `node scripts/check-static-quality.js` -> FAIL 1 (only the pre-existing
  CraftingOperation 556>500 G12.1 baseline; RendererEventBindings and DesktopController
  regressions introduced mid-phase were removed by extracting the renderer feature
  module and lazily constructing the use case)
- `node scripts/validate-architecture.js` -> FAIL 3 (only the 3 pre-existing
  MARKDOWN_UNAUTHORIZED roadmap docs; 420/420 source reachable, no orphans, no cycles)
- Mock/unit + Electron-harness verification only; no live-server or live-GUI proof
  claimed. Saving a procedure requires a backend restart to load the new registry.

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
- G18 architecture/config metadata cleanup (CLOSED: d41954c + closeout fbac1a2):
  - static-quality: removed dead B5PlanningService.js budget + nonexistent managedRoots (src/desktop/b5, src/modes/b5-craft/*)
  - slo: removed producer-less b5-batch-outcome + b5-blocker-dwell objectives (no src producer, no test asserts them; no invented replacement)
  - fault-matrix r1: generalized B5 wording to storage/craft trace (evidence tests untouched)
  - fault-matrix r5: renamed b5-protection-timeout/-verified-continuation to storage-* (same semantics, same evidence tests)
  - run-quality-gates: removed 4 gate entries pointing at deleted test files (kept existing B1StorageProtectionPlanner entry)
  - .cline/ownership: removed deleted B5PlanningService entry; B1 entry now says storage batch protection coupling
  - .cline/crafting-contract: executors point at existing generic coordinators; tierConfig + B5 consumer refs removed
  - Preserved: catalog forbiddenPatterns guards, legacy-mode-debt (fishing-only), crafting-targets (clean), routing (no B5), B1-named runtime (live concept, out of scope)
  - Runtime/config B5 deletion NOT repeated (verified absent on HEAD, untouched)
- G16.1 per-material input policy integration fix (CLOSED: implementation aaf3bd4; closeout pending):
  - Root cause (verified in source): coordinator branched on flow-wide `inputAcquisition.source` default (lines 20/55/72/75), ignoring per-material overrides; automation service built the flow from the `source` string only (overrides never reached the policy; reconfigure dropped them); storage branch reported ready from requested-amount math instead of storage data
  - CraftInputAcquisitionFlow: policy built from full surface (default + overrides); reconfigure merges (default-only change preserves overrides, explicit overrides replace)
  - CraftAutomationService: constructs + reconfigures the flow with overrides; normalizeAutomationConfig carries inputSourceOverrides explicitly (legacy inputSources mapped once)
  - CraftBaseInventoryCoordinator: `#sourceFor(chain)` resolves per material; storage branch goes through `storageFlow.prepareBase` (real availability, fail-closed when unavailable); inventory return carries `source: 'inventory'` so downstream accounting is per-material; contract keeps legacy-default check for non-policy flows
  - Deliberately NOT changed: KhoService.withdrawB1 / KhoWithdrawOperation / shared primitives, decompressionPolicy, batch protection, G12.1 batching, G14.2 runtime
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

## Tests (G19, actually run on working tree)
- Focused desktop+config suites -> PASS 97/97 (BotCardPresenter 8, CraftingRequestControl 5, DesktopApiContract 3, RendererDomContract 3, OperatorPresenter 7, OperatorSnapshotProjector 2, DesktopLogPolicy 3, OperatorHealthService 2, DesktopControllerActions 16, DevExperience 32, OperatorExperienceContract 4, DecompositionContract 2, ModeConfigurationUseCases 2, CraftingConfigSeparation 4, RendererEventBindings 4)
- Desktop E2E critical flow (real Electron, fixture backend) -> PASS 1/1
- `node scripts/validate-config.js` -> PASS 31/31 schema + cross-ref PASS; `node scripts/check-slo-contract.js` -> PASS (7 objectives); `git diff --check` clean
- CraftingModeService modes suite -> PASS 54/54 (mode engine untouched; test names still B5-flavored, out of scope)
- Newly-fixed-by-G19 (were failing on HEAD before this act): CraftingConfigSeparation b5-compat x2, ModeConfigurationUseCases collector x1, DesktopDevExperience b5-trace/nav x3, Desktop E2E harness (stale #b5Journey waiter + channels)
- Remaining baseline failures (untouched, out of scope): GenericConfigMutationTransaction (requires deleted CollectorB5ConfigEditor), DesktopSupportReplay (B5 replay fixture), CraftStep2/3/4 + GenericCraftExecutionTarget (require deleted b5/ coordinators), KhoWithdrawOperation batchCount drift, + others listed under closeout-act section
- Mock/unit + Electron fixture only; no live-server proof claimed.

## Tests (G16.1, actually run on working tree)
- `node --test tests/unit/server-features/CraftInputAcquisition.test.js` -> PASS 18/18 (10 G16 + 8 G16.1: per-material override both directions, independent routing, reconfigure preservation, invalid-override fallback, returnToStorage source, service plumbing)
- Affected suites: planning/parity/bootstrap/modes/quantity batch -> PASS 149/149; shared-storage suites -> PASS 62/62
- `node scripts/validate-config.js` -> PASS 31/31 schema + cross-ref PASS; `git diff --check` clean
- Mock/unit only; no live-server proof claimed. G19 NOT started.

## Tests (G18, actually run on working tree)
- Pre-edit baseline: validate-config 31/31 PASS; check-slo-contract PASS (9 objectives); check-static-quality FAIL x2 (B5PlanningService missing-entry [G18 target] + CraftingOperation 556>500 lines [pre-existing G12.1, out of scope])
- Post-edit: validate-config 31/31 PASS; check-slo-contract PASS (7 objectives); check-static-quality FAIL x1 (only the pre-existing CraftingOperation budget remains — G18 fixed its target failure)
- arch/config suites: SloMetricContract + StaticQualityAst + ConfigurationContracts + CraftGenericParity2 + CraftingModeService -> PASS 80/80
- fault-matrix suites (R1/R5/FaultMatrixContract) -> PASS 11/11
- `git diff --check` clean

## Tests (G16 closeout, run on detached worktree at d6d4b1f for baseline + working tree for scope)
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
- B5 architecture/SLO/fault-matrix/static-quality metadata cleaned (G18 closed); runtime/config deletion was already DONE and was not repeated
- CraftingQuantityResolver now reports verified button capabilities + executes exact batches (G12.1 committed); live-GUI proof still pending
- Storage/input genericized at the crafting boundary (G16 closed + pushed); shared storage primitives untouched
- G16.1 per-material policy fix closed (implementation aaf3bd4); mock/unit only, no live-server proof
- G19 Desktop UI cleanup CLOSED (implementation + closeout 0a1fd93, verified on origin/main): B5 config/rules/compat-mode/controls/labels removed from Desktop (controller/main/preload/contract/renderer/log-policy/health/projection); generic crafting channels (crafting:journey/trace, retry-storage-protection, config:crafting) + craft-debug dev page; RuntimeConfigMigrations + CraftingModeService engine preserved
- Procedure Builder/Recorder foundations exist but production Builder/Recorder wiring (G20/G21) pending
- Special procedures (forge/npc) validated at executor level only; GUI operation intentionally rejects them fail-closed until their owners exist

## Next Action
- G16.1 is CLOSED (implementation aaf3bd4, closeout bec96f1). G19 has NOT started and starts only on explicit user request — no auto-advance, no next-phase prompt.

## Completion Evidence
- (pending full G1-G24)


