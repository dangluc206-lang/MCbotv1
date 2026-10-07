'use strict';

/**
 * Generic quantity strategy (G11).
 * Decides execution batches for an exact-quantity request.
 * Pure, no side effects. Batching lives here, never in CraftingPlanner.
 *
 * Strategies:
 * - button-batch: server exposes discrete buttons (e.g. 1/64). Any positive
 *   remainder is built from 1s, so 65/127/137/1000 stay exact.
 * - repeat: repeat single-unit action N times.
 * - command-quantity: single action carries the full amount.
 * - custom: caller-supplied maxBatch.
 */
class QuantityStrategy {
  constructor({ strategy = 'button-batch', maxBatch = 64, buttons = [64, 1] } = {}) {
    this.strategy = strategy;
    this.maxBatch = Math.max(1, Math.floor(Number(maxBatch) || 64));
    this.buttons = Object.freeze([...buttons].filter(n => Number.isInteger(n) && n > 0).sort((a, b) => b - a));
    Object.freeze(this);
  }

  /**
   * @returns {{ batchAmount:number, action:string, expectedOutput:number }[]}
   */
  plan({ requested, remaining, outputAmount = 1, capabilities = {} } = {}) {
    const need = Math.max(0, Number(remaining ?? requested ?? 0));
    if (!Number.isSafeInteger(need) || need < 0) throw new RangeError('remaining must be a non-negative safe integer');
    const out = Math.max(1, Number(outputAmount) || 1);
    const strategy = capabilities.strategy || this.strategy;
    const maxBatch = Math.max(1, Math.floor(Number(capabilities.maxBatch ?? this.maxBatch) || 64));

    if (need === 0) return [];
    if (strategy === 'command-quantity') {
      const crafts = Math.ceil(need / out);
      return [Object.freeze({ batchAmount: crafts, action: 'command-quantity', expectedOutput: crafts * out })];
    }
    // button-batch / repeat / custom: decompose crafts into batches.
    // crafts = ceil(need / outputAmount); remainder crafts are exact.
    const crafts = Math.ceil(need / out);
    const batches = [];
    let left = crafts;
    const buttons = (capabilities.buttons || this.buttons).filter(n => n <= maxBatch);
    const smallest = buttons.length ? Math.min(...buttons) : 1;
    while (left > 0) {
      let picked = null;
      for (const b of buttons) {
        if (b <= left && (b <= maxBatch)) { picked = b; break; }
      }
      if (picked === null) picked = Math.min(smallest, left);
      // ponytail: greedy over sorted-desc buttons is exact because 1 is always
      // available as fallback; ceiling is maxBatch clicks per craft batch.
      batches.push(Object.freeze({
        batchAmount: picked,
        action: picked === 1 ? 'craft-one' : `craft-${picked}`,
        expectedOutput: picked * out
      }));
      left -= picked;
    }
    return Object.freeze(batches);
  }

  static planBatches(crafts, { maxBatch = 64 } = {}) {
    if (!Number.isSafeInteger(crafts) || crafts < 0) throw new RangeError('crafts must be a non-negative safe integer');
    const cap = Math.max(1, Math.floor(Number(maxBatch) || 64));
    const out = [];
    let left = crafts;
    while (left >= cap) { out.push(cap); left -= cap; }
    while (left > 0) { out.push(1); left -= 1; }
    return Object.freeze(out);
  }
}

module.exports = QuantityStrategy;
