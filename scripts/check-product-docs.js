'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const packageJson = JSON.parse(read('package.json'));
const readme = read('README.md');
const rules = read('RULES.md');
const server = read('SERVER_BEHAVIOR.md');
const renderer = read('src/desktop/renderer/app.js');
const storageConfig = JSON.parse(read('config/storage/kho.json'));
const b1Service = read('src/server-features/storage/B1StorageMaterialService.js');
const trimmer = read('src/server-features/storage/b1/B1StartupReserveTrimmer.js');
const currentReadme = readme.replace(/<!-- HISTORICAL_BEHAVIOR_START -->[\s\S]*?<!-- HISTORICAL_BEHAVIOR_END -->/g, '');
const failures = [];
const requireMatch = (name, text, pattern) => { if (!pattern.test(text)) failures.push(`${name} missing ${pattern}`); };
const rejectMatch = (name, text, pattern) => { if (pattern.test(text)) failures.push(`${name} contains stale statement ${pattern}`); };

requireMatch('README', currentReadme, new RegExp(`CURRENT ${packageJson.version.replace(/\./g, '\\.')}\\b`));
for (const [name, text] of [['README', currentReadme], ['RULES', rules], ['SERVER_BEHAVIOR', server]]) {
    requireMatch(name, text, /raw iron\/raw gold/i);
    requireMatch(name, text, /immutable sell baseline/i);
    requireMatch(name, text, /64(?:-only|`)/i);
    requireMatch(name, text, /1\.5\s*B5/i);
}
rejectMatch('README CURRENT', currentReadme, /allowSmelting|không bao giờ gọi \/nung/i);
rejectMatch('RULES CURRENT', rules, /Mode B5[^\n]*SELL ALL|B5[^\n]*sell quantity `1` được phép/i);
requireMatch('Desktop copy', renderer, /chỉ nung raw iron\/raw gold/i);
if (storageConfig.sell?.reserveCoverage !== 1.5) failures.push('config/storage/kho.json reserveCoverage must be 1.5');
if (storageConfig.sell?.allowSingle !== false) failures.push('config/storage/kho.json allowSingle must be false');
requireMatch('B1 service', b1Service, /sellQuantity:\s*64/);
requireMatch('B1 service', b1Service, /allowSingle:\s*false/);
requireMatch('B1 trimmer quantity constant', trimmer, /B5_SELL_QUANTITY\s*=\s*64/);
requireMatch('B1 trimmer quantity guard', trimmer, /action\.quantity\s*!==\s*B5_SELL_QUANTITY/);

if (failures.length) {
    for (const failure of failures) process.stderr.write(`[FAIL] product-docs: ${failure}\n`);
    process.exitCode = 1;
} else {
    process.stdout.write(`[PASS] product docs ${packageJson.version}: B5 boundary, 64-only sell and 1.5 B5 reserve are consistent.\n`);
}
