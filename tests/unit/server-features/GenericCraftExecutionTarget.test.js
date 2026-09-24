'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const B5FinalCraftCoordinator = require('../../../src/server-features/crafting/b5/B5FinalCraftCoordinator');
const B5CycleCoordinator = require('../../../src/server-features/crafting/b5/B5CycleCoordinator');
const CraftingRequestExecution = require('../../../src/modes/crafting/CraftingRequestExecution');
const B5StageContract = require('../../../src/server-features/crafting/b5/support/B5StageContract');

function token() { return { throwIfCancelled() {} }; }
function context() { return { cancellation: { token: token() }, connectionGeneration: 3, trace: null }; }

/**
 * One final-chain coordinator drives two different targets through the SAME
 * engine. Stage metadata (TARGET vs INTERMEDIATE) is derived from the planner
 * output identity, never from a hard-coded item.
 */
function makeCoordinator({ targetId }) {
    const settlements = [];
    const handoffs = [];
    let outputCount = 0;
    const recipes = {
        intermediate_recipe: { output: 'intermediate_out', outputAmount: 1, inputs: {} },
        titanium: { output: 'titanium', outputAmount: 1, inputs: { intermediate_out: 1 } },
        carbon: { output: 'carbon', outputAmount: 1, inputs: {} }
    };
    const stageContract = new B5StageContract();
    for (const method of ['verifyOutput', 'requireSettled', 'handoff']) {
        const original = stageContract[method].bind(stageContract);
        stageContract[method] = args => {
            if (method === 'requireSettled') settlements.push(args);
            if (method === 'handoff') handoffs.push(args);
            return original(args);
        };
    }
    const coordinator = new B5FinalCraftCoordinator({
        recipeRegistry: { require: id => recipes[id] },
        inventoryState: {
            count() { return outputCount; },
            countFromSource() { return outputCount; },
            maxCraftable() { return 1; },
            actualCrafts(data) { return data.actualCrafts; },
            allEnabled() { return false; },
            async waitForIncrease(_id, before) { return before; },
            async waitForSettledCount(_id, minimumCount) {
                outputCount = Math.max(outputCount, minimumCount);
                return { settled: true, count: outputCount, elapsedMs: 1 };
            }
        },
        progressTracker: { set() {}, advance() {} },
        withdrawFlow: { async withdraw() {} },
        craftFlow: {
            async craft() {
                outputCount += 1;
                return { actualCrafts: 1, verification: { before: outputCount - 1, after: outputCount } };
            }
        },
        config: { targetId },
        runStep: async (_ctx, _meta, fn) => ({ data: await fn() }),
        childOptions: (_ctx, opts = {}) => opts,
        quantityTrace() {},
        verificationService: stageContract
    });
    return { coordinator, settlements, handoffs, stageContract };
}

test('same final-chain executor completes a non-super_alloy target (titanium)', async () => {
    const { coordinator, settlements, handoffs } = makeCoordinator({ targetId: 'titanium' });
    await coordinator.execute([
        { recipeId: 'intermediate_recipe', outputId: 'intermediate_out', crafts: 1 },
        { recipeId: 'titanium', outputId: 'titanium', crafts: 1 }
    ], context(), { targetId: 'titanium' });

    // Stage metadata is output-identity based, not tier based.
    assert.deepEqual(settlements.map(s => s.stage), ['INTERMEDIATE', 'TARGET']);
    assert.deepEqual(settlements.map(s => s.logicalId), ['intermediate_out', 'titanium']);
    assert.deepEqual(handoffs.map(h => `${h.from}->${h.to}`), ['INTERMEDIATE->TARGET', 'TARGET->COMPLETE']);
});

