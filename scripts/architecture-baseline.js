'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const catalog = require('../architecture/catalog.json');
const ConfigSpecs = require('../src/configuration/ConfigSpecs');
const EventScopes = require('../src/core/events/EventScopeRegistry');
const createModeCatalog = require('../src/bootstrap/createModeCatalog');
const { audit: architectureAudit } = require('./validate-architecture');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const SCHEMA_VERSION = 1;
const BASELINE_VERSION = 1;
const EXCLUDED_SEGMENTS = new Set(['node_modules', 'data']);
const EXCLUDED_BASENAMES = [/^\.env(?:\.|$)/i, /\.log$/i];
const CONTENT_SCAN_EXCLUSIONS = ['config/bots'];
const SELF_OUTPUT_PATHS = new Set([
    'architecture/baseline/current.json',
    'docs/architecture-roadmap/baseline/WP-001_GAP_REPORT.md'
]);
const SOURCE_AREAS = Object.freeze({
    ai: 'application-support',
    bootstrap: 'composition-root',
    bot: 'bot-runtime',
    commands: 'command-capability',
    configuration: 'application-configuration',
    connection: 'bot-connection',
    core: 'platform-core',
    desktop: 'control-plane-desktop',
    diagnostics: 'observability',
    discord: 'control-plane-discord',
    fleet: 'fleet-scheduling',
    gui: 'gui-capability',
    items: 'item-inventory-capability',
    modes: 'mode-platform',
    movement: 'movement-capability',
    operations: 'operation-platform',
    planning: 'pure-planning',
    recovery: 'durable-control',
    'server-features': 'server-domain-features',
    'server-profiles': 'server-profile-boundary',
    shared: 'shared-foundation',
    simulation: 'simulation-replay',
    '<root>': 'runtime-entrypoint'
});

function posix(value) {
    return String(value || '').replace(/\\/g, '/').split(path.sep).join('/').replace(/^\.\//, '');
}

function isExcludedPath(relativePath, { contentScan = false } = {}) {
    const normalized = posix(relativePath);
    if (!normalized) return false;
    const segments = normalized.split('/');
    if (segments.some(segment => EXCLUDED_SEGMENTS.has(segment))) return true;
    if (EXCLUDED_BASENAMES.some(pattern => pattern.test(path.posix.basename(normalized)))) return true;
    if (contentScan && CONTENT_SCAN_EXCLUSIONS.some(prefix => normalized === prefix || normalized.startsWith(`${prefix}/`))) return true;
    return false;
}

function walkFiles(root = DEFAULT_ROOT) {
    const output = [];
    const walk = directory => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const full = path.join(directory, entry.name);
            const relative = posix(path.relative(root, full));
            if (isExcludedPath(relative) || SELF_OUTPUT_PATHS.has(relative)) continue;
            if (entry.isSymbolicLink()) continue;
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile()) output.push(relative);
        }
    };
    walk(root);
    return output.sort();
}

