'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const B5ActionDiagnostics = require('../../../src/server-features/crafting/b5/support/B5ActionDiagnostics');
const B5RecipeResolver = require('../../../src/server-features/crafting/b5/support/B5RecipeResolver');

test('B5ActionDiagnostics deduplicates blockers and excludes productive/skipped states', () => {
    const actions = [
        { status: 'waiting', reason: 'headroom', baseId: 'coal' },
        { status: 'waiting', reason: 'headroom', baseId: 'coal' },
        { status: 'base-ready', baseId: 'iron_ingot' },
        { status: 'skipped-noop', baseId: 'gold_ingot' },
        { status: 'deferred-for-space', reason: 'capacity', targetId: 'carbon' }
    ];
    assert.deepEqual(B5ActionDiagnostics.blockingReasons(actions), [
        { status: 'waiting', reason: 'headroom', baseId: 'coal', targetId: null, b3Id: null, message: null },
        { status: 'deferred-for-space', reason: 'capacity', baseId: null, targetId: 'carbon', b3Id: null, message: null }
    ]);
    assert.equal(B5ActionDiagnostics.isProductiveAction(actions[2]), true);
    assert.equal(B5ActionDiagnostics.isProductiveAction(actions[0]), false);
    assert.equal(B5ActionDiagnostics.isProductiveAction(actions[3]), false);
    assert.deepEqual(B5ActionDiagnostics.summarizeActions(actions), {
        waiting: 2,
        'base-ready': 1,
        'skipped-noop': 1,
        'deferred-for-space': 1
    });
});

test('B5RecipeResolver prefers configured final step and verifies direct B5 readiness', () => {
    const recipes = {
        super_alloy: { output: 'super_alloy', inputs: { tungsten: 8, titanium: 16, carbon: 32 } },
        tungsten_recipe: { output: 'tungsten', inputs: { refined_iron_block: 4 } }
    };
    const registry = {
        require(id) {
            if (!recipes[id]) throw new Error(`missing:${id}`);
            return recipes[id];
        },
        ids() { return Object.keys(recipes); }
    };
    const resolver = new B5RecipeResolver({ recipeRegistry: registry, config: { targetId: 'super_alloy' } });
    const resolved = resolver.recipeForOutput('super_alloy', [{ outputId: 'super_alloy', recipeId: 'super_alloy' }]);
    assert.equal(resolved.recipeId, 'super_alloy');
    assert.equal(resolved.recipe, recipes.super_alloy);
    assert.equal(resolver.isB5DirectlyReady({
        fullPlan: { targetId: 'super_alloy' },
        finalSteps: [{ outputId: 'super_alloy', recipeId: 'super_alloy' }],
        nonStorageAvailable: { tungsten: 8, titanium: 16, carbon: 32 }
    }, 1), true);
    assert.equal(resolver.isB5DirectlyReady({
        fullPlan: { targetId: 'super_alloy' },
        finalSteps: [{ outputId: 'super_alloy', recipeId: 'super_alloy' }],
        nonStorageAvailable: { tungsten: 8, titanium: 15, carbon: 32 }
    }, 1), false);
});

test('B5RecipeResolver falls back to registry output scan when direct recipe id is unavailable', () => {
    const registry = {
        require(id) {
            if (id === 'recipe-carbon') return { output: 'carbon', inputs: { refined_coal_block: 8 } };
            throw new Error(`missing:${id}`);
        },
        ids() { return ['missing-candidate', 'recipe-carbon']; }
    };
    const resolver = new B5RecipeResolver({ recipeRegistry: registry });
    const resolved = resolver.recipeForOutput('carbon', [{ outputId: 'carbon', recipeId: 'stale-carbon-id' }]);
    assert.equal(resolved.recipeId, 'recipe-carbon');
    assert.equal(resolved.recipe.output, 'carbon');
});
