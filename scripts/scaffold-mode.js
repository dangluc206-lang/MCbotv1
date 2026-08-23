#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function modeId(value) {
    const id = String(value || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) {
        throw new Error('Mode id must match: mining, mob-farm, auction-watch');
    }
    return id;
}

function classBase(id) {
    return id.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join('');
}

function writeExclusive(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, { encoding: 'utf8', flag: 'wx' });
}

function main(argv = process.argv.slice(2), baseDir = process.cwd()) {
    const id = modeId(argv[0]);
    const label = String(argv.slice(1).join(' ') || id).trim();
    const className = `${classBase(id)}ModeService`;
    const serviceName = `${id.split('-')[0]}${id.split('-').slice(1).map(part => part[0].toUpperCase() + part.slice(1)).join('')}Mode`;
    const relativeService = `src/modes/${id}/${className}.js`;
    const relativeTest = `tests/unit/modes/${className}.test.js`;
    const relativeConfig = `config/modes/${id}.json`;
    const servicePath = path.join(baseDir, relativeService);
    const testPath = path.join(baseDir, relativeTest);
    const configPath = path.join(baseDir, relativeConfig);
    for (const target of [servicePath, testPath, configPath]) {
        if (fs.existsSync(target)) throw new Error(`Refusing to overwrite existing path: ${path.relative(baseDir, target)}`);
    }

    const requireWord = 'require';
    writeExclusive(servicePath, `'use strict';\n\nconst ManagedMode = ${requireWord}('../ManagedMode');\n\nclass ${className} extends ManagedMode {\n    constructor({ botId, modeContext, modeCoordinator, catalog, config = {}, logger = null } = {}) {\n        super({ modeId: '${id}', botId, modeContext, modeCoordinator, catalog, logger });\n        this.config = Object.freeze({ ...config });\n    }\n\n    async onEnable() {\n        // Acquire capabilities with this.modeContext.capability('capability-id') and start work here.\n    }\n\n    async onPause() {\n        // Cancel/pause active work here. Lease ownership is managed by ManagedMode.\n    }\n\n    async onResume() {\n        // Restart paused work here.\n    }\n\n    async onDisable() {\n        // Stop work. Subscription cleanup runs automatically afterwards.\n    }\n\n    statusDetails() {\n        return {};\n    }\n}\n\nmodule.exports = ${className};\n`);

    writeExclusive(testPath, `'use strict';\nconst test = require('node:test');\nconst assert = require('node:assert/strict');\nconst ${className} = ${requireWord}('../../../src/modes/${id}/${className}');\n\ntest('${className} exposes the ManagedMode contract', () => {\n    assert.equal(typeof ${className}, 'function');\n});\n`);

    writeExclusive(configPath, `${JSON.stringify({ enabled: false }, null, 2)}\n`);

    const result = {
        modeId: id,
        label,
        className,
        serviceName,
        files: [relativeService, relativeTest, relativeConfig],
        nextSteps: [
            `Register a ModeCatalog descriptor for '${id}' in src/bootstrap/createModeCatalog.js.`,
            `Register ${relativeConfig} + schema in ConfigSpecs if the mode uses config.`,
            `Construct ${className} in the bot bootstrap and bind it as '${serviceName}'.`,
            'Register every generic dependency as a capability instead of injecting low-level Mineflayer state directly.',
            'Run npm run validate && npm test.'
        ]
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
}

if (require.main === module) {
    try { main(); }
    catch (error) { console.error(`[mode:scaffold] ${error.message}`); process.exitCode = 1; }
}

module.exports = { main, modeId, classBase };
