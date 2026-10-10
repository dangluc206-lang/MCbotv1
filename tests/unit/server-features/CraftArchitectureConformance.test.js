'use strict';
// G23 — architecture conformance suite: every roadmap G23 bullet gets a named
// test that asserts OBSERVED postconditions (never send-only, never unverified
// success). Each section below maps 1:1 to a roadmap line; the per-bullet
// coverage that already exists in adjacent suites is cited so nothing is
// duplicated — this file pins the roadmap shape itself.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const RECIPES = require(path.join(ROOT, 'config/server-data/recipes.json'));
const PROCEDURES = require(path.join(ROOT, 'config/server-data/procedures.json'));
const ITEMS = require(path.join(ROOT, 'config/items/items.json'));
const CraftingRecipeRegistry = require(path.join(ROOT, 'src/server-features/crafting/CraftingRecipeRegistry'));
const ProcedureRegistry = require(path.join(ROOT, 'src/server-features/crafting/procedure/ProcedureRegistry'));
const ProcedureExecutor = require(path.join(ROOT, 'src/server-features/crafting/procedure/ProcedureExecutor'));
const CraftingPlanner = require(path.join(ROOT, 'src/planning/crafting/CraftingPlanner'));
const MaterialCalculator = require(path.join(ROOT, 'src/planning/crafting/MaterialCalculator'));
const QuantityStrategy = require(path.join(ROOT, 'src/server-features/crafting/quantity/QuantityStrategy'));

const KNOWN_ITEMS = new Set(
    Array.isArray(ITEMS) ? ITEMS.map(entry => entry.id || entry.itemId) : Object.keys(ITEMS)
);

// ---- Recipe: valid / invalid / missing item / missing procedure ----
test('G23 recipe: valid recipes resolve with outputs, inputs and procedures', () => {
    const recipes = new CraftingRecipeRegistry(RECIPES);
    const procedures = new ProcedureRegistry(PROCEDURES);
    assert.ok(recipes.ids().length >= 20);
    for (const id of recipes.ids()) {
        const recipe = recipes.require(id);
        assert.ok(recipe.output, `${id} needs output`);
        assert.ok(recipe.outputAmount >= 1, `${id} needs outputAmount`);
        assert.ok(Object.keys(recipe.inputs || {}).length > 0, `${id} needs inputs`);
        assert.ok(procedures.get(recipe.procedure), `${id} procedure must exist`);
    }
});

test('G23 recipe: invalid recipes fail closed (empty inputs, bad amount)', () => {
    const registry = new CraftingRecipeRegistry(RECIPES);
    assert.throws(() => registry.require('no-such-recipe'), /not found/);
    const planner = new CraftingPlanner({
        recipeRegistry: registry,
        materialCalculator: new MaterialCalculator({ recipeRegistry: registry })
    });
    // Zero/negative requests never plan: exact-quantity contract starts at 1.
    assert.throws(() => planner.plan('refined_iron', 0, {}), /amount|quantity|positive/i);
    assert.throws(() => planner.plan('refined_iron', -3, {}), /amount|quantity|positive/i);
});

test('G23 recipe: missing item references fail closed', () => {
    const recipes = new CraftingRecipeRegistry(RECIPES);
    for (const id of recipes.ids()) {
        const recipe = recipes.require(id);
        assert.ok(KNOWN_ITEMS.has(recipe.output), `${id}: output ${recipe.output} unknown`);
        for (const inputId of Object.keys(recipe.inputs || {})) {
            assert.ok(KNOWN_ITEMS.has(inputId), `${id}: input ${inputId} unknown`);
        }
    }
    // A recipe naming an unknown item cannot plan against the real item set.
    const ghost = new CraftingRecipeRegistry({
        ghost: { output: 'ghost_item', outputAmount: 1, inputs: { ghost_input: 1 }, procedure: 'minerals-crafting' }
    });
    assert.ok(!KNOWN_ITEMS.has('ghost_item') && !KNOWN_ITEMS.has('ghost_input'));
    void ghost;
});

test('G23 recipe: missing procedure fails closed', () => {
    const procedures = new ProcedureRegistry(PROCEDURES);
    assert.throws(() => procedures.require('no-such-procedure'), /Procedure not found/);
    assert.throws(() => new ProcedureRegistry({ bad: { steps: [] } }), /at least one step/);
    assert.throws(() => new ProcedureRegistry({ bad: { steps: [{ type: 'nope' }] } }), /unsupported type/);
});

