'use strict';

function object(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function string(value) { return typeof value === 'string' && value.trim().length > 0; }
function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function positive(value) { return finite(value) && value > 0; }
function nonNegative(value) { return finite(value) && value >= 0; }
function integer(value, min = 0) { return Number.isInteger(value) && value >= min; }

function unknown(value, allowed, path, errors) {
    if (!object(value)) return;
    const allowedSet = new Set(allowed);
    for (const key of Object.keys(value)) {
        if (!allowedSet.has(key)) errors.push(`${path}.${key} is not allowed`);
    }
}

function requiredObject(value, path, errors) {
    if (!object(value)) {
        errors.push(`${path} must be an object`);
        return false;
    }
    return true;
}

function requiredString(value, path, errors) {
    if (!string(value)) errors.push(`${path} must be a non-empty string`);
}

function requiredBoolean(value, path, errors) {
    if (typeof value !== 'boolean') errors.push(`${path} must be boolean`);
}

function numberField(value, path, errors, { positiveOnly = false, nonNegativeOnly = false, integerOnly = false, nullable = false } = {}) {
    if (nullable && value === null) return;
    const valid = integerOnly ? integer(value, positiveOnly ? 1 : 0)
        : positiveOnly ? positive(value)
            : nonNegativeOnly ? nonNegative(value)
                : finite(value);
    if (!valid) errors.push(`${path} must be ${integerOnly ? 'an integer' : 'a finite number'}${positiveOnly ? ' greater than 0' : nonNegativeOnly ? ' >= 0' : ''}`);
}

function stringArray(value, path, errors, { allowEmpty = true } = {}) {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some(entry => !string(entry))) {
        errors.push(`${path} must be ${allowEmpty ? 'an' : 'a non-empty'} array of non-empty strings`);
    }
}

function validator(name, check) {
    return value => {
        const errors = [];
        if (!requiredObject(value, name, errors)) return { valid: false, errors };
        check(value, errors);
        return { valid: errors.length === 0, errors };
    };
}

const commands = validator('commands', (value, errors) => {
    if (Object.keys(value).length === 0) errors.push('commands must not be empty');
    for (const [key, command] of Object.entries(value)) {
        if (!/^[a-z][a-zA-Z0-9_-]*$/.test(key)) errors.push(`commands.${key} has an invalid key`);
        if (!string(command) || !command.startsWith('/')) errors.push(`commands.${key} must be a slash command string`);
    }
});

const skyCommands = validator('skyCommands', (value, errors) => {
    const sensitive = /^\/(?:login|register|reg|l|auth|password|changepassword|cp)\b/i;
    for (const [skyId, commandMap] of Object.entries(value)) {
        const skyPath = `skyCommands.${skyId}`;
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(skyId)) errors.push(`${skyPath} has an invalid Sky id`);
        if (!requiredObject(commandMap, skyPath, errors)) continue;
        for (const [commandId, definition] of Object.entries(commandMap)) {
            const path = `${skyPath}.${commandId}`;
            if (!/^[a-z][a-zA-Z0-9_-]*$/.test(commandId)) errors.push(`${path} has an invalid command id`);
            if (!requiredObject(definition, path, errors)) continue;
            unknown(definition, ['command', 'label', 'description', 'enabled'], path, errors);
            if (!string(definition.command) || !definition.command.startsWith('/')) errors.push(`${path}.command must be a slash command string`);
            if (typeof definition.command === 'string' && /[\r\n\0]/.test(definition.command)) errors.push(`${path}.command must be one line`);
            if (typeof definition.command === 'string' && sensitive.test(definition.command.trim())) errors.push(`${path}.command cannot be an authentication/password command`);
            if (definition.label !== undefined && typeof definition.label !== 'string') errors.push(`${path}.label must be a string`);
            if (definition.description !== undefined && typeof definition.description !== 'string') errors.push(`${path}.description must be a string`);
            if (definition.enabled !== undefined && typeof definition.enabled !== 'boolean') errors.push(`${path}.enabled must be boolean`);
        }
    }
});

const commandResponses = validator('commandResponses', (value, errors) => {
    for (const [commandKey, rules] of Object.entries(value)) {
        if (!Array.isArray(rules) || rules.length === 0) {
            errors.push(`commandResponses.${commandKey} must be a non-empty array`);
            continue;
        }
        rules.forEach((rule, index) => {
            const path = `commandResponses.${commandKey}[${index}]`;
            if (!requiredObject(rule, path, errors)) return;
            unknown(rule, ['includes', 'regex', 'flags'], path, errors);
            if (!string(rule.includes) && !string(rule.regex)) errors.push(`${path} requires includes or regex`);
            if (rule.flags !== undefined && typeof rule.flags !== 'string') errors.push(`${path}.flags must be a string`);
            if (string(rule.regex)) {
                try { new RegExp(rule.regex, rule.flags || 'i'); } catch (error) { errors.push(`${path}.regex is invalid: ${error.message}`); }
            }
        });
    }
});

const serverLogin = validator('serverLogin', (value, errors) => {
    unknown(value, ['enabled', 'commandKey', 'delayMs', 'confirm', 'timeoutMs'], 'serverLogin', errors);
    requiredBoolean(value.enabled, 'serverLogin.enabled', errors);
    requiredString(value.commandKey, 'serverLogin.commandKey', errors);
    numberField(value.delayMs, 'serverLogin.delayMs', errors, { nonNegativeOnly: true });
    requiredBoolean(value.confirm, 'serverLogin.confirm', errors);
    numberField(value.timeoutMs, 'serverLogin.timeoutMs', errors, { positiveOnly: true });
});

