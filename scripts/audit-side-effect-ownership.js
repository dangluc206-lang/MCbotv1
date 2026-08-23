'use strict';

const fs = require('node:fs');
const path = require('node:path');
const architectureCatalog = require('../architecture/catalog.json');
const artifactManifest = require('../architecture/artifact-ownership.json');

const root = path.resolve(__dirname, '..');

function posix(value) { return String(value || '').replace(/\\/g, '/'); }
function stripComments(source) {
    return String(source || '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}
function walkJs(directory, base = root, out = []) {
    if (!fs.existsSync(directory)) return out;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) walkJs(full, base, out);
        else if (entry.isFile() && entry.name.endsWith('.js')) out.push(posix(path.relative(base, full)));
    }
    return out.sort();
}

function scanText(source, patterns) {
    const clean = stripComments(source);
    const matched = [];
    for (const [id, expression] of Object.entries(patterns || {})) {
        if (new RegExp(expression).test(clean)) matched.push(id);
    }
    return matched;
}

function audit({ baseDir = root, sourceFiles = null, manifest = artifactManifest, catalog = architectureCatalog } = {}) {
    const files = sourceFiles || walkJs(path.join(baseDir, 'src'), baseDir);
    const failures = [];
    const rawSideEffects = [];
    for (const rule of catalog.exclusiveSideEffects || []) {
        const owners = new Set(rule.owners || []);
        const expression = new RegExp(rule.pattern);
        const callsites = files.filter(file => expression.test(stripComments(fs.readFileSync(path.join(baseDir, file), 'utf8'))));
        const violations = callsites.filter(file => !owners.has(file));
        rawSideEffects.push({ id: rule.id, owners: [...owners].sort(), callsites, violations });
        for (const file of violations) failures.push({ code: 'RAW_SIDE_EFFECT_BYPASS', file, detail: rule.id });
    }

    const ownerByFile = new Map((manifest.owners || []).map(item => [item.file, item]));
    const artifactMutations = [];
    for (const file of files) {
        const source = fs.readFileSync(path.join(baseDir, file), 'utf8');
        const operations = scanText(source, manifest.destructivePatterns);
        if (!operations.length) continue;
        const owner = ownerByFile.get(file) || null;
        artifactMutations.push({ file, operations, scope: owner?.scope || null, cleanupPolicy: owner?.cleanupPolicy || null });
        if (!owner) failures.push({ code: 'ARTIFACT_OWNER_MISSING', file, detail: operations.join(',') });
        else if (!owner.scope || !owner.cleanupPolicy) failures.push({ code: 'ARTIFACT_OWNER_POLICY_INCOMPLETE', file, detail: operations.join(',') });
    }
    for (const owner of manifest.owners || []) {
        if (!fs.existsSync(path.join(baseDir, owner.file))) failures.push({ code: 'ARTIFACT_OWNER_FILE_MISSING', file: owner.file, detail: owner.scope });
    }
    for (const exception of manifest.exceptions || []) {
        if (!exception.owner || !exception.reason || !exception.expires) failures.push({ code: 'OWNERSHIP_EXCEPTION_INVALID', file: exception.file || 'architecture/artifact-ownership.json', detail: exception.id || null });
    }
    return Object.freeze({ valid: failures.length === 0, failures, rawSideEffects, artifactMutations, exceptions: manifest.exceptions || [] });
}

function main() {
    const result = audit();
    if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
        for (const item of result.rawSideEffects) console.log(`[RAW] ${item.id}: ${item.callsites.length} callsite(s), ${item.violations.length} violation(s)`);
        console.log(`[ARTIFACT] ${result.artifactMutations.length} mutation owner(s), ${result.exceptions.length} exception(s)`);
        for (const failure of result.failures) console.error(`[FAIL] ${failure.code} ${failure.file}: ${failure.detail || ''}`);
        console.log(`Ownership audit completed with ${result.failures.length} failure(s).`);
    }
    process.exitCode = result.valid ? 0 : 1;
}

if (require.main === module) main();
module.exports = Object.freeze({ audit, scanText, stripComments });
