'use strict';

const ProcedureRegistry = require('./ProcedureRegistry');

/**
 * Procedure Recorder (G21).
 * Records logical intent, not raw slots: a raw `click slot 11` becomes
 * `find-logical-item "refined_iron"` when the slot resolves to a logical
 * identity through the injected resolver (GUI knowledge / item registry).
 *
 * Contracts enforced here:
 * - Identity is normalized at record time whenever it can be, so the recorder
 *   never depends absolutely on one session's recording (roadmap G21).
 * - A raw slot is fallback metadata only: when identity cannot be resolved the
 *   step is emitted as `find-slot` AND reported in `unresolved`, so a raw slot
 *   never becomes the sole execution contract.
 * - `toProcedure()` validates through the same `ProcedureRegistry` the runtime
 *   consumes, so a recorded procedure is always executable by the runtime.
 *
 * Injected capabilities (all optional; the recorder degrades instead of
 * inventing identity):
 * - resolveLogicalId(rawItem, context) -> string|null
 * - sessionProvider() -> gui session with `.window.slots`
 * - learnSlot(session, { roleId, slot, logicalItemId, context }) -> Promise
 */
const EVENT_KINDS = Object.freeze([
  'command', 'slash-command', 'open-gui', 'wait-for-gui', 'click',
  'select-quantity', 'wait', 'wait-for-output', 'verify'
]);

const DEFAULT_CONTEXT = 'crafting-menu';

class ProcedureRecorder {
  constructor({
    resolveLogicalId = null,
    sessionProvider = null,
    learnSlot = null,
    context = DEFAULT_CONTEXT
  } = {}) {
    this.resolveLogicalId = typeof resolveLogicalId === 'function' ? resolveLogicalId : null;
    this.sessionProvider = typeof sessionProvider === 'function' ? sessionProvider : null;
    this.learnSlot = typeof learnSlot === 'function' ? learnSlot : null;
    this.context = String(context || DEFAULT_CONTEXT);
    this.events = [];
    Object.freeze(this);
  }

  record(event) {
    if (!event || typeof event !== 'object') throw new TypeError('recorded event must be an object');
    const kind = String(event.kind || '').trim();
    if (!EVENT_KINDS.includes(kind)) throw new TypeError(`Unsupported record event kind: ${kind}.`);
    const normalized = kind === 'click' || kind === 'select-quantity'
      ? this.#recordSlotAction(kind, event)
      : this.#normalize(kind, event);
    return { index: this.events.push(Object.freeze(normalized)) - 1, step: normalized };
  }

  reset() {
    this.events.length = 0;
    return this;
  }

  /**
   * @returns {{ id, label, description, quantityStrategy, maxBatch, steps, unresolved }}
   * `unresolved` lists every step whose identity could not be normalized; those
   * steps carry a raw slot and need one knowledge/learning pass before the
   * procedure is identity-complete.
   */
  toProcedure({ id, label = '', description = '', quantityStrategy = 'button-batch', maxBatch = 64 } = {}) {
    const key = String(id || '').trim();
    if (!key) throw new TypeError('procedure id is required');
    const definition = {
      label: label || key,
      description: String(description || ''),
      quantityStrategy,
      maxBatch,
      steps: this.events.map(event => this.#toStep(event))
    };
    // Fail closed: the recorded procedure must be executable by the runtime.
    const normalized = new ProcedureRegistry({ [key]: definition }).require(key);
    // Only slot actions can be unresolved: identity-free steps (command, wait,
    // verify) never carry identity, so they must not pollute the report.
    const unresolved = this.events
      .map((event, index) => ((event.kind === 'click' || event.kind === 'select-quantity') && !event.itemId
        ? { index, type: normalized.steps[index].type, slot: event.slot ?? null, windowId: event.windowId ?? null }
        : null))
      .filter(Boolean);
    return Object.freeze({
      id: key,
      label: normalized.label,
      description: normalized.description,
      quantityStrategy: normalized.quantityStrategy,
      maxBatch: normalized.maxBatch,
      steps: normalized.steps,
      identityComplete: unresolved.length === 0,
      unresolved: Object.freeze(unresolved)
    });
  }

  #toStep(event) {
    switch (event.kind) {
      case 'command': return { type: 'command', commandKey: event.commandKey };
      case 'slash-command': return { type: 'slash-command', command: event.command };
      case 'open-gui': return { type: 'open-gui', guiId: event.guiId };
      case 'wait-for-gui': return { type: 'wait-for-gui', guiId: event.guiId, timeoutMs: event.timeoutMs };
      case 'click':
      case 'select-quantity':
        // Logical identity first; a raw slot stays a learn-later fallback that
        // toProcedure().unresolved reports, never the sole contract.
        return event.itemId
          ? { type: 'find-logical-item', itemId: event.itemId }
          : { type: 'find-slot', slot: event.slot };
      case 'wait': return { type: 'wait', ms: event.ms };
      case 'wait-for-output': return { type: 'wait-for-output', timeoutMs: event.timeoutMs };
      case 'verify': return { type: 'verify-quantity', amount: event.amount };
      default: throw new TypeError(`Unsupported record event kind: ${event.kind}.`);
    }
  }

