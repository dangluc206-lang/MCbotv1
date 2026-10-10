'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '../../..');
const RECIPES = require(path.join(ROOT, 'config/server-data/recipes.json'));
const PROCEDURES = require(path.join(ROOT, 'config/server-data/procedures.json'));
const ITEMS = require(path.join(ROOT, 'config/items/items.json'));
const CraftingRecipeRegistry = require(path.join(ROOT, 'src/server-features/crafting/CraftingRecipeRegistry'));
const ProcedureRegistry = require(path.join(ROOT, 'src/server-features/crafting/procedure/ProcedureRegistry'));
const CraftingPlanner = require(path.join(ROOT, 'src/planning/crafting/CraftingPlanner'));
const MaterialCalculator = require(path.join(ROOT, 'src/planning/crafting/MaterialCalculator'));

const KNOWN_ITEMS = new Set(
    Array.isArray(ITEMS) ? ITEMS.map(entry => entry.id || entry.itemId) : Object.keys(ITEMS)
);

// G22 Case A: sequence already expressible -> add recipe only, no source change.
// A data-only recipe resolves, plans, and executes through the SAME
// registries/engine as every other recipe.
test('G22 case A: a data-only recipe reuses the shared procedure with no new class', () => {
    const recipes = new CraftingRecipeRegistry(RECIPES);
    const procedures = new ProcedureRegistry(PROCEDURES);

    const recipe = recipes.require('my_item');
    assert.equal(recipe.procedure, 'minerals-crafting');
    assert.ok(procedures.get(recipe.procedure), 'shared procedure must exist');

    for (const id of recipes.ids()) {
        const entry = recipes.require(id);
        assert.ok(KNOWN_ITEMS.has(entry.output), `${id}: output must be a known item`);
        for (const inputId of Object.keys(entry.inputs || {})) {
            assert.ok(KNOWN_ITEMS.has(inputId), `${id}: input ${inputId} must be a known item`);
        }
        assert.ok(procedures.get(entry.procedure), `${id}: procedure must exist`);
    }
});

test('G22 case A: data-only recipe plans exactly through the generic planner', () => {
    const registry = new CraftingRecipeRegistry(RECIPES);
    const planner = new CraftingPlanner({
        recipeRegistry: registry,
        materialCalculator: new MaterialCalculator({ recipeRegistry: registry })
    });
    const plan = planner.plan('my_item', 3, { iron_ingot: 200, carbon: 20 });
    assert.equal(plan.steps.find(step => step.outputId === 'my_item').crafts, 3);
    assert.ok(plan.steps.every(step => Number.isInteger(step.crafts) && step.crafts > 0));
    assert.deepEqual(plan.missing, {});
});

// G22 Case B: same procedure, different params -> procedure param/config.
// Procedures are data (params), not classes: many recipes share one procedure
// id while differing only in recipe-level data (slot/inputs).
test('G22 case B: recipes share one procedure id with recipe-level params only', () => {
    const recipes = new CraftingRecipeRegistry(RECIPES);
    const procedures = new ProcedureRegistry(PROCEDURES);
    const sharing = recipes.ids()
        .map(id => recipes.require(id))
        .filter(entry => entry.procedure === 'minerals-crafting');
    assert.ok(sharing.length >= 20, `expected many recipes on one procedure, got ${sharing.length}`);
    const slots = new Set(sharing.map(entry => entry.menuSlot));
    assert.ok(slots.size > 1, 'shared procedure must serve distinct per-recipe params (menuSlot)');
    assert.equal(procedures.require('minerals-crafting').quantityStrategy, 'button-batch');
    // No recipe-specific executor class exists for any shipped recipe id.
    for (const root of ['src/server-features/crafting', 'src/modes/crafting']) {
        const files = fs.readdirSync(path.join(ROOT, root), { recursive: true });
        const hits = files.filter(file => {
            const name = String(file).toLowerCase();
            if (!/operation|service|coordinator|executor/.test(name)) return false;
            if (/craftingoperation|craftautomation|craftingmode|procedure|cycle|reserve|intermediate|inventory|coordinator/i.test(String(file))) return false;
            return recipes.ids().some(id => name.includes(id.replace(/_/g, '')));
        });
        assert.deepEqual(hits, [], `no recipe-specific class may exist in ${root}`);
    }
});

// G22 Case C negative pin: forge/npc-shaped procedures (different terminal
// semantics) fail closed in the /ks GUI operation — they must NOT silently run
// the minerals GUI. Until a real owner exists, the boundary stays closed and no
// recipe may reference them as a shortcut around the engine.
test('G22 case C: non-minerals procedure shapes stay fail-closed, never silent', () => {
    const procedures = new ProcedureRegistry(PROCEDURES);
    const isMineralsShape = procedure => {
        const types = new Set((procedure.steps || []).map(step => String(step?.type || '').trim()));
        return (types.has('command') || types.has('slash-command')) && types.has('find-logical-item');
    };
    assert.equal(isMineralsShape(procedures.require('minerals-crafting')), true);
    assert.equal(isMineralsShape(procedures.require('forge-crafting')), false);
    assert.equal(isMineralsShape(procedures.require('npc-crafting')), false);
    const recipes = new CraftingRecipeRegistry(RECIPES);
    for (const id of recipes.ids()) {
        assert.equal(recipes.require(id).procedure, 'minerals-crafting', `${id} must use the supported shape`);
    }
});
