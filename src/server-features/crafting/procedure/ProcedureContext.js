'use strict';

/**
 * Dynamic execution context (G9).
 * Carries requested/recipe/output/remaining + inventory/GUI/progress.
 * Template: $request.amount, $recipe.output, $recipe.outputAmount, $execution.remaining
 */
class ProcedureContext {
  constructor({ request, recipe, procedure, remaining, inventory = {}, gui = {}, progress = {} } = {}) {
    if (!request) throw new TypeError('ProcedureContext request is required.');
    if (!recipe) throw new TypeError('ProcedureContext recipe is required.');
    this.request = Object.freeze({ ...request });
    this.recipe = Object.freeze({ ...recipe });
    this.procedure = Object.freeze({ ...(procedure || {}) });
    this.remaining = remaining;
    this.inventory = { ...inventory };
    this.gui = { ...gui };
    this.progress = { ...progress };
    this.executed = 0;
    this.actual = 0;
  }

  resolve(value) {
    if (typeof value !== 'string') return value;
    return value
      .replaceAll('$request.amount', String(this.request.amount ?? this.request.quantity ?? ''))
      .replaceAll('$recipe.outputAmount', String(this.recipe.outputAmount ?? 1))
      .replaceAll('$recipe.output', String(this.recipe.output ?? ''))
      .replaceAll('$execution.remaining', String(this.remaining ?? ''));
  }

  snapshot() {
    return Object.freeze({
      requested: Number(this.request.amount ?? this.request.quantity ?? 0),
      remaining: Number(this.remaining || 0),
      executed: Number(this.executed || 0),
      actual: Number(this.actual || 0),
      output: this.recipe.output || null,
      outputAmount: Number(this.recipe.outputAmount || 1)
    });
  }
}

module.exports = ProcedureContext;
