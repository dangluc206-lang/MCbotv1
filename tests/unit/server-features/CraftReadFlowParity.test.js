'use strict';

// Slice 2 parity: CraftReadFlow must behave exactly like B5ReadFlow on the
// legacy planning contract (amount-first, targetId inside options) while also
// forwarding the target to generic planning (target-first). No behavior drift
// either way; the caller contract (amount-first) never changes.

const test = require('node:test');
const assert = require('node:assert/strict');
const CraftReadFlow = require('../../../src/server-features/crafting/flows/CraftReadFlow');
const B5ReadFlow = require('../../../src/server-features/crafting/b5/flows/B5ReadFlow');

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

test('legacy path: CraftReadFlow delegates exactly like B5ReadFlow', async () => {
    const craftCalls = [];
    const b5Calls = [];
    const craft = new CraftReadFlow({ planningService: legacyPlanning(craftCalls) });
    const b5 = new B5ReadFlow({ planningService: legacyPlanning(b5Calls) });
    await craft.inspect(2, { targetId: 'carbon', additional: true });
    await b5.inspect(2, { targetId: 'carbon', additional: true });
    await craft.inspect(2, { additional: false });
    await b5.inspect(2, { additional: false });
    await craft.inspectFresh(1, { targetId: 'carbon' });
    await b5.inspectFresh(1, { targetId: 'carbon' });
    assert.deepEqual(craftCalls, b5Calls);
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

test('direct readers delegate to the same capabilities as B5 thin flows', async () => {
    const khoCalls = [];
    const storage = { read: async options => { khoCalls.push(options); return { success: true }; } };
    const craft = new CraftReadFlow({ planningService: legacyPlanning([]), storage });
    const b5 = new B5ReadFlow({ planningService: legacyPlanning([]), storage });
    await craft.readKho({ fresh: true });
    await b5.readKho({ fresh: true });
    assert.deepEqual(khoCalls.length, 2);
    assert.throws(() => new CraftReadFlow({}), /planningService is required/);
    assert.throws(() => new CraftReadFlow({ planningService: legacyPlanning([]) }).readKho(), /not configured/);
});