const resourcePack = validator('resourcePack', (value, errors) => {
    unknown(value, ['enabled', 'autoAccept'], 'resourcePack', errors);
    requiredBoolean(value.enabled, 'resourcePack.enabled', errors);
    requiredBoolean(value.autoAccept, 'resourcePack.autoAccept', errors);
});

const guiWindows = validator('guiWindows', (value, errors) => {
    for (const [id, definition] of Object.entries(value)) {
        const path = `guiWindows.${id}`;
        if (!requiredObject(definition, path, errors)) continue;
        unknown(definition, ['title', 'layout', 'fingerprints'], path, errors);
        if (definition.title !== undefined) {
            if (requiredObject(definition.title, `${path}.title`, errors)) {
                unknown(definition.title, ['value', 'regex', 'exact'], `${path}.title`, errors);
                if (!string(definition.title.value) && !string(definition.title.regex)) errors.push(`${path}.title requires value or regex`);
                if (definition.title.exact !== undefined && typeof definition.title.exact !== 'boolean') errors.push(`${path}.title.exact must be boolean`);
                if (string(definition.title.regex)) {
                    try { new RegExp(definition.title.regex, 'i'); } catch (error) { errors.push(`${path}.title.regex is invalid: ${error.message}`); }
                }
            }
        }
        if (definition.layout !== undefined && requiredObject(definition.layout, `${path}.layout`, errors)) {
            unknown(definition.layout, ['slotCount', 'type'], `${path}.layout`, errors);
            if (definition.layout.slotCount !== undefined) numberField(definition.layout.slotCount, `${path}.layout.slotCount`, errors, { integerOnly: true, positiveOnly: true });
            if (definition.layout.type !== undefined) requiredString(definition.layout.type, `${path}.layout.type`, errors);
        }
        if (definition.fingerprints !== undefined) {
            if (!Array.isArray(definition.fingerprints)) errors.push(`${path}.fingerprints must be an array`);
            else definition.fingerprints.forEach((fingerprint, index) => {
                const fpPath = `${path}.fingerprints[${index}]`;
                if (!requiredObject(fingerprint, fpPath, errors)) return;
                unknown(fingerprint, ['slot', 'itemId', 'context'], fpPath, errors);
                numberField(fingerprint.slot, `${fpPath}.slot`, errors, { integerOnly: true });
                requiredString(fingerprint.itemId, `${fpPath}.itemId`, errors);
                if (fingerprint.context !== undefined) requiredString(fingerprint.context, `${fpPath}.context`, errors);
            });
        }
    }
});

const guiIdentity = validator('guiIdentity', (value, errors) => {
    const keys = ['minimumConfidence','minimumMargin','expectedMinimumConfidence','titleWeight','layoutWeight','fingerprintWeight','expectedIdWeight','expectedConflictWeight','previousIdWeight','unknownPenalty','maxSemanticWeight','candidateLimit'];
    unknown(value, keys, 'guiIdentity', errors);
    for (const key of keys.filter(key => key !== 'candidateLimit')) {
        numberField(value[key], `guiIdentity.${key}`, errors, { nonNegativeOnly: true });
        if (finite(value[key]) && value[key] > 1) errors.push(`guiIdentity.${key} must be <= 1`);
    }
    numberField(value.candidateLimit, 'guiIdentity.candidateLimit', errors, { integerOnly: true, positiveOnly: true });
    if (finite(value.minimumConfidence) && finite(value.expectedMinimumConfidence) && value.expectedMinimumConfidence > value.minimumConfidence) {
        errors.push('guiIdentity.expectedMinimumConfidence must be <= minimumConfidence');
    }
});

const guiSlots = validator('guiSlots', (value, errors) => {
    const visit = (entry, path) => {
        if (Number.isInteger(entry) && entry >= 0) return;
        if (!object(entry)) { errors.push(`${path} must be a non-negative slot or object`); return; }
        for (const [key, child] of Object.entries(entry)) visit(child, `${path}.${key}`);
    };
    for (const [key, entry] of Object.entries(value)) visit(entry, `guiSlots.${key}`);
});

const guiObservation = validator('guiObservation', (value, errors) => {
    unknown(value, ['enabled', 'directory', 'debounceMs', 'semanticCacheMs'], 'guiObservation', errors);
    requiredBoolean(value.enabled, 'guiObservation.enabled', errors);
    requiredString(value.directory, 'guiObservation.directory', errors);
    numberField(value.debounceMs, 'guiObservation.debounceMs', errors, { nonNegativeOnly: true });
    numberField(value.semanticCacheMs, 'guiObservation.semanticCacheMs', errors, { nonNegativeOnly: true });
});

const inventoryObservation = validator('inventoryObservation', (value, errors) => {
    unknown(value, ['enabled', 'directory', 'debounceMs', 'historyLimit', 'postActionSync'], 'inventoryObservation', errors);
    requiredBoolean(value.enabled, 'inventoryObservation.enabled', errors);
    requiredString(value.directory, 'inventoryObservation.directory', errors);
    numberField(value.debounceMs, 'inventoryObservation.debounceMs', errors, { nonNegativeOnly: true });
    numberField(value.historyLimit, 'inventoryObservation.historyLimit', errors, { integerOnly: true, positiveOnly: true });
    const sync = value.postActionSync;
    if (requiredObject(sync, 'inventoryObservation.postActionSync', errors)) {
        const keys = ['minTicks','pollTicks','pollMs','quietMs','timeoutMs','stablePasses','fallbackTickMs','debugMetadata','debugMaxItems','persistStableSnapshot'];
        unknown(sync, keys, 'inventoryObservation.postActionSync', errors);
        for (const key of ['minTicks','pollTicks','stablePasses','debugMaxItems']) numberField(sync[key], `inventoryObservation.postActionSync.${key}`, errors, { integerOnly: true, positiveOnly: true });
        for (const key of ['pollMs','quietMs','timeoutMs','fallbackTickMs']) numberField(sync[key], `inventoryObservation.postActionSync.${key}`, errors, { positiveOnly: true });
        for (const key of ['debugMetadata','persistStableSnapshot']) requiredBoolean(sync[key], `inventoryObservation.postActionSync.${key}`, errors);
    }
});

