'use strict';

const ConfigValidationError = require('./errors/ConfigValidationError');
const ConfigSpecs = require('./ConfigSpecs');
const { immutableClone } = require('../shared/utils/object');

function isObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function addReference(errors, collection, value, path, targetName) {
    if (typeof value === 'string' && value && !collection.has(value)) {
        errors.push(`${path} references missing ${targetName}: ${value}`);
    }
}

function overlap(first, second) {
    return first.start < second.end && second.start < first.end;
}

function circularSegments(start, duration) {
    const end = start + Math.max(1, duration);
    if (end <= 1440) return [{ start, end }];
    return [{ start, end: 1440 }, { start: 0, end: end - 1440 }];
}

class ConfigurationContractValidator {
    constructor({ requiredKeys = ConfigSpecs.map(spec => spec.key) } = {}) {
        this.requiredKeys = Object.freeze([...requiredKeys]);
    }

    validate(snapshot, { botProfiles = [], requireComplete = true } = {}) {
        const errors = [];
        if (!isObject(snapshot)) {
            return immutableClone({ valid: false, errors: ['configuration snapshot must be an object'] });
        }

        if (requireComplete) {
            for (const key of this.requiredKeys) {
                if (!Object.prototype.hasOwnProperty.call(snapshot, key)) {
                    errors.push(`configuration group is missing: ${key}`);
                }
            }
        }

        this.#validateCommands(snapshot, errors);
        this.#validateSkyCommands(snapshot, errors);
        this.#validateGui(snapshot, errors);
        this.#validateItemsAndRecipes(snapshot, errors);
        this.#validateRoutes(snapshot, errors);
        this.#validateBots(snapshot, botProfiles, errors);
        this.#validateThresholds(snapshot, errors);
        this.#validateModes(snapshot, botProfiles, errors);
        this.#validateDailyRecovery(snapshot, errors);

        return immutableClone({ valid: errors.length === 0, errors });
    }

    assertValid(snapshot, options = {}) {
        const result = this.validate(snapshot, options);
        if (!result.valid) {
            throw new ConfigValidationError('configuration-contract', result.errors);
        }
        return snapshot;
    }

