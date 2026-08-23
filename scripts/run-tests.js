'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');

const baseDir = path.resolve(__dirname, '..');
const installed = process.argv.includes('--installed');
const builtins = new Set(Module.builtinModules.flatMap(name => [name, `node:${name}`]));
const pkg = require(path.join(baseDir, 'package.json'));
const declared = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})]);
const missingDeclared = [...declared].filter(name => {
    try { require.resolve(name, { paths: [baseDir] }); return false; } catch { return true; }
});


function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (entry.isFile() && entry.name.endsWith('.test.js')) out.push(full);
    }
    return out.sort();
}

const requirePattern = /(?<![#.\w$])require\(\s*['"]([^'"]+)['"]\s*\)/g;
const dependencyMemo = new Map();
function unresolvedExternalIn(file, stack = new Set()) {
    const canonical = path.resolve(file);
    if (dependencyMemo.has(canonical)) return dependencyMemo.get(canonical);
    if (stack.has(canonical) || !fs.existsSync(canonical)) return new Set();
    stack.add(canonical);
    const missing = new Set();
    const text = fs.readFileSync(canonical, 'utf8');
    for (const match of text.matchAll(requirePattern)) {
        const spec = match[1];
        if (builtins.has(spec)) continue;
        if (spec.startsWith('.')) {
            const base = path.resolve(path.dirname(canonical), spec);
            const candidates = [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')];
            const local = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
            if (local) for (const dep of unresolvedExternalIn(local, new Set(stack))) missing.add(dep);
            continue;
        }
        try { require.resolve(spec, { paths: [path.dirname(canonical), baseDir] }); }
        catch { missing.add(spec); }
    }
    stack.delete(canonical);
    dependencyMemo.set(canonical, missing);
    return missing;
}

const all = walk(path.join(baseDir, 'tests'));
const dependencyState = all.map(file => ({ file, missing: unresolvedExternalIn(file) }));
if (installed) {
    const missing = [...new Set(dependencyState.flatMap(entry => [...entry.missing]))].sort();
    if (missing.length) {
        console.error(`Installed test gate requires all modules used by the test graph. Run npm ci (or install runtime dependencies) first. Missing: ${missing.join(', ')}`);
        process.exit(2);
    }
}
const skipped = [];
const runnable = [];
for (const entry of dependencyState) {
    if (!installed && entry.missing.size) skipped.push({ file: entry.file, missing: [...entry.missing].sort() });
    else runnable.push(entry.file);
}

if (!installed && skipped.length) {
    console.log(`Source-only test gate: ${runnable.length} files runnable, ${skipped.length} dependency-bound files skipped.`);
    for (const entry of skipped) console.log(`SKIP ${path.relative(baseDir, entry.file)} -> ${entry.missing.join(', ')}`);
}
if (!runnable.length) {
    console.error('No runnable test files found.');
    process.exit(2);
}

const result = spawnSync(process.execPath, ['--test', ...runnable], { cwd: baseDir, stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