function readAllowed(root, relativePath) {
    if (isExcludedPath(relativePath, { contentScan: true })) return null;
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function sourceFingerprint(root, files) {
    const hash = crypto.createHash('sha256');
    for (const file of files) {
        hash.update(file);
        hash.update('\0');
        if (isExcludedPath(file, { contentScan: true })) {
            hash.update('<content-excluded>');
        } else {
            hash.update(fs.readFileSync(path.join(root, file)));
        }
        hash.update('\0');
    }
    return hash.digest('hex');
}

function requireRequests(source) {
    return [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match => match[1]);
}

function resolveLocal(root, fromFile, request) {
    if (!request.startsWith('.')) return null;
    const base = path.resolve(root, path.dirname(fromFile), request);
    const candidates = [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')];
    const resolved = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    return resolved ? posix(path.relative(root, resolved)) : null;
}

function reachability(root, sourceFiles) {
    const graphFiles = sourceFiles.concat(walkFiles(root).filter(file => file.startsWith('scripts/') && file.endsWith('.js')));
    const graph = new Map();
    for (const file of graphFiles) {
        const source = readAllowed(root, file);
        if (source == null) continue;
        graph.set(file, requireRequests(source).map(request => resolveLocal(root, file, request)).filter(Boolean));
    }
    const reachable = roots => {
        const reached = new Set();
        const stack = roots.filter(file => graph.has(file));
        while (stack.length) {
            const file = stack.pop();
            if (reached.has(file)) continue;
            reached.add(file);
            for (const dependency of graph.get(file) || []) if (graph.has(dependency)) stack.push(dependency);
        }
        return reached;
    };
    const runtime = reachable(catalog.runtimeEntrypoints || []);
    const runtimeOrScripts = reachable([...(catalog.runtimeEntrypoints || []), ...[...graph.keys()].filter(file => file.startsWith('scripts/'))]);
    return {
        runtimeEntrypoints: (catalog.runtimeEntrypoints || []).map(file => {
            const fromRoot = reachable([file]);
            return {
                file,
                exists: fs.existsSync(path.join(root, file)),
                directLocalDependencies: [...(graph.get(file) || [])].sort(),
                reachableSourceFiles: [...fromRoot].filter(item => item.startsWith('src/')).length
            };
        }),
        runtimeReachableSourceFiles: [...runtime].filter(file => file.startsWith('src/')).sort(),
        projectReachableSourceFiles: [...runtimeOrScripts].filter(file => file.startsWith('src/')).sort(),
        orphanSourceFiles: sourceFiles.filter(file => !runtimeOrScripts.has(file)).sort()
    };
}

function sourceAreaInventory(sourceFiles) {
    const counts = new Map();
    for (const file of sourceFiles) {
        const parts = file.split('/');
        const area = parts.length === 2 ? '<root>' : (parts[1] || '<root>');
        counts.set(area, (counts.get(area) || 0) + 1);
    }
    return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([area, files]) => ({
        area,
        files,
        owner: area === '<root>' ? 'src/index.js' : `src/${area}/`,
        layer: SOURCE_AREAS[area] || 'UNCLASSIFIED',
        classification: SOURCE_AREAS[area] ? 'CURRENT' : 'UNKNOWN'
    }));
}

function sideEffects(root, sourceFiles) {
    return (catalog.exclusiveSideEffects || []).map(rule => {
        const pattern = new RegExp(rule.pattern, 'g');
        const callsites = [];
        for (const file of sourceFiles) {
            const source = readAllowed(root, file);
            if (source == null) continue;
            pattern.lastIndex = 0;
            if (pattern.test(source)) callsites.push(file);
        }
        const owners = [...(rule.owners || [])].sort();
        const violations = callsites.filter(file => !owners.includes(file));
        return { id: rule.id, owners, callsites: callsites.sort(), violations };
    });
}

function emittedEvents(root, sourceFiles) {
    const producers = new Map();
    const emitPattern = /(?:this\.)?eventBus(?:\?)?\.emit\(\s*['"]([^'"]+)['"]/g;
    for (const file of sourceFiles) {
        const source = readAllowed(root, file);
        if (source == null) continue;
        for (const match of source.matchAll(emitPattern)) {
            if (!producers.has(match[1])) producers.set(match[1], new Set());
            producers.get(match[1]).add(file);
        }
    }
    const guardFiles = sourceFiles.filter(file => {
        const source = readAllowed(root, file);
        return source != null && /normalizeConnectionGeneration|connectionGeneration|getGeneration\(\)/.test(source);
    });
    return {
        connectionScoped: [...EventScopes.CONNECTION_SCOPED_EVENTS].sort().map(event => ({
            event,
            producers: [...(producers.get(event) || [])].sort(),
            producerReachable: Boolean(producers.get(event)?.size)
        })),
        botScopeOverrides: [...EventScopes.BOT_SCOPE_OVERRIDE_EVENTS].sort(),
        generationGuardFiles: guardFiles.sort()
    };
}

function modeInventory(root) {
    const modeCatalog = createModeCatalog({ baseDir: root });
    return modeCatalog.list().map(definition => {
        const serviceFile = definition.serviceName === 'b5CraftMode'
            ? 'src/modes/b5-craft/B5CraftModeService.js'
            : definition.serviceName === 'collectorB5Mode'
                ? 'src/modes/collector-b5/CollectorB5ModeService.js'
                : definition.serviceName === 'fishingMode'
                    ? 'src/modes/fishing/FishingModeService.js'
                    : definition.metadata?.sourceFile || null;
        let lifecycle = 'UNKNOWN';
        if (serviceFile && fs.existsSync(path.join(root, serviceFile))) {
            const source = readAllowed(root, serviceFile);
            lifecycle = source && /extends\s+ManagedMode\b/.test(source) ? 'MANAGED_MODE' : 'LEGACY_OR_CUSTOM';
        } else if (definition.metadata?.kind === 'composable') lifecycle = 'MANAGED_MODE';
        return {
            id: definition.id,
            serviceName: definition.serviceName,
            kind: definition.metadata?.kind || 'unknown',
            lifecycle,
            requiredCapabilities: [...(definition.requiredCapabilities || [])],
            requestedResources: [...(definition.requestedResources || [])],
            sourceFile: serviceFile
        };
    });
}

function capabilityInventory(root) {
    const file = 'src/bootstrap/registerBotServices.js';
    const source = readAllowed(root, file) || '';
    const match = source.match(/const\s+capabilities\s*=\s*\{([\s\S]*?)\};\s*\n?\s*for\s*\(const\s+\[capabilityId/);
    if (!match) return { sourceFile: file, ids: [], parseStatus: 'UNKNOWN' };
    const ids = [];
    const body = match[1];
    for (const raw of body.split(',')) {
        const token = raw.trim();
        if (!token) continue;
        const keyed = token.match(/^(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$-]*))\s*:/);
        if (keyed) {
            ids.push(keyed[1] || keyed[2] || keyed[3]);
            continue;
        }
        const shorthand = token.match(/^([A-Za-z_$][\w$]*)$/);
        if (shorthand) ids.push(shorthand[1]);
    }
    return { sourceFile: file, ids: [...new Set(ids)].sort(), parseStatus: 'CURRENT' };
}

function configInventory(root, sourceFiles) {
    const genericReloadFile = 'src/configuration/ConfigurationService.js';
    const explicitLiveApply = new Set(['skyblock', 'skyCommands', 'b5CraftMode', 'collectorB5Mode']);
    return ConfigSpecs.map(spec => {
        const consumers = [];
        const escaped = spec.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`registry\\.(?:require|get)\\(\\s*['"]${escaped}['"]\\s*\\)`);
        for (const file of sourceFiles) {
            const source = readAllowed(root, file);
            if (source != null && pattern.test(source)) consumers.push(file);
        }
        return {
            key: spec.key,
            file: spec.file,
            schema: spec.schema,
            consumers: [...new Set(consumers)].sort(),
            reload: {
                api: genericReloadFile,
                configurationReloadSupported: true,
                explicitRuntimeApply: explicitLiveApply.has(spec.key),
                explicitRuntimeApplyEvidence: spec.key === 'collectorB5Mode'
                    ? ['src/discord/config/CollectorB5ConfigEditor.js']
                    : explicitLiveApply.has(spec.key) ? ['src/desktop/DesktopController.js'] : []
            }
        };
    });
}

function dynamicConfigurationInventory(root) {
    const files = walkFiles(root);
    const botDirectory = posix(catalog.configuration?.botProfileDirectory || 'config/bots');
    const customModeDirectory = posix(catalog.configuration?.customModeDirectory || 'config/modes/custom');
    return [
        {
            id: 'bot-profiles',
            directory: botDirectory,
            schema: 'bot',
            files: files.filter(file => file.startsWith(`${botDirectory}/`) && file.endsWith('.json')).length,
            contentCaptured: false,
            consumers: ['src/bootstrap/loadBotProfiles.js', 'src/discord/admin/BotProfileAdminService.js'],
            runtimeReload: ['src/discord/config/FishingBotConfigEditor.js', 'src/discord/admin/BotProfileAdminService.js']
        },
        {
            id: 'custom-modes',
            directory: customModeDirectory,
            schema: 'WorkflowDefinitionValidator',
            files: files.filter(file => file.startsWith(`${customModeDirectory}/`) && file.endsWith('.json')).length,
            contentCaptured: true,
            consumers: ['src/modes/composable/CustomModeStore.js', 'src/bootstrap/createModeCatalog.js'],
            runtimeReload: []
        }
    ];
}

function serverFactInventory(root, sourceFiles) {
    const categoryRules = {
        command: { config: ['config/commands/', 'config/authentication/', 'config/island/', 'config/dungeon/'], source: ['src/commands/', 'src/server-features/authentication/', 'src/server-features/island/', 'src/server-features/dungeon/'] },
        gui: { config: ['config/gui/'], source: ['src/gui/', 'src/server-features/storage/', 'src/server-features/personal-vault/', 'src/server-features/minerals/', 'src/server-features/crafting/'] },
        item: { config: ['config/items/'], source: ['src/items/'] },
        recipe: { config: ['config/server-data/', 'config/smelting/', 'config/minerals/'], source: ['src/planning/crafting/', 'src/server-features/crafting/', 'src/server-features/smelting/', 'src/server-features/minerals/'] },
        storage: { config: ['config/storage/', 'config/personal-vault/'], source: ['src/server-features/storage/', 'src/server-features/personal-vault/'] },
        join: { config: ['config/server.json', 'config/skyblock/', 'config/resource-pack/', 'config/authentication/'], source: ['src/connection/', 'src/server-features/skyblock/', 'src/server-features/resource-pack/', 'src/server-features/authentication/'] }
    };
    const allFiles = walkFiles(root);
    return Object.entries(categoryRules).map(([category, rules]) => ({
        category,
        configLocations: allFiles.filter(file => rules.config.some(prefix => file === prefix || file.startsWith(prefix))).sort(),
        sourceLocations: sourceFiles.filter(file => rules.source.some(prefix => file.startsWith(prefix))).sort()
    }));
}

function architectureInspection() {
    const result = architectureAudit();
    return {
        valid: result.valid,
        catalog: result.catalog,
        findings: result.failures.map(failure => ({
            code: failure.code,
            category: 'CURRENT',
            file: failure.file || null,
            message: failure.message
        }))
    };
}

function findings(baseline, root = DEFAULT_ROOT) {
    const modes = baseline.modes;
    const legacyModes = modes.filter(mode => mode.lifecycle !== 'MANAGED_MODE').map(mode => mode.id);
    const reachable = new Set(baseline.reachability.projectReachableSourceFiles || []);
    const exists = relative => fs.existsSync(path.join(root, relative));
    const allReachable = files => files.every(file => reachable.has(file));

    const commonContractsReady = allReachable([
        'src/shared/contracts/OperationResultContract.js',
        'src/shared/contracts/ErrorContract.js',
        'src/core/events/EventEnvelope.js'
    ]);
    const serverProfileReady = allReachable([
        'src/server-profiles/ServerProfile.js',
        'src/server-profiles/ServerProfileRegistry.js',
        'src/server-profiles/createServerProfileRegistry.js'
    ]) && exists('architecture/server-profiles/minerua-inventory.json');
    const transactionReady = reachable.has('src/desktop/update/RuntimeConfigMigrator.js');
    const ownershipReady = (baseline.sideEffects || []).every(item => item.violations.length === 0)
        && exists('architecture/artifact-ownership.json')
        && exists('scripts/audit-side-effect-ownership.js');
    const generationReady = reachable.has('src/core/events/EventEnvelope.js')
        && (baseline.events?.generationGuardFiles || []).length > 0;
    const releaseZipReady = exists('scripts/release-zip-contract.js')
        && exists('scripts/verify-release-zip.js')
        && exists('tests/unit/release/ReleaseZipContract.test.js');
    const stranglerDebtDocumented = exists('architecture/legacy-mode-debt.json')
        && exists('src/modes/legacy/LegacyModeAdapter.js');

    const list = [
        {
            code: 'BASELINE_ARCHITECTURE_VALIDATOR', category: 'CURRENT', file: 'scripts/validate-architecture.js',
            summary: baseline.architectureInspection.valid ? 'Architecture validator is clean at capture time.' : 'Architecture validator reports current failures.',
            workPackages: ['WP-001']
        },
        {
            code: 'COMMON_CONTRACTS_ACTIVE', category: commonContractsReady ? 'CURRENT' : 'DEBT', file: 'src/shared/contracts/OperationResultContract.js',
            summary: commonContractsReady
                ? 'Versioned operation result/error/event contracts are reachable and WP-002 closure is present.'
                : 'One or more common result/error/event contract artifacts are missing or unreachable.',
            workPackages: ['WP-002']
        },
        {
            code: 'SERVER_PROFILE_BOUNDARY_ACTIVE', category: serverProfileReady ? 'CURRENT' : 'DEBT', file: 'src/server-profiles',
            summary: serverProfileReady
                ? 'Server-specific command/GUI/item/recipe/storage/join facts are governed through the ServerProfile boundary; generic consumers may still exist under src/server-features.'
                : 'ServerProfile boundary or MinerUA inventory evidence is missing.',
            workPackages: ['WP-100', 'WP-101', 'WP-102', 'WP-103', 'WP-104', 'WP-105']
        },
        {
            code: 'MODE_LIFECYCLE_STRANGLER_DEBT', category: legacyModes.length ? 'DEBT' : 'CURRENT', file: stranglerDebtDocumented ? 'architecture/legacy-mode-debt.json' : 'src/modes',
            summary: legacyModes.length
                ? `${legacyModes.join(', ')} remain intentional strangler-adapter modes; generic registry/control parity is closed and exit triggers are documented rather than forcing a gameplay rewrite.`
                : 'All detected modes use ManagedMode lifecycle directly.',
            workPackages: ['WP-201', 'WP-203']
        },
        {
            code: 'CONFIG_TRANSACTION_CLOSED', category: transactionReady ? 'CURRENT' : 'DEBT', file: 'src/desktop/update/RuntimeConfigMigrator.js',
            summary: transactionReady
                ? 'Runtime configuration transaction closure is implemented and reachable; WP-003 is no longer pending.'
                : 'Runtime configuration transaction migrator is missing or unreachable.',
            workPackages: ['WP-003']
        },
        {
            code: 'SIDE_EFFECT_OWNERSHIP_CLOSED', category: ownershipReady ? 'CURRENT' : 'DEBT', file: 'architecture/artifact-ownership.json',
            summary: ownershipReady
                ? 'Raw side-effect and destructive artifact ownership are catalogued with zero current raw-owner violations.'
                : 'Side-effect/artifact ownership evidence is missing or current owner violations exist.',
            workPackages: ['WP-004']
        },
        {
            code: 'GENERATION_CANCELLATION_GUARDS_ACTIVE', category: generationReady ? 'CURRENT' : 'DEBT', file: 'src/core/events/EventEnvelope.js',
            summary: generationReady
                ? `Generation/cancellation contracts are active with ${baseline.events.generationGuardFiles.length} source file(s) carrying generation-guard evidence.`
                : 'Generation/cancellation guard evidence is missing.',
            workPackages: ['WP-005']
        },
        {
            code: 'RELEASE_ZIP_CONTRACT_ACTIVE', category: releaseZipReady ? 'CURRENT' : 'DEBT', file: 'scripts/release-zip-contract.js',
            summary: releaseZipReady
                ? 'Release ZIP completeness/safety policy and real-ZIP verifier are present; source-only fast quality includes the pure contract test.'
                : 'Release ZIP completeness/safety contract evidence is missing.',
            workPackages: ['WP-402']
        }
    ];
    for (const failure of baseline.architectureInspection.findings) {
        list.push({ code: failure.code, category: 'CURRENT', file: failure.file, summary: failure.message, workPackages: ['WP-001'] });
    }
    return list;
}

function buildBaseline({ root = DEFAULT_ROOT, generatedAt = new Date().toISOString() } = {}) {
    const files = walkFiles(root);
    const sourceFiles = files.filter(file => file.startsWith('src/') && file.endsWith('.js'));
    const testFiles = files.filter(file => file.startsWith('tests/') && file.endsWith('.js'));
    const scriptFiles = files.filter(file => file.startsWith('scripts/') && file.endsWith('.js'));
    const configFiles = files.filter(file => file.startsWith('config/') && file.endsWith('.json'));
    const routeFiles = files.filter(file => file.startsWith('config/movement/') && /routes/i.test(file));
    const reach = reachability(root, sourceFiles);
    const baseline = {
        schemaVersion: SCHEMA_VERSION,
        baselineVersion: BASELINE_VERSION,
        workPackage: 'WP-001',
        generatedAt,
        releaseVersion: require(path.join(root, 'package.json')).version,
        scope: {
            root: '.',
            exclusions: ['.env*', 'data/**', 'node_modules/**', '**/*.log'],
            contentScanAdditionalExclusions: ['config/bots/**'],
            selfOutputsExcludedFromCounts: [...SELF_OUTPUT_PATHS].sort(),
            reproducibleCommands: [
                "rg --files --hidden -g '!.env*' -g '!data/**' -g '!node_modules/**' -g '!*.log' -g '!architecture/baseline/current.json' -g '!docs/architecture-roadmap/baseline/WP-001_GAP_REPORT.md'",
                'node scripts/inspect-architecture-baseline.js',
                'node scripts/inspect-architecture-baseline.js --check',
                'node scripts/validate-architecture.js --json',
                'node --test tests/unit/architecture/ArchitectureBaseline.test.js'
            ]
        },
        revision: {
            available: false,
            revision: null,
            branch: null,
            worktree: { state: 'STANDALONE', inScopeChangedPaths: 0 },
            reason: 'Standalone source tree; version-control metadata is intentionally not required.',
            sourceFingerprintSha256: sourceFingerprint(root, files)
        },
        counts: { files: files.length, source: sourceFiles.length, tests: testFiles.length, scripts: scriptFiles.length, configJson: configFiles.length, routes: routeFiles.length },
        sourceAreas: sourceAreaInventory(sourceFiles),
        reachability: reach,
        sideEffects: sideEffects(root, sourceFiles),
        events: emittedEvents(root, sourceFiles),
        modes: modeInventory(root),
        capabilities: capabilityInventory(root),
        modePlatform: {
            catalogFactory: 'src/bootstrap/createModeCatalog.js',
            catalogClass: 'src/modes/ModeCatalog.js',
            capabilityRegistry: 'src/core/registry/CapabilityRegistry.js',
            runtimeModeRegistry: 'src/modes/RuntimeModeRegistry.js',
            binding: 'src/bootstrap/registerBotServices.js'
        },
        serverSpecificFacts: serverFactInventory(root, sourceFiles),
        configuration: configInventory(root, sourceFiles),
        dynamicConfiguration: dynamicConfigurationInventory(root),
        architectureInspection: architectureInspection()
    };
    baseline.findings = findings(baseline, root);
    return baseline;
}

function validateTopLevelSchema(baseline, root, fail) {
    let schema;
    try {
        schema = JSON.parse(fs.readFileSync(path.join(root, 'architecture/baseline/schema.json'), 'utf8'));
    } catch (error) {
        fail('BASELINE_SCHEMA_FILE', `Cannot read baseline schema: ${error.message}`, 'architecture/baseline/schema.json');
        return;
    }
    if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) {
        fail('BASELINE_SCHEMA_TYPE', 'Baseline must be an object.');
        return;
    }
    for (const key of schema.required || []) {
        if (!Object.prototype.hasOwnProperty.call(baseline, key)) fail('BASELINE_SCHEMA_REQUIRED', `Missing required property: ${key}`);
    }
    for (const [key, rule] of Object.entries(schema.properties || {})) {
        if (!Object.prototype.hasOwnProperty.call(baseline, key)) continue;
        const value = baseline[key];
        if (Object.prototype.hasOwnProperty.call(rule, 'const') && value !== rule.const) {
            fail('BASELINE_SCHEMA_CONST', `${key} must equal ${JSON.stringify(rule.const)}.`);
        }
        if (rule.type === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) fail('BASELINE_SCHEMA_TYPE', `${key} must be an object.`);
        if (rule.type === 'array' && !Array.isArray(value)) fail('BASELINE_SCHEMA_TYPE', `${key} must be an array.`);
        if (rule.type === 'string' && typeof value !== 'string') fail('BASELINE_SCHEMA_TYPE', `${key} must be a string.`);
        if (rule.type === 'integer' && !Number.isInteger(value)) fail('BASELINE_SCHEMA_TYPE', `${key} must be an integer.`);
        if (rule.type === 'array' && Number.isInteger(rule.minItems) && Array.isArray(value) && value.length < rule.minItems) fail('BASELINE_SCHEMA_MIN_ITEMS', `${key} requires at least ${rule.minItems} item(s).`);
        if (rule.type === 'integer' && Number.isFinite(rule.minimum) && Number.isInteger(value) && value < rule.minimum) fail('BASELINE_SCHEMA_MINIMUM', `${key} must be >= ${rule.minimum}.`);
    }
}