const movement = validator('movement', (value, errors) => {
    unknown(value, ['arrivalRadius', 'defaultTimeoutMs'], 'movement', errors);
    numberField(value.arrivalRadius, 'movement.arrivalRadius', errors, { positiveOnly: true });
    numberField(value.defaultTimeoutMs, 'movement.defaultTimeoutMs', errors, { positiveOnly: true });
});

const locations = validator('locations', (value, errors) => {
    for (const [id, location] of Object.entries(value)) {
        const path = `locations.${id}`;
        if (!requiredObject(location, path, errors)) continue;
        unknown(location, ['x', 'y', 'z', 'yaw', 'pitch'], path, errors);
        for (const axis of ['x', 'y', 'z']) numberField(location[axis], `${path}.${axis}`, errors);
        if (location.yaw !== undefined) numberField(location.yaw, `${path}.yaw`, errors);
        if (location.pitch !== undefined) numberField(location.pitch, `${path}.pitch`, errors);
    }
});

const routes = validator('routes', (value, errors) => {
    for (const [id, route] of Object.entries(value)) {
        if (!Array.isArray(route) || route.length === 0) { errors.push(`routes.${id} must be a non-empty array`); continue; }
        route.forEach((point, index) => {
            const path = `routes.${id}[${index}]`;
            if (typeof point === 'string') { requiredString(point, path, errors); return; }
            if (!requiredObject(point, path, errors)) return;
            unknown(point, ['x', 'y', 'z', 'location', 'radius'], path, errors);
            if (point.location !== undefined) requiredString(point.location, `${path}.location`, errors);
            else for (const axis of ['x', 'y', 'z']) numberField(point[axis], `${path}.${axis}`, errors);
            if (point.radius !== undefined) numberField(point.radius, `${path}.radius`, errors, { positiveOnly: true });
        });
    }
});

const items = validator('items', (value, errors) => {
    if (Object.keys(value).length === 0) errors.push('items must not be empty');
    for (const [itemId, definition] of Object.entries(value)) {
        const path = `items.${itemId}`;
        if (!requiredObject(definition, path, errors)) continue;
        unknown(definition, ['representations', 'metadata'], path, errors);
        if (definition.metadata !== undefined) {
            const metadataPath = `${path}.metadata`;
            if (requiredObject(definition.metadata, metadataPath, errors)) {
                unknown(definition.metadata, ['strongIdentityPolicy'], metadataPath, errors);
                if (definition.metadata.strongIdentityPolicy !== undefined
                    && !['learn'].includes(definition.metadata.strongIdentityPolicy)) {
                    errors.push(`${metadataPath}.strongIdentityPolicy must be learn when configured`);
                }
            }
        }
        if (!requiredObject(definition.representations, `${path}.representations`, errors)) continue;
        for (const [context, representation] of Object.entries(definition.representations)) {
            const repPath = `${path}.representations.${context}`;
            if (!requiredObject(representation, repPath, errors)) continue;
            unknown(representation, ['rules'], repPath, errors);
            if (!Array.isArray(representation.rules) || representation.rules.length === 0) {
                errors.push(`${repPath}.rules must be a non-empty array`);
                continue;
            }
            representation.rules.forEach((rule, index) => {
                const rulePath = `${repPath}.rules[${index}]`;
                if (!requiredObject(rule, rulePath, errors)) return;
                unknown(rule, ['type', 'value', 'flags'], rulePath, errors);
                if (!['identity', 'nbt', 'material', 'lore', 'name'].includes(rule.type)) errors.push(`${rulePath}.type is unsupported`);
                requiredString(rule.value, `${rulePath}.value`, errors);
            });
        }
    }
});

const personalVault = validator('personalVault', (value, errors) => {
    const keys = ['commandKey','storageSlots','guiId','guiTimeoutMs','openSettleMs','openAttempts','openRetryMs','openAfterCloseSettleMs','openCloseConfirmTimeoutMs','transferVerifyAttempts','transferVerifyRetryMs'];
    unknown(value, keys, 'personalVault', errors);
    for (const key of ['commandKey','guiId']) requiredString(value[key], `personalVault.${key}`, errors);
    for (const key of ['storageSlots','openAttempts','transferVerifyAttempts']) numberField(value[key], `personalVault.${key}`, errors, { integerOnly: true, positiveOnly: true });
    for (const key of ['guiTimeoutMs','openRetryMs','openAfterCloseSettleMs','openCloseConfirmTimeoutMs','transferVerifyRetryMs']) numberField(value[key], `personalVault.${key}`, errors, { positiveOnly: true });
    numberField(value.openSettleMs, 'personalVault.openSettleMs', errors, { nonNegativeOnly: true });
});

const island = validator('island', (value, errors) => {
    unknown(value, ['commandKey', 'timeoutMs'], 'island', errors);
    requiredString(value.commandKey, 'island.commandKey', errors);
    numberField(value.timeoutMs, 'island.timeoutMs', errors, { positiveOnly: true });
});

