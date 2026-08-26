'use strict';

const path = require('node:path');

const BOT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,31}$/;
const LAST_ERROR_FILE = 'last-error.json';
const ACTIVE_JOURNAL_FILE = 'errors.jsonl';
const ROTATED_JOURNAL_PATTERN = /^errors-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-\d{4}\.jsonl$/;
const TEMP_LAST_ERROR_PATTERN = /^last-error\.json\..+\.tmp$/;

function assertBotId(botId) {
    const normalized = String(botId || '');
    if (!BOT_ID_PATTERN.test(normalized)) throw new TypeError('Runtime failure botId must match ^[a-z0-9][a-z0-9_-]{1,31}$.');
    return normalized;
}

function resolveBotDirectory(baseDirectory, botId) {
    const root = path.resolve(baseDirectory);
    const normalized = assertBotId(botId);
    const directory = path.resolve(root, normalized);
    const relative = path.relative(root, directory);
    if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
        throw new Error(`Unsafe runtime failure bot directory for botId ${normalized}.`);
    }
    return directory;
}

function resolveChild(directory, name) {
    const root = path.resolve(directory);
    const child = path.resolve(root, String(name || ''));
    if (path.dirname(child) !== root) throw new Error(`Unsafe runtime failure artifact path: ${name}`);
    return child;
}

module.exports = Object.freeze({
    BOT_ID_PATTERN,
    LAST_ERROR_FILE,
    ACTIVE_JOURNAL_FILE,
    ROTATED_JOURNAL_PATTERN,
    TEMP_LAST_ERROR_PATTERN,
    assertBotId,
    resolveBotDirectory,
    resolveChild
});
