'use strict';
const fs = require('fs');
const src = fs.readFileSync('src/desktop/renderer/core/RendererEventBindings.js', 'utf8');
const used = new Set();
for (const m of src.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) {
  used.add(m[1]);
}
console.log(JSON.stringify(Array.from(used).sort()));
