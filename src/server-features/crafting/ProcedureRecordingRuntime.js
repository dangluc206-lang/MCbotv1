'use strict';

const ProcedureRecorder = require('./procedure/ProcedureRecorder');
const ProcedureBuilder = require('./procedure/ProcedureBuilder');
const ProcedureRegistry = require('./procedure/ProcedureRegistry');

/**
 * Procedure recording runtime (G21).
 * Binds the pure `ProcedureRecorder` to the live per-bot capabilities so an
 * operator action becomes a logical procedure step:
 *
 *   command / slash-command / open-gui / wait-for-gui  -> identity-free steps
 *   click slot N, select-quantity slot N               -> find-logical-item when
 *     the live item resolves through GUI knowledge / item registry, otherwise
 *     find-slot + an `unresolved` report (raw slot never the sole contract)
 *
 * The runtime owns no Minecraft side effect itself: the caller reports the
 * actions the bot actually performed, and the recorder normalizes them. Saving
 * a recording goes through the same `ProcedureRegistry` the engine consumes, so
 * a recorded procedure is executable without touching engine code.
 */
class ProcedureRecordingRuntime {
  constructor({
    guiKnowledge = null,
    itemResolver = null,
    resolveLogicalId = null,
    sessionProvider = null,
    learnSlot = null,
    context = 'crafting-menu'
  } = {}) {
    this.guiKnowledge = guiKnowledge || null;
    this.itemResolver = itemResolver || null;
    this.recorder = new ProcedureRecorder({
      resolveLogicalId: resolveLogicalId || ((raw, ctx) => this.#resolveLogicalId(raw, ctx)),
      sessionProvider,
      learnSlot: learnSlot || ((session, options) => this.guiKnowledge?.learnSlot?.(session, options)),
      context
    });
    Object.freeze(this);
  }

  get events() { return this.recorder.events; }

  record(event) { return this.recorder.record(event); }

  /** Records a raw GUI click against the live session window. */
  recordClick({ slot, windowId = null, amount = null } = {}) {
    return this.recorder.record({ kind: 'click', slot, windowId, amount });
  }

  /** Records a quantity-button click and persists its identity when resolved. */
  recordQuantity({ slot, amount, windowId = null, source = null } = {}) {
    return this.recorder.record({ kind: 'select-quantity', slot, amount, windowId, source });
  }

  recordCommand(commandKey) { return this.recorder.record({ kind: 'command', commandKey }); }

  recordSlashCommand(command) { return this.recorder.record({ kind: 'slash-command', command }); }

  recordOpenGui(guiId) { return this.recorder.record({ kind: 'open-gui', guiId }); }

  recordWaitForGui(guiId, timeoutMs) { return this.recorder.record({ kind: 'wait-for-gui', guiId, timeoutMs }); }

  recordWait(ms) { return this.recorder.record({ kind: 'wait', ms }); }

  recordWaitForOutput(timeoutMs) { return this.recorder.record({ kind: 'wait-for-output', timeoutMs }); }

  recordVerify(amount) { return this.recorder.record({ kind: 'verify', amount }); }

  reset() { return this.recorder.reset(); }

  /**
   * Produces the recorded procedure. `identityComplete` is false while any step
   * still depends on a raw slot, so callers can refuse to publish it as final.
   */
  toProcedure(options = {}) {
    const procedure = this.recorder.toProcedure(options);
    return Object.freeze({
      ...procedure,
      identityComplete: procedure.unresolved.length === 0,
      stepCount: procedure.steps.length
    });
  }

  /**
   * Converts the recording into a `ProcedureBuilder` draft so the G20 builder
   * surface can edit / validate / save it with the same code path.
   */
  toBuilderDraft(options = {}) {
    const procedure = this.toProcedure(options);
    const builder = ProcedureBuilder.fromDefinition(procedure);
    return Object.freeze({ ...builder.toDefinition(), id: procedure.id, identityComplete: procedure.identityComplete, unresolved: procedure.unresolved });
  }

  /** Registers the recording into a live registry (runtime save path). */
  save(registry, options = {}) {
    if (!registry || typeof registry.register !== 'function') throw new TypeError('save requires a ProcedureRegistry.');
    return registry.register(this.toProcedure(options).id, this.toProcedure(options));
  }

  #resolveLogicalId(raw, context) {
    if (!raw) return null;
    if (this.guiKnowledge?.resolveLogicalId) {
      try {
        const learned = this.guiKnowledge.resolveLogicalId(raw, context);
        if (learned) return learned;
      } catch { /* fall through to the item registry */ }
    }
    try { return this.itemResolver?.resolve?.(raw, context)?.id || null; }
    catch { return null; }
  }
}

ProcedureRecordingRuntime.RECORDER_EVENT_KINDS = ProcedureRecorder.EVENT_KINDS;
ProcedureRecordingRuntime.ProcedureRegistry = ProcedureRegistry;

module.exports = ProcedureRecordingRuntime;
