'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const ProcedureRecorder = require('../../../src/server-features/crafting/procedure/ProcedureRecorder');
const ProcedureRecordingRuntime = require('../../../src/server-features/crafting/ProcedureRecordingRuntime');
const ProcedureRegistry = require('../../../src/server-features/crafting/procedure/ProcedureRegistry');
const ProcedureBuilder = require('../../../src/server-features/crafting/procedure/ProcedureBuilder');

// Roadmap G21 example: /ks -> click crafting -> click recipe -> click quantity -> wait
// must become command -> open crafting GUI -> find recipe identity -> select quantity
// -> wait-for-output.
function recordedJourney({ resolveLogicalId, session }) {
  const recorder = new ProcedureRecorder({
    resolveLogicalId,
    sessionProvider: () => session || null
  });
  recorder.record({ kind: 'command', commandKey: 'minerals' });
  recorder.record({ kind: 'open-gui', guiId: 'minerals' });
  recorder.record({ kind: 'click', slot: 11, windowId: 'minerals' });
  recorder.record({ kind: 'click', slot: 20, windowId: 'crafting' });
  recorder.record({ kind: 'select-quantity', slot: 22, amount: 64, windowId: 'craftingQuantity' });
  recorder.record({ kind: 'wait-for-output', timeoutMs: 5000 });
  return recorder;
}

test('G21 recorder turns user actions into logical steps, never a bare slot contract', () => {
  const session = { window: { slots: { 11: { name: 'crafting_table' }, 20: { name: 'cobblestone' }, 22: { name: 'paper' } } } };
  const recorder = recordedJourney({
    session,
    resolveLogicalId: raw => ({ crafting_table: 'menu_crafting', cobblestone: 'super_cobblestone', paper: 'quantity:64' }[raw.name] || null)
  });

  const procedure = recorder.toProcedure({ id: 'recorded-minerals' });
  assert.deepEqual(procedure.steps.map(step => step.type), [
    'command', 'open-gui', 'find-logical-item', 'find-logical-item', 'find-logical-item', 'wait-for-output'
  ]);
  assert.deepEqual(procedure.steps[2], { type: 'find-logical-item', itemId: 'menu_crafting' });
  assert.deepEqual(procedure.steps[3], { type: 'find-logical-item', itemId: 'super_cobblestone' });
  assert.deepEqual(procedure.steps[4], { type: 'find-logical-item', itemId: 'quantity:64' });
  assert.deepEqual(procedure.unresolved, []);
  // Every recorded step is a runtime step type, so the runtime can execute it.
  for (const step of procedure.steps) assert.ok(ProcedureRegistry.STEP_TYPES.includes(step.type), step.type);
});

test('G21 unresolved identity degrades to find-slot and is reported, never silently accepted', () => {
  const recorder = recordedJourney({ resolveLogicalId: () => null });
  const procedure = recorder.toProcedure({ id: 'partial' });

  assert.deepEqual(procedure.steps.map(step => step.type), [
    'command', 'open-gui', 'find-slot', 'find-slot', 'find-slot', 'wait-for-output'
  ]);
  assert.deepEqual(procedure.unresolved.map(entry => entry.slot), [11, 20, 22]);
  assert.deepEqual(procedure.unresolved.map(entry => entry.index), [2, 3, 4]);
  assert.equal(procedure.identityComplete, false);
});

test('G21 recorder does not depend on one session: live window identity is enough', () => {
  const session = { window: { slots: { 11: { name: 'crafting_table' } } } };
  const recorder = new ProcedureRecorder({
    resolveLogicalId: raw => (raw?.name === 'crafting_table' ? 'menu_crafting' : null),
    sessionProvider: () => session
  });
  recorder.record({ kind: 'click', slot: 11, windowId: 'minerals' });
  const procedure = recorder.toProcedure({ id: 'live-identity' });
  assert.deepEqual(procedure.steps[0], { type: 'find-logical-item', itemId: 'menu_crafting' });
  assert.equal(procedure.identityComplete, true);
});

test('G21 recorder validates recorded output through the runtime registry (fail closed)', () => {
  const recorder = new ProcedureRecorder();
  recorder.record({ kind: 'command', commandKey: 'minerals' });
  assert.throws(() => recorder.record({ kind: 'slash-command', command: 'is' }), /\/command/);

  const ok = new ProcedureRecorder();
  ok.record({ kind: 'command', commandKey: 'minerals' });
  ok.record({ kind: 'slash-command', command: '/is' });
  ok.record({ kind: 'wait-for-gui', guiId: 'crafting', timeoutMs: 4000 });
  ok.record({ kind: 'wait', ms: 250 });
  ok.record({ kind: 'verify' });
  const procedure = ok.toProcedure({ id: 'ok', quantityStrategy: 'repeat', maxBatch: 1 });
  assert.deepEqual(procedure.steps.map(step => step.type), ['command', 'slash-command', 'wait-for-gui', 'wait', 'verify-quantity']);
  assert.equal(procedure.steps.at(-1).amount, '$execution.remaining');
  assert.equal(procedure.quantityStrategy, 'repeat');
  assert.equal(procedure.maxBatch, 1);
  assert.deepEqual(procedure.unresolved, []);
  assert.equal(procedure.identityComplete, true);
  // The runtime registry accepts it unchanged: a recorded procedure is executable.
  assert.deepEqual(new ProcedureRegistry({ [procedure.id]: procedure }).require(procedure.id).steps, procedure.steps);
});

