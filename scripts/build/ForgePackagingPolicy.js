'use strict';

const fs = require('node:fs');
const path = require('node:path');

function normalizeRelative(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function readDevOnlyPackagePaths(baseDir) {
    const lockPath = path.join(baseDir, 'package-lock.json');
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    return Object.entries(lock.packages || {})
        .filter(([packagePath, meta]) => packagePath.startsWith('node_modules/') && meta?.dev === true)
        .map(([packagePath]) => normalizeRelative(packagePath))
        .sort((a, b) => a.length - b.length || a.localeCompare(b));
}

function isUnderAnyRoot(relativePath, roots) {
    const normalized = normalizeRelative(relativePath);
    if (!normalized) return false;
    if (roots.has(normalized)) return true;

    let cursor = normalized;
    while (cursor.includes('/')) {
        cursor = cursor.slice(0, cursor.lastIndexOf('/'));
        if (roots.has(cursor)) return true;
    }
    return false;
}

function relativeCandidate(baseDir, candidatePath) {
    const absoluteBase = path.resolve(baseDir);
    const absoluteCandidate = path.resolve(candidatePath);
    const relative = path.relative(absoluteBase, absoluteCandidate);
    if (!relative) return '';
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
    return normalizeRelative(relative);
}

function createForgeIgnore({ baseDir = process.cwd() } = {}) {
    const absoluteBase = path.resolve(baseDir);
    const devOnlyRoots = new Set(readDevOnlyPackagePaths(absoluteBase));

    // Electron Packager's IgnoreFunction receives an ABSOLUTE path. Returning
    // true excludes that path from the app bundle. Using a predicate instead of
    // relative-path regexes is important on Windows (C:\\...), where /^\/.../
    // regexes never match the absolute path passed by Packager.
    return candidatePath => {
        const relative = relativeCandidate(absoluteBase, candidatePath);
        if (relative === null || relative === '') return false;
        const lower = relative.toLowerCase();
        const basename = path.basename(relative).toLowerCase();

        // Re-implement Packager defaults because supplying IgnoreFunction means
        // the default ignore list is not applied automatically.
        if (lower === '.git' || lower.startsWith('.git/')) return true;
        if (lower === 'out' || lower.startsWith('out/')) return true;
        if (lower === 'node_modules/.bin' || lower.startsWith('node_modules/.bin/')) return true;
        if (lower === 'node_modules/electron' || lower.startsWith('node_modules/electron/')) return true;
        if (lower === 'node_modules/electron-nightly' || lower.startsWith('node_modules/electron-nightly/')) return true;
        if (basename.endsWith('.o') || basename.endsWith('.obj')) return true;

        // MCbot build/test/runtime-only content.
        const excludedRoots = [
            'coverage',
            'data/logs',
            'data/runtime',
            'data/snapshots',
            'data/backups',
            'data/support',
            'tests',
            'scripts',
            'architecture',
            '.github'
        ];
        if (excludedRoots.some(root => lower === root || lower.startsWith(`${root}/`))) return true;
        if (/^patch_(?:info|summary)/i.test(relative)) return true;
        if (/^(?:agents|architecture|js_responsibilities|readme|rules)\.md$/i.test(relative)) return true;
        if (/^(?:start_here|user_guide|release_notes)\.txt$/i.test(relative)) return true;
        if (/^forge\.config\.js$/i.test(relative)) return true;
        if (/^\.env$/i.test(relative)) return true;

        // Do not ship any lockfile package marked dev-only. This check is based
        // on package-lock metadata and works for scoped and nested packages.
        if (isUnderAnyRoot(relative, devOnlyRoots)) return true;

        // MCbot is Java Edition / Mineflayer. minecraft-data needs
        // bedrock/common at module load time, but versioned Bedrock datasets are
        // not used by MCbot and are hundreds of MB. Keep common, drop the rest.
        const bedrockPrefix = 'node_modules/minecraft-data/minecraft-data/data/bedrock/';
        if (lower.startsWith(bedrockPrefix)) {
            const rest = lower.slice(bedrockPrefix.length);
            if (rest && rest !== 'common' && !rest.startsWith('common/')) return true;
        }
        if (lower === 'node_modules/minecraft-data/.github' || lower.startsWith('node_modules/minecraft-data/.github/')) return true;
        if (lower === 'node_modules/minecraft-data/doc' || lower.startsWith('node_modules/minecraft-data/doc/')) return true;
        if (lower === 'node_modules/minecraft-data/test' || lower.startsWith('node_modules/minecraft-data/test/')) return true;
        if (lower === 'node_modules/minecraft-data/typings' || lower.startsWith('node_modules/minecraft-data/typings/')) return true;
        if (lower === 'node_modules/minecraft-data/minecraft-data/.github' || lower.startsWith('node_modules/minecraft-data/minecraft-data/.github/')) return true;
        if (lower === 'node_modules/minecraft-data/minecraft-data/doc' || lower.startsWith('node_modules/minecraft-data/minecraft-data/doc/')) return true;
        if (lower === 'node_modules/minecraft-data/minecraft-data/tools' || lower.startsWith('node_modules/minecraft-data/minecraft-data/tools/')) return true;

        return false;
    };
}

function isIgnored(candidatePath, ignore, { baseDir = process.cwd() } = {}) {
    if (typeof ignore !== 'function') throw new TypeError('Forge packaging ignore policy must be an IgnoreFunction.');
    const absoluteCandidate = path.isAbsolute(candidatePath) ? candidatePath : path.resolve(baseDir, candidatePath);
    return Boolean(ignore(absoluteCandidate));
}

module.exports = {
    createForgeIgnore,
    isIgnored,
    isUnderAnyRoot,
    readDevOnlyPackagePaths,
    relativeCandidate
};
