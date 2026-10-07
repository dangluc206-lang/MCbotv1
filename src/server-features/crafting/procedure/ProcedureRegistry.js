'use strict';

/**
 * Generic procedure registry (G13).
 * Procedure = HOW. Recipe references procedure by id.
 * Definition shape: { id, label, description, steps: [{ type, params }] }
 * Supported step types (subset reused from workflow primitives + crafting):
 * command, open-gui, resolve-gui, find-logical-item, find-slot, click,
 * wait, wait-for-transition, wait-for-message, wait-for-gui, wait-for-output,
 * close-gui, verify-item, verify-quantity
 */
const STEP_TYPES = Object.freeze([
  'command', 'slash-command', 'open-gui', 'resolve-gui',
  'find-logical-item', 'find-slot', 'click', 'wait',
  'wait-for-transition', 'wait-for-message', 'wait-for-gui',
  'wait-for-output', 'close-gui', 'verify-item', 'verify-quantity'
]);

class ProcedureRegistry {
  constructor(procedures = {}) {
    this.procedures = new Map();
    for (const [id, def] of Object.entries(procedures || {})) {
      this.register(id, def);
    }
    Object.freeze(this);
  }

  register(id, definition) {
    const key = String(id || '').trim();
    if (!key) throw new TypeError('Procedure id is required.');
    const normalized = normalize(key, definition);
    this.procedures.set(key, Object.freeze(normalized));
    return this.procedures.get(key);
  }

  get(id) {
    const key = String(id || '').trim();
    const value = this.procedures.get(key);
    return value ? JSON.parse(JSON.stringify(value)) : null;
  }

  require(id) {
    const value = this.get(id);
    if (!value) throw new Error(`Procedure not found: ${id}`);
    return value;
  }

  ids() { return [...this.procedures.keys()]; }

  static STEP_TYPES = STEP_TYPES;
}

function normalize(id, def) {
  if (!def || typeof def !== 'object') throw new TypeError(`Procedure ${id} must be an object.`);
  const steps = Array.isArray(def.steps) ? def.steps : [];
  if (!steps.length) throw new TypeError(`Procedure ${id} must declare at least one step.`);
  const normalizedSteps = steps.map((step, index) => normalizeStep(id, step, index));
  return {
    id,
    label: String(def.label || id),
    description: String(def.description || ''),
    quantityStrategy: def.quantityStrategy || 'button-batch',
    maxBatch: Number.isInteger(def.maxBatch) && def.maxBatch > 0 ? def.maxBatch : 64,
    steps: normalizedSteps
  };
}

function normalizeStep(procId, step, index) {
  if (!step || typeof step !== 'object') throw new TypeError(`Procedure ${procId} step ${index} must be an object.`);
  const type = String(step.type || '').trim();
  if (!STEP_TYPES.includes(type)) throw new TypeError(`Procedure ${procId} step ${index} has unsupported type: ${type}.`);
  return Object.freeze({ type, ...(step.params && typeof step.params === 'object' ? { params: { ...step.params } } : {}), ...(step.commandKey ? { commandKey: step.commandKey } : {}), ...(step.guiId ? { guiId: step.guiId } : {}), ...(step.itemId ? { itemId: step.itemId } : {}), ...(step.slot !== undefined ? { slot: step.slot } : {}), ...(step.amount !== undefined ? { amount: step.amount } : {}), ...(step.ms !== undefined ? { ms: step.ms } : {}), ...(step.timeoutMs !== undefined ? { timeoutMs: step.timeoutMs } : {}) });
}

module.exports = ProcedureRegistry;
