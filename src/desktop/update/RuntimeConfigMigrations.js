'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

function parseVersion(value) {
    const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)/);
    return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
    const a = parseVersion(left);
    const b = parseVersion(right);
    if (!a || !b) return null;
    for (let index = 0; index < 3; index += 1) {
        if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
    }
    return 0;
}

function shouldRunBefore(version, target) {
    if (!version || version === 'legacy') return true;
    const comparison = compareVersions(version, target);
    return comparison === null ? true : comparison < 0;
}

async function writeJsonAtomic(filePath, value) {
    const temporary = `${filePath}.migration-${process.pid}-${Date.now()}`;
    await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fsp.rename(temporary, filePath);
}

async function migrateGuiIdentityWindowDefaults({ runtimeRoot, templateRoot, fromVersion }) {
    // 2.6.0 introduced GUI Identity V2, but runtimes created by 2.5.x kept the
    // old gui/windows.json primitive values because mergeDefaults deliberately
    // preserves user primitives. The result was deterministic but wrong:
    // MinerUA NBT titles such as "ᴋʜᴏ ᴄʜứᴀ" and "ᴋʜᴏ đồ #2" did not match the
    // legacy ASCII regexes, leaving /pv 2 at confidence 0.2105 and causing a
    // close/retry/timeout loop. Replace ONLY known historical defaults so real
    // operator customisations remain untouched.
    if (!shouldRunBefore(fromVersion, '2.6.1')) return { changed: false, files: [] };

    const relative = path.join('config', 'gui', 'windows.json');
    const runtimePath = path.join(runtimeRoot, relative);
    const templatePath = path.join(templateRoot, relative);
    if (!fs.existsSync(runtimePath) || !fs.existsSync(templatePath)) return { changed: false, files: [] };

    const current = JSON.parse(await fsp.readFile(runtimePath, 'utf8'));
    const defaults = JSON.parse(await fsp.readFile(templatePath, 'utf8'));
    let changed = false;

    const legacyStorageRegexes = new Set([
        'kho|storage'
    ]);
    const legacyPv2Regexes = new Set([
        'pv\\s*2|personal\\s*vault'
    ]);

    const currentStorageRegex = current?.storage?.title?.regex;
    const currentPv2Regex = current?.personalVault2?.title?.regex;
    const defaultStorageRegex = defaults?.storage?.title?.regex;
    const defaultPv2Regex = defaults?.personalVault2?.title?.regex;

    if (legacyStorageRegexes.has(currentStorageRegex) && typeof defaultStorageRegex === 'string' && defaultStorageRegex) {
        current.storage.title.regex = defaultStorageRegex;
        changed = true;
    }
    if (legacyPv2Regexes.has(currentPv2Regex) && typeof defaultPv2Regex === 'string' && defaultPv2Regex) {
        current.personalVault2.title.regex = defaultPv2Regex;
        changed = true;
    }

    if (!changed) return { changed: false, files: [] };
    await writeJsonAtomic(runtimePath, current);
    return {
        changed: true,
        files: [relative.replace(/\\/g, '/')],
        migrationId: '2.6.1-gui-identity-v2-window-defaults'
    };
}

async function migrateB5SmeltingProtectionDefault({ runtimeRoot, templateRoot, fromVersion }) {
    // Up to 2.6.2 the B5 schema forced allowSmelting=false, so every existing
    // runtime carries false even though it was not an operator choice. 2.6.3
    // changes the B5 protection order to smelt raw -> compact base to blocks ->
    // relieve storage pressure. Promote that historical forced default once;
    // after this migration the value is a normal user-editable boolean.
    if (!shouldRunBefore(fromVersion, '2.6.3')) return { changed: false, files: [] };

    const relative = path.join('config', 'modes', 'b5-craft.json');
    const runtimePath = path.join(runtimeRoot, relative);
    const templatePath = path.join(templateRoot, relative);
    if (!fs.existsSync(runtimePath) || !fs.existsSync(templatePath)) return { changed: false, files: [] };

    const current = JSON.parse(await fsp.readFile(runtimePath, 'utf8'));
    const defaults = JSON.parse(await fsp.readFile(templatePath, 'utf8'));
    if (current?.storageProtection?.allowSmelting !== false
        || defaults?.storageProtection?.allowSmelting !== true) {
        return { changed: false, files: [] };
    }

    current.storageProtection.allowSmelting = true;
    await writeJsonAtomic(runtimePath, current);
    return {
        changed: true,
        files: [relative.replace(/\\/g, '/')],
        migrationId: '2.6.3-b5-smelt-before-storage-protection'
    };
}


