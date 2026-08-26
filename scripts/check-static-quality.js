'use strict';

const fs = require('node:fs');
const path = require('node:path');
const AstMetrics = require('./static-quality/AstMetrics');

const ROOT = path.resolve(__dirname, '..');
const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'architecture', 'static-quality', 'current.json'), 'utf8'));

function files(root) {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(root, entry.name);
        return entry.isDirectory() ? files(file) : entry.isFile() && entry.name.endsWith('.js') ? [file] : [];
    });
}

function normalized(relative) {
    return relative.replace(/\\/g, '/');
}

function inspect(file, budget = {}) {
    const source = fs.readFileSync(file, 'utf8');
    const relative = normalized(path.relative(ROOT, file));
    const failures = [];
    const lines = source.split(/\r?\n/).length;
    const maxFileLines = budget.maxFileLines ?? contract.maxFileLines;
    if (lines > maxFileLines) failures.push({ code: 'STATIC_FILE_LINES', file: relative, observed: lines, limit: maxFileLines });

    let analysis;
    try {
        analysis = AstMetrics.analyze(source);
    } catch (error) {
        return [{ code: 'STATIC_AST_PARSE', file: relative, reason: error.message }];
    }
    const limits = {
        lines: budget.maxFunctionLines ?? contract.maxFunctionLines,
        statements: budget.maxFunctionStatements ?? contract.maxFunctionStatements,
        complexity: budget.maxCyclomaticComplexity ?? contract.maxCyclomaticComplexity
    };
    const codes = {
        lines: 'STATIC_FUNCTION_LINES',
        statements: 'STATIC_FUNCTION_STATEMENTS',
        complexity: 'STATIC_CYCLOMATIC_COMPLEXITY'
    };
    for (const fn of analysis.functions) {
        for (const metric of Object.keys(limits)) {
            if (fn[metric] > limits[metric]) {
                failures.push({
                    code: codes[metric], file: relative, function: fn.name, startLine: fn.startLine,
                    observed: fn[metric], limit: limits[metric]
                });
            }
        }
    }

    for (const call of analysis.calls) {
        if (call.kind === 'call' && call.callee === 'eval') failures.push({ code: 'STATIC_EVAL', file: relative, line: call.line });
        if (call.kind === 'new' && call.callee === 'Function') failures.push({ code: 'STATIC_FUNCTION_CONSTRUCTOR', file: relative, line: call.line });
        const sideEffect = call.callee === 'bot.chat'
            ? 'bot.chat'
            : call.callee?.endsWith('.clickWindow') || call.callee === 'clickWindow'
                ? 'clickWindow'
                : call.callee?.endsWith('.client.end') || call.callee === 'client.end'
                    ? 'client.end'
                    : null;
        if (sideEffect && !(contract.rawSideEffectAllowlist?.[sideEffect] || []).includes(relative)) {
            failures.push({ code: 'STATIC_RAW_SIDE_EFFECT', file: relative, line: call.line, sideEffect });
        }
    }
    for (const comment of analysis.comments) {
        if (/\b(?:TODO|FIXME|HACK)\b/i.test(comment.value)) failures.push({ code: 'STATIC_TODO', file: relative, line: comment.line });
    }
    return failures;
}

function check() {
    const fromRoots = contract.managedRoots.flatMap(relative => files(path.join(ROOT, relative)));
    const declared = [...(contract.managedFiles || []), ...Object.keys(contract.legacyBudgets || {})]
        .map(relative => path.join(ROOT, relative));
    const managed = [...new Set([...fromRoots, ...declared])].sort();
    const failures = [];
    for (const file of managed) {
        const relative = normalized(path.relative(ROOT, file));
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
            failures.push({ code: 'STATIC_MANAGED_FILE_MISSING', file: relative });
            continue;
        }
        failures.push(...inspect(file, contract.legacyBudgets?.[relative] || {}));
    }
    return Object.freeze({ contract: contract.contract, status: failures.length ? 'FAIL' : 'PASS', checkedFiles: managed.length, failures });
}

function main() {
    const report = check();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.status === 'PASS' ? 0 : 1;
    return report;
}

if (require.main === module) main();
module.exports = Object.freeze({ check, inspect, main });
