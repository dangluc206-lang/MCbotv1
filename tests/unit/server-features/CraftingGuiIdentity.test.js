'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CraftingOperation = require('../../../src/server-features/crafting/CraftingOperation');

function session(id, size = 54) {
    return {
        active: true,
        definitionId: id,
        identity: { id, confidence: 0.95, accepted: true },
        source: null,
        window: { slots: Array(size).fill(null), title: id },
        setSource(source) { this.source = source; },
        setIdentity(identity) { this.identity = identity; this.definitionId = identity?.id || null; }
    };
}

function makeOperation(guiManager) {
    return new CraftingOperation({
        commandService: { send: async () => ({ success: true }) },
        guiManager,
        context: {
            getGeneration: () => 1,
            has: () => true,
            require: () => ({ currentWindow: null, waitForTicks: async () => {} })
        },
        itemResolver: { matches: () => ({ matched: false }) },
        recipeRegistry: {
            require: () => ({ output: 'out', outputAmount: 1, inputs: {}, menuItemId: 'recipe', menuSlot: 10 }),
            ids: () => ['recipe']
        },
        quantityResolver: { resolve: () => 3, describeCandidates: () => [] },
        resultVerifier: {
            before: () => ({}),
            arm: () => {},
            after: async () => ({ verified: true, before: 0, after: 64 })
        },
        guiKnowledge: {
            resolveSlot: async (_session, options) => {
                if (options.roleId === 'menu_crafting') return 16;
                if (options.roleId === 'recipe:recipe') return 10;
                return -1;
            },
            learnBootstrapSlots: async () => {},
            learnSlot: async () => {}
        },
        config: {
            commandKey: 'minerals',
            mineralsGuiId: 'minerals',
            guiId: 'crafting',
            quantityGuiId: 'craftingQuantity',
            entryMenuItemId: 'menu_crafting',
            entrySlot: 16,
            guiTimeoutMs: 100,
            resultDelayMs: 0,
            openSettleMs: 0,
            preQuantityClickTicks: 0,
            postQuantityClickTicks: 0
        }
    });
}

test('CraftingOperation binds /ks root, crafting and quantity transitions to explicit GUI identities', async () => {
    const roots = [session('minerals', 27), session('crafting', 54), session('craftingQuantity', 45)];
    const expectedIds = [];
    const transitionSources = [];
    let transitionIndex = 1;
    const guiManager = {
        current: () => null,
        performAndWaitForOpen: async (action, options) => {
            await action();
            roots[0].setSource(options.source);
            transitionSources.push(options.source);
            return { session: roots[0] };
        },
        clickAndWaitForTransition: async (_slot, options) => {
            const next = roots[transitionIndex++];
            next.setSource(options.source);
            transitionSources.push(options.source);
            return next;
        },
        verifyIdentity: (expectedId, { session: current }) => {
            expectedIds.push(expectedId);
            return { matched: current.identity.id === expectedId, identity: current.identity, session: current };
        },
        click: async () => {},
        describeCurrent: () => null
    };

    await makeOperation(guiManager).execute('recipe', 64, { expectedGeneration: 1 });

    assert.deepEqual(transitionSources.map(source => source.guiId), ['minerals', 'crafting', 'craftingQuantity']);
    assert.ok(expectedIds.includes('minerals'));
    assert.ok(expectedIds.includes('crafting'));
    assert.ok(expectedIds.includes('craftingQuantity'));
});

test('CraftingOperation refuses a strong conflicting GUI instead of clicking it as /ks', async () => {
    const wrongRoot = session('personalVault2', 54);
    const guiManager = {
        current: () => null,
        performAndWaitForOpen: async (action, options) => {
            await action();
            wrongRoot.setSource(options.source);
            return { session: wrongRoot };
        },
        verifyIdentity: expectedId => ({
            matched: expectedId === wrongRoot.identity.id,
            identity: wrongRoot.identity,
            session: wrongRoot
        }),
        describeCurrent: () => ({ definitionId: wrongRoot.definitionId })
    };

    await assert.rejects(
        () => makeOperation(guiManager).execute('recipe', 64, { expectedGeneration: 1 }),
        error => error?.code === 'CRAFTING_GUI_IDENTITY_MISMATCH'
    );
});