async function migrateB5IronGoldOnlySmeltingAndMineralsIdentity({ runtimeRoot, templateRoot, fromVersion }) {
    // 2.6.4 narrows automatic B5 smelting to exactly raw iron and raw gold.
    // The old global smelting defaults still contained stone -> smooth stone,
    // which is not part of the B5 storage-protection policy. The same release
    // also teaches GUI Identity V2 the exact stylized MinerUA /ks root title
    // observed in production logs. Only the known historical minerals regex is
    // upgraded; the stone recipe is removed as a hard product rule.
    if (!shouldRunBefore(fromVersion, '2.6.4')) return { changed: false, files: [] };

    const changedFiles = [];

    const windowsRelative = path.join('config', 'gui', 'windows.json');
    const runtimeWindowsPath = path.join(runtimeRoot, windowsRelative);
    const templateWindowsPath = path.join(templateRoot, windowsRelative);
    if (fs.existsSync(runtimeWindowsPath) && fs.existsSync(templateWindowsPath)) {
        const current = JSON.parse(await fsp.readFile(runtimeWindowsPath, 'utf8'));
        const defaults = JSON.parse(await fsp.readFile(templateWindowsPath, 'utf8'));
        const legacyMineralsRegexes = new Set([
            'khoáng|khoang|mineral|ks'
        ]);
        const currentRegex = current?.minerals?.title?.regex;
        const defaultRegex = defaults?.minerals?.title?.regex;
        if (legacyMineralsRegexes.has(currentRegex) && typeof defaultRegex === 'string' && defaultRegex) {
            current.minerals.title.regex = defaultRegex;
            await writeJsonAtomic(runtimeWindowsPath, current);
            changedFiles.push(windowsRelative.replace(/\\/g, '/'));
        }
    }

    const smeltingRelative = path.join('config', 'smelting', 'recipes.json');
    const runtimeSmeltingPath = path.join(runtimeRoot, smeltingRelative);
    if (fs.existsSync(runtimeSmeltingPath)) {
        const current = JSON.parse(await fsp.readFile(runtimeSmeltingPath, 'utf8'));
        if (current?.recipes && Object.prototype.hasOwnProperty.call(current.recipes, 'stone_to_smooth_stone')) {
            delete current.recipes.stone_to_smooth_stone;
            await writeJsonAtomic(runtimeSmeltingPath, current);
            changedFiles.push(smeltingRelative.replace(/\\/g, '/'));
        }
    }

    const conversionsRelative = path.join('config', 'minerals', 'conversions.json');
    const runtimeConversionsPath = path.join(runtimeRoot, conversionsRelative);
    if (fs.existsSync(runtimeConversionsPath)) {
        const current = JSON.parse(await fsp.readFile(runtimeConversionsPath, 'utf8'));
        const original = Array.isArray(current?.smeltingRecipeIds) ? current.smeltingRecipeIds : [];
        const filtered = original.filter(id => id === 'raw_iron_to_iron' || id === 'raw_gold_to_gold');
        if (JSON.stringify(filtered) !== JSON.stringify(original)) {
            current.smeltingRecipeIds = filtered;
            await writeJsonAtomic(runtimeConversionsPath, current);
            changedFiles.push(conversionsRelative.replace(/\\/g, '/'));
        }
    }

    if (changedFiles.length === 0) return { changed: false, files: [] };
    return {
        changed: true,
        files: [...new Set(changedFiles)],
        migrationId: '2.6.4-iron-gold-only-smelting-ks-identity'
    };
}

async function migrateB5GuardedAllAndReserveDefaults({ runtimeRoot, templateRoot, fromVersion }) {
    // 2.6.5 aligns the shipped B5 policy with the guarded ALL flow that already
    // exists in B5AutomationService and restores the intended ~3-B5 storage
    // reserve. Reserve numbers are promoted only when they equal the exact
    // historical defaults. The old shipped B2-ALL=false value is intentionally
    // promoted to true as the new product policy; operators can disable it again
    // after update for diagnosis.
    if (!shouldRunBefore(fromVersion, '2.6.5')) return { changed: false, files: [] };

    const changedFiles = [];

    const storageRelative = path.join('config', 'storage', 'kho.json');
    const runtimeStoragePath = path.join(runtimeRoot, storageRelative);
    const templateStoragePath = path.join(templateRoot, storageRelative);
    if (fs.existsSync(runtimeStoragePath) && fs.existsSync(templateStoragePath)) {
        const current = JSON.parse(await fsp.readFile(runtimeStoragePath, 'utf8'));
        const defaults = JSON.parse(await fsp.readFile(templateStoragePath, 'utf8'));
        let changed = false;
        if (Number(current?.sell?.startupReserveCoverage) === 1.5
            && Number(defaults?.sell?.startupReserveCoverage) === 3) {
            current.sell.startupReserveCoverage = 3;
            changed = true;
        }
        if (Number(current?.sell?.startupStopCoverage) === 1.75
            && Number(defaults?.sell?.startupStopCoverage) === 3.25) {
            current.sell.startupStopCoverage = 3.25;
            changed = true;
        }
        if (changed) {
            await writeJsonAtomic(runtimeStoragePath, current);
            changedFiles.push(storageRelative.replace(/\\/g, '/'));
        }
    }

    const b5Relative = path.join('config', 'server-data', 'b5.json');
    const runtimeB5Path = path.join(runtimeRoot, b5Relative);
    const templateB5Path = path.join(templateRoot, b5Relative);
    if (fs.existsSync(runtimeB5Path) && fs.existsSync(templateB5Path)) {
        const current = JSON.parse(await fsp.readFile(runtimeB5Path, 'utf8'));
        const defaults = JSON.parse(await fsp.readFile(templateB5Path, 'utf8'));
        if (current?.quantityOptimization?.useAllForB2 === false
            && defaults?.quantityOptimization?.useAllForB2 === true) {
            current.quantityOptimization.useAllForB2 = true;
            await writeJsonAtomic(runtimeB5Path, current);
            changedFiles.push(b5Relative.replace(/\\/g, '/'));
        }
    }

    const modeRelative = path.join('config', 'modes', 'b5-craft.json');
    const runtimeModePath = path.join(runtimeRoot, modeRelative);
    const templateModePath = path.join(templateRoot, modeRelative);
    if (fs.existsSync(runtimeModePath) && fs.existsSync(templateModePath)) {
        const current = JSON.parse(await fsp.readFile(runtimeModePath, 'utf8'));
        const defaults = JSON.parse(await fsp.readFile(templateModePath, 'utf8'));
        if (Number(current?.storageProtection?.startupReserveCoverage) === 1.5
            && Number(defaults?.storageProtection?.startupReserveCoverage) === 3) {
            current.storageProtection.startupReserveCoverage = 3;
            await writeJsonAtomic(runtimeModePath, current);
            changedFiles.push(modeRelative.replace(/\\/g, '/'));
        }
    }

    if (changedFiles.length === 0) return { changed: false, files: [] };
    return {
        changed: true,
        files: [...new Set(changedFiles)],
        migrationId: '2.6.5-gui-normalization-storage-race-b2-all'
    };
}