const collectorB5Mode = validator('collectorB5Mode', (value, errors) => {
    const keys = ['enabled','teleportHomeOnEnable','pickupLocation','arrivalRadius','reanchorRadius','moveTimeoutMs','pollIntervalMs','errorRetryMs','craftLoopDelayMs','b1Decompression'];
    unknown(value, keys, 'collectorB5Mode', errors);
    for (const key of ['enabled','teleportHomeOnEnable']) requiredBoolean(value[key], `collectorB5Mode.${key}`, errors);
    for (const key of ['arrivalRadius','reanchorRadius','moveTimeoutMs','pollIntervalMs','errorRetryMs','craftLoopDelayMs']) numberField(value[key], `collectorB5Mode.${key}`, errors, { positiveOnly: true });
    if (requiredObject(value.pickupLocation, 'collectorB5Mode.pickupLocation', errors)) {
        unknown(value.pickupLocation, ['x','y','z'], 'collectorB5Mode.pickupLocation', errors);
        for (const axis of ['x','y','z']) {
            if (value.enabled || value.pickupLocation[axis] !== null) numberField(value.pickupLocation[axis], `collectorB5Mode.pickupLocation.${axis}`, errors);
        }
    }
    if (requiredObject(value.b1Decompression, 'collectorB5Mode.b1Decompression', errors)) {
        unknown(value.b1Decompression, ['maxUsageRatio','requireKnownCapacity'], 'collectorB5Mode.b1Decompression', errors);
        if (!finite(value.b1Decompression.maxUsageRatio) || value.b1Decompression.maxUsageRatio <= 0 || value.b1Decompression.maxUsageRatio > 1) {
            errors.push('collectorB5Mode.b1Decompression.maxUsageRatio must be in (0, 1]');
        }
        requiredBoolean(value.b1Decompression.requireKnownCapacity, 'collectorB5Mode.b1Decompression.requireKnownCapacity', errors);
    }
});

const b5CraftMode = validator('b5CraftMode', (value, errors) => {
    const keys = ['enabled','teleportHomeOnEnable','autoResumeOnReconnect','pollIntervalMs','disconnectedPollMs','errorRetryMs','errorRetryMaxMs','craftLoopDelayMs','postB5CooldownMs','stability','reconciliation'];
    unknown(value, keys, 'b5CraftMode', errors);
    for (const key of ['enabled','teleportHomeOnEnable','autoResumeOnReconnect']) requiredBoolean(value[key], `b5CraftMode.${key}`, errors);
    for (const key of ['pollIntervalMs','disconnectedPollMs','errorRetryMs','errorRetryMaxMs','craftLoopDelayMs','postB5CooldownMs']) numberField(value[key], `b5CraftMode.${key}`, errors, { positiveOnly: true });
    const stability = value.stability;
    if (requiredObject(stability, 'b5CraftMode.stability', errors)) {
        unknown(stability, ['noProgressBackoffEnabled','noProgressBaseDelayMs','noProgressMaxDelayMs','sameBlockerThreshold','logEveryNthRepeat'], 'b5CraftMode.stability', errors);
        requiredBoolean(stability.noProgressBackoffEnabled, 'b5CraftMode.stability.noProgressBackoffEnabled', errors);
        for (const key of ['noProgressBaseDelayMs','noProgressMaxDelayMs','sameBlockerThreshold','logEveryNthRepeat']) {
            numberField(stability[key], `b5CraftMode.stability.${key}`, errors, { positiveOnly: true });
        }
        if (Number.isFinite(stability.noProgressBaseDelayMs) && Number.isFinite(stability.noProgressMaxDelayMs)
            && stability.noProgressMaxDelayMs < stability.noProgressBaseDelayMs) {
            errors.push('b5CraftMode.stability.noProgressMaxDelayMs must be >= noProgressBaseDelayMs');
        }
        if (Number.isFinite(stability.sameBlockerThreshold) && !Number.isInteger(stability.sameBlockerThreshold)) {
            errors.push('b5CraftMode.stability.sameBlockerThreshold must be an integer');
        }
        if (Number.isFinite(stability.logEveryNthRepeat) && !Number.isInteger(stability.logEveryNthRepeat)) {
            errors.push('b5CraftMode.stability.logEveryNthRepeat must be an integer');
        }
    }
    const reconciliation = value.reconciliation;
    if (requiredObject(reconciliation, 'b5CraftMode.reconciliation', errors)) {
        unknown(reconciliation, ['maxFreshReads','retryMs','unresolvedPollMs','allowRetryAfterVerifiedNoEffect'], 'b5CraftMode.reconciliation', errors);
        requiredBoolean(reconciliation.allowRetryAfterVerifiedNoEffect, 'b5CraftMode.reconciliation.allowRetryAfterVerifiedNoEffect', errors);
        numberField(reconciliation.maxFreshReads, 'b5CraftMode.reconciliation.maxFreshReads', errors, { integerOnly: true, positiveOnly: true });
        numberField(reconciliation.retryMs, 'b5CraftMode.reconciliation.retryMs', errors, { positiveOnly: true });
        numberField(reconciliation.unresolvedPollMs, 'b5CraftMode.reconciliation.unresolvedPollMs', errors, { positiveOnly: true });
        if (Number.isFinite(reconciliation.retryMs) && Number.isFinite(reconciliation.unresolvedPollMs)
            && reconciliation.unresolvedPollMs < reconciliation.retryMs) {
            errors.push('b5CraftMode.reconciliation.unresolvedPollMs must be >= retryMs');
        }
    }

});

