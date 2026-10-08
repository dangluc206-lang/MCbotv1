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
        if (type === 'command' || type === 'slash-command') return this.stepCommand(step, state, { procedure, recipe, resolved });
        if (type === 'open-gui') return this.stepOpenGui(step, state, { recipe, resolved });
        if (type === 'resolve-gui' || type === 'wait-for-gui') return this.stepWaitGui(step, state, { resolved });
        if (type === 'find-logical-item') return this.stepFind(step, state, { recipe, resolved });
        if (type === 'click') return this.stepClick(step, state, { options });
        if (type === 'find-slot') {
            const slot = Number(resolved.slot ?? step.slot);
            if (Number.isInteger(slot) && slot >= 0) state.foundSlot = slot;
            return state;
        }
        if (type === 'wait' || type === 'wait-for-transition') {
            const ms = Math.max(0, Number(resolved.ms ?? step.ms ?? 0));
            if (ms > 0) await Timeout.delay(ms, { cancellationToken: state.cancellationToken });
            return state;
        }
        if (type === 'wait-for-message' || type === 'wait-for-output' || type === 'verify-item' || type === 'verify-quantity' || type === 'close-gui') return state;
        throw this.fail(state, 'CRAFTING_PROCEDURE_STEP_UNSUPPORTED', 'run-procedure-step', 'run step', recipe?.output, { step });
    }
    async stepCommand(step, state, { procedure, recipe, resolved }) {
        const key = String(resolved.commandKey || step.commandKey || recipe.commandKey || '').trim();
        if (!key) throw this.fail(state, 'CRAFTING_PROCEDURE_COMMAND_MISSING', 'run-procedure-step', 'resolve command', recipe?.output, { step });
        const sent = await this.commandService.send(key, {
            confirm: false, cancellationToken: state.cancellationToken, expectedGeneration: state.expectedGeneration,
            operationId: state.operationContext?.operationId || null, correlationId: state.operationContext?.correlationId || null
        });
        if (sent?.success === false) throw sent.error || new Error('Procedure command failed: ' + key + '.');
        state.commandResult = sent?.data ?? sent;
        return state;
    }
    async stepOpenGui(step, state, { recipe, resolved }) {
        if (state.commandResult && !state.session) {
            const cur = this.guiManager.syncCurrentWindow?.() || this.guiManager.current?.();
            if (cur?.active || cur?.window) { state.session = cur; return state; }
        }
        if (!state.session && typeof this.navigator.openRoot === 'function') {
            const src = { commandKey: recipe.commandKey || resolved.commandKey || null, guiId: resolved.guiId || null };
            state.session = await this.navigator.openRoot(src, {
                cancellationToken: state.cancellationToken, expectedGeneration: state.expectedGeneration, operationContext: state.operationContext
            });
            return state;
        }
        if (!state.session) state.session = this.guiManager.syncCurrentWindow?.() || this.guiManager.current?.() || null;
        return state;
    }
    async stepWaitGui(step, state, { resolved }) {
        if (state.session?.active || state.session?.window) {
            if (resolved.guiId && typeof this.navigator.assertGuiIdentity === 'function') this.navigator.assertGuiIdentity(state.session, resolved.guiId, 'run-procedure-step', {});
            return state;
        }
        const waited = await this.guiManager.waitFor?.(resolved.guiId || null, 5000, state.cancellationToken, state.expectedGeneration).catch(() => null);
        if (waited) state.session = waited;
        return state;
    }
    async stepFind(step, state, { recipe, resolved }) {
        const itemId = String(resolved.itemId || '').trim();
        if (itemId && state.session) {
            const entryId = String(state.config?.entryMenuItemId || '').trim();
            if (entryId && itemId === entryId && typeof this.navigator.resolveEntrySlot === 'function') {
                state.entrySlot = await this.navigator.resolveEntrySlot(state.session, { guiId: state.session?.definitionId || null });
                return state;
            }
            if (typeof this.navigator.resolveRecipeSlot === 'function') {
                state.recipeSlot = await this.navigator.resolveRecipeSlot(state.session, recipe.id || recipe.output, recipe, { guiId: state.session?.definitionId || null });
            }
        }
        return state;
    }
    async stepClick(step, state, { options }) {
        if (!state.session) return state;
        const timeoutMs = Number(options?.config?.guiTimeoutMs || 5000);
        const settleMs = Number(options?.config?.openSettleMs || 0);
        if (state.entrySlot !== null && state.entrySlot !== undefined && !state.enteredMenu) {
            state.session = await this.guiManager.clickAndWaitForTransition?.(state.entrySlot, {
                timeoutMs, cancellationToken: state.cancellationToken, expectedGeneration: state.expectedGeneration,
                label: 'procedure click entry', source: { guiId: null }, settleMs
            }) || state.session;
            state.enteredMenu = true;
            return state;
        }
        if (state.recipeSlot !== null && state.recipeSlot !== undefined && !state.selectedRecipe) {
            state.session = await this.guiManager.clickAndWaitForTransition?.(state.recipeSlot, {
                timeoutMs, cancellationToken: state.cancellationToken, expectedGeneration: state.expectedGeneration,
                label: 'procedure click recipe', source: { guiId: null }, settleMs
            }) || state.session;
            state.selectedRecipe = true;
            return state;
        }
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
        if (typeof state.flow === 'function') return state.flow(code, stepName, action, resource, details || {});
        return new FlowError(code + ' for ' + (resource || 'crafting') + '.', {
            code, subsystem: 'crafting', operation: 'CraftingProcedureRuntime', step: stepName, action, resource, details: details || {}
        });
    }
}
module.exports = CraftingProcedureRuntime;
