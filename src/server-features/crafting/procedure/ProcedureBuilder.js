'use strict';

const ProcedureRegistry = require('./ProcedureRegistry');

/**
 * Procedure Builder foundation (G20).
 * Uses the exact runtime definition schema (ProcedureRegistry STEP_TYPES):
 * add / edit / remove / reorder steps, edit parameters, validate, save.
 * A saved procedure validates and the runtime can execute it without changes.
 */
class ProcedureBuilder {
  constructor({ id, label = '', description = '', quantityStrategy = 'button-batch', maxBatch = 64 } = {}) {
    if (!String(id || '').trim()) throw new TypeError('ProcedureBuilder id is required.');
    this.id = String(id).trim();
    this.label = label;
    this.description = description;
    this.quantityStrategy = quantityStrategy;
    this.maxBatch = maxBatch;
    this.steps = [];
  }

  static fromDefinition(definition) {
    const normalized = new ProcedureRegistry({ tmp: definition }).get('tmp');
    const builder = new ProcedureBuilder({
      id: normalized.id, label: normalized.label, description: normalized.description,
      quantityStrategy: normalized.quantityStrategy, maxBatch: normalized.maxBatch
    });
    builder.steps = normalized.steps.map(step => ({ ...step }));
    return builder;
  }

  addStep(step) {
    ProcedureBuilder.assertStepType(step?.type);
    this.steps.push({ ...(step || {}) });
    return this.steps.length - 1;
  }

  editStep(index, patch) {
    this.#assertIndex(index);
    const next = { ...this.steps[index], ...(patch || {}) };
    ProcedureBuilder.assertStepType(next.type);
    this.steps[index] = next;
    return this.steps[index];
  }

  removeStep(index) {
    this.#assertIndex(index);
    this.steps.splice(index, 1);
    return this;
  }

  moveStep(from, to) {
    this.#assertIndex(from);
    if (!Number.isInteger(to) || to < 0 || to >= this.steps.length) throw new RangeError('move target is out of range');
    const [step] = this.steps.splice(from, 1);
    this.steps.splice(to, 0, step);
    return this;
  }

  setMeta({ label, description, quantityStrategy, maxBatch } = {}) {
    if (label !== undefined) this.label = String(label);
    if (description !== undefined) this.description = String(description);
    if (quantityStrategy !== undefined) this.quantityStrategy = quantityStrategy;
    if (maxBatch !== undefined) this.maxBatch = maxBatch;
    return this;
  }

  validate() {
    return new ProcedureRegistry({ [this.id]: this.toDefinition() }).require(this.id);
  }

  toDefinition() {
    return {
      label: this.label || this.id,
      description: this.description || '',
      quantityStrategy: this.quantityStrategy,
      maxBatch: this.maxBatch,
      steps: this.steps.map(step => ({ ...step }))
    };
  }

  save(registry) {
    if (!registry || typeof registry.register !== 'function') throw new TypeError('ProcedureBuilder.save requires a ProcedureRegistry.');
    return registry.register(this.id, this.toDefinition());
  }

  static assertStepType(type) {
    if (!ProcedureRegistry.STEP_TYPES.includes(String(type || '').trim())) {
      throw new TypeError(`Unsupported procedure step type: ${type}.`);
    }
  }

  #assertIndex(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.steps.length) throw new RangeError('step index out of range');
  }
}

module.exports = ProcedureBuilder;
