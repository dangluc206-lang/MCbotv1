'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const catalog = require('../architecture/catalog.json');
const ConfigSpecs = require('../src/configuration/ConfigSpecs');
const EventScopes = require('../src/core/events/EventScopeRegistry');
const { STALE_PATHS } = require('./cleanup-stale');
const {
    normalizeRepositoryRelativePath,
    isDocumentPathAuthorized,
    validateGovernedDocumentRoots
} = require('./document-governance');

function relative(file) {
    return path.relative(root, file).split(path.sep).join('/');
}

function walk(directory, predicate = () => true, result = []) {
    if (!fs.existsSync(directory)) return result;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (['node_modules', 'data'].includes(entry.name)) continue;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(full, predicate, result);
        else if (entry.isFile() && predicate(full)) result.push(full);
    }
    return result;
}

function resolveRequest(fromFile, request) {
    if (!request.startsWith('.')) return null;
    const base = path.resolve(path.dirname(fromFile), request);
    const candidates = [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')];
    return candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

function dependencies(file) {
    const source = fs.readFileSync(file, 'utf8');
    const requests = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match => match[1]);
    return requests.map(request => ({ request, resolved: resolveRequest(file, request) }));
}

function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function filesForBoundary(boundary, sourceFiles) {
    const explicit = (boundary.files || []).map(file => path.resolve(root, file));
    const matched = [];
    for (const pattern of boundary.globs || []) {
        if (pattern.endsWith('/**/*.js')) {
            const prefix = pattern.slice(0, -'**/*.js'.length);
            matched.push(...sourceFiles.filter(file => relative(file).startsWith(prefix) && file.endsWith('.js')));
        }
    }
    return [...new Set([...explicit, ...matched])];
}

function reachableFrom(roots, graph) {
    const reached = new Set();
    const stack = roots.filter(Boolean);
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current || reached.has(current)) continue;
        reached.add(current);
        for (const dependency of graph.get(current) || []) {
            if (dependency.endsWith('.js')) stack.push(dependency);
        }
    }
    return reached;
}

function findCycles(graph) {
    const cycles = [];
    const visited = new Set();
    const active = new Set();
    const stack = [];
    const seen = new Set();
    const visit = file => {
        if (active.has(file)) {
            const start = stack.indexOf(file);
            const cycle = [...stack.slice(start), file].map(relative);
            const signature = [...new Set(cycle.slice(0, -1))].sort().join('|');
            if (!seen.has(signature)) {
                seen.add(signature);
                cycles.push(cycle);
            }
            return;
        }
        if (visited.has(file)) return;
        visited.add(file);
        active.add(file);
        stack.push(file);
        for (const dependency of graph.get(file) || []) {
            if (graph.has(dependency)) visit(dependency);
        }
        stack.pop();
        active.delete(file);
    };
    for (const file of graph.keys()) visit(file);
    return cycles;
}