async function migrateB5ReconciliationAndLearnedIdentityPolicy({ runtimeRoot, templateRoot, fromVersion }) {
    // 2.6.8 adds a mandatory reconciliation barrier after any crafting click
    // whose outcome cannot be verified, plus an explicit learn-once identity
    // policy for tungsten. Missing fields are added only when absent; operator
    // custom reconciliation values and any fixed tungsten identity are preserved.
    if (!shouldRunBefore(fromVersion, '2.6.8')) return { changed: false, files: [] };

    const changedFiles = [];

    const modeRelative = path.join('config', 'modes', 'b5-craft.json');
    const runtimeModePath = path.join(runtimeRoot, modeRelative);
    const templateModePath = path.join(templateRoot, modeRelative);
    if (fs.existsSync(runtimeModePath) && fs.existsSync(templateModePath)) {
        const current = JSON.parse(await fsp.readFile(runtimeModePath, 'utf8'));
        const defaults = JSON.parse(await fsp.readFile(templateModePath, 'utf8'));
        const defaultReconciliation = defaults?.reconciliation || null;
        if (defaultReconciliation && typeof defaultReconciliation === 'object') {
            let changed = false;
            if (!current.reconciliation || typeof current.reconciliation !== 'object' || Array.isArray(current.reconciliation)) {
                current.reconciliation = { ...defaultReconciliation };
                changed = true;
            } else {
                for (const [key, value] of Object.entries(defaultReconciliation)) {
                    if (current.reconciliation[key] === undefined) {
                        current.reconciliation[key] = value;
                        changed = true;
                    }
                }
                // 2.6.8 safety hardening makes reconciliation mandatory. A
                // pre-release/operator field that attempted to disable the
                // barrier must not survive migration and re-enable blind retry.
                if (Object.prototype.hasOwnProperty.call(current.reconciliation, 'enabled')) {
                    delete current.reconciliation.enabled;
                    changed = true;
                }
            }
            if (changed) {
                await writeJsonAtomic(runtimeModePath, current);
                changedFiles.push(modeRelative.replace(/\\/g, '/'));
            }
        }
    }

    const itemsRelative = path.join('config', 'items', 'items.json');
    const runtimeItemsPath = path.join(runtimeRoot, itemsRelative);
    const templateItemsPath = path.join(templateRoot, itemsRelative);
    if (fs.existsSync(runtimeItemsPath) && fs.existsSync(templateItemsPath)) {
        const current = JSON.parse(await fsp.readFile(runtimeItemsPath, 'utf8'));
        const defaults = JSON.parse(await fsp.readFile(templateItemsPath, 'utf8'));
        const tungsten = current?.tungsten || null;
        const defaultPolicy = defaults?.tungsten?.metadata?.strongIdentityPolicy || null;
        const configuredIdentity = ['inventory', 'personal-vault'].some(context =>
            (tungsten?.representations?.[context]?.rules || []).some(rule => rule?.type === 'identity' && rule?.value));
        let itemsChanged = false;
        if (tungsten && configuredIdentity && tungsten?.metadata?.strongIdentityPolicy === 'learn') {
            // mergeDefaults runs before versioned migrations and may have added
            // the shipped learn policy to a runtime that already has an operator-
            // supplied fixed identity. Fixed identity is stronger and must win.
            delete tungsten.metadata.strongIdentityPolicy;
            if (Object.keys(tungsten.metadata).length === 0) delete tungsten.metadata;
            itemsChanged = true;
        } else if (tungsten && !configuredIdentity && !tungsten?.metadata?.strongIdentityPolicy && defaultPolicy === 'learn') {
            tungsten.metadata = { ...(tungsten.metadata || {}), strongIdentityPolicy: 'learn' };
            itemsChanged = true;
        }
        if (itemsChanged) {
            await writeJsonAtomic(runtimeItemsPath, current);
            changedFiles.push(itemsRelative.replace(/\\/g, '/'));
        }
    }

    if (changedFiles.length === 0) return { changed: false, files: [] };
    return {
        changed: true,
        files: [...new Set(changedFiles)],
        migrationId: '2.6.8-craft-reconciliation-learned-identity-policy'
    };
}


