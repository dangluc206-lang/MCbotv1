'use strict';
const fs = require('fs');
const AstMetrics = require('./scripts/static-quality/AstMetrics.js');
const source = fs.readFileSync('src/desktop/renderer/core/RendererEventBindings.js', 'utf8');
const analysis = AstMetrics.analyze(source);
for (const fn of analysis.functions) {
  if (fn.lines > 50 || fn.statements > 30 || fn.complexity > 15) {
    console.log(fn.name + ' lines=' + fn.lines + ' stmts=' + fn.statements + ' compl=' + fn.complexity + ' at line ' + fn.startLine);
  }
}