function validateBaseline(baseline, { root = DEFAULT_ROOT, compareArchitecture = true } = {}) {
    const failures = [];
    const fail = (code, message, file = 'architecture/baseline/current.json') => failures.push({ code, message, file });
    validateTopLevelSchema(baseline, root, fail);
    if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) fail('BASELINE_SCHEMA', 'Baseline must be an object.');
    if (baseline?.schemaVersion !== SCHEMA_VERSION) fail('BASELINE_SCHEMA_VERSION', `Expected schemaVersion ${SCHEMA_VERSION}.`);
    if (baseline?.workPackage !== 'WP-001') fail('BASELINE_WORK_PACKAGE', 'workPackage must be WP-001.');
    if (!Number.isInteger(baseline?.counts?.source) || baseline.counts.source < 1) fail('BASELINE_COUNTS', 'counts.source must be a positive integer.');
    if (!Array.isArray(baseline?.sourceAreas) || baseline.sourceAreas.length < 1) fail('BASELINE_SOURCE_AREAS', 'sourceAreas must be a non-empty array.');
    if (Array.isArray(baseline?.sourceAreas)) {
        for (const area of baseline.sourceAreas) if (!['CURRENT', 'UNKNOWN'].includes(area.classification)) fail('BASELINE_AREA_CLASSIFICATION', `Invalid source area classification: ${area.classification}`);
    }
    if (!Array.isArray(baseline?.dynamicConfiguration)) fail('BASELINE_DYNAMIC_CONFIGURATION', 'dynamicConfiguration must be an array.');
    if (!Array.isArray(baseline?.findings)) fail('BASELINE_FINDINGS', 'findings must be an array.');
    if (compareArchitecture && Array.isArray(baseline?.findings)) {
        const expectedFindings = findings(baseline, root);
        if (JSON.stringify(baseline.findings) !== JSON.stringify(expectedFindings)) {
            fail('BASELINE_FINDINGS_STALE', 'Committed gap findings do not match current semantic evidence.');
        }
    }
    else for (const finding of baseline.findings) if (!['CURRENT', 'TARGET', 'DEBT', 'UNKNOWN'].includes(finding.category)) fail('BASELINE_FINDING_CATEGORY', `Invalid finding category: ${finding.category}`);
    const capturedPaths = [
        ...(baseline?.reachability?.runtimeEntrypoints || []).map(item => item.file),
        ...(baseline?.reachability?.runtimeReachableSourceFiles || []),
        ...(baseline?.reachability?.projectReachableSourceFiles || []),
        ...(baseline?.reachability?.orphanSourceFiles || []),
        ...(baseline?.sideEffects || []).flatMap(item => [...(item.owners || []), ...(item.callsites || []), ...(item.violations || [])]),
        ...(baseline?.events?.connectionScoped || []).flatMap(item => item.producers || []),
        ...(baseline?.events?.generationGuardFiles || []),
        ...(baseline?.modes || []).map(item => item.sourceFile).filter(Boolean),
        ...Object.values(baseline?.modePlatform || {}).filter(Boolean),
        ...(baseline?.serverSpecificFacts || []).flatMap(item => [...(item.configLocations || []), ...(item.sourceLocations || [])]),
        ...(baseline?.configuration || []).flatMap(item => [item.file, ...(item.consumers || []), item.reload?.api, ...(item.reload?.explicitRuntimeApplyEvidence || [])]).filter(Boolean),
        ...(baseline?.dynamicConfiguration || []).flatMap(item => [item.directory, ...(item.consumers || []), ...(item.runtimeReload || [])]).filter(Boolean),
        ...(baseline?.architectureInspection?.findings || []).map(item => item.file).filter(Boolean),
        ...(baseline?.findings || []).map(item => item.file).filter(Boolean)
    ];
    for (const capturedPath of capturedPaths) {
        if (isExcludedPath(capturedPath)) fail('BASELINE_EXCLUSION_LEAK', `Baseline captured an excluded path: ${capturedPath}`);
    }
    const files = walkFiles(root);
    if (files.some(file => isExcludedPath(file))) fail('BASELINE_EXCLUSION_INTERNAL', 'walkFiles returned an excluded path.');
    if (compareArchitecture && baseline?.counts) {
        const currentCounts = {
            files: files.length,
            source: files.filter(file => file.startsWith('src/') && file.endsWith('.js')).length,
            tests: files.filter(file => file.startsWith('tests/') && file.endsWith('.js')).length,
            scripts: files.filter(file => file.startsWith('scripts/') && file.endsWith('.js')).length,
            configJson: files.filter(file => file.startsWith('config/') && file.endsWith('.json')).length,
            routes: files.filter(file => file.startsWith('config/movement/') && /routes/i.test(file)).length
        };
        for (const [field, value] of Object.entries(currentCounts)) {
            if (baseline.counts[field] !== value) fail('BASELINE_INVENTORY_STALE', `${field} baseline=${baseline.counts[field]} current=${value}`);
        }
        const currentRelease = require(path.join(root, 'package.json')).version;
        if (baseline.releaseVersion !== currentRelease) fail('BASELINE_RELEASE_STALE', `release baseline=${baseline.releaseVersion} current=${currentRelease}`);
    }
    if (compareArchitecture && baseline?.architectureInspection?.catalog) {
        const current = architectureAudit();
        const fields = ['sourceFiles', 'testFiles', 'scriptFiles', 'sourceReachable', 'runtimeReachable', 'configGroups', 'connectionEvents'];
        for (const field of fields) {
            if (baseline.architectureInspection.catalog[field] !== current.catalog[field]) {
                fail('BASELINE_ARCHITECTURE_STALE', `${field} baseline=${baseline.architectureInspection.catalog[field]} current=${current.catalog[field]}`);
            }
        }
        if (baseline.architectureInspection.valid !== current.valid) fail('BASELINE_ARCHITECTURE_STALE', 'Architecture validator validity changed.');
    }
    return { valid: failures.length === 0, failures };
}