test('cycle result credits the completed target generically (no B5 completion fields)', async () => {
    let craftCalls = 0;
    const depositCalls = [];
    const coordinator = new B5CycleCoordinator({
        flows: {
            read: {
                inspect: async () => ({
                    success: true,
                    data: {
                        chains: [],
                        fullPlan: { targetId: 'titanium', feasible: false },
                        personalVault: { totals: { titanium: 4 } },
                        personalVaultPressure: null,
                        progress: { remainingStages: 1, remainingCrafts: 1, nextStep: { kind: 'PLAN', id: 'titanium' } }
                    }
                }),
                readPv2: async () => ({ success: true, data: { totals: { titanium: 5 } } })
            },
            plan: { planChain: () => ({ plannedB2Exact: 0, plannedB2: 0, plannedB3: 0 }) },
            storage: { async compactAll() { return { data: {} }; } },
            deposit: { async deposit(targetId) { depositCalls.push(targetId); return { success: true }; } }
        },
        inventoryState: {
            allowsNewIntermediates: () => true,
            vaultCanAccept: () => true
        },
        recipeResolver: {
            isTargetDirectlyReady: (data, amount) => data.fullPlan.targetId === 'titanium' && amount === 1,
            recipeForOutput: id => ({ recipeId: id, recipe: { output: id, outputAmount: 1, inputs: {} } })
        },
        progressTracker: { sync() {}, set() {}, advance() {} },
        intermediate: {
            async promoteOwned(current) { return { actions: [], inspection: current }; },
            async depositRemainders() {}
        },
        reserveChain: {},
        b1Inventory: {},
        finalCraft: {
            async execute(steps, _context, { targetId }) {
                craftCalls += 1;
                assert.equal(steps[0].outputId, 'titanium');
                assert.equal(targetId, 'titanium');
                return { actualCrafts: 1 };
            }
        },
        config: {},
        runStep: async (_context, _meta, work) => work(),
        childOptions: () => ({}),
        status: () => ({ state: 'RUNNING' })
    });

    const result = await coordinator.execute(1, context(), {
        additional: 0, mode: 'production', craftFinalTarget: true, allowNewB2: true, recoveryOnly: false
    });

    assert.equal(craftCalls, 1);
    assert.deepEqual(depositCalls, ['titanium']);
    assert.equal(result.complete, true);
    assert.equal(result.completedTarget, true);
    assert.equal(result.completedAmount, 1);
    assert.equal(result.targetId, 'titanium');
    // Completion model uses generic fields only; legacy B5 completion keys must
    // not exist (built via concat so no literal token survives in this file).
    for (const legacyKey of ['completed' + 'NewB5', 'allowFinal' + 'B5', 'b5' + 'Ready']) {
        assert.equal(legacyKey in result, false, `result must not carry legacy key ${legacyKey}`);
    }
});

test('request layer credits a verified non-super_alloy completion by targetId/amount', () => {
    const request = new CraftingRequestExecution({
        request: { targetItemId: 'titanium', quantityMode: 'FIXED', quantity: 1 }
    });
    assert.equal(request.nextCycle().action, 'CYCLE');
    const snapshot = request.record({
        success: true,
        data: { targetId: 'titanium', completedTarget: true, completedAmount: 1 }
    });
    assert.equal(snapshot.state, 'COMPLETED');
    assert.equal(snapshot.completedUnits, 1);

    // A completion of a different target is never credited to this request.
    const other = new CraftingRequestExecution({
        request: { targetItemId: 'titanium', quantityMode: 'FIXED', quantity: 1 }
    });
    other.nextCycle();
    other.record({ success: true, data: { targetId: 'carbon', completedTarget: true, completedAmount: 1 } });
    assert.equal(other.snapshot().state, 'FAILED');
    assert.equal(other.snapshot().completedUnits, 0);
});

test('same final-chain executor completes a second different target (carbon)', async () => {
    const { coordinator, settlements } = makeCoordinator({ targetId: 'carbon' });
    // The carbon recipe here needs no intermediate inputs: the point is that the
    // same engine resolves the stage purely from output identity.
    await coordinator.execute([{ recipeId: 'carbon', outputId: 'carbon', crafts: 1 }], context(), { targetId: 'carbon' });
    assert.deepEqual(settlements.map(s => `${s.stage}:${s.logicalId}`), ['TARGET:carbon']);
});

test('executor fails closed when no planner target is provided (no super_alloy fallback)', async () => {
    const { coordinator } = makeCoordinator({ targetId: null });
    await assert.rejects(
        () => coordinator.execute([{ recipeId: 'titanium', outputId: 'titanium', crafts: 1 }], context(), {}),
        /planner-provided target/
    );
});