const dailyRecovery = validator('dailyRecovery', (value, errors) => {
    unknown(value, ['enabled','timezoneOffsetMinutes','sky','server'], 'dailyRecovery', errors);
    requiredBoolean(value.enabled, 'dailyRecovery.enabled', errors);
    numberField(value.timezoneOffsetMinutes, 'dailyRecovery.timezoneOffsetMinutes', errors);
    for (const name of ['sky','server']) {
        const section = value[name];
        const path = `dailyRecovery.${name}`;
        if (!requiredObject(section, path, errors)) continue;
        unknown(section, ['enabled','hour','minute','waitMinutes','retryWindowMinutes'], path, errors);
        requiredBoolean(section.enabled, `${path}.enabled`, errors);
        if (!Number.isInteger(section.hour) || section.hour < 0 || section.hour > 23) errors.push(`${path}.hour must be 0..23`);
        if (!Number.isInteger(section.minute) || section.minute < 0 || section.minute > 59) errors.push(`${path}.minute must be 0..59`);
        numberField(section.waitMinutes, `${path}.waitMinutes`, errors, { nonNegativeOnly: true });
        numberField(section.retryWindowMinutes, `${path}.retryWindowMinutes`, errors, { nonNegativeOnly: true });
    }
});

const recipes = validator('recipes', (value, errors) => {
    if (Object.keys(value).length === 0) errors.push('recipes must not be empty');
    for (const [recipeId, recipe] of Object.entries(value)) {
        const path = `recipes.${recipeId}`;
        if (!requiredObject(recipe, path, errors)) continue;
        unknown(recipe, ['output','outputAmount','menuItemId','inputs','menuSlot','inputSource'], path, errors);
        requiredString(recipe.output, `${path}.output`, errors);
        numberField(recipe.outputAmount, `${path}.outputAmount`, errors, { integerOnly: true, positiveOnly: true });
        requiredString(recipe.menuItemId, `${path}.menuItemId`, errors);
        numberField(recipe.menuSlot, `${path}.menuSlot`, errors, { integerOnly: true });
        if (!requiredObject(recipe.inputs, `${path}.inputs`, errors)) continue;
        if (Object.keys(recipe.inputs).length === 0) errors.push(`${path}.inputs must not be empty`);
        for (const [itemId, amount] of Object.entries(recipe.inputs)) numberField(amount, `${path}.inputs.${itemId}`, errors, { integerOnly: true, positiveOnly: true });
        if (recipe.inputSource !== undefined && !['storage','inventory','personal-vault'].includes(recipe.inputSource)) errors.push(`${path}.inputSource is unsupported`);
    }
});

const craftingTiers = validator('craftingTiers', (value, errors) => {
    unknown(value, ['B1','B2','B3','B4','B5'], 'craftingTiers', errors);
    for (const tier of ['B1','B2','B3','B4','B5']) stringArray(value[tier], `craftingTiers.${tier}`, errors, { allowEmpty: false });
});

const b5 = validator('b5', (value, errors) => {
    const keys = ['targetId','timeoutMs','inventorySafetyEmptySlots','quantityOptimization','b3AllMinEmptySlots','b1SupplyMode','b2InputSource','personalVaultBackpressure','pvInventorySettleTimeoutMs','pvInventorySettlePollMs'];
    unknown(value, keys, 'b5', errors);
    requiredString(value.targetId, 'b5.targetId', errors);
    numberField(value.timeoutMs, 'b5.timeoutMs', errors, { positiveOnly: true });
    numberField(value.inventorySafetyEmptySlots, 'b5.inventorySafetyEmptySlots', errors, { integerOnly: true });
    numberField(value.b3AllMinEmptySlots, 'b5.b3AllMinEmptySlots', errors, { integerOnly: true });
    numberField(value.pvInventorySettleTimeoutMs, 'b5.pvInventorySettleTimeoutMs', errors, { integerOnly: true, nonNegativeOnly: true });
    numberField(value.pvInventorySettlePollMs, 'b5.pvInventorySettlePollMs', errors, { integerOnly: true, positiveOnly: true });
    if (value.b1SupplyMode !== 'continuous') errors.push('b5.b1SupplyMode must be continuous; finite supply is not implemented');
    if (!['inventory','storage'].includes(value.b2InputSource)) errors.push('b5.b2InputSource must be inventory or storage');
    const quantity = value.quantityOptimization;
    if (requiredObject(quantity, 'b5.quantityOptimization', errors)) {
        const quantityKeys = ['enabled','useAllForB2','useAllForB3','useAllForB4WhenExact','useAllForB5','keepSurplusInPv2','b2BatchSize'];
        unknown(quantity, quantityKeys, 'b5.quantityOptimization', errors);
        for (const key of quantityKeys.filter(key => key !== 'b2BatchSize')) requiredBoolean(quantity[key], `b5.quantityOptimization.${key}`, errors);
        numberField(quantity.b2BatchSize, 'b5.quantityOptimization.b2BatchSize', errors, { integerOnly: true, positiveOnly: true });
        if (quantity.keepSurplusInPv2 !== true) errors.push('b5.quantityOptimization.keepSurplusInPv2 must be true');
    }
    const pressure = value.personalVaultBackpressure;
    if (requiredObject(pressure, 'b5.personalVaultBackpressure', errors)) {
        unknown(pressure, ['minEmptySlots','hardMinEmptySlots'], 'b5.personalVaultBackpressure', errors);
        numberField(pressure.minEmptySlots, 'b5.personalVaultBackpressure.minEmptySlots', errors, { integerOnly: true });
        numberField(pressure.hardMinEmptySlots, 'b5.personalVaultBackpressure.hardMinEmptySlots', errors, { integerOnly: true });
    }
});

function genericStrict(name, allowedKeys, stringKeys = [], positiveKeys = [], nonNegativeKeys = [], integerKeys = [], booleanKeys = []) {
    return validator(name, (value, errors) => {
        unknown(value, allowedKeys, name, errors);
        for (const key of stringKeys) requiredString(value[key], `${name}.${key}`, errors);
        for (const key of positiveKeys) numberField(value[key], `${name}.${key}`, errors, { positiveOnly: true });
        for (const key of nonNegativeKeys) numberField(value[key], `${name}.${key}`, errors, { nonNegativeOnly: true });
        for (const key of integerKeys) numberField(value[key], `${name}.${key}`, errors, { integerOnly: true, positiveOnly: true });
        for (const key of booleanKeys) requiredBoolean(value[key], `${name}.${key}`, errors);
    });
}

