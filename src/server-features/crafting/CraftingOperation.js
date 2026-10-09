'use strict';

const Timeout = require('../../shared/time/Timeout');
const FlowError = require('../../shared/errors/FlowError');
const CraftingGuiNavigator = require('./CraftingGuiNavigator');
const CraftingExecutionSupport = require('./CraftingExecutionSupport');
const CraftingVerificationCoordinator = require('./CraftingVerificationCoordinator');

class CraftingOperation {
    constructor({
        commandService,
        guiManager,
        context = null,
        itemResolver,
        recipeRegistry,
        quantityResolver,
        resultVerifier,
        guiKnowledge = null,
        procedureRegistry = null,
        procedureRuntime = null,
        config,
        logger = null
    }) {
        Object.assign(this, {
            commandService,
            guiManager,
            context,
            itemResolver,
            recipeRegistry,
            quantityResolver,
            resultVerifier,
            guiKnowledge,
            procedureRegistry,
            procedureRuntime,
            logger
        });
        this.config = this.#validateConfig(config);
        this.navigator = new CraftingGuiNavigator({
            commandService, guiManager, itemResolver, quantityResolver, guiKnowledge,
            config: this.config,
            trace: (...args) => this.#trace(...args),
            flow: (...args) => this.#flow(...args)
        });
        this.support = new CraftingExecutionSupport({
            resultVerifier, guiManager, context, logger, config: this.config,
            trace: (...args) => this.#trace(...args),
            flow: (...args) => this.#flow(...args)
        });
        this.verification = new CraftingVerificationCoordinator({
            resultVerifier, guiKnowledge, guiManager, config: this.config,
            support: this.support,
            trace: (...args) => this.#trace(...args),
            flow: (...args) => this.#flow(...args)
        });
    }

    async execute(recipeId, amount, options = {}) {
        const state = this.#createState(recipeId, amount, options);
        state.procedure = this.#resolveProcedure(state.recipe, options);
        try {
            this.#captureBefore(state);
            await this.#runProcedureNavigation(state);
            await this.#navigateToQuantity(state);
            // G12.1: ALL keeps single-click semantics. Any positive integer is
            // satisfied by repeating verified button-batch clicks (1s and 64s
            // from observed GUI capabilities), verifying each batch.
            if (state.quantity === 'ALL') return this.#executeSingleBatch(state);
            return this.#executeBatches(state);
        } catch (error) {
            if (error instanceof FlowError) throw error;
            throw FlowError.wrap(error, {
                code: error?.code || 'CRAFTING_STEP_FAILED', subsystem: 'crafting', operation: 'CraftingOperation',
                step: state.stage, action: this.#stageAction(state.stage, state.quantity), resource: state.recipe?.output || state.recipeId,
                details: { ...state.baseDetails, before: state.before?.countsBySource || null, gui: this.guiManager.describeCurrent?.() || null }
            });
        }
    }

