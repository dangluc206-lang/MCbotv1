'use strict';

/**
 * Procedure Recorder foundation (G21).
 * Records logical intent, not raw slots: a raw `click slot 11` becomes
 * `select recipe "refined_iron"` when the slot resolves to a logical identity.
 * When logical identity cannot be resolved at record time, fallback metadata
 * (raw slot + window identity) is kept so the step can be learned/resolved later.
 * Raw slots never become the sole execution contract.
 */
class ProcedureRecorder {
  constructor({ resolveLogical = null } = {}) {
    // resolveLogical({ slot, windowId }) -> { itemId } | null
    this.resolveLogical = typeof resolveLogical === 'function' ? resolveLogical : null;
    this.events = [];
    Object.freeze(this);
  }

  record(event) {
    if (!event || typeof event !== 'object') throw new TypeError('recorded event must be an object');
    const normalized = this.#normalize(event);
    return { index: this.events.push(Object.freeze(normalized)) - 1, step: normalized };
  }

  toProcedure({ id, label = '', description = '' } = {}) {
    if (!String(id || '').trim()) throw new TypeError('procedure id is required');
    const steps = [];
    for (const event of this.events) {
      if (event.kind === 'command') steps.push({ type: 'command', commandKey: event.commandKey });
      else if (event.kind === 'select-recipe') steps.push({ type: 'find-logical-item', itemId: event.itemId });
      else if (event.kind === 'click') {
        steps.push(event.itemId
          ? { type: 'find-logical-item', itemId: event.itemId }
          : { type: 'find-slot', slot: event.slot, fallback: event.fallback || null });
      }
      else if (event.kind === 'wait') steps.push({ type: 'wait', ms: event.ms });
      else if (event.kind === 'verify') steps.push({ type: 'verify-quantity', amount: event.amount });
    }
    return { id: String(id).trim(), label: label || String(id).trim(), description, steps };
  }

  #normalize(event) {
    const kind = String(event.kind || '').trim();
    if (kind === 'command') {
      if (!String(event.commandKey || '').trim()) throw new TypeError('command event needs commandKey');
      return { kind, commandKey: String(event.commandKey).trim() };
    }
    if (kind === 'click') {
      const slot = Number(event.slot);
      if (!Number.isInteger(slot) || slot < 0) throw new TypeError('click event needs a slot');
      const logical = this.resolveLogical?.({ slot, windowId: event.windowId || null }) || null;
      if (logical?.itemId) return { kind: 'select-recipe', slot, itemId: String(logical.itemId), windowId: event.windowId || null };
      // ponytail: unresolved clicks keep slot+window as learn-later metadata;
      // ceiling is one manual resolution pass, upgrade path is GuiKnowledge binding.
      return { kind, slot, windowId: event.windowId || null, fallback: { slot, windowId: event.windowId || null } };
    }
    if (kind === 'wait') return { kind, ms: Math.max(0, Number(event.ms || 0)) };
    if (kind === 'verify') return { kind, amount: event.amount };
    throw new TypeError(`Unsupported record event kind: ${kind}.`);
  }
}

module.exports = ProcedureRecorder;