const dungeonBase = genericStrict('dungeon', ['commandKey','defaultCountdownMs','destinations','guiId','guiTimeoutMs'], ['commandKey','guiId'], ['defaultCountdownMs','guiTimeoutMs']);
const dungeon = value => {
    const result = dungeonBase(value); const errors = [...result.errors];
    if (object(value?.destinations)) {
        for (const [id, destination] of Object.entries(value.destinations)) {
            const path = `dungeon.destinations.${id}`;
            if (!requiredObject(destination, path, errors)) continue;
            unknown(destination, ['menuItemId','countdownMs','verifyTimeoutMs'], path, errors);
            requiredString(destination.menuItemId, `${path}.menuItemId`, errors);
            numberField(destination.countdownMs, `${path}.countdownMs`, errors, { nonNegativeOnly: true });
            numberField(destination.verifyTimeoutMs, `${path}.verifyTimeoutMs`, errors, { positiveOnly: true });
        }
    } else errors.push('dungeon.destinations must be an object');
    return { valid: errors.length === 0, errors };
};

const storage = validator('storage', (value, errors) => {
    // STORAGE_MATERIAL_TRANSFER_SCHEMA_PATCH_V1
    const keys = ['commandKey','resourceAmountPatterns','allowStackCountFallback','capacityIndicator','sell','withdraw','guiId','guiTimeoutMs','openSettleMs','refreshSettleMs','openAttempts','retryDelayMs','retryCloseSettleMs','openAfterCloseSettleMs','closeConfirmTimeoutMs'];
    unknown(value, keys, 'storage', errors);
    for (const key of ['commandKey','guiId']) requiredString(value[key], `storage.${key}`, errors);
    stringArray(value.resourceAmountPatterns, 'storage.resourceAmountPatterns', errors, { allowEmpty: false });
    requiredBoolean(value.allowStackCountFallback, 'storage.allowStackCountFallback', errors);
    for (const key of ['guiTimeoutMs','openAttempts','retryDelayMs','retryCloseSettleMs','openAfterCloseSettleMs','closeConfirmTimeoutMs']) numberField(value[key], `storage.${key}`, errors, { positiveOnly: true });
    for (const key of ['openSettleMs','refreshSettleMs']) numberField(value[key], `storage.${key}`, errors, { nonNegativeOnly: true });
    const withdraw = value.withdraw;
    if (withdraw !== undefined && requiredObject(withdraw, 'storage.withdraw', errors)) {
        const withdrawKeys = ['enabled','numericQuantities','withdrawPatterns','stackPatterns','fullInventoryPatterns','detailTimeoutMs','verifyAttempts','verifyRetryMs','unchangedConfirmationReads','minimumOutputSlots','allowStack','allowFillInventory','reuseQuantityGui','maxWithdrawalActions','maxBatchClicks'];
        unknown(withdraw, withdrawKeys, 'storage.withdraw', errors);
        requiredBoolean(withdraw.enabled, 'storage.withdraw.enabled', errors);
        if (!Array.isArray(withdraw.numericQuantities) || withdraw.numericQuantities.length === 0
            || withdraw.numericQuantities.some(value => !Number.isInteger(Number(value)) || Number(value) <= 0)) {
            errors.push('storage.withdraw.numericQuantities must be a non-empty positive integer array');
        }
        for (const key of ['withdrawPatterns','stackPatterns','fullInventoryPatterns']) stringArray(withdraw[key], `storage.withdraw.${key}`, errors, { allowEmpty: false });
        for (const key of ['detailTimeoutMs','verifyAttempts','verifyRetryMs','unchangedConfirmationReads','minimumOutputSlots','maxWithdrawalActions','maxBatchClicks']) {
            numberField(withdraw[key], `storage.withdraw.${key}`, errors, { integerOnly: true, positiveOnly: true });
        }
        for (const key of ['allowStack','allowFillInventory','reuseQuantityGui']) requiredBoolean(withdraw[key], `storage.withdraw.${key}`, errors);
        if (Number.isInteger(withdraw.maxBatchClicks) && Number.isInteger(withdraw.maxWithdrawalActions)
            && withdraw.maxBatchClicks > withdraw.maxWithdrawalActions) {
            errors.push('storage.withdraw.maxBatchClicks must be <= maxWithdrawalActions');
        }
    }
    const indicator = value.capacityIndicator;
    if (requiredObject(indicator, 'storage.capacityIndicator', errors)) {
        unknown(indicator, ['itemId','scanAllSlots','usedPatterns','freePatterns','limitPatterns','regex','slot','fallbackLimit'], 'storage.capacityIndicator', errors);
        requiredString(indicator.itemId, 'storage.capacityIndicator.itemId', errors);
        requiredBoolean(indicator.scanAllSlots, 'storage.capacityIndicator.scanAllSlots', errors);
        for (const key of ['usedPatterns','freePatterns','limitPatterns']) stringArray(indicator[key], `storage.capacityIndicator.${key}`, errors, { allowEmpty: false });
        requiredString(indicator.regex, 'storage.capacityIndicator.regex', errors);
        numberField(indicator.slot, 'storage.capacityIndicator.slot', errors, { integerOnly: true });
        numberField(indicator.fallbackLimit, 'storage.capacityIndicator.fallbackLimit', errors, { positiveOnly: true });
    }
    const sell = value.sell;
    if (requiredObject(sell, 'storage.sell', errors)) {
        const sellKeys = ['enabled','commandKey','mode','resultDelayMs','itemAliases','allowAll','openSettleMs','closeSettleMs','updateTimeoutMs','openAfterCloseSettleMs','blockOnly','reserveCoverage','allowSingle'];
        unknown(sell, sellKeys, 'storage.sell', errors);
        requiredBoolean(sell.enabled, 'storage.sell.enabled', errors);
        requiredString(sell.commandKey, 'storage.sell.commandKey', errors);
        if (!['gui'].includes(sell.mode)) errors.push('storage.sell.mode is unsupported');
        if (!requiredObject(sell.itemAliases, 'storage.sell.itemAliases', errors)) return;
        for (const [id, alias] of Object.entries(sell.itemAliases)) requiredString(alias, `storage.sell.itemAliases.${id}`, errors);
        for (const key of ['allowAll','blockOnly','allowSingle']) requiredBoolean(sell[key], `storage.sell.${key}`, errors);
        if (sell.allowSingle !== false) errors.push('storage.sell.allowSingle must be false for the B5 64-only sell contract');
        for (const key of ['resultDelayMs','openSettleMs','closeSettleMs','updateTimeoutMs','openAfterCloseSettleMs']) numberField(sell[key], `storage.sell.${key}`, errors, { nonNegativeOnly: true });
        numberField(sell.reserveCoverage, 'storage.sell.reserveCoverage', errors, { positiveOnly: true });
        if (Number(sell.reserveCoverage) !== 1.5) errors.push('storage.sell.reserveCoverage must be exactly 1.5 for the B5 hard reserve contract');
    }
});