function audit() {
    const failures = [];
    const warnings = [];
    const add = (code, message, file = null) => failures.push({ code, message, file });
    const jsFiles = [
        ...walk(path.join(root, 'src'), file => file.endsWith('.js')),
        ...walk(path.join(root, 'scripts'), file => file.endsWith('.js')),
        ...walk(path.join(root, 'tests'), file => file.endsWith('.js'))
    ];
    const sourceFiles = jsFiles.filter(file => relative(file).startsWith('src/'));

    const officialDocuments = catalog.officialDocuments || [];
    for (const document of officialDocuments) {
        const normalized = normalizeRepositoryRelativePath(document);
        if (!normalized) {
            add('DOCUMENT_PATH_INVALID', `Invalid official document path: ${String(document)}`, 'architecture/catalog.json');
            continue;
        }
        if (!fs.existsSync(path.join(root, normalized))) add('DOCUMENT_MISSING', `Official document is missing: ${normalized}`, normalized);
    }
    const documentGovernance = validateGovernedDocumentRoots(catalog.governedDocumentRoots, root);
    failures.push(...documentGovernance.failures);
    const markdown = walk(root, file => file.endsWith('.md')).map(relative);
    for (const file of markdown) {
        if (!isDocumentPathAuthorized(file, officialDocuments, documentGovernance.roots)) {
            add('MARKDOWN_UNAUTHORIZED', `Unauthorized Markdown file: ${file}`, file);
        }
    }

    for (const file of jsFiles) {
        const source = fs.readFileSync(file, 'utf8');
        if (!source.trim()) {
            add('JAVASCRIPT_EMPTY', 'JavaScript file is empty.', relative(file));
            continue;
        }
        try {
            new vm.Script(source, { filename: relative(file) });
        } catch (error) {
            add('JAVASCRIPT_SYNTAX', error.message, relative(file));
        }
    }

    const graph = new Map();
    for (const file of [...sourceFiles, ...jsFiles.filter(entry => relative(entry).startsWith('scripts/'))]) {
        const resolved = [];
        for (const dependency of dependencies(file)) {
            if (dependency.request.startsWith('.') && !dependency.resolved) {
                add('REQUIRE_UNRESOLVED', `Unresolved require: ${dependency.request}`, relative(file));
            } else if (dependency.resolved) {
                resolved.push(dependency.resolved);
            }
        }
        graph.set(file, resolved);
    }
    for (const cycle of findCycles(new Map([...graph].filter(([file]) => relative(file).startsWith('src/'))))) {
        add('IMPORT_CYCLE', cycle.join(' -> '), cycle[0]);
    }

    const runtimeRoots = (catalog.runtimeEntrypoints || []).map(file => path.resolve(root, file));
    const scriptRoots = walk(path.join(root, 'scripts'), file => file.endsWith('.js'));
    for (const entrypoint of runtimeRoots) {
        if (!fs.existsSync(entrypoint)) add('ENTRYPOINT_MISSING', `Runtime entrypoint is missing: ${relative(entrypoint)}`, relative(entrypoint));
    }
    const runtimeReachable = reachableFrom(runtimeRoots, graph);
    const allReachable = reachableFrom([...runtimeRoots, ...scriptRoots], graph);
    for (const file of sourceFiles) {
        if (!allReachable.has(file)) add('SOURCE_ORPHAN', 'Source file is unreachable from runtime or script entrypoints.', relative(file));
    }

    const sourceText = new Map(sourceFiles.map(file => [file, stripComments(fs.readFileSync(file, 'utf8'))]));
    for (const rule of catalog.exclusiveSideEffects || []) {
        const pattern = new RegExp(rule.pattern, 'g');
        const owners = new Set(rule.owners || []);
        for (const [file, source] of sourceText) {
            pattern.lastIndex = 0;
            if (pattern.test(source) && !owners.has(relative(file))) {
                add('SIDE_EFFECT_OWNER', `${rule.id} is owned only by ${[...owners].join(', ')}`, relative(file));
            }
        }
    }
    for (const boundary of catalog.boundaries || []) {
        for (const file of filesForBoundary(boundary, sourceFiles)) {
            if (!fs.existsSync(file)) {
                add('BOUNDARY_FILE_MISSING', `${boundary.id} references a missing file.`, relative(file));
                continue;
            }
            const source = sourceText.get(file) || stripComments(fs.readFileSync(file, 'utf8'));
            for (const expression of boundary.forbiddenPatterns || []) {
                if (new RegExp(expression).test(source)) {
                    add('BOUNDARY_VIOLATION', `${boundary.id} matched forbidden pattern ${expression}`, relative(file));
                }
            }
        }
    }

    const forbiddenAudits = [
        { code: 'MAX_LISTENERS_DISABLED', pattern: /setMaxListeners\s*\(\s*(?:0|Infinity)\s*\)/, files: jsFiles },
        { code: 'FOCUSED_OR_SKIPPED_TEST', pattern: /\b(?:test|describe|it)\.(?:only|skip)\s*\(/, files: jsFiles.filter(file => relative(file).startsWith('tests/')) }
    ];
    for (const rule of forbiddenAudits) {
        for (const file of rule.files) {
            if (rule.pattern.test(stripComments(fs.readFileSync(file, 'utf8')))) add(rule.code, `Forbidden pattern: ${rule.pattern}`, relative(file));
        }
    }

    const emitted = new Set();
    const emitPattern = /(?:this\.)?eventBus(?:\?)?\.emit\(\s*['"]([^'"]+)['"]/g;
    for (const file of runtimeReachable) {
        if (!file.endsWith('.js') || !fs.existsSync(file)) continue;
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(emitPattern)) emitted.add(match[1]);
    }
    for (const eventName of EventScopes.CONNECTION_SCOPED_EVENTS) {
        if (!emitted.has(eventName)) add('EVENT_PRODUCER_UNREACHABLE', `No runtime-reachable producer for ${eventName}.`, catalog.eventScopes.registryModule);
    }

    const configFiles = walk(path.join(root, 'config'), file => file.endsWith('.json')).map(relative);
    const botDirectory = `${catalog.configuration.botProfileDirectory.replace(/\\/g, '/')}/`;
    const customModeDirectory = `${String(catalog.configuration.customModeDirectory || 'config/modes/custom').replace(/\\/g, '/')}/`;
    const registeredConfig = new Set(ConfigSpecs.map(spec => spec.file.replace(/\\/g, '/')));
    for (const file of configFiles) {
        if (!file.startsWith(botDirectory) && !file.startsWith(customModeDirectory) && !registeredConfig.has(file)) {
            add('CONFIG_UNREGISTERED', 'JSON config is not registered by ConfigSpecs.', file);
        }
    }
    for (const spec of ConfigSpecs) {
        if (!fs.existsSync(path.join(root, spec.file))) add('CONFIG_SPEC_MISSING', `Registered config is missing: ${spec.file}`, spec.file);
        if (!spec.schema) add('CONFIG_SCHEMA_MISSING', `Registered config has no schema: ${spec.key}`, spec.file);
    }

    const staleSet = new Set();
    for (const stalePath of STALE_PATHS) {
        if (staleSet.has(stalePath)) add('STALE_MANIFEST_DUPLICATE', `Duplicate stale path: ${stalePath}`, catalog.staleManifest);
        staleSet.add(stalePath);
        if (fs.existsSync(path.join(root, stalePath))) add('STALE_PATH_PRESENT', `Audited stale path is present: ${stalePath}`, stalePath);
    }

    const result = {
        valid: failures.length === 0,
        failures,
        warnings,
        catalog: {
            version: catalog.version,
            sourceFiles: sourceFiles.length,
            testFiles: jsFiles.filter(file => relative(file).startsWith('tests/')).length,
            scriptFiles: jsFiles.filter(file => relative(file).startsWith('scripts/')).length,
            sourceReachable: [...allReachable].filter(file => relative(file).startsWith('src/')).length,
            runtimeReachable: [...runtimeReachable].filter(file => relative(file).startsWith('src/')).length,
            configGroups: ConfigSpecs.length,
            connectionEvents: EventScopes.CONNECTION_SCOPED_EVENTS.length,
            stalePaths: STALE_PATHS.length,
            officialDocuments: officialDocuments.length,
            governedDocumentRoots: documentGovernance.roots.length,
            coverage: catalog.coverage
        }
    };
    return result;
}

function print(result, { json = false } = {}) {
    if (json) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    for (const failure of result.failures) {
        console.error(`[FAIL] ${failure.code}${failure.file ? ` ${failure.file}` : ''}: ${failure.message}`);
    }
    for (const warning of result.warnings) console.warn(`[WARN] ${warning.code}: ${warning.message}`);
    const summary = result.catalog;
    console.log(`Architecture catalog: ${summary.sourceFiles} source / ${summary.testFiles} test / ${summary.scriptFiles} script files.`);
    console.log(`Project reachability: ${summary.sourceReachable}/${summary.sourceFiles} source files; ${summary.runtimeReachable} are runtime-reachable.`);
    console.log(`Contracts: ${summary.configGroups} config groups / ${summary.connectionEvents} connection events / ${summary.stalePaths} stale guards.`);
    console.log(`Documentation: ${summary.officialDocuments} official documents / ${summary.governedDocumentRoots} governed roots.`);
    console.log(`Architecture validation completed with ${result.failures.length} failure(s).`);
}

if (require.main === module) {
    const result = audit();
    print(result, { json: process.argv.includes('--json') });
    process.exitCode = result.valid ? 0 : 1;
}

module.exports = Object.freeze({
    audit,
    print,
    normalizeRepositoryRelativePath,
    isDocumentPathAuthorized,
    validateGovernedDocumentRoots
});