async function migrateHubSkyRecoveryAndB5Normalization({ runtimeRoot, templateRoot, fromVersion }) {
    // 2.6.10 models MinerUA's confirmed HUB <-> SKY lifecycle and makes B1
    // normalization a first-class checkpoint of pure B5. Historical shipped
    // defaults are promoted as a unit; custom Sky retry policies are preserved.
    if (!shouldRunBefore(fromVersion, '2.6.10')) return { changed: false, files: [] };
    const changedFiles = [];

    const modeRelative = path.join('config', 'modes', 'b5-craft.json');
    const modePath = path.join(runtimeRoot, modeRelative);
    const modeTemplate = path.join(templateRoot, modeRelative);
    if (fs.existsSync(modePath) && fs.existsSync(modeTemplate)) {
        const current = JSON.parse(await fsp.readFile(modePath, 'utf8'));
        const defaults = JSON.parse(await fsp.readFile(modeTemplate, 'utf8'));
        let changed = false;
        for (const key of ['b1NormalizeIntervalMs', 'postB5CooldownMs']) {
            if (current[key] === undefined && defaults[key] !== undefined) { current[key] = defaults[key]; changed = true; }
        }
        if (changed) { await writeJsonAtomic(modePath, current); changedFiles.push(modeRelative.replace(/\\/g, '/')); }
    }

    const pvRelative = path.join('config', 'personal-vault', 'pv2.json');
    const pvPath = path.join(runtimeRoot, pvRelative);
    const pvTemplate = path.join(templateRoot, pvRelative);
    if (fs.existsSync(pvPath) && fs.existsSync(pvTemplate)) {
        const current = JSON.parse(await fsp.readFile(pvPath, 'utf8'));
        const defaults = JSON.parse(await fsp.readFile(pvTemplate, 'utf8'));
        let changed = false;
        if (Number(current.openAttempts) === 2 && Number(defaults.openAttempts) === 3) { current.openAttempts = 3; changed = true; }
        for (const key of ['openAfterCloseSettleMs', 'openCloseConfirmTimeoutMs']) {
            if (current[key] === undefined && defaults[key] !== undefined) { current[key] = defaults[key]; changed = true; }
        }
        if (changed) { await writeJsonAtomic(pvPath, current); changedFiles.push(pvRelative.replace(/\\/g, '/')); }
    }

    const skyRelative = path.join('config', 'skyblock', 'join.json');
    const skyPath = path.join(runtimeRoot, skyRelative);
    const skyTemplate = path.join(templateRoot, skyRelative);
    if (fs.existsSync(skyPath) && fs.existsSync(skyTemplate)) {
        const current = JSON.parse(await fsp.readFile(skyPath, 'utf8'));
        const defaults = JSON.parse(await fsp.readFile(skyTemplate, 'utf8'));
        let changed = false;
        current.selections ||= {};
        for (const id of ['sky1', 'sky2']) {
            if (!current.selections[id] && defaults?.selections?.[id]) { current.selections[id] = defaults.selections[id]; changed = true; }
        }
        if (current.defaultSelection === 'primary' && defaults.defaultSelection === 'sky1') { current.defaultSelection = 'sky1'; changed = true; }
        // Historical 2.6.10 migration must remain safe when the current
        // template has already moved to the 2.6.16 demand-driven gateway.
        // Only touch autoJoin when both the runtime and the template still
        // expose that legacy contract; 2.6.16 will migrate it to modeJoin.
        if (current.autoJoin && defaults?.autoJoin) {
            const historicalAuto = current.autoJoin.selection === 'primary'
                && Number(current.autoJoin.maxAttempts) === 3
                && Number(current.autoJoin.retryDelayMs) === 2000;
            if (historicalAuto) {
                current.autoJoin.selection = defaults.autoJoin.selection;
                current.autoJoin.maxAttempts = defaults.autoJoin.maxAttempts;
                current.autoJoin.retryDelayMs = defaults.autoJoin.retryDelayMs;
                changed = true;
            }
            for (const key of ['rejoinDelayMs', 'recoveryPollMs']) {
                if (current.autoJoin[key] === undefined && defaults.autoJoin[key] !== undefined) {
                    current.autoJoin[key] = defaults.autoJoin[key];
                    changed = true;
                }
            }
        }
        if (changed) { await writeJsonAtomic(skyPath, current); changedFiles.push(skyRelative.replace(/\\/g, '/')); }
    }

    const conversionsRelative = path.join('config', 'minerals', 'conversions.json');
    const conversionsPath = path.join(runtimeRoot, conversionsRelative);
    const conversionsTemplate = path.join(templateRoot, conversionsRelative);
    if (fs.existsSync(conversionsPath) && fs.existsSync(conversionsTemplate)) {
        const current = JSON.parse(await fsp.readFile(conversionsPath, 'utf8'));
        const defaults = JSON.parse(await fsp.readFile(conversionsTemplate, 'utf8'));
        if (current.menuOptionReadyTimeoutMs === undefined && defaults.menuOptionReadyTimeoutMs !== undefined) {
            current.menuOptionReadyTimeoutMs = defaults.menuOptionReadyTimeoutMs;
            await writeJsonAtomic(conversionsPath, current);
            changedFiles.push(conversionsRelative.replace(/\\/g, '/'));
        }
    }

    const mineralsRelative = path.join('config', 'minerals', 'menu.json');
    const mineralsPath = path.join(runtimeRoot, mineralsRelative);
    const mineralsTemplate = path.join(templateRoot, mineralsRelative);
    if (fs.existsSync(mineralsPath) && fs.existsSync(mineralsTemplate)) {
        const current = JSON.parse(await fsp.readFile(mineralsPath, 'utf8'));
        const defaults = JSON.parse(await fsp.readFile(mineralsTemplate, 'utf8'));
        if (current.conversionGuiId === undefined && defaults.conversionGuiId !== undefined) {
            current.conversionGuiId = defaults.conversionGuiId;
            await writeJsonAtomic(mineralsPath, current);
            changedFiles.push(mineralsRelative.replace(/\\/g, '/'));
        }
    }

    const botsDir = path.join(runtimeRoot, 'config', 'bots');
    if (fs.existsSync(botsDir)) {
        for (const name of (await fsp.readdir(botsDir)).filter(name => name.endsWith('.json'))) {
            const filePath = path.join(botsDir, name);
            const current = JSON.parse(await fsp.readFile(filePath, 'utf8'));
            if (current.skyblockSelection !== undefined) continue;
            current.skyblockSelection = 'sky1';
            await writeJsonAtomic(filePath, current);
            changedFiles.push(path.join('config', 'bots', name).replace(/\\/g, '/'));
        }
    }

    if (changedFiles.length === 0) return { changed: false, files: [] };
    return {
        changed: true,
        files: [...new Set(changedFiles)],
        migrationId: '2.6.10-hub-sky-recovery-b5-normalization'
    };
}