test('G21 recorder rejects unknown kinds, missing parameters and empty ids', () => {
  const recorder = new ProcedureRecorder();
  assert.throws(() => recorder.record({ kind: 'teleport' }), TypeError);
  assert.throws(() => recorder.record(null), TypeError);
  assert.throws(() => recorder.record({ kind: 'command' }), /commandKey/);
  assert.throws(() => recorder.record({ kind: 'open-gui' }), /guiId/);
  assert.throws(() => recorder.record({ kind: 'click', slot: -1 }), /slot/);
  assert.deepEqual(ProcedureRecorder.EVENT_KINDS, [
    'command', 'slash-command', 'open-gui', 'wait-for-gui', 'click',
    'select-quantity', 'wait', 'wait-for-output', 'verify'
  ]);

  const empty = new ProcedureRecorder();
  assert.throws(() => empty.toProcedure({ id: '' }), /id is required/);
  const noSteps = new ProcedureRecorder();
  assert.throws(() => noSteps.toProcedure({ id: 'empty' }), /at least one step/);
});

test('G21 recorder reset clears events so a new recording cannot inherit a previous one', () => {
  const recorder = new ProcedureRecorder();
  recorder.record({ kind: 'command', commandKey: 'minerals' });
  assert.equal(recorder.events.length, 1);
  assert.equal(recorder.reset().events.length, 0);
  assert.throws(() => recorder.toProcedure({ id: 'empty' }), /at least one step/);
});

test('G21 recording runtime binds live GUI knowledge and reports identity completeness', () => {
  const learned = [];
  const session = {
    source: { command: '/ks' },
    window: { slots: { 11: { name: 'crafting_table' }, 22: { name: 'paper' }, 30: { name: 'mystery' } } }
  };
  const runtime = new ProcedureRecordingRuntime({
    guiKnowledge: {
      resolveLogicalId: raw => ({ crafting_table: 'menu_crafting', paper: 'quantity:64' }[raw.name] || null),
      learnSlot: async (_session, options) => { learned.push(options); }
    },
    itemResolver: { resolve: () => null },
    sessionProvider: () => session
  });

  runtime.recordCommand('minerals');
  runtime.recordOpenGui('minerals');
  runtime.recordClick({ slot: 11, windowId: 'minerals' });
  runtime.recordQuantity({ slot: 22, amount: 64, windowId: 'craftingQuantity' });
  runtime.recordClick({ slot: 30, windowId: 'craftingQuantity' });
  runtime.recordWaitForOutput(5000);

  const procedure = runtime.toProcedure({ id: 'recorded-ks' });
  assert.equal(procedure.stepCount, 6);
  assert.equal(procedure.identityComplete, false);
  assert.deepEqual(procedure.unresolved.map(entry => entry.slot), [30]);
  assert.deepEqual(procedure.steps[2], { type: 'find-logical-item', itemId: 'menu_crafting' });
  assert.deepEqual(procedure.steps[3], { type: 'find-logical-item', itemId: 'quantity:64' });
  assert.equal(procedure.steps[4].type, 'find-slot');

  // Resolved quantity identity is persisted through GUI knowledge immediately.
  assert.equal(learned.length, 1);
  assert.deepEqual(learned[0], {
    source: { command: '/ks' }, roleId: 'quantity:64', slot: 22, logicalItemId: 'quantity:64', context: 'crafting-quantity'
  });
});

test('G21 recording hands off to the G20 builder and saves into a live registry', () => {
  const session = { window: { slots: { 11: { name: 'crafting_table' } } } };
  const runtime = new ProcedureRecordingRuntime({
    resolveLogicalId: raw => (raw?.name === 'crafting_table' ? 'menu_crafting' : null),
    itemResolver: { resolve: raw => (raw?.name === 'crafting_table' ? { id: 'menu_crafting' } : null) },
    sessionProvider: () => session
  });
  runtime.recordCommand('minerals');
  runtime.recordOpenGui('minerals');
  runtime.recordClick({ slot: 11 });

  const draft = runtime.toBuilderDraft({ id: 'recorded-handoff', label: 'Recorded' });
  assert.equal(draft.id, 'recorded-handoff');
  assert.equal(draft.identityComplete, true);
  assert.deepEqual(draft.steps.map(step => step.type), ['command', 'open-gui', 'find-logical-item']);
  // The builder accepts the recorded draft unchanged (same runtime schema).
  assert.deepEqual(ProcedureBuilder.fromDefinition(draft).toDefinition().steps, draft.steps);

  const registry = new ProcedureRegistry({});
  const saved = runtime.save(registry, { id: 'recorded-handoff' });
  assert.equal(saved.id, 'recorded-handoff');
  assert.deepEqual(registry.require('recorded-handoff').steps, draft.steps);
  assert.throws(() => runtime.save({}), TypeError);
});

test('G21 recording runtime fails closed when a capability throws', () => {
  const runtime = new ProcedureRecordingRuntime({
    guiKnowledge: {
      resolveLogicalId: () => { throw new Error('knowledge offline'); },
      learnSlot: async () => { throw new Error('knowledge offline'); }
    },
    itemResolver: { resolve: () => { throw new Error('registry offline'); } },
    sessionProvider: () => ({ window: { slots: { 11: { name: 'crafting_table' } } } })
  });
  runtime.recordCommand('minerals');
  runtime.recordClick({ slot: 11 });
  const procedure = runtime.toProcedure({ id: 'degraded' });
  assert.equal(procedure.identityComplete, false);
  assert.deepEqual(procedure.unresolved.map(entry => entry.slot), [11]);
  assert.equal(procedure.steps[1].type, 'find-slot');
});