function renderGapReport(baseline) {
    const lines = [
        '# WP-001 Architecture Baseline and Gap Inventory', '',
        `Generated: ${baseline.generatedAt}`, '',
        `Release: ${baseline.releaseVersion}`, '',
        '## Capture scope', '',
        `- Files: ${baseline.counts.files}; source: ${baseline.counts.source}; tests: ${baseline.counts.tests}; scripts: ${baseline.counts.scripts}; config JSON: ${baseline.counts.configJson}.`,
        `- Source tree: standalone; worktree metadata: ${baseline.revision.worktree.state}.`,
        `- Safe-scope source fingerprint: \`${baseline.revision.sourceFingerprintSha256}\` (bot-profile payload bytes excluded).`,
        '- Excluded from inventory/content capture: `.env*`, `data/**`, `node_modules/**`, `**/*.log`; bot profile payloads are not content-scanned.',
        '- The manifest and generated gap report are excluded from `counts.files` to avoid self-referential count drift.', '',
        '## Current evidence', '',
        `- Architecture validator: ${baseline.architectureInspection.valid ? 'PASS' : 'FAIL'} with ${baseline.architectureInspection.findings.length} finding(s).`,
        `- Project source reachability: ${baseline.reachability.projectReachableSourceFiles.length}/${baseline.counts.source}; runtime reachability: ${baseline.reachability.runtimeReachableSourceFiles.length}/${baseline.counts.source}.`,
        `- Mode descriptors: ${baseline.modes.length}; capabilities: ${baseline.capabilities.ids.length}; connection-scoped events: ${baseline.events.connectionScoped.length}.`,
        `- Exclusive side-effect rules: ${baseline.sideEffects.length}; current owner violations: ${baseline.sideEffects.reduce((sum, item) => sum + item.violations.length, 0)}.`, '',
        '## Major source areas', '',
        '| Area | Files | Owner | Layer | Classification |', '|---|---:|---|---|---|',
        ...baseline.sourceAreas.map(area => `| \`${area.area}\` | ${area.files} | \`${area.owner}\` | ${area.layer} | ${area.classification} |`), '',
        '## Gap inventory', '',
        '| Code | Category | Evidence location | Follow-up | Summary |', '|---|---|---|---|---|',
        ...baseline.findings.map(item => `| ${item.code} | ${item.category} | \`${item.file || '-'}\` | ${item.workPackages.join(', ')} | ${item.summary.replace(/\|/g, '\\|')} |`), '',
        '## Reproduce', '', '```bash', ...baseline.scope.reproducibleCommands, '```', '',
        'This report is evidence only. WP-001 does not change runtime/gameplay behavior and does not auto-fix any debt.', ''
    ];
    return lines.join('\n');
}

module.exports = Object.freeze({
    SCHEMA_VERSION,
    BASELINE_VERSION,
    isExcludedPath,
    walkFiles,
    buildBaseline,
    validateBaseline,
    renderGapReport
});