const minerals = validator('minerals', (value, errors) => {
    const keys = ['commandKey','conversionMenuItemId','smeltingMenuItemId','withdrawMenuItemId','craftingMenuItemId','conversionGuiId','crafting','guiId','guiTimeoutMs','conversionMenuSlot','smeltingMenuSlot','craftingMenuSlot','commandOpenAttempts','commandOpenRetryMs','commandCloseSettleMs'];
    unknown(value, keys, 'minerals', errors);
    for (const key of ['commandKey','conversionMenuItemId','smeltingMenuItemId','withdrawMenuItemId','craftingMenuItemId','conversionGuiId','guiId']) requiredString(value[key], `minerals.${key}`, errors);
    for (const key of ['guiTimeoutMs','commandOpenAttempts','commandOpenRetryMs']) numberField(value[key], `minerals.${key}`, errors, { positiveOnly: true });
    numberField(value.commandCloseSettleMs, 'minerals.commandCloseSettleMs', errors, { nonNegativeOnly: true });
    for (const key of ['conversionMenuSlot','smeltingMenuSlot','craftingMenuSlot']) numberField(value[key], `minerals.${key}`, errors, { integerOnly: true });
    const crafting = value.crafting;
    if (requiredObject(crafting, 'minerals.crafting', errors)) {
        const craftKeys = ['commandKey','quantitySlots','_note','mineralsGuiId','guiId','quantityGuiId','entryMenuItemId','guiTimeoutMs','resultDelayMs','entrySlot','commandOpenAttempts','commandOpenRetryMs','resultVerifyAttempts','resultVerifyRetryMs','preQuantityClickTicks','postQuantityClickTicks','commandCloseSettleMs'];
        unknown(crafting, craftKeys, 'minerals.crafting', errors);
        for (const key of ['commandKey','mineralsGuiId','guiId','quantityGuiId','entryMenuItemId']) requiredString(crafting[key], `minerals.crafting.${key}`, errors);
        if (!requiredObject(crafting.quantitySlots, 'minerals.crafting.quantitySlots', errors)) return;
        unknown(crafting.quantitySlots, ['1','64','ALL'], 'minerals.crafting.quantitySlots', errors);
        for (const key of ['1','64','ALL']) numberField(crafting.quantitySlots[key], `minerals.crafting.quantitySlots.${key}`, errors, { integerOnly: true });
        for (const key of ['guiTimeoutMs','commandOpenAttempts','commandOpenRetryMs','resultVerifyAttempts','resultVerifyRetryMs']) numberField(crafting[key], `minerals.crafting.${key}`, errors, { positiveOnly: true });
        for (const key of ['resultDelayMs','preQuantityClickTicks','postQuantityClickTicks','commandCloseSettleMs']) numberField(crafting[key], `minerals.crafting.${key}`, errors, { nonNegativeOnly: true });
        numberField(crafting.entrySlot, 'minerals.crafting.entrySlot', errors, { integerOnly: true });
    }
});

const mineralConversions = validator('mineralConversions', (value, errors) => {
    const keys = ['menuSettleMs','menuTransitionAttempts','menuTransitionRetryMs','menuOptionReadyTimeoutMs','resultDelayMs','smeltingRecipeIds','resources'];
    unknown(value, keys, 'mineralConversions', errors);
    for (const key of ['menuSettleMs','menuTransitionRetryMs','menuOptionReadyTimeoutMs','resultDelayMs']) numberField(value[key], `mineralConversions.${key}`, errors, { nonNegativeOnly: true });
    numberField(value.menuTransitionAttempts, 'mineralConversions.menuTransitionAttempts', errors, { integerOnly: true, positiveOnly: true });
    stringArray(value.smeltingRecipeIds, 'mineralConversions.smeltingRecipeIds', errors);
    const b5RequiredSmelting = ['raw_iron_to_iron', 'raw_gold_to_gold'];
    if (Array.isArray(value.smeltingRecipeIds)
        && JSON.stringify(value.smeltingRecipeIds) !== JSON.stringify(b5RequiredSmelting)) {
        errors.push('mineralConversions.smeltingRecipeIds must be exactly [raw_iron_to_iron, raw_gold_to_gold] in that order for B5 protection');
    }
    if (requiredObject(value.resources, 'mineralConversions.resources', errors)) {
        for (const [id, resource] of Object.entries(value.resources)) {
            const path = `mineralConversions.resources.${id}`;
            if (!requiredObject(resource, path, errors)) continue;
            unknown(resource, ['baseId','blockId','ratio','sellId','toBlockMenuItemId','toBaseMenuItemId'], path, errors);
            requiredString(resource.baseId, `${path}.baseId`, errors);
            if (resource.blockId !== null) requiredString(resource.blockId, `${path}.blockId`, errors);
            requiredString(resource.sellId, `${path}.sellId`, errors);
            numberField(resource.ratio, `${path}.ratio`, errors, { integerOnly: true, positiveOnly: true });
            if (resource.toBlockMenuItemId !== undefined) requiredString(resource.toBlockMenuItemId, `${path}.toBlockMenuItemId`, errors);
            if (resource.toBaseMenuItemId !== undefined) requiredString(resource.toBaseMenuItemId, `${path}.toBaseMenuItemId`, errors);
        }
    }

});