async function migrateB5SingleSourceStoragePolicyAndTungstenIdentity({ runtimeRoot, templateRoot, fromVersion }) {
    // 2.6.11 removes the duplicated B5 startup-trim controls. Storage sell
    // policy is now the single source of truth for whether startup trim runs
    // and for the reserve/stop coverage. It also promotes the live-observed
    // MinerUA tungsten identity (MMOITEMS_ITEM_ID:VOLFRAM) from learn-once to
    // a fixed identity. Operator-supplied fixed identities are preserved.
    if (!shouldRunBefore(fromVersion, '2.6.11')) return { changed: false, files: [] };

    const changedFiles = [];

    const modeRelative = path.join('config', 'modes', 'b5-craft.json');
    const modePath = path.join(runtimeRoot, modeRelative);
    const storageRelative = path.join('config', 'storage', 'kho.json');
    const storagePath = path.join(runtimeRoot, storageRelative);
    let legacyModeReserve = null;

    if (fs.existsSync(modePath)) {
        const current = JSON.parse(await fsp.readFile(modePath, 'utf8'));
        const protection = current?.storageProtection;
        let changed = false;
        if (protection && typeof protection === 'object' && !Array.isArray(protection)) {
            if (Number.isFinite(Number(protection.startupReserveCoverage))) {
                legacyModeReserve = Number(protection.startupReserveCoverage);
            }
            if (Object.prototype.hasOwnProperty.call(protection, 'startupTrimToReserve')) {
                delete protection.startupTrimToReserve;
                changed = true;
            }
            if (Object.prototype.hasOwnProperty.call(protection, 'startupReserveCoverage')) {
                delete protection.startupReserveCoverage;
                changed = true;
            }
        }
        if (changed) {
            await writeJsonAtomic(modePath, current);
            changedFiles.push(modeRelative.replace(/\\/g, '/'));
        }
    }

    // Preserve a non-default operator reserve that previously lived only in the
    // B5-mode duplicate field, but do not let the historical shipped false flag
    // disable the storage-wide startup policy. The storage group owns the policy.
    if (legacyModeReserve !== null && fs.existsSync(storagePath)) {
        const current = JSON.parse(await fsp.readFile(storagePath, 'utf8'));
        const currentReserve = Number(current?.sell?.startupReserveCoverage);
        if (current?.sell
            && Number.isFinite(currentReserve)
            && Math.abs(currentReserve - 3) < 1e-9
            && Math.abs(legacyModeReserve - 3) > 1e-9) {
            current.sell.startupReserveCoverage = legacyModeReserve;
            await writeJsonAtomic(storagePath, current);
            changedFiles.push(storageRelative.replace(/\\/g, '/'));
        }
    }

    const itemsRelative = path.join('config', 'items', 'items.json');
    const itemsPath = path.join(runtimeRoot, itemsRelative);
    const templateItemsPath = path.join(templateRoot, itemsRelative);
    if (fs.existsSync(itemsPath) && fs.existsSync(templateItemsPath)) {
        const current = JSON.parse(await fsp.readFile(itemsPath, 'utf8'));
        const defaults = JSON.parse(await fsp.readFile(templateItemsPath, 'utf8'));
        const tungsten = current?.tungsten;
        const defaultTungsten = defaults?.tungsten;
        let changed = false;

        if (tungsten && defaultTungsten) {
            tungsten.representations ||= {};
            const fixedContexts = ['inventory', 'personal-vault'];
            const existingIdentities = new Set();
            for (const context of fixedContexts) {
                for (const rule of tungsten?.representations?.[context]?.rules || []) {
                    if (rule?.type === 'identity' && typeof rule.value === 'string' && rule.value.trim()) {
                        existingIdentities.add(rule.value.trim());
                    }
                }
            }

            // No operator fixed identity exists: upgrade the old learn policy to
            // the live-observed fixed ID shipped by 2.6.11.
            if (existingIdentities.size === 0) {
                for (const context of fixedContexts) {
                    const next = defaultTungsten?.representations?.[context];
                    if (next) tungsten.representations[context] = next;
                }
                changed = true;
            } else if (existingIdentities.size === 1) {
                // If an operator already fixed one context, mirror that exact
                // identity into the missing context so inventory/PV stay coherent.
                const [identity] = [...existingIdentities];
                for (const context of fixedContexts) {
                    const rules = tungsten?.representations?.[context]?.rules || [];
                    const hasIdentity = rules.some(rule => rule?.type === 'identity' && rule?.value);
                    if (!hasIdentity) {
                        tungsten.representations[context] = { rules: [{ type: 'identity', value: identity }] };
                        changed = true;
                    }
                }
            }

            if (tungsten?.metadata?.strongIdentityPolicy === 'learn') {
                delete tungsten.metadata.strongIdentityPolicy;
                if (Object.keys(tungsten.metadata).length === 0) delete tungsten.metadata;
                changed = true;
            }
        }

        if (changed) {
            await writeJsonAtomic(itemsPath, current);
            changedFiles.push(itemsRelative.replace(/\\/g, '/'));
        }
    }

    if (changedFiles.length === 0) return { changed: false, files: [] };
    return {
        changed: true,
        files: [...new Set(changedFiles)],
        migrationId: '2.6.11-single-source-storage-volfram-identity'
    };
}


