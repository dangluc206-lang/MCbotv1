'use strict';
const fs = require('fs');
const src = fs.readFileSync('src/desktop/renderer/core/RendererEventBindings.js', 'utf8');
const lines = src.split(/\r?\n/);
lines.forEach((l, i) => {
  const trimmed = l.trim();
  if (trimmed.startsWith('//') || trimmed.includes('.onclick =') || trimmed.includes('.onchange =') || trimmed.includes('.addEventListener(') || trimmed.includes('.oninput =')) {
    console.log((i + 1) + ': ' + trimmed.slice(0, 80));
  }
});
