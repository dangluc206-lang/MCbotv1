'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'architecture', 'static-quality', 'current.json'), 'utf8'));

function files(root) {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes:true }).flatMap(entry => {
        const file = path.join(root, entry.name);
        return entry.isDirectory() ? files(file) : entry.isFile() && entry.name.endsWith('.js') ? [file] : [];
    });
}

function inspect(file, budget = {}) {
    const source = fs.readFileSync(file, 'utf8');
    const relative = path.relative(ROOT, file).replace(/\\/g, '/');
    const failures = [];
    const lines = source.split(/\r?\n/).length;
    const maxFileLines = budget.maxFileLines ?? contract.maxFileLines;
    const maxFunctionDecisionPoints = budget.maxFunctionDecisionPoints ?? contract.maxFunctionDecisionPoints;
    if (lines > maxFileLines) failures.push({ code:'STATIC_FILE_LINES', file:relative, observed:lines, limit:maxFileLines });
    const patterns = [
        ['STATIC_EVAL', /\beval\s*\(/], ['STATIC_FUNCTION_CONSTRUCTOR', /new\s+Function\s*\(/],
        ['STATIC_RAW_SIDE_EFFECT', /\b(?:bot\.chat|clickWindow|client\.end)\s*\(/],
        ['STATIC_TODO', new RegExp(`\\b(?:${'TO' + 'DO'}|${'FIX' + 'ME'}|${'HA' + 'CK'})\\b`)]
    ];
    for (const [code, pattern] of patterns) if (pattern.test(source)) failures.push({ code, file:relative });
    for (const block of functionBodies(source)) {
        const header = block.split(/\r?\n/, 1)[0].trim().slice(0, 120);
        const decisions = (block.match(/\b(?:if|for|while|case|catch)\s*(?:\(|:)|&&|\|\||\?(?![?.])/g) || []).length;
        if (decisions > maxFunctionDecisionPoints) failures.push({ code:'STATIC_DECISION_BUDGET', file:relative, function:header, observed:decisions, limit:maxFunctionDecisionPoints });
    }
    return failures;
}

function functionBodies(source) {
    const lines = source.split(/\r?\n/);
    const output = [];
    for (let start = 0; start < lines.length; start += 1) {
        const header = lines[start];
        const isFunction = /^\s*(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.test(header)
            || /^\s*(?:static\s+)?(?:async\s+)?#?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/.test(header)
            || /^\s*(?:const|let)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/.test(header);
        if (!isFunction) continue;
        let balance = 0; let opened = false; const body = [];
        for (let index = start; index < lines.length; index += 1) {
            const line = lines[index]; body.push(line);
            const open = (line.match(/\{/g) || []).length;
            const close = (line.match(/\}/g) || []).length;
            if (open) opened = true;
            balance += open - close;
            if (opened && balance <= 0) { start = index; break; }
        }
        output.push(body.join('\n'));
    }
    return output;
}

function check() {
    const fromRoots = contract.managedRoots.flatMap(relative => files(path.join(ROOT, relative)));
    const declared = [...(contract.managedFiles || []), ...Object.keys(contract.legacyBudgets || {})]
        .map(relative => path.join(ROOT, relative));
    const managed = [...new Set([...fromRoots, ...declared])].sort();
    const failures = [];
    for (const file of managed) {
        const relative = path.relative(ROOT, file).replace(/\\/g, '/');
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
            failures.push({ code:'STATIC_MANAGED_FILE_MISSING', file:relative });
            continue;
        }
        const budget = contract.legacyBudgets?.[relative] || {};
        failures.push(...inspect(file, budget));
    }
    return Object.freeze({ contract:contract.contract, status:failures.length ? 'FAIL' : 'PASS', checkedFiles:managed.length, failures });
}

function main() {
    const report = check();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.status === 'PASS' ? 0 : 1;
    return report;
}

if (require.main === module) main();
module.exports = Object.freeze({ check, inspect, functionBodies, main });
