'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadModule(file, stubs) {
    const source = fs.readFileSync(file, 'utf8');
    const module = { exports: {} };
    const sandbox = {
        require: request => {
            if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
            throw new Error(`Unexpected require: ${request}`);
        },
        module,
        exports: module.exports,
        console,
        Date,
        Math,
        Number,
        Boolean,
        String,
        Object,
        Array,
        Map,
        Set,
        Promise
    };
    vm.runInNewContext(source, sandbox, { filename: file });
    return module.exports;
}

function isContainerSlot() { return true; }
function findContainerSlot() { return -1; }

const navigatorPath = path.resolve(__dirname, '../../../src/server-features/crafting/CraftingGuiNavigator.js');
const CraftingGuiNavigator = loadModule(navigatorPath, {
    '../../shared/time/Timeout': { delay: async () => {} },
    '../../shared/errors/FlowError': { wrap: error => error },
    '../../gui/ContainerSlotRange': { findContainerSlot, isContainerSlot }
});

test('stone B3 recipe slot is authoritative even when GUI knowledge would return B2 slot 10', async () => {
    let knowledgeCalled = false;
    const traces = [];
    const navigator = new CraftingGuiNavigator({
        commandService: {},
        guiManager: {},
        itemResolver: {},
        quantityResolver: {},
        guiKnowledge: { resolveSlot: async () => { knowledgeCalled = true; return 10; } },
        config: {},
        trace: (...args) => traces.push(args)
    });

    const session = {
        window: {
            slots: Array.from({ length: 54 }, (_, slot) => ({ slot })),
            inventoryStart: 54,
            inventoryEnd: 54
        }
    };
    const recipe = { menuItemId: 'super_cobblestone_block', menuSlot: 20 };
    const slot = await navigator.resolveRecipeSlot(session, 'super_cobblestone_block', recipe, 'crafting');

    assert.equal(slot, 20);
    assert.equal(knowledgeCalled, false);
    assert.equal(traces[0][0], 'CRAFT FIXED RECIPE SLOT');
});

test('other recipes still use GUI knowledge resolution', async () => {
    let knowledgeCalled = false;
    const navigator = new CraftingGuiNavigator({
        commandService: {},
        guiManager: {},
        itemResolver: {},
        quantityResolver: {},
        guiKnowledge: { resolveSlot: async () => { knowledgeCalled = true; return 10; } },
        config: {}
    });
    const session = { window: { slots: Array(54).fill({}), inventoryStart: 54, inventoryEnd: 54 } };
    const slot = await navigator.resolveRecipeSlot(session, 'super_cobblestone', { menuSlot: 10, menuItemId: 'super_cobblestone' }, 'crafting');
    assert.equal(slot, 10);
    assert.equal(knowledgeCalled, true);
});

const verifierPath = path.resolve(__dirname, '../../../src/server-features/crafting/CraftingResultVerifier.js');
const CraftingResultVerifier = loadModule(verifierPath, {
    '../../shared/time/Timeout': { delay: async () => {} },
    './verification/CraftingVerificationEvidence': class {
        constructor() {}
        readViews() { return []; }
        countViews() { return { snapshot: null, count: 0, countsBySource: {} }; }
        aggregateMmoTotalsAcrossViews() { return {}; }
        eventEvidence() { return { outputDelta: 0, eventCount: 0 }; }
    },
    './verification/CraftingVerificationAttempt': class {
        constructor() {}
        async evaluate() { return { verified: false, before: 0, after: 0, delta: 0, views: [], countsBySource: {}, beforeCountsBySource: {}, inputEvidence: [], eventEvidence: { outputDelta: 0, eventCount: 0 }, snapshotMmoCandidates: [], verificationMode: 'none', attempt: 1 }; }
    }
});

test('output verification never fails solely because the initial global inventory sync is unstable', async () => {
    let syncCalls = 0;
    const verifier = new CraftingResultVerifier({
        inventoryReader: {},
        inventoryCounter: {},
        inventorySync: { waitForStable: async () => { syncCalls += 1; throw new Error('must not gate verification'); } }
    });
    verifier.attemptEvaluator = { evaluate: async () => ({
        verified: true, before: 0, after: 1, delta: 1, views: [], countsBySource: {},
        beforeCountsBySource: {}, inputEvidence: [], eventEvidence: { outputDelta: 0, eventCount: 0 },
        snapshotMmoCandidates: [], verificationMode: 'output-snapshot-delta', attempt: 1
    }) };
    const result = await verifier.after('refined_coal', {
        count: 0, snapshot: null, views: [], countsBySource: {}, capturedAt: Date.now(),
        verificationStartedAt: Date.now(), inventorySource: 'bot-inventory'
    }, { attempts: 1, expectedDelta: 1, inventorySource: 'bot-inventory' });

    assert.equal(syncCalls, 0);
    assert.equal(result.verified, true);
});

const coordinatorPath = path.resolve(__dirname, '../../../src/server-features/crafting/CraftingVerificationCoordinator.js');
const FlowError = class extends Error { constructor(code, step, action, resource, details) { super(code); Object.assign(this, { code, step, action, resource, details }); } };
const CraftingVerificationCoordinator = loadModule(coordinatorPath, {
    './CraftingOutcomeClassifier': { classify: () => ({ kind: 'uncertain' }) }
});

test('verified craft survives post-craft settlement timeout instead of restarting the flow', async () => {
    let settleCalls = 0;
    let traceMessages = [];
    const coordinator = new CraftingVerificationCoordinator({
        resultVerifier: {
            after: async () => ({
                verified: true, before: 0, after: 512, delta: 512,
                views: [], countsBySource: {}, beforeCountsBySource: {},
                inputEvidence: [], eventEvidence: { outputDelta: 512, eventCount: 12 },
                verificationMode: 'output-event-delta', attempt: 1
            }),
            settleAfterCraft: async () => { settleCalls += 1; return { timedOut: true, elapsedMs: 2500, eventCount: 300, stablePasses: 1, quietForMs: 10 }; }
        },
        guiKnowledge: null,
        guiManager: { describeCurrent: () => ({}) },
        config: { resultVerifyAttempts: 3, resultVerifyRetryMs: 50, outputCompletionTimeoutMs: 8000, outputCompletionPollMs: 50 },
        support: { deriveActualCrafts: () => 512 },
        trace: (message) => traceMessages.push(message),
        flow: (code, step, action, resource, details) => new FlowError(code, step, action, resource, details)
    });

    const result = await coordinator.verify({
        recipeId: 'refined_coal',
        recipe: { output: 'refined_coal', outputAmount: 1, inputs: { coal: 1 } },
        quantity: 'ALL',
        before: { count: 0, views: [], snapshot: null, capturedAt: Date.now(), verificationStartedAt: Date.now() },
        baseDetails: {},
        effectiveInputSource: () => 'storage',
        reconciliationBaseline: null,
        expectedGeneration: 1,
        bot: { currentWindow: null },
        startedAt: Date.now(),
        entrySlot: 16,
        recipeSlot: 11,
        quantitySlot: 24
    });

    assert.equal(settleCalls, 1);
    assert.equal(result.actualCrafts, 512);
    assert.equal(traceMessages.includes('CRAFT SETTLEMENT PENDING'), true);
    assert.equal(traceMessages.includes('CRAFT OK'), true);
});