    #validateCommands(snapshot, errors) {
        if (!isObject(snapshot.commands)) return;
        const commandKeys = new Set(Object.keys(snapshot.commands));
        const refs = [
            ['serverLogin.commandKey', snapshot.serverLogin?.commandKey],
            ['storage.commandKey', snapshot.storage?.commandKey],
            ['storage.sell.commandKey', snapshot.storage?.sell?.commandKey],
            ['personalVault.commandKey', snapshot.personalVault?.commandKey],
            ['minerals.commandKey', snapshot.minerals?.commandKey],
            ['minerals.crafting.commandKey', snapshot.minerals?.crafting?.commandKey],
            ['smelting.commandKey', snapshot.smelting?.commandKey],
            ['smelting.mineralsCommandKey', snapshot.smelting?.mineralsCommandKey],
            ['island.commandKey', snapshot.island?.commandKey],
            ['dungeon.commandKey', snapshot.dungeon?.commandKey],
            ['skyblock.commandKey', snapshot.skyblock?.commandKey],
            ['fishingMode.commandKey', snapshot.fishingMode?.commandKey]
        ];
        for (const [path, value] of refs) addReference(errors, commandKeys, value, path, 'command');
        for (const key of Object.keys(snapshot.commandResponses || {})) {
            addReference(errors, commandKeys, key, `commandResponses.${key}`, 'command');
        }
        for (const [targetId, target] of Object.entries(snapshot.discord?.targets || {})) {
            addReference(errors, commandKeys, target?.commandKey, `discord.targets.${targetId}.commandKey`, 'command');
        }
    }

    #validateSkyCommands(snapshot, errors) {
        if (!isObject(snapshot.skyCommands)) return;
        const skySelections = new Set(Object.keys(snapshot.skyblock?.selections || {}));
        for (const skyId of Object.keys(snapshot.skyCommands)) {
            addReference(errors, skySelections, skyId, `skyCommands.${skyId}`, 'Skyblock selection');
        }
    }

    #validateGui(snapshot, errors) {
        if (!isObject(snapshot.guiWindows)) return;
        const windows = snapshot.guiWindows;
        const windowIds = new Set(Object.keys(windows));
        const refs = [
            ['storage.guiId', snapshot.storage?.guiId],
            ['personalVault.guiId', snapshot.personalVault?.guiId],
            ['minerals.guiId', snapshot.minerals?.guiId],
            ['minerals.crafting.mineralsGuiId', snapshot.minerals?.crafting?.mineralsGuiId],
            ['minerals.crafting.guiId', snapshot.minerals?.crafting?.guiId],
            ['minerals.crafting.quantityGuiId', snapshot.minerals?.crafting?.quantityGuiId],
            ['smelting.guiId', snapshot.smelting?.guiId],
            ['smelting.mineralsGuiId', snapshot.smelting?.mineralsGuiId],
            ['dungeon.guiId', snapshot.dungeon?.guiId],
            ['skyblock.entryGuiId', snapshot.skyblock?.entryGuiId]
        ];
        if (snapshot.skyblock?.joinGuiId !== null && snapshot.skyblock?.joinGuiId !== undefined) {
            refs.push(['skyblock.joinGuiId', snapshot.skyblock.joinGuiId]);
        }
        for (const [path, value] of refs) addReference(errors, windowIds, value, path, 'GUI window');

        const checkSlot = (guiId, slot, path) => {
            if (!Number.isInteger(slot) || !windowIds.has(guiId)) return;
            const slotCount = windows[guiId]?.layout?.slotCount;
            if (Number.isInteger(slotCount) && slot >= slotCount) {
                errors.push(`${path} (${slot}) is outside ${guiId} slotCount ${slotCount}`);
            }
        };

        for (const [windowId, definition] of Object.entries(windows)) {
            for (const [index, fingerprint] of (definition.fingerprints || []).entries()) {
                checkSlot(windowId, fingerprint.slot, `guiWindows.${windowId}.fingerprints[${index}].slot`);
            }
        }
        checkSlot(snapshot.storage?.guiId, snapshot.storage?.capacityIndicator?.slot, 'storage.capacityIndicator.slot');
        checkSlot(snapshot.minerals?.guiId, snapshot.minerals?.conversionMenuSlot, 'minerals.conversionMenuSlot');
        checkSlot(snapshot.minerals?.guiId, snapshot.minerals?.smeltingMenuSlot, 'minerals.smeltingMenuSlot');
        checkSlot(snapshot.minerals?.guiId, snapshot.minerals?.craftingMenuSlot, 'minerals.craftingMenuSlot');
        checkSlot(snapshot.minerals?.crafting?.mineralsGuiId, snapshot.minerals?.crafting?.entrySlot, 'minerals.crafting.entrySlot');
        for (const [quantity, slot] of Object.entries(snapshot.minerals?.crafting?.quantitySlots || {})) {
            checkSlot(snapshot.minerals?.crafting?.quantityGuiId, slot, `minerals.crafting.quantitySlots.${quantity}`);
        }
        checkSlot(snapshot.smelting?.mineralsGuiId, snapshot.smelting?.mineralsMenuSlot, 'smelting.mineralsMenuSlot');
        checkSlot(snapshot.smelting?.guiId, snapshot.smelting?.actionSlot, 'smelting.actionSlot');
        for (const [selectionId, selection] of Object.entries(snapshot.skyblock?.selections || {})) {
            checkSlot(snapshot.skyblock?.entryGuiId, selection?.slot, `skyblock.selections.${selectionId}.slot`);
        }
        if (snapshot.skyblock?.joinGuiId) checkSlot(snapshot.skyblock.joinGuiId, snapshot.skyblock.joinSlot, 'skyblock.joinSlot');
        for (const [recipeId, recipe] of Object.entries(snapshot.recipes || {})) {
            checkSlot(snapshot.minerals?.crafting?.guiId, recipe?.menuSlot, `recipes.${recipeId}.menuSlot`);
        }

        const visitConfiguredSlots = (entry, path, guiId) => {
            if (Number.isInteger(entry)) {
                checkSlot(guiId, entry, path);
                return;
            }
            if (!isObject(entry)) return;
            for (const [key, child] of Object.entries(entry)) visitConfiguredSlots(child, `${path}.${key}`, guiId);
        };
        for (const [guiId, entry] of Object.entries(snapshot.guiSlots || {})) {
            addReference(errors, windowIds, guiId, `guiSlots.${guiId}`, 'GUI window');
            visitConfiguredSlots(entry, `guiSlots.${guiId}`, guiId);
        }
    }

    #validateItemsAndRecipes(snapshot, errors) {
        if (!isObject(snapshot.items)) return;
        const itemIds = new Set(Object.keys(snapshot.items));
        const checkItem = (value, path, { nullable = false } = {}) => {
            if (nullable && value === null) return;
            addReference(errors, itemIds, value, path, 'item');
        };

        for (const [windowId, window] of Object.entries(snapshot.guiWindows || {})) {
            for (const [index, fingerprint] of (window.fingerprints || []).entries()) {
                checkItem(fingerprint.itemId, `guiWindows.${windowId}.fingerprints[${index}].itemId`);
            }
        }
        checkItem(snapshot.storage?.capacityIndicator?.itemId, 'storage.capacityIndicator.itemId');
        for (const itemId of Object.keys(snapshot.storage?.sell?.itemAliases || {})) {
            checkItem(itemId, `storage.sell.itemAliases.${itemId}`);
        }
        for (const key of ['conversionMenuItemId', 'smeltingMenuItemId', 'withdrawMenuItemId', 'craftingMenuItemId']) {
            checkItem(snapshot.minerals?.[key], `minerals.${key}`);
        }
        checkItem(snapshot.minerals?.crafting?.entryMenuItemId, 'minerals.crafting.entryMenuItemId');
        checkItem(snapshot.smelting?.mineralsMenuItemId, 'smelting.mineralsMenuItemId');
        checkItem(snapshot.smelting?.actionItemId, 'smelting.actionItemId', { nullable: true });

        for (const [resourceId, resource] of Object.entries(snapshot.mineralConversions?.resources || {})) {
            for (const key of ['baseId', 'blockId', 'sellId', 'toBlockMenuItemId', 'toBaseMenuItemId']) {
                if (resource[key] !== undefined) checkItem(resource[key], `mineralConversions.resources.${resourceId}.${key}`, { nullable: true });
            }
            const ratio = Number(resource?.ratio);
            if (resource?.blockId) {
                if (resource.sellId !== resource.blockId) {
                    errors.push(`mineralConversions.resources.${resourceId}.sellId must equal blockId; loose mineral selling is forbidden`);
                }
            } else if (resource?.sellId !== resource?.baseId || ratio !== 1) {
                errors.push(`mineralConversions.resources.${resourceId} without blockId may only sell its 1:1 baseId form`);
            }
        }
        for (const [recipeId, recipe] of Object.entries(snapshot.smelting?.recipes || {})) {
            for (const key of ['input', 'output', 'menuItemId']) checkItem(recipe[key], `smelting.recipes.${recipeId}.${key}`);
        }
        for (const [destinationId, destination] of Object.entries(snapshot.dungeon?.destinations || {})) {
            checkItem(destination?.menuItemId, `dungeon.destinations.${destinationId}.menuItemId`);
        }

        const recipeOutputs = new Map();
        const recipes = snapshot.recipes || {};
        for (const [recipeId, recipe] of Object.entries(recipes)) {
            checkItem(recipe.output, `recipes.${recipeId}.output`);
            checkItem(recipe.menuItemId, `recipes.${recipeId}.menuItemId`);
            for (const inputId of Object.keys(recipe.inputs || {})) checkItem(inputId, `recipes.${recipeId}.inputs.${inputId}`);
            if (recipeOutputs.has(recipe.output)) {
                errors.push(`recipes.${recipeId}.output duplicates recipe ${recipeOutputs.get(recipe.output)}: ${recipe.output}`);
            } else {
                recipeOutputs.set(recipe.output, recipeId);
            }
        }

        const graph = new Map();
        for (const recipe of Object.values(recipes)) {
            graph.set(recipe.output, Object.keys(recipe.inputs || {}).filter(input => recipeOutputs.has(input)));
        }
        const visiting = new Set();
        const visited = new Set();
        const path = [];
        const walk = itemId => {
            if (visiting.has(itemId)) {
                const start = path.indexOf(itemId);
                errors.push(`recipe dependency cycle: ${[...path.slice(start), itemId].join(' -> ')}`);
                return;
            }
            if (visited.has(itemId)) return;
            visiting.add(itemId);
            path.push(itemId);
            for (const dependency of graph.get(itemId) || []) walk(dependency);
            path.pop();
            visiting.delete(itemId);
            visited.add(itemId);
        };
        for (const itemId of graph.keys()) walk(itemId);

        const tierMembership = new Map();
        for (const [tier, ids] of Object.entries(snapshot.craftingTiers || {})) {
            for (const itemId of ids || []) {
                checkItem(itemId, `craftingTiers.${tier}`);
                if (tierMembership.has(itemId)) errors.push(`item ${itemId} appears in both ${tierMembership.get(itemId)} and ${tier}`);
                else tierMembership.set(itemId, tier);
            }
        }
        const identityOwners = new Map();
        const identityValues = definition => {
            const output = {};
            for (const context of ['inventory', 'personal-vault']) {
                output[context] = (definition?.representations?.[context]?.rules || [])
                    .filter(rule => rule?.type === 'identity' && typeof rule.value === 'string' && rule.value.trim())
                    .map(rule => rule.value.trim());
            }
            return output;
        };
        for (const [logicalId, definition] of Object.entries(snapshot.items || {})) {
            const values = identityValues(definition);
            for (const identity of [...values.inventory, ...values['personal-vault']]) {
                const canonical = identity.toUpperCase();
                const existingOwner = identityOwners.get(canonical);
                if (existingOwner && existingOwner !== logicalId) {
                    errors.push(`strong identity ${identity} is configured for both ${existingOwner} and ${logicalId}`);
                } else {
                    identityOwners.set(canonical, logicalId);
                }
            }
        }
        for (const tier of ['B2', 'B3', 'B4', 'B5']) {
            for (const logicalId of snapshot.craftingTiers?.[tier] || []) {
                const definition = snapshot.items?.[logicalId];
                if (!definition) continue;
                const values = identityValues(definition);
                const policy = definition?.metadata?.strongIdentityPolicy || null;
                const hasInventory = values.inventory.length > 0;
                const hasVault = values['personal-vault'].length > 0;
                if (policy === 'learn') {
                    if (hasInventory || hasVault) {
                        errors.push(`items.${logicalId} uses strongIdentityPolicy=learn but also configures a fixed inventory/personal-vault identity`);
                    }
                    continue;
                }
                if (!hasInventory || !hasVault) {
                    errors.push(`craftingTiers.${tier} item ${logicalId} must configure strong identity rules for inventory and personal-vault, or set metadata.strongIdentityPolicy=learn`);
                    continue;
                }
                const vaultSet = new Set(values['personal-vault'].map(value => value.toUpperCase()));
                if (!values.inventory.some(value => vaultSet.has(value.toUpperCase()))) {
                    errors.push(`items.${logicalId} inventory and personal-vault strong identities must share at least one identity`);
                }
            }
        }

        const targetId = snapshot.b5?.targetId;
        checkItem(targetId, 'b5.targetId');
        if (typeof targetId === 'string' && !(snapshot.craftingTiers?.B5 || []).includes(targetId)) {
            errors.push(`b5.targetId must belong to craftingTiers.B5: ${targetId}`);
        }
        if (typeof targetId === 'string' && !recipeOutputs.has(targetId)) {
            errors.push(`b5.targetId has no producing recipe: ${targetId}`);
        }

        const smeltingIds = new Set(Object.keys(snapshot.smelting?.recipes || {}));
        for (const recipeId of snapshot.mineralConversions?.smeltingRecipeIds || []) {
            addReference(errors, smeltingIds, recipeId, 'mineralConversions.smeltingRecipeIds', 'smelting recipe');
        }
    }

    #validateRoutes(snapshot, errors) {
        if (!isObject(snapshot.locations)) return;
        const locationIds = new Set(Object.keys(snapshot.locations));
        for (const [routeId, points] of Object.entries(snapshot.routes || {})) {
            for (const [index, point] of (points || []).entries()) {
                const locationId = typeof point === 'string' ? point : point?.location;
                if (locationId !== undefined) addReference(errors, locationIds, locationId, `routes.${routeId}[${index}]`, 'location');
            }
        }
    }

    #validateBots(snapshot, botProfiles, errors) {
        if (!Array.isArray(botProfiles) || botProfiles.length === 0) return;
        const ids = new Set();
        const profiles = new Set(Object.keys(snapshot.server?.profiles || {}));
        const skySelections = new Set(Object.keys(snapshot.skyblock?.selections || {}));
        for (const profile of botProfiles) {
            if (!profile || typeof profile.id !== 'string') continue;
            if (ids.has(profile.id)) errors.push(`duplicate bot profile id: ${profile.id}`);
            ids.add(profile.id);
            const serverProfile = profile.serverProfile || snapshot.server?.defaultProfile;
            addReference(errors, profiles, serverProfile, `bots.${profile.id}.serverProfile`, 'server profile');
            const skySelection = profile.skyblockSelection || snapshot.skyblock?.defaultSelection;
            addReference(errors, skySelections, skySelection, `bots.${profile.id}.skyblockSelection`, 'Skyblock selection');
        }
        const defaultBotId = snapshot.discord?.defaultBotId;
        addReference(errors, ids, defaultBotId, 'discord.defaultBotId', 'bot profile');
        if (snapshot.discord?.panels?.enabled !== false) {
            addReference(errors, ids, snapshot.discord?.panels?.botId, 'discord.panels.botId', 'bot profile');
        }
    }

    #validateThresholds(snapshot, errors) {
        const pv = snapshot.b5?.personalVaultBackpressure;
        if (pv && Number.isInteger(pv.minEmptySlots) && Number.isInteger(pv.hardMinEmptySlots)
            && pv.hardMinEmptySlots > pv.minEmptySlots) {
            errors.push('b5.personalVaultBackpressure.hardMinEmptySlots must be <= minEmptySlots');
        }
    }

    #validateModes(snapshot, botProfiles, errors) {
        const collector = snapshot.collectorB5Mode;
        if (collector?.enabled) {
            for (const axis of ['x', 'y', 'z']) {
                if (!Number.isFinite(collector.pickupLocation?.[axis])) {
                    errors.push(`collectorB5Mode.pickupLocation.${axis} is required while enabled`);
                }
            }
        }
        if (collector && Number.isFinite(collector.arrivalRadius) && Number.isFinite(collector.reanchorRadius)
            && collector.reanchorRadius < collector.arrivalRadius) {
            errors.push('collectorB5Mode.reanchorRadius must be >= arrivalRadius');
        }

        const decompressionMax = collector?.b1Decompression?.maxUsageRatio;
        if (Number.isFinite(decompressionMax) && (decompressionMax <= 0 || decompressionMax > 1)) {
            errors.push('collectorB5Mode.b1Decompression.maxUsageRatio must be in (0, 1]');
        }

        const areaIds = new Set((snapshot.fishingMode?.areas || []).map(area => area.id));
        for (const profile of botProfiles || []) {
            for (const areaId of Object.keys(profile?.fishing?.areas || {})) {
                addReference(errors, areaIds, areaId, `bots.${profile.id}.fishing.areas.${areaId}`, 'fishing area');
            }
        }
        const defaultSelection = snapshot.skyblock?.defaultSelection;
        const selections = new Set(Object.keys(snapshot.skyblock?.selections || {}));
        addReference(errors, selections, defaultSelection, 'skyblock.defaultSelection', 'skyblock selection');
    }

    #validateDailyRecovery(snapshot, errors) {
        const recovery = snapshot.dailyRecovery;
        if (!recovery) return;
        if (!Number.isInteger(recovery.timezoneOffsetMinutes)
            || recovery.timezoneOffsetMinutes < -840
            || recovery.timezoneOffsetMinutes > 840) {
            errors.push('dailyRecovery.timezoneOffsetMinutes must be an integer between -840 and 840');
        }
        const enabledWindows = ['sky', 'server']
            .map(name => ({ name, ...recovery[name] }))
            .filter(window => window.enabled);
        for (let first = 0; first < enabledWindows.length; first += 1) {
            for (let second = first + 1; second < enabledWindows.length; second += 1) {
                const left = enabledWindows[first];
                const right = enabledWindows[second];
                const leftStart = (left.hour * 60) + left.minute;
                const rightStart = (right.hour * 60) + right.minute;
                const leftSegments = circularSegments(leftStart, left.waitMinutes + left.retryWindowMinutes);
                const rightSegments = circularSegments(rightStart, right.waitMinutes + right.retryWindowMinutes);
                if (leftSegments.some(a => rightSegments.some(b => overlap(a, b)))) {
                    errors.push(`dailyRecovery.${left.name} window overlaps dailyRecovery.${right.name}`);
                }
            }
        }
    }
}

module.exports = ConfigurationContractValidator;