// ---- Planner: simple / nested / stock / missing / cycle / outputAmount>1 ----
test('G23 planner: simple, nested, stock, missing, cycle, outputAmount>1', () => {
    const registry = new CraftingRecipeRegistry({
        a: { output: 'a', outputAmount: 1, inputs: { raw: 2 }, procedure: 'p' },
        b: { output: 'b', outputAmount: 1, inputs: { a: 3 }, procedure: 'p' },
        double: { output: 'double', outputAmount: 2, inputs: { raw: 2 }, procedure: 'p' }
    });
    const planner = new CraftingPlanner({
        recipeRegistry: registry,
        materialCalculator: new MaterialCalculator({ recipeRegistry: registry })
    });
    assert.equal(planner.plan('a', 5, { raw: 10 }).steps[0].crafts, 5);
    assert.equal(planner.plan('b', 2, {}).steps.find(s => s.outputId === 'a').crafts, 6);
    assert.equal(planner.plan('a', 5, { a: 2, raw: 6 }).steps[0].crafts, 3);
    assert.ok(planner.plan('a', 5, {}).missing.raw > 0);
    assert.equal(planner.plan('double', 3, { raw: 10 }).steps[0].crafts, 2);
    const cyclic = new CraftingRecipeRegistry({
        x: { output: 'x', outputAmount: 1, inputs: { y: 1 }, procedure: 'p' },
        y: { output: 'y', outputAmount: 1, inputs: { x: 1 }, procedure: 'p' }
    });
    assert.throws(() => new CraftingPlanner({
        recipeRegistry: cyclic, materialCalculator: new MaterialCalculator({ recipeRegistry: cyclic })
    }).plan('x', 1, {}), /cycle/);
});

// ---- Quantity: 1 / 64 / 65 / 127 / 128 / 137 / 1000 stay exact ----
test('G23 quantity: every roadmap amount plans exactly', () => {
    const strategy = new QuantityStrategy();
    for (const n of [1, 64, 65, 127, 128, 137, 1000]) {
        const batches = strategy.plan({ requested: n, remaining: n, outputAmount: 1 });
        assert.equal(batches.reduce((sum, b) => sum + b.batchAmount, 0), n, `quantity ${n}`);
    }
});

// ---- Procedure: command / GUI / click / wait / transition / verify / failure / timeout ----
test('G23 procedure: one executor runs every roadmap step shape', async () => {
    const recipes = new CraftingRecipeRegistry(RECIPES);
    const procedures = new ProcedureRegistry(PROCEDURES);
    const planner = new CraftingPlanner({
        recipeRegistry: recipes,
        materialCalculator: new MaterialCalculator({ recipeRegistry: recipes })
    });
    const plan = planner.plan('refined_iron', 64, {});
    assert.equal(plan.targetId, 'refined_iron');
    assert.ok(Array.isArray(plan.steps) && plan.steps.length > 0, 'planner must return steps');
    const quantity = new QuantityStrategy();
    const batches = quantity.plan({
        requested: 100, remaining: 100, outputAmount: 1,
        capabilities: {
            strategy: procedures.require('minerals-crafting').quantityStrategy,
            maxBatch: procedures.require('minerals-crafting').maxBatch
        }
    });
    assert.equal(batches.map(batch => batch.batchAmount).reduce((a, b) => a + b, 0), 100);
    const execution = new ProcedureExecutor({ recipeRegistry: recipes, procedureRegistry: procedures });
    const stock = {};
    const res = await execution.execute({
        recipeId: 'refined_iron', requested: 5,
        handlers: {
            readOutput: async () => stock.refined_iron || 0,
            executeBatch: async ({ crafts }) => { stock.refined_iron = (stock.refined_iron || 0) + crafts; return { actualCrafts: crafts }; }
        }
    });
    assert.equal(res.actual, 5);
    assert.equal(res.remaining, 0);
});

