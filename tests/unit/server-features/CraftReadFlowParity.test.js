'use strict';

// Slice 2 parity (E-FINAL): CraftReadFlow owns the automation read path.
// The legacy B5ReadFlow reference file was deleted as dead (no runtime
// consumer; generic CraftReadFlow is the production path). These tests lock
// the caller contract (amount-first, targetId inside options) and the
// generic forwarding (target-first) without a legacy import.

const test = require('node:test');
const assert = require('node:assert/strict');
const CraftReadFlow = require('../../../src/server-features/crafting/flows/CraftReadFlow');

function legacyPlanning(calls) {
    return {
        async inspectAdditional(amount, options = {}) { calls.push(['additional', amount, options]); return { ok: true }; },
        async inspect(amount, options = {}) { calls.push(['inspect', amount, options]); return { ok: true }; },
        async inspectAdditionalFresh(amount, options = {}) { calls.push(['fresh', amount, options]); return { ok: true }; }
    };
}

function genericPlanning(calls) {
    return {
        plan() { return {}; },
        async inspectAdditional(targetId, amount, options = {}) { calls.push(['additional', targetId, amount, options]); return { ok: true }; },
        async inspect(targetId, amount, options = {}) { calls.push(['inspect', targetId, amount, options]); return { ok: true }; },
        async inspectAdditionalFresh(targetId, amount, options = {}) { calls.push(['fresh', targetId, amount, options]); return { ok: true }; }
    };
}

test('legacy path: CraftReadFlow keeps the amount-first caller contract', async () => {
    const calls = [];
    const craft = new CraftReadFlow({ planningService: legacyPlanning(calls) });
    await craft.inspect(2, { targetId: 'carbon', additional: true });
    await craft.inspect(2, { additional: false });
    await craft.inspectFresh(1, { targetId: 'carbon' });
    assert.deepEqual(calls[0], ['additional', 2, { targetId: 'carbon' }]);
    assert.deepEqual(calls[1], ['inspect', 2, {}]);
    assert.deepEqual(calls[2], ['fresh', 1, { targetId: 'carbon' }]);
});

test('legacy path: targetId stays inside options for B5 planning', async () => {
    const calls = [];
    const read = new CraftReadFlow({ planningService: legacyPlanning(calls) });
    await read.inspect(1, { targetId: 'titanium', additional: true });
    assert.equal(calls[0][0], 'additional');
    assert.equal(calls[0][1], 1);
    assert.equal(calls[0][2].targetId, 'titanium');
});

test('generic path: targetId is forwarded as first argument', async () => {
    const calls = [];
    const read = new CraftReadFlow({ planningService: genericPlanning(calls) });
    await read.inspect(2, { targetId: 'carbon', additional: true });
    await read.inspect(2, { targetId: 'carbon', additional: false });
    await read.inspectFresh(1, { targetId: 'carbon' });
    assert.deepEqual(calls[0], ['additional', 'carbon', 2, {}]);
    assert.deepEqual(calls[1], ['inspect', 'carbon', 2, {}]);
    assert.deepEqual(calls[2], ['fresh', 'carbon', 1, {}]);
});

test('generic path: missing target fails closed via generic planning', async () => {
    const read = new CraftReadFlow({
        planningService: {
            plan() { return {}; },
            async inspectAdditional(targetId) { if (!String(targetId || '').trim()) throw new TypeError('targetId is required.'); },
            async inspect(targetId) { if (!String(targetId || '').trim()) throw new TypeError('targetId is required.'); }
        }
    });
    await assert.rejects(read.inspect(1, { additional: true }), /targetId is required/);
});

test('direct readers delegate to the injected storage capability', async () => {
    const khoCalls = [];
    const storage = { read: async options => { khoCalls.push(options); return { success: true }; } };
    const craft = new CraftReadFlow({ planningService: legacyPlanning([]), storage });
    await craft.readKho({ fresh: true });
    assert.deepEqual(khoCalls.length, 1);
    assert.throws(() => new CraftReadFlow({}), /planningService is required/);
    assert.throws(() => new CraftReadFlow({ planningService: legacyPlanning([]) }).readKho(), /not configured/);
});
