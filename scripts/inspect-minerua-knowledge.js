'use strict';

const fs = require('node:fs');
const path = require('node:path');
const createServerProfileRegistry = require('../src/server-profiles/createServerProfileRegistry');

const root = path.resolve(__dirname, '..');
function readJson(relative) { return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')); }
function row({ factId, category, meaning, locations, status = 'CONFIRMED', consumers = [], risk = 'LOW', target, tests = [], notes = null }) {
    return { factId, category, semanticMeaning: meaning, currentLocations: locations, status, evidence: 'committed-config-and-server-behavior-doc', consumers, mutationRisk: risk, targetProfileGroup: target, testCoverage: tests, notes };
}
function buildInventory() {
    const server = readJson('config/server.json');
    const profileId = server.defaultProfile || Object.keys(server.profiles || {})[0] || 'default';
    const serverProfile = createServerProfileRegistry(server).require(profileId);
    const commands = readJson('config/commands/commands.json');
    const windows = readJson('config/gui/windows.json');
    const items = readJson('config/items/items.json');
    const recipes = readJson('config/server-data/recipes.json');
    const tiers = readJson('config/server-data/crafting-tiers.json');
    const b5 = readJson('config/server-data/b5.json');
    const storage = readJson('config/storage/kho.json');
    const pv2 = readJson('config/personal-vault/pv2.json');
    const smelting = readJson('config/smelting/recipes.json');
    const minerals = readJson('config/minerals/menu.json');
    const conversions = readJson('config/minerals/conversions.json');
    const skyblock = readJson('config/skyblock/join.json');
    const login = readJson('config/authentication/login.json');
    const responses = readJson('config/commands/responses.json');

    const facts = [];
    for (const [key, raw] of Object.entries(commands)) {
        facts.push(row({ factId: `command.${key}`, category: 'command', meaning: `Semantic server command ${key}`, locations: ['config/commands/commands.json'], consumers: ['CommandRegistry', 'CommandResolver', 'CommandService'], risk: key === 'login' ? 'HIGH' : 'MEDIUM', target: 'commands', tests: ['tests/unit/commands'] , notes: raw.includes('{password}') ? 'Template contains password placeholder only; secret value is never inventoried.' : raw }));
    }
    for (const [guiId, definition] of Object.entries(windows)) {
        facts.push(row({ factId: `gui.${guiId}`, category: 'gui-identity', meaning: `Stateful GUI identity ${guiId}`, locations: ['config/gui/windows.json'], consumers: ['GuiRegistry', 'GuiDetector', 'GuiIdentityEngine'], risk: 'HIGH', target: 'gui', tests: ['tests/unit/gui'], notes: { title: definition.title || null, layout: definition.layout || null, fingerprintCount: Array.isArray(definition.fingerprints) ? definition.fingerprints.length : 0 } }));
    }
    facts.push(row({ factId: 'auth.login', category: 'authentication', meaning: 'Server login behavior references semantic login command', locations: ['config/authentication/login.json', 'src/server-features/authentication/ServerLoginService.js'], consumers: ['ServerLoginService'], risk: 'HIGH', target: 'authentication', tests: ['tests/unit/server-features/ServerLoginGeneration.test.js'], notes: { enabled: login.enabled, commandKey: login.commandKey, confirm: login.confirm } }));
    facts.push(row({ factId: 'join.skyblock', category: 'join', meaning: 'Sky server selection/join contract', locations: ['config/skyblock/join.json'], consumers: ['SkyblockJoinOperation', 'SkyblockAutoJoinService'], risk: 'HIGH', target: 'join', tests: ['tests/unit/server-features'], notes: { commandKey: skyblock.commandKey, entryGuiId: skyblock.entryGuiId, selections: Object.keys(skyblock.selections || {}), defaultSelection: skyblock.defaultSelection } }));
    facts.push(row({ factId: 'command.responses', category: 'command-response', meaning: 'Server response confirmation patterns', locations: ['config/commands/responses.json'], consumers: ['CommandConfirmation', 'ResponseMatcher'], risk: 'MEDIUM', target: 'commands', tests: ['tests/unit/commands'], notes: { keys: Object.keys(responses).sort() } }));

    facts.push(row({ factId: 'items.catalog', category: 'item-identity', meaning: 'MinerUA/vanilla logical item identity catalog including B1-B5 and GUI carrier identities', locations: ['config/items/items.json'], consumers: ['ItemRegistry', 'ItemResolver', 'GuiIdentityEngine', 'CraftingRecipeRegistry'], risk: 'HIGH', target: 'items', tests: ['tests/unit/items', 'tests/unit/gui'], notes: { itemIds: Object.keys(items).sort(), count: Object.keys(items).length, mmoIdentityItems: Object.entries(items).filter(([,v]) => JSON.stringify(v).includes('MMOITEMS')).map(([k]) => k).sort() } }));
    facts.push(row({ factId: 'recipes.crafting', category: 'recipe', meaning: 'B2-B5 recipe inputs/output/menu-slot/server input source', locations: ['config/server-data/recipes.json'], consumers: ['CraftingRecipeRegistry', 'B5Planner', 'CraftingOperation'], risk: 'HIGH', target: 'recipes', tests: ['tests/unit/planning', 'tests/unit/server-features'], notes: { recipeIds: Object.keys(recipes).sort(), count: Object.keys(recipes).length } }));
    facts.push(row({ factId: 'tiers.b1-b5', category: 'crafting-tier', meaning: 'B1-B5 item tier mapping', locations: ['config/server-data/crafting-tiers.json'], consumers: ['B5Planner', 'B5PlanningService'], risk: 'HIGH', target: 'recipes', tests: ['tests/unit/planning'], notes: tiers }));
    facts.push(row({ factId: 'policy.b5', category: 'bot-policy', meaning: 'B5 execution policy; explicitly not a server-profile fact', locations: ['config/server-data/b5.json'], consumers: ['B5PlanningService', 'B5AutomationService', 'B5CraftModeService'], risk: 'HIGH', target: 'OUTSIDE_PROFILE', tests: ['tests/unit/modes/B5CraftModeService.test.js'], notes: { targetId: b5.targetId, policyKeys: Object.keys(b5).sort() } }));
    facts.push(row({ factId: 'storage.kho', category: 'storage', meaning: 'Kho read/capacity/open semantics', locations: ['config/storage/kho.json'], consumers: ['KhoReader', 'KhoService', 'KhoCapacityReader'], risk: 'HIGH', target: 'storage', tests: ['tests/unit/server-features'], notes: { commandKey: storage.commandKey, guiId: storage.guiId, capacitySlot: storage.capacityIndicator?.slot, fallbackLimit: storage.capacityIndicator?.fallbackLimit } }));
    facts.push(row({ factId: 'storage.sell', category: 'storage-sell', meaning: 'Kho sell GUI semantics and item aliases', locations: ['config/storage/kho.json'], consumers: ['KhoSellOperation', 'SellGuiReader'], risk: 'CRITICAL', target: 'storage', tests: ['tests/unit/server-features'], notes: storage.sell }));
    facts.push(row({ factId: 'storage.pv2', category: 'personal-vault', meaning: 'PV2 container/open/transfer semantics', locations: ['config/personal-vault/pv2.json'], consumers: ['PersonalVaultService', 'PersonalVaultReader', 'PersonalVaultTransfer'], risk: 'HIGH', target: 'storage', tests: ['tests/unit/server-features'], notes: { commandKey: pv2.commandKey, guiId: pv2.guiId, storageSlots: pv2.storageSlots } }));
    facts.push(row({ factId: 'smelting.contract', category: 'smelting', meaning: 'MinerUA smelting menu/action/verification semantics', locations: ['config/smelting/recipes.json'], consumers: ['SmeltingOperation', 'SmeltingService'], risk: 'HIGH', target: 'recipes', tests: ['tests/unit/server-features'], notes: { commandKey: smelting.commandKey, guiId: smelting.guiId, recipes: Object.keys(smelting.recipes || {}).sort() } }));
    facts.push(row({ factId: 'minerals.menu', category: 'conversion', meaning: 'Minerals menu and conversion/crafting entry semantics', locations: ['config/minerals/menu.json'], consumers: ['MineralConversionOperation', 'CraftingOperation'], risk: 'HIGH', target: 'recipes', tests: ['tests/unit/server-features'], notes: { commandKey: minerals.commandKey, guiId: minerals.guiId, conversionGuiId: minerals.conversionGuiId } }));
    facts.push(row({ factId: 'minerals.conversions', category: 'conversion', meaning: 'B1 raw/ingot/block conversion and smelting resource facts', locations: ['config/minerals/conversions.json'], consumers: ['B1StorageMaterialService', 'MineralConversionOperation'], risk: 'CRITICAL', target: 'recipes', tests: ['tests/unit/server-features'], notes: { resources: Object.keys(conversions.resources || {}).sort(), smeltingRecipeIds: conversions.smeltingRecipeIds || [] } }));

    return {
        schemaVersion: 1,
        workPackage: 'WP-101',
        generatedAt: '2026-08-22',
        profile: { id: serverProfile.id, revision: serverProfile.revision, implementation: 'minerua', endpointHost: serverProfile.endpoint.host },
        statusVocabulary: ['CONFIRMED', 'INFERRED', 'UNKNOWN', 'DEPRECATED'],
        safety: { liveServerObserved: false, secretsCaptured: false, runtimeDataCaptured: false, logPayloadCaptured: false },
        counts: { commands: Object.keys(commands).length, guis: Object.keys(windows).length, items: Object.keys(items).length, recipes: Object.keys(recipes).length, facts: facts.length },
        facts,
        conflictsAndUnknowns: [
            { id: 'sky.joinGuiId', status: skyblock.joinGuiId == null ? 'UNKNOWN' : 'CONFIRMED', note: 'joinGuiId is null in committed config; extraction must preserve fallback behavior rather than invent an identity.' },
            { id: 'gui.slots.dynamic', status: Object.keys(readJson('config/gui/slots.json')).length === 0 ? 'INFERRED' : 'CONFIRMED', note: 'Fixed slot registry is empty; recipe/menu/bootstrap and observation knowledge supply current semantic slot evidence.' },
            { id: 'runtime.live-drift', status: 'UNKNOWN', note: 'No live server observation was performed in WP-101.' }
        ],
        extractionBatches: {
            'WP-102': ['config/commands/commands.json', 'config/commands/responses.json', 'config/authentication/login.json', 'config/skyblock/join.json', 'src/commands/**', 'src/server-features/authentication/**', 'src/server-features/skyblock/**'],
            'WP-103': ['config/gui/**', 'config/items/items.json', 'src/gui/**', 'src/items/**'],
            'WP-104': ['config/server-data/**', 'config/storage/kho.json', 'config/personal-vault/pv2.json', 'config/minerals/**', 'config/smelting/**', 'src/server-features/storage/**', 'src/server-features/crafting/**', 'src/server-features/minerals/**', 'src/server-features/smelting/**']
        }
    };
}

function validateInventory(inventory) {
    const failures = [];
    const commandFacts = inventory.facts.filter(f => f.category === 'command');
    if (commandFacts.length !== inventory.counts.commands) failures.push('Every raw command must have an inventory row.');
    const guiFacts = inventory.facts.filter(f => f.category === 'gui-identity');
    if (guiFacts.length !== inventory.counts.guis) failures.push('Every stateful GUI identity must have an inventory row.');
    if (!inventory.facts.some(f => f.factId === 'tiers.b1-b5')) failures.push('B1-B5 tier fact is missing.');
    if (!inventory.facts.some(f => f.factId === 'storage.sell')) failures.push('Storage sell fact is missing.');
    if (!inventory.conflictsAndUnknowns.some(f => f.status === 'UNKNOWN')) failures.push('Unknown/conflict state must be explicit.');
    if (JSON.stringify(inventory).match(/password\s*[=:]\s*[^}\],"']+/i)) failures.push('Potential secret payload captured.');
    return failures;
}

function main() {
    const inventory = buildInventory();
    const failures = validateInventory(inventory);
    if (process.argv.includes('--check')) {
        const committed = JSON.parse(fs.readFileSync(path.join(root, 'architecture/server-profiles/minerua-inventory.json'), 'utf8'));
        const committedFailures = validateInventory(committed);
        const comparable = value => { const clone = JSON.parse(JSON.stringify(value)); clone.generatedAt = '<stable>'; return clone; };
        if (JSON.stringify(comparable(committed)) !== JSON.stringify(comparable(inventory))) committedFailures.push('Committed MinerUA inventory is stale.');
        for (const failure of committedFailures) console.error(`[FAIL] ${failure}`);
        console.log(`MinerUA knowledge inventory check completed with ${committedFailures.length} failure(s).`);
        process.exitCode = committedFailures.length ? 1 : 0;
        return;
    }
    if (failures.length) throw new Error(failures.join('\n'));
    process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
}
if (require.main === module) main();
module.exports = Object.freeze({ buildInventory, validateInventory });