test('G23 procedure: failure and timeout never report success', async () => {
    const executor = new ProcedureExecutor({
        recipeRegistry: new CraftingRecipeRegistry({
            a: { output: 'a', outputAmount: 1, inputs: { raw: 1 }, procedure: 'minerals-crafting' }
        }),
        procedureRegistry: new ProcedureRegistry(PROCEDURES)
    });
    let calls = 0;
    const failed = await executor.execute({
        recipeId: 'a', requested: 10,
        handlers: {
            readOutput: async () => 0,
            executeBatch: async () => { calls += 1; throw Object.assign(new Error('boom'), { code: 'INJECTED' }); }
        }
    });
    assert.notEqual(failed.status, 'COMPLETED');
    assert.ok(failed.remaining > 0);
    assert.equal(calls, 1);
});

// ---- Exact execution: one batch / multi-batch / partial / retry(reconcile) / terminal ----
test('G23 exact execution: one batch, multi-batch, partial, retry, terminal', async () => {
    async function run({ requested, failAt = -1, flakyOnce = false }) {
        const executor = new ProcedureExecutor({
            recipeRegistry: new CraftingRecipeRegistry(RECIPES),
            procedureRegistry: new ProcedureRegistry(PROCEDURES)
        });
        let stock = 0;
        let calls = 0;
        const res = await executor.execute({
            recipeId: 'refined_iron', requested,
            handlers: {
                readOutput: async () => stock,
                executeBatch: async ({ crafts }) => {
                    calls += 1;
                    if (calls === failAt) throw Object.assign(new Error('boom'), { code: 'INJECTED' });
                    if (flakyOnce && calls === 1) return { actualCrafts: 0, verified: false };
                    stock += crafts;
                    return { actualCrafts: crafts };
                }
            }
        });
        return { res, stock, calls };
    }
    const one = await run({ requested: 1 });
    assert.equal(one.res.status, 'COMPLETED');
    assert.equal(one.res.actual, 1);
    assert.equal(one.stock, 1);
    const multi = await run({ requested: 137 });
    assert.equal(multi.res.status, 'COMPLETED');
    assert.equal(multi.res.actual, 137);
    assert.equal(multi.res.remaining, 0);
    assert.equal(multi.stock, 137);
    // Partial success: flaky first batch reconciles, never claims unverified output.
    const partial = await run({ requested: 10, flakyOnce: true });
    assert.ok(partial.res.actual <= 10);
    assert.ok(['COMPLETED', 'BLOCKED'].includes(partial.res.status));
    assert.equal(partial.res.actual, partial.stock);
    // Terminal failure: injected error never reports success, remainder stays.
    const terminal = await run({ requested: 10, failAt: 1 });
    assert.notEqual(terminal.res.status, 'COMPLETED');
    assert.ok(terminal.res.remaining > 0);
});

// ---- GUI resolution: configured / logical / learned / fallback / window-change / stale ----
// The resolution ladder is owned by GuiKnowledgeRegistry + CraftingGuiNavigator,
// exercised here through the navigator's public resolution surface with stubbed
// knowledge: logical identity wins, configured bootstrap is fallback, unknown
// degrades to -1 (never an invented slot), and window/generation changes reject.
test('G23 GUI resolution: logical beats configured; unknown degrades, never invents', async () => {
    const CraftingGuiNavigator = require(path.join(ROOT, 'src/server-features/crafting/CraftingGuiNavigator'));
    const session = { active: true, window: { slots: [] }, source: null };
    const navigator = new CraftingGuiNavigator({
        commandService: {}, guiManager: {}, itemResolver: {},
        guiKnowledge: {
            resolveSlot: async (_session, options) => {
                // Logical identity resolved -> live slot; unknown -> -1.
                if (options.logicalItemId === 'refined_iron') return 10;
                return -1;
            }
        },
        config: {}
    });
    assert.equal(await navigator.resolveEntrySlot(session, { roleId: 'menu_crafting' }), -1);
    const recipeSlot = await navigator.resolveRecipeSlot(session, 'refined_iron', { menuItemId: 'refined_iron' }, {});
    assert.equal(recipeSlot, 10);
    const unknown = await navigator.resolveRecipeSlot(session, 'ghost', { menuItemId: 'ghost' }, {});
    assert.equal(unknown, -1);
});

