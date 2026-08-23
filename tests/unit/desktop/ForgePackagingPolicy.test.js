'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
    createForgeIgnore,
    isIgnored,
    readDevOnlyPackagePaths,
    relativeCandidate
} = require('../../../scripts/build/ForgePackagingPolicy');

const root = path.resolve(__dirname, '..', '..', '..');

test('Forge packaging policy is an absolute-path IgnoreFunction', () => {
    const ignore = createForgeIgnore({ baseDir: root });
    assert.equal(typeof ignore, 'function');
    assert.equal(ignore(path.join(root, 'tests', 'fixture.js')), true);
    assert.equal(ignore(path.join(root, 'src', 'index.js')), false);
    assert.equal(ignore(path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')), true);
});

test('Forge packaging policy removes every dev-only lockfile package without removing production dependencies', () => {
    const lock = require('../../../package-lock.json');
    const ignore = createForgeIgnore({ baseDir: root });
    const devPaths = readDevOnlyPackagePaths(root);
    assert.ok(devPaths.length > 0);

    for (const packagePath of devPaths) {
        assert.equal(isIgnored(packagePath, ignore, { baseDir: root }), true, `dev package should be ignored: ${packagePath}`);
    }

    for (const [packagePath, meta] of Object.entries(lock.packages || {})) {
        if (!packagePath.startsWith('node_modules/') || meta?.dev === true) continue;
        if (packagePath === 'node_modules/electron' || packagePath === 'node_modules/electron-nightly') continue;
        assert.equal(isIgnored(packagePath, ignore, { baseDir: root }), false, `production package must be preserved: ${packagePath}`);
    }
});

test('Forge packaging policy keeps Java minecraft-data and required Bedrock common metadata while dropping versioned Bedrock data', () => {
    const ignore = createForgeIgnore({ baseDir: root });
    assert.equal(isIgnored('node_modules/minecraft-data/minecraft-data/data/pc/1.21.1/items.json', ignore, { baseDir: root }), false);
    assert.equal(isIgnored('node_modules/minecraft-data/minecraft-data/data/pc/common/versions.json', ignore, { baseDir: root }), false);
    assert.equal(isIgnored('node_modules/minecraft-data/minecraft-data/data/bedrock/common/versions.json', ignore, { baseDir: root }), false);
    assert.equal(isIgnored('node_modules/minecraft-data/minecraft-data/data/bedrock/1.21.0/items.json', ignore, { baseDir: root }), true);
});

test('relativeCandidate maps the absolute paths Packager sends back to project-relative paths', () => {
    const source = path.join(root, 'node_modules', 'minecraft-data', 'package.json');
    assert.equal(relativeCandidate(root, source), 'node_modules/minecraft-data/package.json');
    assert.equal(relativeCandidate(root, root), '');
    assert.equal(relativeCandidate(root, path.resolve(root, '..', 'outside.txt')), null);
});

test('Forge config uses deterministic absolute-path filtering instead of Galactus pruning', () => {
    const config = require('../../../forge.config');
    assert.equal(config.packagerConfig.prune, false);
    assert.equal(config.packagerConfig.asar, true);
    assert.equal(typeof config.packagerConfig.ignore, 'function');
});