async function migrateDiscordRemoteAndStrongSmeltingIdentity({ runtimeRoot, templateRoot, fromVersion }) {
    if (!shouldRunBefore(fromVersion, '2.6.14')) return { changed: false, files: [] };
    const changedFiles = [];

    const discordRelative = path.join('config', 'discord', 'discord.json');
    const discordPath = path.join(runtimeRoot, discordRelative);
    const discordTemplate = path.join(templateRoot, discordRelative);
    if (fs.existsSync(discordPath) && fs.existsSync(discordTemplate)) {
        const current = JSON.parse(await fsp.readFile(discordPath, 'utf8'));
        const defaults = JSON.parse(await fsp.readFile(discordTemplate, 'utf8'));
        let changed = false;
        for (const key of ['remoteOnly', 'skyCommandName']) {
            if (current[key] === undefined && defaults[key] !== undefined) {
                current[key] = defaults[key];
                changed = true;
            }
        }
        if (changed) {
            await writeJsonAtomic(discordPath, current);
            changedFiles.push(discordRelative.replace(/\\/g, '/'));
        }
    }

    const windowsRelative = path.join('config', 'gui', 'windows.json');
    const windowsPath = path.join(runtimeRoot, windowsRelative);
    const windowsTemplate = path.join(templateRoot, windowsRelative);
    if (fs.existsSync(windowsPath) && fs.existsSync(windowsTemplate)) {
        const current = JSON.parse(await fsp.readFile(windowsPath, 'utf8'));
        const defaults = JSON.parse(await fsp.readFile(windowsTemplate, 'utf8'));
        let changed = false;
        const oldMinerals = new Set(['ᴋʜᴏáɴɢ\\s*ѕảɴ|khoáng|khoang|mineral|ks']);
        const oldSmelting = new Set(['nung|smelt']);
        if (oldMinerals.has(current?.minerals?.title?.regex) && defaults?.minerals?.title?.regex) {
            current.minerals.title.regex = defaults.minerals.title.regex;
            changed = true;
        }
        if (oldSmelting.has(current?.smelting?.title?.regex) && defaults?.smelting?.title?.regex) {
            current.smelting.title.regex = defaults.smelting.title.regex;
            changed = true;
        }
        if (changed) {
            await writeJsonAtomic(windowsPath, current);
            changedFiles.push(windowsRelative.replace(/\\/g, '/'));
        }
    }

    if (!changedFiles.length) return { changed: false, files: [] };
    return { changed: true, files: [...new Set(changedFiles)], migrationId: '2.6.14-discord-remote-strong-smelting-identity' };
}

