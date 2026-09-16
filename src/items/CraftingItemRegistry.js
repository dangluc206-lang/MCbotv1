'use strict';
const { immutableClone } = require('../shared/utils/object');

// ponytail: B1 items are vanilla and items.json only carries material rules for
// them, so their display names live here. Upgrade path: add `name` rules to
// config/items/items.json if the server ever renames them; this map is the
// fallback and stays secondary to any config-provided name rule.
const VANILLA_DISPLAY_NAMES = Object.freeze({
    cobblestone: 'Cobblestone',
    coal: 'Coal',
    redstone: 'Redstone',
    lapis_lazuli: 'Lapis Lazuli',
    iron_ingot: 'Iron Ingot',
    gold_ingot: 'Gold Ingot',
    diamond: 'Diamond',
    emerald: 'Emerald'
});

/**
 * Unified read-only view over the existing item identity catalog, the crafting
 * recipe registry and the B1-B5 tier mapping. Tier letters are internal
 * classification metadata only; the user-facing identifier is always the real
 * item id / display name. Composes existing registries, owns no config I/O and
 * has no Mineflayer dependency.
 */
class CraftingItemRegistry {
    constructor({ itemRegistry, recipeRegistry, tiers = {} }) {
        if (!itemRegistry || typeof itemRegistry.get !== 'function') throw new TypeError('ItemRegistry is required.');
        if (!recipeRegistry || typeof recipeRegistry.ids !== 'function') throw new TypeError('CraftingRecipeRegistry is required.');

        this.#tierByItem = buildTierIndex(tiers);
        this.#recipeByOutput = buildRecipeIndex(recipeRegistry);
        this.#displayNameByItem = buildDisplayNameIndex(itemRegistry);
        this.#idsByDisplayName = buildDisplayNameLookup(this.#displayNameByItem);
        this.itemRegistry = itemRegistry;
        this.recipeRegistry = recipeRegistry;
    }

    #tierByItem;
    #recipeByOutput;
    #displayNameByItem;
    #idsByDisplayName;

    resolveById(id) {
        const itemId = String(id || '').trim();
        if (!itemId || !this.itemRegistry.get(itemId)) return null;
        return this.#entry(itemId);
    }

    requireById(id) {
        const entry = this.resolveById(id);
        if (!entry) throw new Error(`Item not found in registry: ${id}`);
        return entry;
    }

    resolveByDisplayName(name) {
        const key = String(name || '').trim().toLowerCase();
        if (!key) return null;
        const itemId = this.#idsByDisplayName.get(key);
        return itemId ? this.#entry(itemId) : null;
    }

    getRecipe(id) {
        const recipe = this.#recipeByOutput.get(String(id || '').trim());
        return recipe ? immutableClone(recipe) : null;
    }

    // ponytail: DFS over recipes.json which is validated acyclic by
    // ConfigurationContractValidator; the seen set is only a cycle guard.
    getInputChain(id) {
        const chain = [];
        const seen = new Set([String(id || '').trim()]);
        const walk = itemId => {
            const recipe = this.#recipeByOutput.get(itemId);
            if (!recipe) return;
            for (const inputId of Object.keys(recipe.inputs || {})) {
                if (seen.has(inputId)) continue;
                seen.add(inputId);
                chain.push(inputId);
                walk(inputId);
            }
        };
        walk(String(id || '').trim());
        return Object.freeze(chain);
    }

    getOutputChain(id) {
        const chain = [];
        const target = String(id || '').trim();
        for (const [outputId, recipe] of this.#recipeByOutput) {
            if (outputId !== target && Object.keys(recipe.inputs || {}).includes(target) && !chain.includes(outputId)) {
                chain.push(outputId);
            }
        }
        // ponytail: recipes.json is validated acyclic, so bounded expansion is safe.
        for (let i = 0; i < chain.length; i += 1) {
            for (const [outputId, recipe] of this.#recipeByOutput) {
                if (Object.keys(recipe.inputs || {}).includes(chain[i]) && !chain.includes(outputId) && outputId !== target) {
                    chain.push(outputId);
                }
            }
        }
        return Object.freeze(chain);
    }

    ids() {
        // Crafting-scoped view only: tier members plus recipe outputs/inputs.
        const ids = new Set(this.#tierByItem.keys());
        for (const recipe of this.#recipeByOutput.values()) {
            ids.add(recipe.output);
            for (const inputId of Object.keys(recipe.inputs || {})) ids.add(inputId);
        }
        return Object.freeze([...ids].filter(id => this.itemRegistry.get(id)));
    }

    items() {
        return Object.freeze([...this.ids()].map(id => this.#entry(id)));
    }

    #entry(itemId) {
        const definition = this.itemRegistry.get(itemId) || {};
        const recipe = this.#recipeByOutput.get(itemId) || null;
        const tier = this.#tierByItem.get(itemId) || null;
        return Object.freeze({
            id: itemId,
            displayName: this.#displayNameByItem.get(itemId) || itemId,
            tier,
            classifications: Object.freeze(tier ? [tier] : []),
            identities: extractIdentityRules(definition),
            recipe: recipe ? immutableClone(recipe) : null
        });
    }
}

function buildTierIndex(tiers) {
    const tierByItem = new Map();
    for (const [tier, ids] of Object.entries(tiers || {})) {
        for (const id of ids || []) tierByItem.set(id, tier);
    }
    return tierByItem;
}

function buildRecipeIndex(recipeRegistry) {
    const recipeByOutput = new Map();
    for (const id of recipeRegistry.ids()) {
        const recipe = recipeRegistry.require(id);
        recipeByOutput.set(recipe.output || id, recipe);
    }
    return recipeByOutput;
}

function buildDisplayNameIndex(itemRegistry) {
    const displayNameByItem = new Map();
    for (const id of itemRegistry.ids()) {
        const definition = itemRegistry.get(id) || {};
        const name = extractNameRule(definition) || VANILLA_DISPLAY_NAMES[id] || null;
        if (name) displayNameByItem.set(id, name);
    }
    return displayNameByItem;
}

function buildDisplayNameLookup(displayNameByItem) {
    const byName = new Map();
    for (const [id, name] of displayNameByItem) {
        const key = name.toLowerCase();
        // ponytail: first id wins on duplicate display names; identity rules
        // are the authoritative disambiguator for colliding names.
        if (!byName.has(key)) byName.set(key, id);
    }
    return byName;
}

function extractNameRule(definition) {
    const representations = definition?.representations || {};
    for (const representation of Object.values(representations)) {
        for (const rule of representation?.rules || []) {
            if (rule?.type === 'name' && rule.value) return rule.value;
        }
    }
    return null;
}

function extractIdentityRules(definition) {
    const identities = [];
    for (const representation of Object.values(definition?.representations || {})) {
        for (const rule of representation?.rules || []) {
            if (rule?.type === 'identity' && rule.value && !identities.includes(rule.value)) identities.push(rule.value);
        }
    }
    return Object.freeze(identities);
}

module.exports = CraftingItemRegistry;
