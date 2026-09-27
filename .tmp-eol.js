'use strict';
const fs = require('fs');
const raw = fs.readFileSync('src/desktop/renderer/app.js', 'utf8');
console.log(JSON.stringify({
  crlf: (raw.match(/\r\n/g) || []).length,
  totalLines: raw.split(/\r?\n/).length,
  hasBind: raw.includes('function bindEvents() {')
}));
