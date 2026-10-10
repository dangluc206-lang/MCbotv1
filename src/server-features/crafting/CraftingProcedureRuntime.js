'use strict';
const Timeout = require('../../shared/time/Timeout');
const FlowError = require('../../shared/errors/FlowError');
const ProcedureContext = require('./procedure/ProcedureContext');

// ACT-G14.1: procedure primitives -> capability owners.
// command -> CommandService; open/wait/click -> GuiManager;
// find -> CraftingGuiNavigator; verify/close -> operation.
class CraftingProcedureRuntime {
    constructor({ commandService, guiManager, navigator, logger = null } = {}) {
        if (!commandService) throw new TypeError('CraftingProcedureRuntime commandService is required.');
        if (!guiManager) throw new TypeError('CraftingProcedureRuntime guiManager is required.');
        if (!navigator) throw new TypeError('CraftingProcedureRuntime navigator is required.');
        Object.assign(this, { commandService, guiManager, navigator, logger });
    }
    async runBatch({ procedure, recipe, request, execution, options = {} } = {}) {
        if (!procedure?.steps?.length) throw new TypeError('CraftingProcedureRuntime procedure steps are required.');
        if (!recipe) throw new TypeError('CraftingProcedureRuntime recipe is required.');
        const context = new ProcedureContext({
            request: { amount: request?.amount ?? execution?.requested },
            recipe, procedure: { id: procedure.id },
            remaining: execution?.remaining ?? execution?.requested,
            inventory: options.inventory || {}, gui: options.gui || {}
        });
        context.executed = Number(execution?.executed || 0);
        context.actual = Number(execution?.actual || 0);
        const state = {
            context, session: null, entrySlot: null, recipeSlot: null, foundSlot: null,
            enteredMenu: false, selectedRecipe: false, commandResult: null,
            trace: options.trace || (() => {}), flow: options.flow || null,
            cancellationToken: options.cancellationToken || null,
            expectedGeneration: options.expectedGeneration ?? null,
            operationContext: options.operationContext || null,
            config: options.config || {}
        };
        for (const step of procedure.steps) {
            state.cancellationToken?.throwIfCancelled?.();
            await this.runStep(step, state, { procedure, recipe, execution, options });
        }
        return state;
    }
    async runStep(step, state, { procedure, recipe, options } = {}) {
        const type = String(step?.type || '').trim();
        const resolved = this.resolveParams(step, state);
        state.cancellationToken?.throwIfCancelled?.();
        this.#assertGeneration(state);
        if (type === 'command' || type === 'slash-command') return this.stepCommand(step, state, { procedure, recipe, resolved });
        if (type === 'open-gui') return this.stepOpenGui(step, state, { recipe, resolved });
        if (type === 'resolve-gui' || type === 'wait-for-gui') return this.stepWaitGui(step, state, { resolved });
        if (type === 'find-logical-item') return this.stepFind(step, state, { recipe, resolved });
        if (type === 'click') return this.stepClick(step, state, { options });
        if (type === 'find-slot') {
            const slot = Number(resolved.slot ?? step.slot);
            if (!Number.isInteger(slot) || slot < 0) throw this.fail(state, 'CRAFTING_PROCEDURE_SLOT_INVALID', 'run-procedure-step', 'resolve slot', recipe?.output, { step });
            state.foundSlot = slot;
            return state;
        }
        if (type === 'wait' || type === 'wait-for-transition') {
            const ms = Math.max(0, Number(resolved.ms ?? step.ms ?? 0));
            if (ms > 0) await Timeout.delay(ms, { cancellationToken: state.cancellationToken });
            this.#assertGeneration(state);
            return state;
        }
        // Verification / output settlement / close belong to the operation owner
        // (CraftingOperation quantity click + CraftingVerificationCoordinator).
        // The runtime never reports them as done without evidence.
        if (type === 'wait-for-output' || type === 'verify-item' || type === 'verify-quantity') {
            throw this.fail(state, 'CRAFTING_PROCEDURE_STEP_NOT_OWNED', 'run-procedure-step', 'defer verification to operation', recipe?.output, { step, owner: 'CraftingOperation' });
        }
        if (type === 'close-gui') return this.stepCloseGui(step, state);
        if (type === 'wait-for-message') {
            throw this.fail(state, 'CRAFTING_PROCEDURE_STEP_UNSUPPORTED', 'run-procedure-step', 'run step', recipe?.output, { step });
        }
        throw this.fail(state, 'CRAFTING_PROCEDURE_STEP_UNSUPPORTED', 'run-procedure-step', 'run step', recipe?.output, { step });
    }
    async stepCommand(step, state, { procedure, recipe, resolved }) {
        const key = String(resolved.commandKey || step.commandKey || recipe.commandKey || '').trim();
        if (!key) throw this.fail(state, 'CRAFTING_PROCEDURE_COMMAND_MISSING', 'run-procedure-step', 'resolve command', recipe?.output, { step });
        state.cancellationToken?.throwIfCancelled?.();
        this.#assertGeneration(state);
        const sent = await this.commandService.send(key, {
            confirm: false, cancellationToken: state.cancellationToken, expectedGeneration: state.expectedGeneration,
            operationId: state.operationContext?.operationId || null, correlationId: state.operationContext?.correlationId || null
        });
        this.#assertGeneration(state);
        if (sent?.success === false) throw this.fail(state, sent?.error?.code || 'CRAFTING_PROCEDURE_COMMAND_FAILED', 'run-procedure-step', `send /${key}`, recipe?.output, { step, error: sent?.error?.message || sent?.message || null });
        // Command send is not success: reconcile the observable GUI before claiming progress.
        const cur = this.guiManager.syncCurrentWindow?.() || this.guiManager.current?.() || null;
        if (cur?.active || cur?.window) state.session = cur;
        state.commandResult = sent?.data ?? sent;
        return state;
    }
    async stepOpenGui(step, state, { recipe, resolved }) {
        state.cancellationToken?.throwIfCancelled?.();
        this.#assertGeneration(state);
        const cur = this.guiManager.syncCurrentWindow?.() || this.guiManager.current?.() || null;
        if (cur?.active || cur?.window) {
            state.session = cur;
            if (resolved.guiId && typeof this.navigator.assertGuiIdentity === 'function') {
                this.navigator.assertGuiIdentity(state.session, resolved.guiId, 'run-procedure-step', {});
            }
            return state;
        }
        const openRoot = typeof this.navigator.openMineralsRoot === 'function'
            ? this.navigator.openMineralsRoot.bind(this.navigator)
            : (typeof this.navigator.openRoot === 'function' ? this.navigator.openRoot.bind(this.navigator) : null);
        if (openRoot) {
            const src = {
                commandKey: recipe?.commandKey || resolved.commandKey || state.config?.commandKey || null,
                command: recipe?.commandKey || resolved.commandKey || state.config?.commandKey || null,
                guiId: resolved.guiId || null, clicks: [], actions: [], source: 'procedure'
            };
            state.session = await openRoot(src, {
                cancellationToken: state.cancellationToken, expectedGeneration: state.expectedGeneration, operationContext: state.operationContext
            });
            this.#assertGeneration(state);
            if (!state.session?.window) throw this.fail(state, 'CRAFTING_PROCEDURE_GUI_NOT_OPEN', 'run-procedure-step', 'open GUI', recipe?.output, { step, guiId: resolved.guiId || null });
            if (resolved.guiId && typeof this.navigator.assertGuiIdentity === 'function') {
                this.navigator.assertGuiIdentity(state.session, resolved.guiId, 'run-procedure-step', {});
            }
            return state;
        }
        state.session = cur;
        if (!state.session?.window) throw this.fail(state, 'CRAFTING_PROCEDURE_GUI_NOT_OPEN', 'run-procedure-step', 'open GUI', recipe?.output, { step, guiId: resolved.guiId || null });
        return state;
    }
    async stepWaitGui(step, state, { resolved }) {
        state.cancellationToken?.throwIfCancelled?.();
        this.#assertGeneration(state);
        const timeoutMs = Math.max(1, Number(state.config?.guiTimeoutMs || 5000));
        if (state.session?.active || state.session?.window) {
            if (resolved.guiId && typeof this.navigator.assertGuiIdentity === 'function') this.navigator.assertGuiIdentity(state.session, resolved.guiId, 'run-procedure-step', {});
            return state;
        }
        if (typeof this.guiManager.waitFor === 'function') {
            const waited = await this.guiManager.waitFor(resolved.guiId || null, timeoutMs, state.cancellationToken, state.expectedGeneration);
            this.#assertGeneration(state);
            if (!waited?.window) throw this.fail(state, 'CRAFTING_PROCEDURE_GUI_NOT_OPEN', 'run-procedure-step', 'wait GUI', null, { step });
            state.session = waited;
            return state;
        }
        const synced = this.guiManager.syncCurrentWindow?.() || this.guiManager.current?.() || null;
        if (synced?.window) {
            state.session = synced;
            if (resolved.guiId && typeof this.navigator.assertGuiIdentity === 'function') this.navigator.assertGuiIdentity(state.session, resolved.guiId, 'run-procedure-step', {});
            return state;
        }
        throw this.fail(state, 'CRAFTING_PROCEDURE_GUI_NOT_OPEN', 'run-procedure-step', 'wait GUI', null, { step });
    }
    async stepFind(step, state, { recipe, resolved }) {
        state.cancellationToken?.throwIfCancelled?.();
        this.#assertGeneration(state);
        const itemId = String(resolved.itemId || '').trim();
        if (!itemId) throw this.fail(state, 'CRAFTING_PROCEDURE_ITEM_MISSING', 'run-procedure-step', 'resolve logical item', recipe?.output, { step });
        if (!state.session?.window) throw this.fail(state, 'CRAFTING_PROCEDURE_GUI_NOT_OPEN', 'run-procedure-step', 'find ' + itemId, recipe?.output, { step });
        // G21.1: recorded quantity buttons (quantity:<amount>) resolve through
        // the quantity resolver — the same capability the production quantity
        // phase uses — never through the recipe-slot path.
        const quantityMatch = /^quantity:(\d+|ALL)$/i.exec(itemId);
        if (quantityMatch) {
            const amount = /^ALL$/i.test(quantityMatch[1]) ? 'ALL' : Number(quantityMatch[1]);
            if (typeof this.navigator.resolveQuantitySlot !== 'function') throw this.fail(state, 'CRAFTING_PROCEDURE_RESOLVE_UNAVAILABLE', 'run-procedure-step', 'find ' + itemId, recipe?.output, { step });
            state.foundSlot = await this.navigator.resolveQuantitySlot(state.session, amount, { guiId: state.session?.definitionId || null });
            this.#assertGeneration(state);
            if (!Number.isInteger(state.foundSlot) || state.foundSlot < 0) throw this.fail(state, 'CRAFTING_QUANTITY_NOT_FOUND', 'run-procedure-step', 'find ' + itemId, itemId, { step });
            return state;
        }
        const entryId = String(state.config?.entryMenuItemId || '').trim();
        if (entryId && itemId === entryId) {
            if (typeof this.navigator.resolveEntrySlot !== 'function') throw this.fail(state, 'CRAFTING_PROCEDURE_RESOLVE_UNAVAILABLE', 'run-procedure-step', 'find ' + itemId, recipe?.output, { step });
            state.entrySlot = await this.navigator.resolveEntrySlot(state.session, { guiId: state.session?.definitionId || null });
            this.#assertGeneration(state);
            if (!Number.isInteger(state.entrySlot) || state.entrySlot < 0) throw this.fail(state, 'CRAFTING_ENTRY_NOT_FOUND', 'run-procedure-step', 'find ' + itemId, itemId, { step });
            return state;
        }
        // G21.1: any other logical target resolves through GUI knowledge when
        // the navigator exposes it (fail-closed when it cannot be resolved —
        // never silently re-routed to the recipe slot).
        if (typeof this.navigator.resolveLogicalSlot === 'function') {
            state.foundSlot = await this.navigator.resolveLogicalSlot(state.session, itemId, { guiId: state.session?.definitionId || null });
            this.#assertGeneration(state);
            if (!Number.isInteger(state.foundSlot) || state.foundSlot < 0) throw this.fail(state, 'CRAFTING_PROCEDURE_TARGET_NOT_FOUND', 'run-procedure-step', 'find ' + itemId, itemId, { step });
            return state;
        }
        if (typeof this.navigator.resolveRecipeSlot !== 'function') throw this.fail(state, 'CRAFTING_PROCEDURE_RESOLVE_UNAVAILABLE', 'run-procedure-step', 'find ' + itemId, recipe?.output, { step });
        state.recipeSlot = await this.navigator.resolveRecipeSlot(state.session, recipe?.id || recipe?.output, recipe, { guiId: state.session?.definitionId || null });
        this.#assertGeneration(state);
        if (!Number.isInteger(state.recipeSlot) || state.recipeSlot < 0) throw this.fail(state, 'CRAFTING_RECIPE_NOT_FOUND', 'run-procedure-step', 'find ' + itemId, itemId, { step });
        return state;
    }
    async stepClick(step, state, { options }) {
        state.cancellationToken?.throwIfCancelled?.();
        this.#assertGeneration(state);
        if (!state.session?.window) throw this.fail(state, 'CRAFTING_PROCEDURE_GUI_NOT_OPEN', 'run-procedure-step', 'click', null, { step });
        if (typeof this.guiManager.clickAndWaitForTransition !== 'function') throw this.fail(state, 'CRAFTING_PROCEDURE_CLICK_UNAVAILABLE', 'run-procedure-step', 'click', null, { step });
        const timeoutMs = Math.max(1, Number(options?.config?.guiTimeoutMs || state.config?.guiTimeoutMs || 5000));
        const settleMs = Math.max(0, Number(options?.config?.openSettleMs ?? state.config?.openSettleMs ?? 0));
        const slot = Number.isInteger(state.foundSlot) && state.foundSlot >= 0 ? state.foundSlot
            : (!state.enteredMenu && Number.isInteger(state.entrySlot) && state.entrySlot >= 0 ? state.entrySlot
            : (!state.selectedRecipe && Number.isInteger(state.recipeSlot) && state.recipeSlot >= 0 ? state.recipeSlot : null));
        if (!Number.isInteger(slot) || slot < 0) throw this.fail(state, 'CRAFTING_PROCEDURE_CLICK_SLOT_MISSING', 'run-procedure-step', 'click without resolved slot', null, { step });
        const isEntry = slot === state.entrySlot && !state.enteredMenu;
        const isRecipe = !isEntry && slot === state.recipeSlot && !state.selectedRecipe;
        state.session = await this.guiManager.clickAndWaitForTransition(slot, {
            timeoutMs, cancellationToken: state.cancellationToken, expectedGeneration: state.expectedGeneration,
            label: 'procedure click slot ' + slot, source: { guiId: state.session?.definitionId || null }, settleMs
        });
        this.#assertGeneration(state);
        if (!state.session?.window) throw this.fail(state, 'CRAFTING_PROCEDURE_TRANSITION_FAILED', 'run-procedure-step', 'click slot ' + slot, null, { step, slot });
        if (isEntry) state.enteredMenu = true;
        if (isRecipe) state.selectedRecipe = true;
        state.foundSlot = null;
        return state;
    }
    async stepCloseGui(step, state) {
        state.cancellationToken?.throwIfCancelled?.();
        this.#assertGeneration(state);
        const current = this.guiManager.syncCurrentWindow?.() || this.guiManager.current?.() || null;
        if (!current?.window && !current?.active) {
            state.session = null;
            return state;
        }
        if (typeof this.guiManager.closeCurrentWindow !== 'function') throw this.fail(state, 'CRAFTING_QUANTITY_GUI_CLOSE_UNAVAILABLE', 'run-procedure-step', 'close GUI', null, { step });
        await this.guiManager.closeCurrentWindow();
        this.#assertGeneration(state);
        const after = this.guiManager.syncCurrentWindow?.() || this.guiManager.current?.() || null;
        state.session = after?.window ? after : null;
        return state;
    }
    resolveParams(step, state) {
        const out = {};
        for (const [key, value] of Object.entries(step || {})) {
            if (key === 'type') continue;
            out[key] = typeof value === 'string' ? state.context.resolve(value) : value;
        }
        const params = step?.params && typeof step.params === 'object' ? step.params : {};
        for (const [k, v] of Object.entries(params)) {
            if (out[k] === undefined) out[k] = typeof v === 'string' ? state.context.resolve(v) : v;
        }
        return out;
    }
    fail(state, code, stepName, action, resource, details) {
        if (typeof state.flow === 'function') throw state.flow(code, stepName, action, resource, details || {});
        throw new FlowError(code + ' for ' + (resource || 'crafting') + '.', {
            code, subsystem: 'crafting', operation: 'CraftingProcedureRuntime', step: stepName, action, resource, details: details || {}
        });
    }
    #assertGeneration(state) {
        const expected = state?.expectedGeneration;
        if (expected === null || expected === undefined) return;
        const current = Number(state?.operationContext?.connectionGeneration ?? NaN);
        if (Number.isFinite(current) && current !== Number(expected)) {
            throw new FlowError('Procedure step belongs to a stale connection generation.', {
                code: 'GUI_STALE_GENERATION', subsystem: 'crafting', operation: 'CraftingProcedureRuntime',
                step: 'run-procedure-step', retryable: true,
                details: { expectedGeneration: Number(expected), currentGeneration: current }
            });
        }
    }
}
module.exports = CraftingProcedureRuntime;
