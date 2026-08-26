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
        try {
            this.#captureBefore(state);
            await this.#navigateToQuantity(state);
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
        } catch (error) {
            if (error instanceof FlowError) throw error;
            throw FlowError.wrap(error, {
                code: error?.code || 'CRAFTING_STEP_FAILED', subsystem: 'crafting', operation: 'CraftingOperation',
                step: state.stage, action: this.#stageAction(state.stage, state.quantity), resource: state.recipe?.output || state.recipeId,
                details: { ...state.baseDetails, before: state.before?.countsBySource || null, gui: this.guiManager.describeCurrent?.() || null }
            });
        }
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

    async #navigateToQuantity(state) {
        const { recipeId, recipe, quantity, cancellationToken, expectedGeneration, operationContext, baseDetails } = state;
        state.stage = 'open-minerals-root';
        this.#trace('CRAFT OPEN /ks', state.stage, { recipeId, quantity, resource: recipe.output, phase: 'START' });
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
        state.stage = 'resolve-recipe-slot';
        const craftingSource = state.craftingSource;
        state.recipeSlot = await this.navigator.resolveRecipeSlotWithRetry(session, recipeId, recipe, craftingSource);
        this.#trace('CRAFT RECIPE RESOLVED', state.stage, { recipeId, resource: recipe.output, phase: 'OK', slot: state.recipeSlot });
        if (state.recipeSlot < 0) throw this.#flow('CRAFTING_RECIPE_NOT_FOUND', state.stage, 'resolve recipe slot', recipeId, { ...baseDetails, menuItemId: recipe.menuItemId, gui: this.guiManager.describeCurrent() });
        await this.#bindRecipeOutput(state, session);
        state.quantitySession = await this.#openQuantityMenu(state);
        state.stage = 'resolve-quantity';
        state.quantitySlot = await this.navigator.resolveQuantitySlot(state.quantitySession, quantity, state.quantitySource);
        this.#trace('CRAFT QUANTITY RESOLVED', state.stage, { recipeId, resource: recipe.output, quantity, phase: 'OK', slot: state.quantitySlot });
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
            return { roleId: `recipe:${id}`, bootstrapSlot: definition.menuSlot ?? null, logicalItemId: definition.menuItemId, context: 'crafting-menu' };
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

    async #clickQuantity(state) {
        state.stage = 'click-quantity';
        state.bot = this.support.requireBot();
        this.#trace('CRAFT PRE-CLICK DELAY', state.stage, { recipeId: state.recipeId, resource: state.recipe.output, quantity: state.quantity, phase: 'WAIT', ticks: this.config.preQuantityClickTicks, slot: state.quantitySlot });
        await state.bot.waitForTicks(this.config.preQuantityClickTicks);
        state.cancellationToken?.throwIfCancelled?.(); this.#assertGeneration(state.expectedGeneration);
        this.#trace('CRAFT CLICK QUANTITY', state.stage, { recipeId: state.recipeId, resource: state.recipe.output, quantity: state.quantity, phase: 'START', slot: state.quantitySlot });
        this.resultVerifier.arm?.(state.before); state.quantityClickedAt = Date.now();
        await this.guiManager.click(state.quantitySlot, { cancellationToken: state.cancellationToken, expectedGeneration: state.expectedGeneration });
        this.support.traceInventoryTimeline('after-click', state.quantityClickedAt, state.recipeId, state.recipe, state.effectiveInputSource, state.expectedGeneration);
        await this.#postClickWait(state);
        state.stage = 'close-quantity-menu';
        const closeResult = await this.support.closeQuantityWindowIfStillOpen(state.quantitySession, state.bot);
        this.#trace('CRAFT QUANTITY GUI CLOSED', state.stage, { recipeId: state.recipeId, resource: state.recipe.output, quantity: state.quantity, phase: 'OK', ...closeResult });
        this.#trace('CRAFT CLICK QUANTITY OK', 'click-quantity', { recipeId: state.recipeId, resource: state.recipe.output, quantity: state.quantity, phase: 'OK', slot: state.quantitySlot });
        this.support.traceInventoryTimeline('after-quantity-close', state.quantityClickedAt, state.recipeId, state.recipe, state.effectiveInputSource, state.expectedGeneration);
    }

    async #postClickWait(state) {
        this.#trace('CRAFT POST-CLICK DELAY', state.stage, { recipeId: state.recipeId, resource: state.recipe.output, quantity: state.quantity, phase: 'WAIT', ticks: this.config.postQuantityClickTicks, slot: state.quantitySlot });
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
        if (amount === 1 || amount === 64) return amount;
        if (typeof amount === 'string' && amount.trim().toUpperCase() === 'ALL') return 'ALL';
        throw this.#flow('CRAFTING_QUANTITY_INVALID', 'resolve-quantity', 'normalize crafting quantity', String(amount), {
            amount,
            supported: [1, 64, 'ALL']
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
            CRAFTING_QUANTITY_INVALID: `Unsupported crafting quantity: ${resource}.`
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