  #recordSlotAction(kind, event) {
    const slot = Number(event.slot);
    if (!Number.isInteger(slot) || slot < 0) throw new TypeError(`${kind} event needs a slot`);
    const windowId = event.windowId === undefined ? null : event.windowId;
    const raw = event.rawItem || this.#rawItemAt(slot);
    const itemId = this.#resolveLogicalId(raw, event.context || this.context);
    if (itemId) {
      // Quantity identity is worth persisting immediately: the same slot then
      // resolves next session without re-recording.
      if (kind === 'select-quantity' && this.learnSlot) {
        const session = this.sessionProvider?.() || null;
        if (session) this.learnSlot(session, {
          source: event.source || session.source || null,
          roleId: `quantity:${event.amount ?? slot}`,
          slot, logicalItemId: itemId, context: 'crafting-quantity'
        }).catch(() => {});
      }
      return { kind, slot, itemId, windowId };
    }
    return { kind, slot, windowId, itemId: null };
  }

  #rawItemAt(slot) {
    return this.sessionProvider?.()?.window?.slots?.[slot] || null;
  }

  #resolveLogicalId(raw, context) {
    if (!raw || !this.resolveLogicalId) return null;
    try { return this.resolveLogicalId(raw, context) || null; }
    catch { return null; }
  }

  #normalize(kind, event) {
    if (kind === 'command') {
      const commandKey = String(event.commandKey || '').trim();
      if (!commandKey) throw new TypeError('command event needs commandKey');
      return { kind, commandKey };
    }
    if (kind === 'slash-command') {
      const command = String(event.command || '').trim();
      if (!command.startsWith('/')) throw new TypeError('slash-command event needs a /command');
      return { kind, command };
    }
    if (kind === 'open-gui' || kind === 'wait-for-gui') {
      const guiId = String(event.guiId || '').trim();
      if (!guiId) throw new TypeError(`${kind} event needs guiId`);
      const timeoutMs = event.timeoutMs === undefined ? undefined : Math.max(1, Number(event.timeoutMs) || 5000);
      return timeoutMs === undefined ? { kind, guiId } : { kind, guiId, timeoutMs };
    }
    if (kind === 'wait') return { kind, ms: Math.max(0, Number(event.ms || 0)) };
    if (kind === 'wait-for-output') {
      const timeoutMs = event.timeoutMs === undefined ? undefined : Math.max(1, Number(event.timeoutMs) || 5000);
      return timeoutMs === undefined ? { kind } : { kind, timeoutMs };
    }
    if (kind === 'verify') return { kind, amount: event.amount === undefined ? '$execution.remaining' : event.amount };
    throw new TypeError(`Unsupported record event kind: ${kind}.`);
  }
}

ProcedureRecorder.EVENT_KINDS = EVENT_KINDS;

module.exports = ProcedureRecorder;
