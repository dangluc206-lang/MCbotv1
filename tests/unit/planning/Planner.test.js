'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const CraftingRecipeRegistry=require('../../../src/server-features/crafting/CraftingRecipeRegistry');const MaterialCalculator=require('../../../src/planning/crafting/MaterialCalculator');const CraftingPlanner=require('../../../src/planning/crafting/CraftingPlanner');
test('planner recursively calculates base materials',()=>{const registry=new CraftingRecipeRegistry({b2:{output:'b2',outputAmount:1,inputs:{b1:16}},b3:{output:'b3',outputAmount:1,inputs:{b2:16}}});const planner=new CraftingPlanner({recipeRegistry:registry,materialCalculator:new MaterialCalculator({recipeRegistry:registry})});const plan=planner.plan('b3',1,{b1:100});assert.equal(plan.baseMaterials.b1,256);assert.equal(plan.missing.b1,156);});

test('B5 recipe graph calculates the configured base materials',()=>{
    const recipes=require('../../../config/server-data/recipes.json');
    const registry=new CraftingRecipeRegistry(recipes);
    const calculator=new MaterialCalculator({recipeRegistry:registry});
    assert.deepEqual(calculator.requirements('super_alloy',1),{
        cobblestone:36864,
        diamond:65536,
        emerald:32768,
        iron_ingot:327680,
        gold_ingot:196608,
        lapis_lazuli:65536,
        redstone:262144,
        coal:131072
    });
});

test('planner consumes existing intermediate tiers before requiring more B1',()=>{
    const registry=new CraftingRecipeRegistry({
        b2:{output:'b2',outputAmount:1,inputs:{b1:16}},
        b3:{output:'b3',outputAmount:1,inputs:{b2:16}}
    });
    const planner=new CraftingPlanner({recipeRegistry:registry,materialCalculator:new MaterialCalculator({recipeRegistry:registry})});
    const plan=planner.plan('b3',2,{b3:1,b2:8,b1:128});
    assert.equal(plan.feasible,true);
    assert.equal(plan.availableUsed.b3,1);
    assert.equal(plan.availableUsed.b2,8);
    assert.equal(plan.availableUsed.b1,128);
    assert.equal(plan.steps.find(step=>step.outputId==='b2').crafts,8);
    assert.equal(plan.steps.find(step=>step.outputId==='b3').crafts,1);
});
