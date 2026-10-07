'use strict';

const ProcedureContext = require('./ProcedureContext');
const QuantityStrategy = require('../quantity/QuantityStrategy');

/**
 * Procedure executor (G14) + reconciliation (G15).
 * Exact-quantity loop: requested/planned/executed/actual/remaining.
 * Each batch: BEFORE -> ACTION (procedure steps) -> OBSERVE -> AFTER -> VERIFY.
 * Uncertain mutation -> reconcile -> SUCCESS | NO_EFFECT | retry | terminal failure.
 * Success only when actual == requested and remaining == 0.
 */
class ProcedureExecutor {
  constructor({ recipeRegistry, procedureRegistry, quantityStrategy = null, logger = null } = {}) {
    if (!recipeRegistry) throw new TypeError('ProcedureExecutor recipeRegistry is required.');
    if (!procedureRegistry) throw new TypeError('ProcedureExecutor procedureRegistry is required.');
    this.recipeRegistry = recipeRegistry;
    this.procedureRegistry = procedureRegistry;
    this.quantity = quantityStrategy || new QuantityStrategy();
    this.logger = logger;
    Object.freeze(this);
  }

  /**
   * @param {string} recipeId
   * @param {number} requested positive integer
   * @param {object} handlers { readOutput, executeBatch, maxBatches }
   */
  async execute({ recipeId, requested, handlers = {}, options = {} } = {}) {
    if (!Number.isSafeInteger(requested) || requested <= 0) {
      throw new RangeError('requested must be a positive integer');
    }
    const recipe = this.recipeRegistry.require(recipeId);
    const procedureId = recipe.procedure || options.procedureId || 'minerals-crafting';
    const procedure = this.procedureRegistry.require(procedureId);
    const outputAmount = Math.max(1, Number(recipe.outputAmount || 1));
    const readOutput = handlers.readOutput || (async () => 0);
    const executeBatch = handlers.executeBatch || (async () => ({ actualCrafts: 0 }));

    const before = Math.max(0, Number(await readOutput()) || 0);
    let actual = 0;
    let executed = 0;
    let remaining = requested;
    const batches = [];
    const maxBatches = Math.max(1, Number(handlers.maxBatches || options.maxBatches || 10000));
    let status = 'COMPLETED';

    while (remaining > 0) {
      if (batches.length >= maxBatches) { status = 'BLOCKED'; break; }
      const plan = this.quantity.plan({
        requested, remaining, outputAmount,
        capabilities: { strategy: procedure.quantityStrategy, maxBatch: procedure.maxBatch }
      });
      if (!plan.length) { status = 'BLOCKED'; break; }
      const step = plan[0];
      const craftsWanted = step.batchAmount;
      const expectedOutput = craftsWanted * outputAmount;
      const context = new ProcedureContext({
        request: { amount: requested }, recipe, procedure,
        remaining, inventory: options.inventory || {}, gui: options.gui || {}
      });
      let batchResult;
      try {
        batchResult = await executeBatch({ crafts: craftsWanted, expectedOutput, context, procedure, recipe });
      } catch (error) {
        batches.push({ wanted: craftsWanted, actual: 0, status: 'ERROR', error: error?.code || error?.message });
        const reconciled = await this.#reconcile({ readOutput, before, actual });
        actual = reconciled; remaining = requested - actual;
        if (remaining <= 0) { status = 'COMPLETED'; break; }
        status = 'FAILED';
        break;
      }
      executed += craftsWanted;
      const verified = Math.max(0, Number(batchResult?.actualOutput ?? batchResult?.actualCrafts * outputAmount ?? 0) || 0);
      // Verify from fresh observation when provided.
      const observed = await this.#reconcile({ readOutput, before, actual });
      const delta = Math.max(0, observed - actual);
      const applied = batchResult?.verified === false ? 0 : Math.min(delta, expectedOutput);
      // ponytail: trust fresh read delta capped at expected; ceiling is one extra
      // read per batch, upgrade path is event-driven output evidence.
      if (applied > 0 || delta > 0) {
        actual = observed;
      } else if (verified > 0) {
        actual += verified;
      }
      context.actual = actual; context.executed = executed;
      batches.push({ wanted: craftsWanted, expectedOutput, actual: actual, status: applied > 0 || verified > 0 ? 'SUCCESS' : 'NO_EFFECT' });
      remaining = requested - actual;
      if (remaining <= 0) { status = 'COMPLETED'; break; }
      if (batches.length > 0 && batches.at(-1).status === 'NO_EFFECT') {
        const retry = await this.#reconcile({ readOutput, before, actual });
        if (retry > actual) { actual = retry; remaining = requested - actual; continue; }
        status = options.failOpen === true ? 'BLOCKED' : 'BLOCKED';
        break;
      }
    }

    return Object.freeze({
      recipeId, procedureId, requested,
      planned: requested, executed, actual, remaining: Math.max(0, requested - actual),
      status: remaining <= 0 ? 'COMPLETED' : status,
      outputAmount,
      batches: Object.freeze(batches)
    });
  }

  async #reconcile({ readOutput, before, actual }) {
    try {
      const current = Math.max(0, Number(await readOutput()) || 0);
      return Math.max(actual, current - before);
    } catch {
      return actual;
    }
  }
}

module.exports = ProcedureExecutor;