async function migrateB5StorageProtectionAndModeSkyGateway({ runtimeRoot, fromVersion }) {
    if (!shouldRunBefore(fromVersion, '2.6.16')) return { changed: false, files: [], changes: [] };
    const changedFiles = [];
    const changes = [];
    const note = (relative, field, action, details = null) => changes.push({
        file: relative.replace(/\\/g, '/'), field, action, details
    });

    const update = async (relative, mutate) => {
        const filePath = path.join(runtimeRoot, relative);
        if (!fs.existsSync(filePath)) return;
        const current = JSON.parse(await fsp.readFile(filePath, 'utf8'));
        const before = JSON.stringify(current);
        mutate(current, relative);
        if (JSON.stringify(current) === before) return;
        await writeJsonAtomic(filePath, current);
        changedFiles.push(relative.replace(/\\/g, '/'));
    };

    const conversionsRelative = path.join('config', 'minerals', 'conversions.json');
    let legacyDecompressionMaxRatio = null;
    let legacyRequireKnownCapacity = null;
    const conversionsPath = path.join(runtimeRoot, conversionsRelative);
    if (fs.existsSync(conversionsPath)) {
        const current = JSON.parse(await fsp.readFile(conversionsPath, 'utf8'));
        const legacyPressure = current?.storagePressure && typeof current.storagePressure === 'object'
            ? current.storagePressure
            : null;
        legacyDecompressionMaxRatio = Number.isFinite(Number(legacyPressure?.decompressionMaxRatio))
            ? Number(legacyPressure.decompressionMaxRatio)
            : null;
        legacyRequireKnownCapacity = typeof legacyPressure?.requireKnownCapacityForDecompression === 'boolean'
            ? legacyPressure.requireKnownCapacityForDecompression
            : null;
        let conversionsChanged = false;
        if (legacyPressure) {
            delete current.storagePressure;
            conversionsChanged = true;
            note(conversionsRelative, 'storagePressure', 'migrated-and-removed', {
                decompressionMaxRatio: legacyDecompressionMaxRatio,
                requireKnownCapacityForDecompression: legacyRequireKnownCapacity,
                destination: 'config/modes/collector-b5.json:b1Decompression',
                unsupportedFieldsRemoved: Object.keys(legacyPressure).filter(key => !['decompressionMaxRatio', 'requireKnownCapacityForDecompression'].includes(key))
            });
        }
        const requiredSmeltingOrder = ['raw_iron_to_iron', 'raw_gold_to_gold'];
        if (JSON.stringify(current.smeltingRecipeIds) !== JSON.stringify(requiredSmeltingOrder)) {
            const previous = current.smeltingRecipeIds;
            current.smeltingRecipeIds = requiredSmeltingOrder;
            conversionsChanged = true;
            note(conversionsRelative, 'smeltingRecipeIds', 'canonicalized-b5-ordered-smelting-contract', { previous, next: requiredSmeltingOrder });
        }
        if (conversionsChanged) {
            await writeJsonAtomic(conversionsPath, current);
            changedFiles.push(conversionsRelative.replace(/\\/g, '/'));
        }
    }

    await update(path.join('config', 'storage', 'kho.json'), (current, relative) => {
        current.sell ||= {};
        const legacySellFields = [
            'maxProtectionPasses', 'maxSellBurstClicks', 'maxSellClicks', 'maxPasses',
            'forecastWindowMs', 'rapidGrowthThreshold', 'rapidGrowthMultiplier',
            'startupReserveCoverage', 'startupStopCoverage', 'startupTrimEnabled',
            'fastDisposable', 'fastDisposableSellAllIds'
        ];
        for (const key of legacySellFields) {
            if (!Object.prototype.hasOwnProperty.call(current.sell, key)) continue;
            const previous = current.sell[key];
            delete current.sell[key];
            note(relative, `sell.${key}`, 'removed-unsupported-legacy-field', { previous });
        }

        if (Number(current.sell.reserveCoverage) !== 1.5) {
            const previous = current.sell.reserveCoverage;
            current.sell.reserveCoverage = 1.5;
            note(relative, 'sell.reserveCoverage', 'normalized-hard-b5-reserve', { previous, next: 1.5 });
        }
        if (!Object.prototype.hasOwnProperty.call(current.sell, 'allowSingle')) {
            current.sell.allowSingle = true;
            note(relative, 'sell.allowSingle', 'default-added', { next: true });
        }
        // Existing allowSingle (including false) and every other schema-supported
        // operator setting are intentionally preserved verbatim.
    });

    await update(path.join('config', 'modes', 'b5-craft.json'), (current, relative) => {
        for (const key of ['waitForSkyblockReady', 'skyblockReadyTimeoutMs', 'b1NormalizeIntervalMs']) {
            if (!Object.prototype.hasOwnProperty.call(current, key)) continue;
            const previous = current[key];
            delete current[key];
            note(relative, key, 'removed-unsupported-legacy-field', { previous });
        }
        if (Object.prototype.hasOwnProperty.call(current, 'storageProtection')) {
            const previous = current.storageProtection;
            delete current.storageProtection;
            note(relative, 'storageProtection', 'moved-to-storage-boundary-owner', { previous, destination: 'config/storage/kho.json:sell' });
        }
    });

    await update(path.join('config', 'modes', 'collector-b5.json'), (current, relative) => {
        for (const key of ['waitForSkyblockReady', 'skyblockReadyTimeoutMs']) {
            if (!Object.prototype.hasOwnProperty.call(current, key)) continue;
            const previous = current[key];
            delete current[key];
            note(relative, key, 'removed-unsupported-legacy-field', { previous });
        }
        if (Object.prototype.hasOwnProperty.call(current, 'storageProtection')) {
            const previous = current.storageProtection;
            delete current.storageProtection;
            note(relative, 'storageProtection', 'moved-to-storage-boundary-owner', { previous, destination: 'config/storage/kho.json:sell' });
        }
        const ratio = legacyDecompressionMaxRatio !== null && legacyDecompressionMaxRatio > 0 && legacyDecompressionMaxRatio <= 1
            ? legacyDecompressionMaxRatio
            : Number(current?.b1Decompression?.maxUsageRatio ?? 0.8);
        const requireKnown = legacyRequireKnownCapacity !== null
            ? legacyRequireKnownCapacity
            : current?.b1Decompression?.requireKnownCapacity !== false;
        const previous = current.b1Decompression;
        current.b1Decompression = {
            maxUsageRatio: ratio,
            requireKnownCapacity: requireKnown
        };
        if (JSON.stringify(previous) !== JSON.stringify(current.b1Decompression)) {
            note(relative, 'b1Decompression', 'normalized-collector-only-decompression-policy', { previous, next: current.b1Decompression });
        }
    });

    await update(path.join('config', 'skyblock', 'join.json'), (current, relative) => {
        const old = current.autoJoin && typeof current.autoJoin === 'object' ? current.autoJoin : {};
        const existing = current.modeJoin && typeof current.modeJoin === 'object' ? current.modeJoin : {};
        const previousModeJoin = current.modeJoin;
        current.modeJoin = {
            delayMs: Number.isFinite(Number(old.delayMs)) ? Number(old.delayMs) : Number(existing.delayMs ?? 1200),
            spawnFallbackDelayMs: Number.isFinite(Number(old.spawnFallbackDelayMs)) ? Number(old.spawnFallbackDelayMs) : Number(existing.spawnFallbackDelayMs ?? 5000),
            retryDelayMs: Number.isFinite(Number(old.retryDelayMs)) ? Number(old.retryDelayMs) : Number(existing.retryDelayMs ?? 300000),
            rejoinDelayMs: Number.isFinite(Number(old.rejoinDelayMs)) ? Number(old.rejoinDelayMs) : Number(existing.rejoinDelayMs ?? 300000),
            recoveryPollMs: Number.isFinite(Number(old.recoveryPollMs)) ? Number(old.recoveryPollMs) : Number(existing.recoveryPollMs ?? 10000),
            waitForResourcePack: typeof old.waitForResourcePack === 'boolean' ? old.waitForResourcePack : existing.waitForResourcePack === true
        };
        if (JSON.stringify(previousModeJoin) !== JSON.stringify(current.modeJoin)) {
            note(relative, 'modeJoin', 'migrated-mode-demand-gateway-settings', { previous: previousModeJoin, next: current.modeJoin });
        }
        if (typeof old.selection === 'string' && old.selection.trim() && current?.selections?.[old.selection]) {
            if (current.defaultSelection !== old.selection) {
                note(relative, 'defaultSelection', 'migrated-autoJoin-selection', { previous: current.defaultSelection, next: old.selection });
                current.defaultSelection = old.selection;
            }
        }
        if (Object.prototype.hasOwnProperty.call(current, 'autoJoin')) {
            delete current.autoJoin;
            note(relative, 'autoJoin', 'migrated-and-removed', { destination: 'modeJoin/defaultSelection' });
        }
    });

    if (!changedFiles.length) return { changed: false, files: [], changes: [] };
    return {
        changed: true,
        files: [...new Set(changedFiles)],
        changes,
        migrationId: '2.6.16-b5-storage-protection-mode-sky-gateway'
    };
}