    async #executeSingleBatch(state) {
        await this.#clickQuantity(state);
        state.stage = 'verify-output';
        this.#trace('CRAFT VERIFY START', state.stage, {
            recipeId: state.recipeId, resource: state.recipe.output, quantity: state.quantity, phase: 'START',
            inventorySource: 'bot-inventory', currentWindowId: state.bot.currentWindow?.id ?? null
        });
        return this.verification.verify({
            recipeId: state.recipeId, recipe: state.recipe, quantity: state.quantity, before: state.before,
            baseDetails: state.baseDetails, effectiveInputSource: state.effectiveInputSource,
            reconciliationBaseline: state.reconciliationBaseline, expectedGeneration: state.expectedGeneration,
            bot: state.bot, startedAt: state.startedAt, entrySlot: state.entrySlot,
            recipeSlot: state.recipeSlot, quantitySlot: state.quantitySlot
        });
    }

    async #executeBatches(state) {
        // Batching belongs to the observed capability, never to a hardcoded
        // 64: the plan is rebuilt from fresh GUI actions every iteration, so a
        // GUI that only exposes a 1-button still stays exact.
        const requested = Number(state.quantity);
        const batches = [];
        let actual = 0;
        let crafts = 0;
        let lastResult = null;
        while (crafts < requested) {
            state.cancellationToken?.throwIfCancelled?.();
            this.#assertGeneration(state.expectedGeneration);
            const remaining = requested - crafts;
            const actions = this.#quantityActions(state);
            if (!actions.length) {
                throw this.#flow('CRAFTING_QUANTITY_NOT_FOUND', 'resolve-quantity', `resolve quantity batch ${remaining}`, state.recipe.output, {
                    ...state.baseDetails, remaining, candidates: this.quantityResolver.describeCandidates?.(state.quantitySession?.window) || []
                });
            }
            const batchAmount = this.#pickBatch(actions, remaining);
            await this.#ensureQuantitySession(state);
            await this.#clickQuantity(state, batchAmount, { keepOpen: true });
            const result = await this.#verifyBatch(state, batchAmount, batches.length + 1);
            const verified = Number(result?.actualCrafts || 0);
            batches.push(Object.freeze({ wanted: batchAmount, actual: verified, quantitySlot: state.quantitySlot }));
            // producedAmount is per-batch: accumulate, never overwrite.
            actual += Number(result?.producedAmount || 0);
            crafts += verified;
            lastResult = result;
            if (verified <= 0) break;
        }
        const remaining = requested - crafts;
        if (remaining > 0) {
            throw this.#flow('CRAFTING_OUTPUT_NOT_VERIFIED', 'verify-output', `verify quantity batches ${requested}`, state.recipe.output, {
                ...state.baseDetails, requested, actual, remaining,
                batches, lastVerification: lastResult?.verification || null
            });
        }
        // Single close at the end: verification observed the open GUI, and the
        // closed-GUI invariant for inventory reads holds from here on.
        state.stage = 'close-quantity-menu';
        const closeResult = await this.support.closeQuantityWindowIfStillOpen(state.quantitySession, state.bot);
        this.#trace('CRAFT QUANTITY GUI CLOSED', state.stage, { recipeId: state.recipeId, resource: state.recipe.output, phase: 'OK', ...closeResult });
        // Totals, not last-batch: callers account requested/actual/remaining.
        return {
            ...lastResult, batches: Object.freeze(batches), requested, actual, remaining: 0,
            amount: requested, quantityAction: requested, actualCrafts: crafts, producedAmount: actual
        };
    }

    #quantityActions(state) {
        const window = state.quantitySession?.window || null;
        if (typeof this.quantityResolver.describeActions === 'function') {
            const actions = this.quantityResolver.describeActions(window) || [];
            return actions.filter(action => Number.isInteger(action?.amount) && action.amount > 0 && Number.isInteger(action?.slot) && action.slot >= 0);
        }
        // Fallback for stub resolvers in older tests: single resolve probes.
        const actions = [];
        for (const amount of [64, 1]) {
            try {
                const slot = this.quantityResolver.resolve(amount, window);
                if (Number.isInteger(slot) && slot >= 0) actions.push({ amount, slot, source: 'resolve' });
            } catch { /* capability absent: not a batch candidate */ }
        }
        return actions;
    }

    #pickBatch(actions, remaining) {
        // Greedy over verified desc amounts; a 1-button guarantees exactness.
        // ALL is never a candidate: it is not a fixed-size batch.
        let batch = 1;
        for (const action of actions) {
            if (action.amount <= remaining && action.amount >= batch) batch = action.amount;
        }
        return batch;
    }

    async #verifyBatch(state, batchAmount, batchIndex) {
        state.stage = 'verify-output';
        this.#trace('CRAFT VERIFY START', state.stage, {
            recipeId: state.recipeId, resource: state.recipe.output, quantity: batchAmount, phase: 'START',
            batch: batchIndex, inventorySource: 'bot-inventory', currentWindowId: state.bot.currentWindow?.id ?? null
        });
        const result = await this.verification.verify({
            recipeId: state.recipeId, recipe: state.recipe, quantity: batchAmount, before: state.before,
            baseDetails: state.baseDetails, effectiveInputSource: state.effectiveInputSource,
            reconciliationBaseline: state.reconciliationBaseline, expectedGeneration: state.expectedGeneration,
            bot: state.bot, startedAt: state.startedAt, entrySlot: state.entrySlot,
            recipeSlot: state.recipeSlot, quantitySlot: state.quantitySlot
        });
        // Advance the baseline so the next batch verifies only its own delta.
        this.#captureBefore(state);
        return result;
    }

    #createState(recipeId, amount, options) {
        let cancellationToken = options.operationContext?.cancellation?.token || options.cancellationToken || null;
        const expectedGeneration = options.expectedGeneration ?? options.operationContext?.connectionGeneration ?? this.context?.getGeneration?.() ?? null;
        cancellationToken?.throwIfCancelled?.();
        this.#assertGeneration(expectedGeneration);
        const recipe = this.recipeRegistry.require(recipeId);
        const quantity = this.#normalizeQuantity(amount);
        const effectiveInputSource = inputId => String(options.inputSourceOverrides?.[inputId] || recipe.inputSources?.[inputId] || recipe.inputSource || 'inventory');
        return {
            recipeId, recipe, quantity, cancellationToken, expectedGeneration, operationContext: options.operationContext || null,
            reconciliationBaseline: options.reconciliationBaseline || null, effectiveInputSource, before: null,
            stage: 'capture-before', startedAt: Date.now(), entrySlot: null, recipeSlot: null, quantitySlot: null, bot: null, quantitySession: null,
            baseDetails: { recipeId, amount: quantity, outputId: recipe.output, outputAmount: recipe.outputAmount || 1,
                inputSources: Object.fromEntries(Object.keys(recipe.inputs || {}).map(inputId => [inputId, effectiveInputSource(inputId)])) }
        };
    }

    #captureBefore(state) {
        this.#trace('CRAFT START', state.stage, { recipeId: state.recipeId, quantity: state.quantity, resource: state.recipe.output, phase: 'START' });
        state.before = this.resultVerifier.before(state.recipe.output, Object.keys(state.recipe.inputs || {}), {
            inventorySource: 'bot-inventory', connectionGeneration: state.expectedGeneration
        });
        this.#trace('CRAFT SNAPSHOT BEFORE', state.stage, {
            recipeId: state.recipeId, quantity: state.quantity, resource: state.recipe.output, phase: 'OK', before: state.before?.countsBySource || null,
            inputCounts: Object.fromEntries(Object.entries(state.before?.inputCounts || {}).map(([inputId, counted]) => [inputId,
                Number(counted?.countsBySource?.['bot-inventory'] ?? counted?.count ?? 0)])), inputSources: state.baseDetails.inputSources
        });
    }

    #resolveProcedure(recipe, options = {}) {
        const explicitId = String(options.procedureId || recipe?.procedure || '').trim();
        // Legacy/test recipes without a procedure keep the fixed production path.
        // Schema requires `procedure` for new recipes, so null only means fallback.
        if (!explicitId) return null;
        const registry = this.procedureRegistry;
        if (!registry || typeof registry.require !== 'function') throw this.#flow('CRAFTING_PROCEDURE_REGISTRY_MISSING', 'resolve-procedure', 'resolve procedure', explicitId, { recipeId: recipe?.output || null });
        return registry.require(explicitId);
    }

    async #runProcedureNavigation(state) {
        state.cancellationToken?.throwIfCancelled?.();
        this.#assertGeneration(state.expectedGeneration);
        if (!state.procedure) return { skipped: true, reason: 'no-procedure' };
        if (!this.procedureRuntime || typeof this.procedureRuntime.runBatch !== 'function') return { skipped: true, reason: 'no-runtime' };
        // Quantity/verification/close stay owned by the operation. Only navigation
        // primitives (command/open/find/click/wait/slot) run through the runtime.
        const NAVIGATION_TYPES = ['command', 'slash-command', 'open-gui', 'resolve-gui', 'wait-for-gui', 'find-logical-item', 'find-slot', 'click', 'wait', 'wait-for-transition'];
        const types = new Set((state.procedure.steps || []).map(step => String(step?.type || '').trim()));
        const hasCommand = types.has('command') || types.has('slash-command');
        const hasFind = types.has('find-logical-item');
        // Legacy/test recipes without a navigation shape keep the fixed path.
        if (!hasCommand && !hasFind) return { skipped: true, reason: 'no-navigation-steps' };
        // Fail-closed: this operation executes command-driven GUI navigation only.
        // Forge/npc-shaped procedures declare different terminal semantics and must
        // not silently run the minerals GUI.
        if (!hasCommand || !hasFind) throw this.#flow('CRAFTING_PROCEDURE_NOT_SUPPORTED', 'run-procedure-step', 'run procedure navigation', state.procedure.id || state.recipe?.procedure, { recipeId: state.recipeId, procedureSteps: (state.procedure.steps || []).map(step => step?.type) });
        // Navigation prefix: leading command/open/find/click/wait steps only. The
        // quantity phase (wait-for-gui quantity, quantity click, output wait,
        // verify, close) stays owned by the operation below.
        const NAV_PREFIX = new Set(['command', 'slash-command', 'open-gui', 'find-logical-item', 'find-slot', 'click', 'wait', 'wait-for-transition']);
        const navigationSteps = [];
        for (const step of state.procedure.steps || []) {
            if (!NAV_PREFIX.has(String(step?.type || '').trim())) break;
            navigationSteps.push(step);
        }
        if (!navigationSteps.length) return { skipped: true, reason: 'no-navigation-steps' };
        const navigation = { ...state.procedure, steps: navigationSteps };
        const runtimeState = await this.procedureRuntime.runBatch({
            procedure: navigation,
            recipe: state.recipe,
            request: { amount: state.quantity },
            execution: { requested: state.quantity, remaining: state.quantity, executed: 0, actual: 0 },
            options: {
                config: this.config,
                cancellationToken: state.cancellationToken,
                expectedGeneration: state.expectedGeneration,
                operationContext: state.operationContext,
                trace: (...args) => this.#trace(...args),
                flow: (...args) => this.#flow(...args)
            }
        });
        this.#assertGeneration(state.expectedGeneration);
        if (Number.isInteger(runtimeState?.entrySlot) && runtimeState.entrySlot >= 0) state.entrySlot = runtimeState.entrySlot;
        if (Number.isInteger(runtimeState?.recipeSlot) && runtimeState.recipeSlot >= 0) state.recipeSlot = runtimeState.recipeSlot;
        state.procedureNavigation = {
            session: runtimeState?.session || null,
            enteredMenu: runtimeState?.enteredMenu === true,
            selectedRecipe: runtimeState?.selectedRecipe === true,
            reachedMenu: Boolean(runtimeState?.session?.window)
        };
        return { skipped: false, steps: navigationSteps.length };
    }

    async #navigateToQuantity(state) {
        const { recipeId, recipe, quantity, cancellationToken, expectedGeneration, operationContext, baseDetails } = state;
        state.stage = 'open-minerals-root';
        this.#trace('CRAFT OPEN /ks', state.stage, { recipeId, quantity, resource: recipe.output, phase: 'START' });
        // G14.2: the procedure owns the navigation sequence (command + entry/menu
        // clicks). The runtime already applied those primitives through the same
        // capability owners (CommandService/GuiManager). Skipping the fixed /ks
        // sequence avoids double-clicking; the fixed path below is the fail-closed
        // fallback when no procedure navigation ran.
        const nav = state.procedureNavigation;
        const navigatedSession = nav?.session?.window ? nav.session : null;
        if (navigatedSession && nav?.selectedRecipe) {
            // Runtime already selected the recipe (its click opened the quantity
            // GUI). Adopt that session instead of clicking the recipe slot a
            // second time — re-clicking would be an unverified repeat side effect.
            await this.#adoptProcedureQuantitySession(state, navigatedSession);
            return;
        }
        if (navigatedSession && nav?.enteredMenu) {
            this.#trace('CRAFT PROCEDURE MENU READY', state.stage, { recipeId, resource: recipe.output, phase: 'OK', title: navigatedSession?.window?.title || null });
            await this.#prepareQuantityFromMenu(state, navigatedSession);
            return;
        }
        const rootSource = { commandKey: this.config.commandKey, command: '/ks', guiId: this.config.mineralsGuiId, clicks: [], actions: [], source: 'operation' };
        let session = await this.navigator.openMineralsRoot(rootSource, { cancellationToken, expectedGeneration, operationContext });
        this.navigator.assertGuiIdentity(session, this.config.mineralsGuiId, state.stage, baseDetails);
        this.#trace('CRAFT /ks READY', state.stage, { recipeId, resource: recipe.output, phase: 'OK', title: session?.window?.title || null, guiIdentity: session?.identity || null });
        state.stage = 'resolve-crafting-entry';
        state.entrySlot = await this.navigator.resolveEntrySlot(session, rootSource);
        this.#trace('CRAFT ENTRY RESOLVED', state.stage, { recipeId, resource: recipe.output, phase: 'OK', slot: state.entrySlot });
        if (state.entrySlot < 0) throw this.#flow('CRAFTING_ENTRY_NOT_FOUND', state.stage, 'resolve menu_crafting', this.config.entryMenuItemId, { ...baseDetails, gui: this.guiManager.describeCurrent() });
        session = await this.#enterCraftingMenu(state, rootSource);
        await this.#learnRecipeMenu(state, session);
        await this.#prepareQuantityFromMenu(state, session);
    }

    async #adoptProcedureQuantitySession(state, session) {
        const { recipeId, recipe, quantity } = state;
        state.stage = 'resolve-quantity';
        this.navigator.assertGuiIdentity(session, this.config.quantityGuiId, state.stage, state.baseDetails);
        this.#trace('CRAFT QUANTITY MENU READY', state.stage, { recipeId, resource: recipe.output, phase: 'OK', title: session?.window?.title || null, via: 'procedure' });
        state.quantitySession = session;
        state.quantitySource = { commandKey: this.config.commandKey, command: '/ks', guiId: this.config.quantityGuiId,
            clicks: [state.entrySlot, state.recipeSlot], actions: ['menu_crafting', `recipe:${recipeId}`], source: 'procedure' };
        // G12.1: batch mode resolves per-batch slots in the loop; only the
        // single-click ALL path resolves the full amount here.
        if (quantity === 'ALL') {
            state.quantitySlot = await this.navigator.resolveQuantitySlot(state.quantitySession, quantity, state.quantitySource);
            this.#trace('CRAFT QUANTITY RESOLVED', state.stage, { recipeId, resource: recipe.output, quantity, phase: 'OK', slot: state.quantitySlot });
        }
    }

    async #prepareQuantityFromMenu(state, session) {
        const { recipeId, recipe, quantity, baseDetails } = state;
        state.stage = 'resolve-recipe-slot';
        const craftingSource = state.craftingSource;
        state.recipeSlot = await this.navigator.resolveRecipeSlotWithRetry(session, recipeId, recipe, craftingSource);
        this.#trace('CRAFT RECIPE RESOLVED', state.stage, { recipeId, resource: recipe.output, phase: 'OK', slot: state.recipeSlot });
        if (state.recipeSlot < 0) throw this.#flow('CRAFTING_RECIPE_NOT_FOUND', state.stage, 'resolve recipe slot', recipeId, { ...baseDetails, menuItemId: recipe.menuItemId, gui: this.guiManager.describeCurrent() });
        await this.#bindRecipeOutput(state, session);
        state.quantitySession = await this.#openQuantityMenu(state);
        state.stage = 'resolve-quantity';
        // G12.1: batch mode resolves per-batch slots in the loop; only the
        // single-click ALL path resolves the full amount here.
        if (quantity === 'ALL') {
            state.quantitySlot = await this.navigator.resolveQuantitySlot(state.quantitySession, quantity, state.quantitySource);
            this.#trace('CRAFT QUANTITY RESOLVED', state.stage, { recipeId, resource: recipe.output, quantity, phase: 'OK', slot: state.quantitySlot });
        }
    }

    async #enterCraftingMenu(state) {
        state.stage = 'enter-crafting-menu';
        state.craftingSource = { commandKey: this.config.commandKey, command: '/ks', guiId: this.config.guiId, clicks: [state.entrySlot], actions: ['menu_crafting'], source: 'operation' };
        this.#trace('CRAFT ENTER MENU', state.stage, { recipeId: state.recipeId, resource: state.recipe.output, phase: 'START', slot: state.entrySlot });
        const session = await this.guiManager.clickAndWaitForTransition(state.entrySlot, {
            timeoutMs: this.config.guiTimeoutMs, cancellationToken: state.cancellationToken, expectedGeneration: state.expectedGeneration,
            label: 'crafting menu click', requireNewWindow: true, settleMs: this.config.openSettleMs, source: state.craftingSource
        });
        this.navigator.assertGuiIdentity(session, this.config.guiId, state.stage, state.baseDetails);
        this.#trace('CRAFT MENU READY', state.stage, { recipeId: state.recipeId, resource: state.recipe.output, phase: 'OK', title: session?.window?.title || null, guiIdentity: session?.identity || null });
        return session;
    }

    async #learnRecipeMenu(state, session) {
        if (!this.guiKnowledge) return;
        state.stage = 'learn-recipe-menu';
        this.#trace('CRAFT LEARN RECIPES', state.stage, { recipeId: state.recipeId, resource: state.recipe.output, phase: 'START' });
        await this.guiKnowledge.learnBootstrapSlots(session, { source: state.craftingSource, entries: this.recipeRegistry.ids().map(id => {
            const definition = this.recipeRegistry.require(id);
            return { roleId: `recipe:${id}`, bootstrapSlot: definition.guiIdentityOverride ?? definition.menuSlot ?? null, logicalItemId: definition.menuItemId, context: 'crafting-menu' };
        }) });
        this.#trace('CRAFT LEARN RECIPES OK', state.stage, { recipeId: state.recipeId, resource: state.recipe.output, phase: 'OK' });
    }

    async #bindRecipeOutput(state, session) {
        state.stage = 'bind-recipe-output';
        this.#trace('CRAFT BIND OUTPUT', state.stage, { recipeId: state.recipeId, resource: state.recipe.output, phase: 'START', slot: state.recipeSlot });
        const selected = session.window?.slots?.[state.recipeSlot] || null;
        if (selected && this.guiKnowledge?.learnLogicalItem) await this.guiKnowledge.learnLogicalItem(state.recipe.output, selected, {
            source: 'crafting-recipe-selected', roleId: `recipe:${state.recipeId}`, context: 'crafting-menu'
        });
        this.#trace('CRAFT BIND OUTPUT OK', state.stage, { recipeId: state.recipeId, resource: state.recipe.output, phase: 'OK', outputIdentity: this.guiKnowledge?.getStrongIdentity?.(state.recipe.output) || null });
    }

    async #openQuantityMenu(state) {
        state.stage = 'open-quantity-menu';
        state.quantitySource = { commandKey: this.config.commandKey, command: '/ks', guiId: this.config.quantityGuiId,
            clicks: [state.entrySlot, state.recipeSlot], actions: ['menu_crafting', `recipe:${state.recipeId}`], source: 'operation' };
        this.#trace('CRAFT OPEN QUANTITY', state.stage, { recipeId: state.recipeId, resource: state.recipe.output, phase: 'START', slot: state.recipeSlot });
        const session = await this.guiManager.clickAndWaitForTransition(state.recipeSlot, { timeoutMs: this.config.guiTimeoutMs,
            cancellationToken: state.cancellationToken, expectedGeneration: state.expectedGeneration, label: `crafting recipe ${state.recipeId}`,
            requireNewWindow: true, settleMs: this.config.openSettleMs, source: state.quantitySource });
        this.navigator.assertGuiIdentity(session, this.config.quantityGuiId, state.stage, state.baseDetails);
        this.#trace('CRAFT QUANTITY MENU READY', state.stage, { recipeId: state.recipeId, resource: state.recipe.output, phase: 'OK', title: session?.window?.title || null, guiIdentity: session?.identity || null });
        return session;
    }

    async #ensureQuantitySession(state) {
        // Batches share one live quantity GUI: closing between clicks would
        // force unverified re-navigation. If the server closed it mid-loop,
        // stop with partial evidence instead of blindly re-clicking.
        const live = state.quantitySession?.window || null;
        if (!live) {
            throw this.#flow('CRAFTING_QUANTITY_GUI_CLOSED', 'resolve-quantity', 'reuse quantity GUI', state.recipe.output, {
                ...state.baseDetails, gui: this.guiManager.describeCurrent?.() || null
            });
        }
        state.cancellationToken?.throwIfCancelled?.();
        this.#assertGeneration(state.expectedGeneration);
        return state.quantitySession;
    }

    async #clickQuantity(state, batchAmount = null, { keepOpen = false } = {}) {
        const clicked = batchAmount === null ? state.quantity : batchAmount;
        state.stage = 'click-quantity';
        state.bot = this.support.requireBot();
        if (batchAmount !== null) {
            // Each batch re-resolves its slot from the CURRENT live quantity
            // GUI: capabilities are re-observed every iteration, never assumed.
            state.quantitySlot = await this.navigator.resolveQuantitySlot(state.quantitySession, batchAmount, state.quantitySource);
            this.#trace('CRAFT QUANTITY RESOLVED', state.stage, { recipeId: state.recipeId, resource: state.recipe.output, quantity: batchAmount, phase: 'OK', slot: state.quantitySlot });
        }
        this.#trace('CRAFT PRE-CLICK DELAY', state.stage, { recipeId: state.recipeId, resource: state.recipe.output, quantity: clicked, phase: 'WAIT', ticks: this.config.preQuantityClickTicks, slot: state.quantitySlot });
        await state.bot.waitForTicks(this.config.preQuantityClickTicks);
        state.cancellationToken?.throwIfCancelled?.(); this.#assertGeneration(state.expectedGeneration);
        this.#trace('CRAFT CLICK QUANTITY', state.stage, { recipeId: state.recipeId, resource: state.recipe.output, quantity: clicked, phase: 'START', slot: state.quantitySlot });
        this.resultVerifier.arm?.(state.before); state.quantityClickedAt = Date.now();
        await this.guiManager.click(state.quantitySlot, { cancellationToken: state.cancellationToken, expectedGeneration: state.expectedGeneration });
        this.support.traceInventoryTimeline('after-click', state.quantityClickedAt, state.recipeId, state.recipe, state.effectiveInputSource, state.expectedGeneration);
        await this.#postClickWait(state, batchAmount);
        if (keepOpen) {
            this.#trace('CRAFT CLICK QUANTITY OK', 'click-quantity', { recipeId: state.recipeId, resource: state.recipe.output, quantity: clicked, phase: 'OK', slot: state.quantitySlot, keptOpen: true });
            this.support.traceInventoryTimeline('after-post-click-ticks-keep-open', state.quantityClickedAt, state.recipeId, state.recipe, state.effectiveInputSource, state.expectedGeneration);
            return;
        }
        state.stage = 'close-quantity-menu';
        const closeResult = await this.support.closeQuantityWindowIfStillOpen(state.quantitySession, state.bot);
        this.#trace('CRAFT QUANTITY GUI CLOSED', state.stage, { recipeId: state.recipeId, resource: state.recipe.output, quantity: state.quantity, phase: 'OK', ...closeResult });
        this.#trace('CRAFT CLICK QUANTITY OK', 'click-quantity', { recipeId: state.recipeId, resource: state.recipe.output, quantity: clicked, phase: 'OK', slot: state.quantitySlot });
        this.support.traceInventoryTimeline('after-quantity-close', state.quantityClickedAt, state.recipeId, state.recipe, state.effectiveInputSource, state.expectedGeneration);
    }

    async #postClickWait(state, batchAmount = null) {
        const waited = batchAmount === null ? state.quantity : batchAmount;
        this.#trace('CRAFT POST-CLICK DELAY', state.stage, { recipeId: state.recipeId, resource: state.recipe.output, quantity: waited, phase: 'WAIT', ticks: this.config.postQuantityClickTicks, slot: state.quantitySlot });
        await state.bot.waitForTicks(this.config.postQuantityClickTicks);
        state.cancellationToken?.throwIfCancelled?.(); this.#assertGeneration(state.expectedGeneration);
        this.support.traceInventoryTimeline('after-post-click-ticks', state.quantityClickedAt, state.recipeId, state.recipe, state.effectiveInputSource, state.expectedGeneration);
        if (this.config.resultDelayMs > 0) await Timeout.delay(this.config.resultDelayMs, { cancellationToken: state.cancellationToken });
    }

    #assertGeneration(expectedGeneration) {
        if (expectedGeneration === null || expectedGeneration === undefined || !this.context) return;
        const expected = Number(expectedGeneration);
        if (this.context.has?.() && Number(this.context.getGeneration?.()) === expected) return;
        throw new FlowError('Crafting operation belongs to a stale connection generation.', {
            code: 'DISCONNECTED', subsystem: 'crafting', operation: 'CraftingOperation',
            step: 'generation-guard', retryable: true,
            details: { expectedGeneration: expected, currentGeneration: this.context.getGeneration?.() ?? null }
        });
    }

    #normalizeQuantity(amount) {
        if (amount === 'ALL') return 'ALL';
        if (typeof amount === 'string' && amount.trim().toUpperCase() === 'ALL') return 'ALL';
        // G10/G11: exact quantity. GUI buttons (1/64) are server capabilities,
        // not architecture limits — callers batch them to stay exact.
        const value = Number(amount);
        if (Number.isSafeInteger(value) && value >= 1) return value;
        throw this.#flow('CRAFTING_QUANTITY_INVALID', 'resolve-quantity', 'normalize crafting quantity', String(amount), {
            amount,
            supported: 'positive-integer-or-ALL'
        });
    }

    #trace(message, step, meta = {}) {
        this.logger?.info?.(message, {
            operation: 'CraftingOperation',
            step,
            action: this.#stageAction(step, meta.quantity),
            ...meta
        });
    }

    #stageAction(stage, amount) {
        const actions = {
            'capture-before': 'capture inventory before craft',
            'open-minerals-root': '/ks',
            'resolve-crafting-entry': 'resolve crafting menu entry',
            'enter-crafting-menu': 'click crafting menu entry',
            'learn-recipe-menu': 'learn recipe menu fingerprints',
            'resolve-recipe-slot': 'resolve recipe item',
            'bind-recipe-output': 'bind recipe output identity',
            'open-quantity-menu': 'click recipe item',
            'resolve-quantity': `resolve quantity ${amount}`,
            'click-quantity': `click quantity ${amount}`,
            'close-quantity-menu': 'close quantity GUI before inventory verification',
            'verify-output': 'verify inventory output'
        };
        return actions[stage] || stage;
    }

    #flow(code, step, action, resource, details, { retryable = true } = {}) {
        return new FlowError(this.#messageForCode(code, resource), {
            code, subsystem: 'crafting', operation: 'CraftingOperation', step, action, resource, details, retryable
        });
    }

    #messageForCode(code, resource) {
        const messages = {
            CRAFTING_ENTRY_NOT_FOUND: `Crafting menu entry could not be learned or found: ${resource}.`,
            CRAFTING_RECIPE_NOT_FOUND: `Crafting recipe slot not found for ${resource}.`,
            CRAFTING_OUTPUT_NOT_VERIFIED: `Crafting produced no verified inventory output for ${resource}.`,
            CRAFTING_OUTCOME_UNCERTAIN: `Crafting outcome is uncertain for ${resource}; fresh reconciliation is required before retry.`,
            CRAFTING_BOT_TIMING_UNAVAILABLE: 'Crafting cannot apply the configured tick delays because bot.waitForTicks is unavailable.',
            CRAFTING_QUANTITY_GUI_CLOSE_UNAVAILABLE: 'Crafting quantity GUI could not be closed before inventory verification.',
            CRAFTING_QUANTITY_INVALID: `Unsupported crafting quantity: ${resource}.`,
            CRAFTING_QUANTITY_GUI_CLOSED: `Crafting quantity GUI closed before all batches completed for ${resource}.`,
            CRAFTING_PROCEDURE_MISSING: `Crafting procedure is missing for ${resource}.`,
            CRAFTING_PROCEDURE_REGISTRY_MISSING: `Crafting procedure registry is missing for ${resource}.`,
            CRAFTING_PROCEDURE_NOT_SUPPORTED: `Crafting procedure is not supported by the GUI operation: ${resource}.`
        };
        return messages[code] || `Crafting failed for ${resource}.`;
    }

    #validateConfig(config) {
        if (!config || typeof config !== 'object') throw new TypeError('crafting config is required');
        for (const key of ['commandKey', 'entryMenuItemId']) {
            if (typeof config[key] !== 'string' || !config[key]) throw new Error(`crafting.${key} is required`);
        }
        for (const key of ['guiTimeoutMs', 'resultDelayMs']) {
            if (!Number.isFinite(config[key]) || config[key] < 0) throw new Error(`crafting.${key} must be a non-negative number`);
        }
        const entrySlot = config.entrySlot === undefined ? null : Number(config.entrySlot);
        if (entrySlot !== null && (!Number.isInteger(entrySlot) || entrySlot < 0)) throw new Error('crafting.entrySlot must be a non-negative integer when configured');
        return {
            ...config,
            entrySlot,
            openSettleMs: Number.isFinite(config.openSettleMs) && config.openSettleMs >= 0 ? config.openSettleMs : 150,
            recipeLearnAttempts: Number.isInteger(config.recipeLearnAttempts) && config.recipeLearnAttempts > 0 ? config.recipeLearnAttempts : 3,
            recipeLearnRetryMs: Number.isFinite(config.recipeLearnRetryMs) && config.recipeLearnRetryMs >= 0 ? config.recipeLearnRetryMs : 200,
            commandOpenAttempts: Number.isInteger(config.commandOpenAttempts) && config.commandOpenAttempts > 0 ? config.commandOpenAttempts : 3,
            commandOpenRetryMs: Number.isFinite(config.commandOpenRetryMs) && config.commandOpenRetryMs >= 0 ? config.commandOpenRetryMs : 600,
            commandCloseSettleMs: Number.isFinite(config.commandCloseSettleMs) && config.commandCloseSettleMs >= 0 ? config.commandCloseSettleMs : 350,
            resultVerifyAttempts: Number.isInteger(config.resultVerifyAttempts) && config.resultVerifyAttempts > 0 ? config.resultVerifyAttempts : 10,
            resultVerifyRetryMs: Number.isFinite(config.resultVerifyRetryMs) && config.resultVerifyRetryMs >= 0 ? config.resultVerifyRetryMs : 300,
            preQuantityClickTicks: Number.isInteger(config.preQuantityClickTicks) && config.preQuantityClickTicks >= 0 ? config.preQuantityClickTicks : 15,
            postQuantityClickTicks: Number.isInteger(config.postQuantityClickTicks) && config.postQuantityClickTicks >= 0 ? config.postQuantityClickTicks : 10
        };
    }
}

module.exports = CraftingOperation;
