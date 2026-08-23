'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const StateStore = require('../../../src/core/StateStore');

test('StateStore supports observable patch/update/reset without exposing mutable state', () => {
    const store = new StateStore({ count: 1, nested: { value: 2 } });
    const changes = [];
    const off = store.onChange(change => changes.push(change), { immediate: true });
    store.patch({ count: 2 });
    store.update(draft => { draft.nested.value = 3; });
    const snapshot = store.get();
    assert.throws(() => { snapshot.nested.value = 99; }, TypeError);
    assert.equal(store.get().nested.value, 3);
    store.reset({ count: 0 });
    off();
    assert.equal(store.getRevision(), 3);
    assert.deepEqual(changes.map(change => change.type), ['snapshot', 'patch', 'update', 'reset']);
    assert.equal(changes.at(-1).revision, 3);
});