async function migrateB5Sell64OnlyPolicy({ runtimeRoot, fromVersion }) {
    // 2.6.26 makes the B5 warehouse sale coarse and resumable. The server
    // action is always 64; a verified surplus remainder below 64 is retained
    // instead of issuing a final quantity-1 click.
    if (!shouldRunBefore(fromVersion, '2.6.26')) return { changed: false, files: [] };

    const relative = path.join('config', 'storage', 'kho.json');
    const runtimePath = path.join(runtimeRoot, relative);
    if (!fs.existsSync(runtimePath)) return { changed: false, files: [] };

    const current = JSON.parse(await fsp.readFile(runtimePath, 'utf8'));
    current.sell ||= {};
    if (current.sell.allowSingle === false) return { changed: false, files: [] };

    const previous = current.sell.allowSingle;
    current.sell.allowSingle = false;
    await writeJsonAtomic(runtimePath, current);
    return {
        changed: true,
        files: [relative.replace(/\\/g, '/')],
        changes: [{
            file: relative.replace(/\\/g, '/'),
            field: 'sell.allowSingle',
            action: 'enforced-b5-64-only-sell-contract',
            previous,
            next: false
        }],
        migrationId: '2.6.26-b5-64-only-resumable-storage-sale'
    };
}

async function applyRuntimeConfigMigrations(context) {
    const migrations = [
        { target: '2.6.1', run: migrateGuiIdentityWindowDefaults },
        { target: '2.6.3', run: migrateB5SmeltingProtectionDefault },
        { target: '2.6.4', run: migrateB5IronGoldOnlySmeltingAndMineralsIdentity },
        { target: '2.6.5', run: migrateB5GuardedAllAndReserveDefaults },
        { target: '2.6.8', run: migrateB5ReconciliationAndLearnedIdentityPolicy },
        { target: '2.6.10', run: migrateHubSkyRecoveryAndB5Normalization },
        { target: '2.6.11', run: migrateB5SingleSourceStoragePolicyAndTungstenIdentity },
        { target: '2.6.14', run: migrateDiscordRemoteAndStrongSmeltingIdentity },
        { target: '2.6.16', run: migrateB5StorageProtectionAndModeSkyGateway },
        { target: '2.6.26', run: migrateB5Sell64OnlyPolicy }
    ];
    const applied = [];
    const files = new Set();
    const reports = [];
    for (const migration of migrations) {
        const targetComparison = compareVersions(context?.toVersion, migration.target);
        if (targetComparison !== null && targetComparison < 0) continue;
        const result = await migration.run(context);
        if (!result?.changed) continue;
        const migrationId = result.migrationId || migration.run.name;
        applied.push(migrationId);
        for (const file of result.files || []) files.add(file);
        reports.push({ migrationId, files: result.files || [], changes: result.changes || [] });
    }
    return { applied, files: [...files], reports };
}

module.exports = {
    applyRuntimeConfigMigrations,
    compareVersions,
    migrateGuiIdentityWindowDefaults,
    migrateB5SmeltingProtectionDefault,
    migrateB5IronGoldOnlySmeltingAndMineralsIdentity,
    migrateB5GuardedAllAndReserveDefaults,
    migrateB5ReconciliationAndLearnedIdentityPolicy,
    migrateHubSkyRecoveryAndB5Normalization,
    migrateB5SingleSourceStoragePolicyAndTungstenIdentity,
    migrateDiscordRemoteAndStrongSmeltingIdentity,
    migrateB5StorageProtectionAndModeSkyGateway,
    migrateB5Sell64OnlyPolicy
};
