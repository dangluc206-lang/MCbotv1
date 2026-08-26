'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const AstMetrics = require('../../../scripts/static-quality/AstMetrics');
const { inspect } = require('../../../scripts/check-static-quality');

test('AST metrics count compressed statements and real cyclomatic branches', () => {
    const source = 'function compressed(a,b){let x=0;if(a&&b){x++;}else if(a||b){x+=2;}for(const item of [1,2]){if(item)x+=item;}return x;}';
    const [metric] = AstMetrics.analyze(source).functions;
    assert.equal(metric.name, 'compressed');
    assert.ok(metric.statements >= 8, `expected compressed statements, got ${metric.statements}`);
    assert.ok(metric.complexity >= 7, `expected real branches, got ${metric.complexity}`);
});

test('AST quality inspection ignores forbidden words in strings but catches executable constructs', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-static-quality-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const safe = path.join(directory, 'safe.js');
    fs.writeFileSync(safe, "'use strict'; const message = 'eval( and TODO are inert text';\n", 'utf8');
    assert.deepEqual(inspect(safe, { maxFileLines: 20, maxFunctionLines: 20, maxFunctionStatements: 20, maxCyclomaticComplexity: 5 }), []);

    const unsafe = path.join(directory, 'unsafe.js');
    fs.writeFileSync(unsafe, "'use strict'; eval('1'); new Function('return 1'); // TODO remove\n", 'utf8');
    const codes = inspect(unsafe, { maxFileLines: 20, maxFunctionLines: 20, maxFunctionStatements: 20, maxCyclomaticComplexity: 5 }).map(item => item.code);
    assert.deepEqual(codes.sort(), ['STATIC_EVAL', 'STATIC_FUNCTION_CONSTRUCTOR', 'STATIC_TODO']);
});

test('AST parser rejects invalid JavaScript instead of silently skipping quality checks', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-static-quality-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'invalid.js');
    fs.writeFileSync(file, 'function broken( {', 'utf8');
    assert.equal(inspect(file, {})[0].code, 'STATIC_AST_PARSE');
});
