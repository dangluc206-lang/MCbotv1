'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ProcedureRegistry = require('../../../src/server-features/crafting/procedure/ProcedureRegistry');
const ProcedureBuilder = require('../../../src/server-features/crafting/procedure/ProcedureBuilder');
const ProcedureRecorder = require('../../../src/server-features/crafting/procedure/ProcedureRecorder');

const PROCEDURES = require('../../../config/server-data/procedures.json');

test('builder uses the runtime schema: add/edit/remove/reorder/validate/save', () => {
  const builder = new ProcedureBuilder({ id: 'test-proc', label: 'Test' });
  builder.addStep({ type: 'command', commandKey: 'minerals' });
  builder.addStep({ type: 'click' });
  builder.addStep({ type: 'verify-quantity', amount: '$execution.remaining' });
  assert.equal(builder.steps.length, 3);
  builder.editStep(1, { guiId: 'crafting' });
  assert.equal(builder.steps[1].guiId, 'crafting');
  builder.moveStep(2, 0);
  assert.equal(builder.steps[0].type, 'verify-quantity');
  builder.removeStep(0);
  assert.equal(builder.steps.length, 2);
  const validated = builder.validate();
  assert.equal(validated.id, 'test-proc');
  const registry = new ProcedureRegistry(PROCEDURES);
  const saved = builder.save(registry);
  assert.equal(saved.id, 'test-proc');
  assert.ok(registry.get('test-proc'));
});

test('builder round-trips the shipped minerals procedure without schema drift', () => {
  const builder = ProcedureBuilder.fromDefinition(PROCEDURES['minerals-crafting']);
  const validated = builder.validate();
  assert.equal(validated.steps.length, PROCEDURES['minerals-crafting'].steps.length);
  assert.deepEqual(validated.steps.map(s => s.type), PROCEDURES['minerals-crafting'].steps.map(s => s.type));
});

test('recorder prefers logical intent; raw slot is fallback metadata only', () => {
  const recorder = new ProcedureRecorder({
    resolveLogical: ({ slot }) => (slot === 11 ? { itemId: 'refined_iron' } : null)
  });
  recorder.record({ kind: 'command', commandKey: 'minerals' });
  recorder.record({ kind: 'click', slot: 11, windowId: 'crafting' });
  recorder.record({ kind: 'click', slot: 99, windowId: 'crafting' });
  const proc = recorder.toProcedure({ id: 'recorded' });
  assert.equal(proc.steps[0].type, 'command');
  assert.deepEqual(proc.steps[1], { type: 'find-logical-item', itemId: 'refined_iron' });
  assert.equal(proc.steps[2].type, 'find-slot');
  assert.equal(proc.steps[2].fallback.slot, 99);
});
