'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const OUT = path.resolve('src/desktop/renderer/core/RendererEventBindings.js');
let src = fs.readFileSync(OUT, 'utf8');
const lines = src.split(/\r?\n/);
const footerIdx = lines.findIndex(line => line === '    function bindEvents() {');
assert.ok(footerIdx > 0, 'dispatcher footer must exist');
const blocks = src.split(/\r?\n\r?\n/);
assert.ok(blocks.length > 5, `expected blank-line separated blocks, got ${blocks.length}`);
const STATIC_HEAD_LINES = 32;
const headLines = lines.slice(0, STATIC_HEAD_LINES);
assert.ok(headLines[STATIC_HEAD_LINES - 1] === '    } = deps;', 'dep bag must stay intact');
const moved = lines.slice(STATIC_HEAD_LINES, footerIdx).join('\n').split(/\n\n/).map(block => block.replace(/^/gm, '  ').replace(/^ {2}( {2})?document/m, '  document')).filter(block => block.trim().length);
console.log(JSON.stringify({ blockCount: moved.length, first: moved[0].slice(0, 80), last: moved[moved.length - 1].slice(0, 80) }));
const used = new Set();
for (const block of moved) {
  for (const match of block.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) used.add(match[1]);
  for (const match of block.matchAll(/window\.mcbot\.([A-Za-z0-9_]+)/g)) used.add(`api:${match[1]}`);
}
console.log('USED=' + [...used].sort().slice(0, 40).join(','));
const known = new Set(['addEventListener', 'catch', 'forEach', 'closest', 'querySelector']);
const missing = [...used].filter(name => !known.has(name) && !name.startsWith('api:') && !/^(if|for|while|switch|catch|function|return|await|new|typeof)$/.test(name));
console.log('CANDIDATES=' + missing.sort().join(','));
