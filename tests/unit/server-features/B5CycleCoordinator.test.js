'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const B5CycleCoordinator = require('../../../src/server-features/crafting/b5/B5CycleCoordinator');

function chain(baseId) {
    return {
        baseId,
        b2Id: `${baseId}-b2`,
        b3Id: `${baseId}-b3`,
        b2RecipeId: `${baseId}-b2-recipe`,
        b3RecipeId: `${baseId}-b3-recipe`
    };
}

function createCoordinator({ availability, reserveCalls, preparationFailure = null }) {
    const chains = Object.keys(availability).map(chain);
    const inspection = () => ({
        success: true,
        data: {
            chains,
            fullPlan: { targetId: 'super_alloy', feasible: false },
            personalVault: { totals: {} },
            progress: { remainingStages: 1, remainingCrafts: 1, nextStep: { kind: 'B2/B3', id: chains[0]?.b3Id || null } }
        }
    });
    const plan = candidate => ({
        plannedB2Exact: 1,
        plannedB2: availability[candidate.baseId] ? 1 : 0,
        plannedB3: 0,
        b2BatchSize: 64,
        useAllForB2: false,
        basePerB2: 16,
        requiredRawForStart: 16,
        totalEffective: availability[candidate.baseId] ? 16 : 0,
        totalB2Crafts: availability[candidate.baseId] ? 1 : 0,
        decompressionBlocked: false
    });
    const status = () => ({ state: 'RUNNING' });

    return new B5CycleCoordinator({
        flows: {
            read: { inspect: async () => inspection() },
            plan: { planChain: plan },
            storage: {
                async prepareBase(baseId) {
                    if (preparationFailure?.baseId === baseId) return preparationFailure.result;
                    return { success: true, data: { ready: true, available: 16 } };
                },
                async finalizeBase() { return { data: {} }; }
            }
        },
        inventoryState: {
            allowsNewIntermediates: () => true,
            vaultCanAccept: () => true
        },
        recipeResolver: { isB5DirectlyReady: () => false },
        progressTracker: { sync() {}, set() {}, advance() {} },
        intermediate: {
            async promoteOwned(current) { return { actions: [], inspection: current }; },
            async depositRemainders() {}
        },
        reserveChain: {
            async prepare(candidate) {
                reserveCalls.push(candidate.baseId);
                return {};
            }
        },
        b1Inventory: { async returnToStorage() { return { returned: 0 }; } },
        finalCraft: {},
        config: {},
        runStep: async (_context, _details, work) => work(),
        childOptions: () => ({}),
        status
    });
}

function context() {
    return { cancellation: { token: { throwIfCancelled() {} } }, trace: [] };
}

async function execute(coordinator) {
    return coordinator.execute(1, context(), {
        additional: 0,
        mode: 'production',
        allowFinalB5: false,
        allowNewB2: true,
        recoveryOnly: false
    });
}

test('B5 B2 skips one material without B1 and continues to a material that is ready', async () => {
    const reserveCalls = [];
    const result = await execute(createCoordinator({ availability: { coal: false, redstone: true }, reserveCalls }));

    assert.deepEqual(reserveCalls, ['redstone']);
    assert.equal(result.actions.some(action => action.baseId === 'coal' && action.reason === 'waiting-for-complete-b2-batch'), true);
});

test('B5 B2 continues across alternating missing and ready B1 materials', async () => {
    const reserveCalls = [];
    const result = await execute(createCoordinator({ availability: { coal: false, redstone: true, lapis: false, gold: true }, reserveCalls }));

    assert.deepEqual(reserveCalls, ['redstone', 'gold']);
    assert.deepEqual(result.actions.filter(action => action.status === 'waiting').map(action => action.baseId), ['coal', 'lapis']);
});

test('B5 B2 leaves the cycle waiting for materials when every material lacks B1', async () => {
    const reserveCalls = [];
    const result = await execute(createCoordinator({ availability: { coal: false, redstone: false, lapis: false, gold: false }, reserveCalls }));

    assert.deepEqual(reserveCalls, []);
    assert.equal(result.waitingForMaterials, true);
    assert.equal(result.productive, false);
    assert.equal(result.actions.filter(action => action.status === 'waiting').length, 4);
});

test('B5 B2 does not permanently exclude a material that becomes ready in a later cycle', async () => {
    const reserveCalls = [];
    const availability = { coal: false, redstone: true };
    const coordinator = createCoordinator({ availability, reserveCalls });

    await execute(coordinator);
    availability.coal = true;
    await execute(coordinator);

    assert.deepEqual(reserveCalls, ['redstone', 'coal', 'redstone']);
});

test('B5 B2 still propagates a fatal prepare-b1 failure', async () => {
    const reserveCalls = [];
    const coordinator = createCoordinator({
        availability: { coal: true, redstone: true },
        reserveCalls,
        preparationFailure: { baseId: 'coal', result: { success: false, status: 'ERROR', message: 'crafting service failed' } }
    });

    await assert.rejects(() => execute(coordinator), /crafting service failed/);
    assert.deepEqual(reserveCalls, []);
});