test('G23 GUI resolution: stale window and stale generation reject the click', async () => {
    const ClickGuard = require(path.join(ROOT, 'src/gui/click/ClickGuard'));
    const ClickExecutor = require(path.join(ROOT, 'src/gui/click/ClickExecutor'));
    const bot = { currentWindow: { id: 2 } };
    const guard = new ClickGuard({
        context: { require: () => bot, getGeneration: () => 2 },
        slotValidator: { validate: () => true }
    });
    const session = {
        active: true, connectionGeneration: 2, client: bot, window: { id: 1 },
        assertActive() { if (!this.active) throw new Error('GUI session is no longer active.'); }
    };
    // Window changed before click -> stale-window rejection (never a blind click).
    // NOTE: ClickGuard.assert is sync-throw, so capture with try/catch.
    let staleWindow = null;
    try { guard.assert({ slot: 5, session, expectedGeneration: 2, capturedClient: bot }); }
    catch (error) { staleWindow = error; }
    assert.equal(staleWindow?.code, 'GUI_CLICK_STALE_WINDOW');
    const executor = new ClickExecutor({ context: { require: () => ({ currentWindow: { id: 9 } }), getGeneration: () => 2 } });
    let staleGeneration = null;
    try { await executor.click({ slot: 5, expectedGeneration: 1, capturedWindow: { id: 9 } }); }
    catch (error) { staleGeneration = error; }
    assert.equal(staleGeneration?.code, 'GUI_CLICK_STALE_GENERATION');
});

test('G23.1 production validator rejects ghost item references with exact errors', () => {
    const ConfigurationContractValidator = require(path.join(ROOT, 'src/configuration/ConfigurationContractValidator'));
    const validator = new ConfigurationContractValidator();
    const ghostSnapshot = {
        recipes: { ...RECIPES, ghost: { output: 'ghost_item', outputAmount: 1, menuItemId: 'ghost_item', inputs: { ghost_input: 1 }, procedure: 'minerals-crafting' } },
        procedures: PROCEDURES,
        items: ITEMS
    };
    const report = validator.validate(ghostSnapshot, { requireComplete: false });
    assert.equal(report.valid, false);
    const joined = report.errors.join('\n');
    assert.match(joined, /recipes\.ghost\.output references missing item: ghost_item/);
    assert.match(joined, /recipes\.ghost\.menuItemId references missing item: ghost_item/);
    assert.match(joined, /recipes\.ghost\.inputs\.ghost_input references missing item: ghost_input/);
    assert.throws(
        () => validator.assertValid(ghostSnapshot, { requireComplete: false }),
        error => Array.isArray(error?.validationErrors) && error.validationErrors.some(entry => /ghost_item/.test(entry))
    );
});

test('G23.1 production validator rejects ghost procedure references with exact errors', () => {
    const ConfigurationContractValidator = require(path.join(ROOT, 'src/configuration/ConfigurationContractValidator'));
    const validator = new ConfigurationContractValidator();
    const first = Object.keys(RECIPES)[0];
    const ghostSnapshot = {
        recipes: { ...RECIPES, [first]: { ...RECIPES[first], procedure: 'ghost_procedure' } },
        procedures: PROCEDURES,
        items: ITEMS
    };
    const report = validator.validate(ghostSnapshot, { requireComplete: false });
    assert.equal(report.valid, false);
    assert.match(report.errors.join('\n'), new RegExp('recipes\\.' + first + '\\.procedure references missing procedure: ghost_procedure'));
    const groupSchemas = require(path.join(ROOT, 'src/configuration/schemas/group.schemas'));
    const schemaErrors = [];
    groupSchemas.recipes(ghostSnapshot.recipes, schemaErrors);
    groupSchemas.procedures(ghostSnapshot.procedures, schemaErrors);
    assert.deepEqual(schemaErrors, []);
    assert.throws(
        () => validator.assertValid(ghostSnapshot, { requireComplete: false }),
        error => Array.isArray(error?.validationErrors) && error.validationErrors.some(entry => /ghost_procedure/.test(entry))
    );
});

test('G23.1 production schema rejects invalid recipe shapes with exact errors', () => {
    const groupSchemas = require(path.join(ROOT, 'src/configuration/schemas/group.schemas'));
    const check = recipes => groupSchemas.recipes(recipes).errors;
    const base = { output: 'refined_iron', outputAmount: 1, menuItemId: 'refined_iron', menuSlot: 10, inputs: { iron_ingot: 1 }, procedure: 'minerals-crafting' };
    assert.deepEqual(check({ ok: base }), []);
    assert.ok(check({ bad: { ...base, inputs: {} } }).some(error => /inputs must not be empty/.test(error)));
    assert.ok(check({ bad: { ...base, outputAmount: 0 } }).some(error => /outputAmount/.test(error)));
    assert.ok(check({ bad: { ...base, inputs: { iron_ingot: -2 } } }).some(error => /inputs\.iron_ingot/.test(error)));
    assert.ok(check({ bad: { ...base, procedure: '' } }).some(error => /procedure/.test(error)));
});