const smelting = validator('smelting', (value, errors) => {
    const keys = ['commandKey','mineralsCommandKey','recipes','guiId','mineralsGuiId','mineralsMenuItemId','guiTimeoutMs','resultDelayMs','mineralsMenuSlot','actionSlot','actionItemId','verificationAttempts','verificationRetryMs','commandOpenAttempts','commandOpenRetryMs','commandCloseSettleMs','openSettleMs'];
    unknown(value, keys, 'smelting', errors);
    for (const key of ['commandKey','mineralsCommandKey','guiId','mineralsGuiId','mineralsMenuItemId']) requiredString(value[key], `smelting.${key}`, errors);
    for (const key of ['guiTimeoutMs','verificationAttempts','verificationRetryMs','commandOpenAttempts','commandOpenRetryMs']) numberField(value[key], `smelting.${key}`, errors, { positiveOnly: true });
    for (const key of ['resultDelayMs','commandCloseSettleMs','openSettleMs']) numberField(value[key], `smelting.${key}`, errors, { nonNegativeOnly: true });
    for (const key of ['mineralsMenuSlot','actionSlot']) numberField(value[key], `smelting.${key}`, errors, { integerOnly: true });
    if (value.actionItemId !== null) requiredString(value.actionItemId, 'smelting.actionItemId', errors);
    if (requiredObject(value.recipes, 'smelting.recipes', errors)) {
        for (const [id, recipe] of Object.entries(value.recipes)) {
            const path = `smelting.recipes.${id}`;
            if (!requiredObject(recipe, path, errors)) continue;
            unknown(recipe, ['input','output','menuItemId'], path, errors);
            for (const key of ['input','output','menuItemId']) requiredString(recipe[key], `${path}.${key}`, errors);
        }
    }
});

const skyblock = validator('skyblock', (value, errors) => {
    const keys = ['commandKey','entryGuiId','joinGuiId','selections','defaultSelection','joinSlot','guiTimeoutMs','clickTimeoutMs','slotReadyTimeoutMs','selectionSettleMs','joinSettleMs','postJoinTimeoutMs','postJoinMinPositionDelta','modeJoin'];
    unknown(value, keys, 'skyblock', errors);
    for (const key of ['commandKey','entryGuiId','defaultSelection']) requiredString(value[key], `skyblock.${key}`, errors);
    if (value.joinGuiId !== null) requiredString(value.joinGuiId, 'skyblock.joinGuiId', errors);
    numberField(value.joinSlot, 'skyblock.joinSlot', errors, { integerOnly: true });
    for (const key of ['guiTimeoutMs','clickTimeoutMs','slotReadyTimeoutMs','postJoinTimeoutMs','postJoinMinPositionDelta']) numberField(value[key], `skyblock.${key}`, errors, { positiveOnly: true });
    for (const key of ['selectionSettleMs','joinSettleMs']) numberField(value[key], `skyblock.${key}`, errors, { nonNegativeOnly: true });
    if (requiredObject(value.selections, 'skyblock.selections', errors)) {
        for (const [id, selection] of Object.entries(value.selections)) {
            if (!requiredObject(selection, `skyblock.selections.${id}`, errors)) continue;
            unknown(selection, ['slot'], `skyblock.selections.${id}`, errors);
            numberField(selection.slot, `skyblock.selections.${id}.slot`, errors, { integerOnly: true });
        }
    }
    const modeJoin = value.modeJoin;
    if (requiredObject(modeJoin, 'skyblock.modeJoin', errors)) {
        const modeJoinKeys = ['delayMs','spawnFallbackDelayMs','retryDelayMs','rejoinDelayMs','recoveryPollMs','waitForResourcePack'];
        unknown(modeJoin, modeJoinKeys, 'skyblock.modeJoin', errors);
        for (const key of ['delayMs','spawnFallbackDelayMs','retryDelayMs','rejoinDelayMs','recoveryPollMs']) numberField(modeJoin[key], `skyblock.modeJoin.${key}`, errors, { nonNegativeOnly: true });
        requiredBoolean(modeJoin.waitForResourcePack, 'skyblock.modeJoin.waitForResourcePack', errors);
    }
});

module.exports = Object.freeze({
    commands,
    skyCommands,
    commandResponses,
    serverLogin,
    resourcePack,
    guiWindows,
    guiIdentity,
    guiSlots,
    guiObservation,
    inventoryObservation,
    movement,
    locations,
    routes,
    items,
    storage,
    personalVault,
    minerals,
    mineralConversions,
    smelting,
    island,
    dungeon,
    skyblock,
    recipes,
    craftingTiers,
    b5,
    collectorB5Mode,
    b5CraftMode,
    dailyRecovery
});