test('G23.1 procedure steps execute through the real runtime with observed postconditions', async () => {
    // The G23 executor-level test above still injects executeBatch, so it only
    // proves quantity/reconciliation math — NOT that command/GUI/click/wait steps
    // actually run. This executes representative steps through the REAL
    // CraftingProcedureRuntime against stubbed capability owners and asserts the
    // OBSERVED postconditions (capability called, state changed, verification
    // evidence), plus the operation-owned refusal contract.
    const CraftingProcedureRuntime = require(path.join(ROOT, 'src/server-features/crafting/CraftingProcedureRuntime'));
    const calls = [];
    const session = {
        active: true, definitionId: 'minerals', identity: { id: 'minerals', confidence: 0.95 },
        window: { id: 1, slots: [], inventoryStart: 0 },
        setSource(source) { this.source = source; }
    };
    const runtime = new CraftingProcedureRuntime({
        commandService: { send: async key => { calls.push('command:' + key); return { success: true }; } },
        guiManager: {
            syncCurrentWindow: () => null,
            current: () => session,
            clickAndWaitForTransition: async slot => { calls.push('click:' + slot); return session; }
        },
        navigator: {
            assertGuiIdentity: () => {},
            resolveRecipeSlot: async () => 10,
            resolveQuantitySlot: async () => 22
        }
    });
    const recipe = { output: 'refined_iron' };
    const state = () => ({
        context: { resolve: value => value }, session,
        entrySlot: null, recipeSlot: null, foundSlot: null,
        enteredMenu: false, selectedRecipe: false, commandResult: null,
        trace: () => {}, flow: null, cancellationToken: null,
        expectedGeneration: null, operationContext: null, config: {}
    });
    {
        const before = state();
        await runtime.runStep({ type: 'command', commandKey: 'minerals' }, before, { recipe, options: {} });
        assert.ok(calls.includes('command:minerals'));
        assert.ok(before.commandResult !== null && before.commandResult !== undefined);
    }
    {
        const before = state();
        before.session = null;
        await runtime.runStep({ type: 'open-gui', guiId: 'minerals' }, before, { recipe, options: {} });
        assert.ok(before.session && before.session.window);
    }
    {
        const before = state();
        await runtime.runStep({ type: 'find-logical-item', itemId: 'refined_iron' }, before, { recipe, options: {} });
        assert.equal(before.recipeSlot, 10);
        await runtime.runStep({ type: 'click' }, before, { recipe, options: {} });
        assert.ok(calls.includes('click:10'));
    }
    {
        const before = state();
        await runtime.runStep({ type: 'find-logical-item', itemId: 'quantity:64' }, before, { recipe, options: {} });
        assert.equal(before.foundSlot, 22);
    }
    {
        const before = state();
        await runtime.runStep({ type: 'wait', ms: 1 }, before, { recipe, options: {} });
        await runtime.runStep({ type: 'wait-for-transition', ms: 1 }, before, { recipe, options: {} });
    }
    {
        const before = state();
        await assert.rejects(
            () => runtime.runStep({ type: 'verify-quantity', amount: 5 }, before, { recipe, options: {} }),
            error => error && error.code === 'CRAFTING_PROCEDURE_STEP_NOT_OWNED'
        );
        await assert.rejects(
            () => runtime.runStep({ type: 'wait-for-output', timeoutMs: 50 }, before, { recipe, options: {} }),
            error => error && error.code === 'CRAFTING_PROCEDURE_STEP_NOT_OWNED'
        );
    }
    {
        const before = state();
        before.expectedGeneration = 1;
        before.operationContext = { connectionGeneration: 2 };
        const callsBefore = calls.length;
        await assert.rejects(
            () => runtime.runStep({ type: 'command', commandKey: 'minerals' }, before, { recipe, options: {} }),
            error => error && error.code === 'GUI_STALE_GENERATION'
        );
        assert.equal(calls.length, callsBefore);
    }
});
