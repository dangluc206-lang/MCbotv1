'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ConfigSpecs = require('../../configuration/ConfigSpecs');
const Redactor = require('../../shared/security/Redactor');
const Layout = require('./RuntimeFailureArtifactLayout');

const CONTRACT = 'runtime-failure-artifact-v1';
const ID_PREFIX = 'rfa1.';
const MAX_LIST_LIMIT = 200;
const DEFAULT_LIST_LIMIT = 40;
const MAX_TAIL_ENTRIES = 200;
const DEFAULT_TAIL_ENTRIES = 50;
const MAX_UI_READ_BYTES = 8 * 1024 * 1024;
const MAX_TAIL_BYTES = 1024 * 1024;
const MAX_LIST_METADATA_BYTES = 8 * 1024 * 1024;

function warning(code, message, details = null) {
    return Redactor.sanitize({ code, message, details });
}

function safeLimit(value, fallback, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.min(max, Math.trunc(parsed)));
}

function encodeArtifactId(botId, kind = 'last-error') {
    Layout.assertBotId(botId);
    if (kind !== 'last-error') throw new Error(`Unsupported runtime failure artifact kind: ${kind}`);
    const payload = Buffer.from(JSON.stringify({ v: 1, b: botId, k: kind }), 'utf8').toString('base64url');
    return `${ID_PREFIX}${payload}`;
}

function decodeArtifactId(id) {
    const value = String(id || '');
    if (!value.startsWith(ID_PREFIX) || value.length > 256) throw new Error('Invalid runtime failure artifact ID.');
    let parsed;
    try { parsed = JSON.parse(Buffer.from(value.slice(ID_PREFIX.length), 'base64url').toString('utf8')); }
    catch { throw new Error('Invalid runtime failure artifact ID.'); }
    if (!parsed || parsed.v !== 1 || parsed.k !== 'last-error') throw new Error('Unsupported runtime failure artifact ID.');
    Layout.assertBotId(parsed.b);
    return Object.freeze({ botId: parsed.b, kind: parsed.k });
}

class RuntimeFailureArtifactRepository {
    constructor({ baseDir = process.cwd(), configuration = null, logger = null } = {}) {
        this.baseDir = path.resolve(baseDir);
        this.configuration = configuration;
        this.logger = logger;
        this.config = this.#loadConfig();
        this.rootDirectory = path.resolve(this.baseDir, this.config.directory);
        const relative = path.relative(this.baseDir, this.rootDirectory);
        if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
            throw new Error('Runtime failure artifact directory escapes project base.');
        }
        const configuredBytes = Math.max(1, Math.floor(Number(this.config.maxFileMb) * 1024 * 1024));
        this.maxReadBytes = Math.min(configuredBytes, MAX_UI_READ_BYTES);
    }

    list({ botId = null, limit = DEFAULT_LIST_LIMIT, hydrateMetadata = true } = {}) {
        const requestedBot = botId == null ? null : Layout.assertBotId(botId);
        const warnings = [];
        const items = [];
        const rootState = this.#rootState({ allowMissing: true });
        if (!rootState.exists) return { contract: CONTRACT, items, warnings };

        const botIds = requestedBot ? [requestedBot] : this.#listBotIds(warnings);
        const candidates = [];
        for (const currentBotId of botIds) {
            try {
                const file = this.#safeArtifactFile(currentBotId, Layout.LAST_ERROR_FILE, { allowMissing: true });
                if (file) candidates.push({ botId: currentBotId, file, metadata: this.#metadataFromStat(currentBotId, file.stat) });
            } catch (error) {
                warnings.push(warning('RUNTIME_FAILURE_ARTIFACT_LIST_SKIPPED', 'Không thể đọc metadata bản ghi lỗi runtime.', {
                    botId: currentBotId,
                    reason: error.message
                }));
            }
        }
        candidates.sort((a, b) => b.file.stat.mtimeMs - a.file.stat.mtimeMs);
        const selected = candidates.slice(0, safeLimit(limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT));
        let metadataBudget = hydrateMetadata === false ? 0 : MAX_LIST_METADATA_BYTES;
        for (const candidate of selected) {
            if (hydrateMetadata === false) {
                candidate.metadata.metadataLimited = true;
            } else if (candidate.file.stat.size <= metadataBudget) {
                this.#hydrateMetadata(candidate.metadata, candidate.file.path, candidate.file.stat.size);
                metadataBudget -= candidate.file.stat.size;
                if (candidate.metadata.warning) warnings.push(candidate.metadata.warning);
            } else {
                candidate.metadata.metadataLimited = true;
                warnings.push(warning('RUNTIME_FAILURE_METADATA_BUDGET_EXHAUSTED', 'Đã giới hạn đọc metadata Diagnostics để tránh I/O quá lớn.', {
                    botId: candidate.botId,
                    size: candidate.file.stat.size
                }));
            }
            items.push(candidate.metadata);
        }
        return { contract: CONTRACT, items, warnings };
    }

    read(id) {
        const decoded = decodeArtifactId(id);
        const file = this.#safeArtifactFile(decoded.botId, Layout.LAST_ERROR_FILE, { allowMissing: false });
        const metadata = this.#metadataFromStat(decoded.botId, file.stat);
        const warnings = [];
        let record = null;
        try {
            const text = this.#readBoundedFile(file.path, file.stat.size);
            record = Redactor.sanitize(JSON.parse(text));
        } catch (error) {
            warnings.push(warning('RUNTIME_FAILURE_ARTIFACT_CORRUPT', 'Bản ghi lỗi runtime bị hỏng hoặc không đọc được.', {
                botId: decoded.botId,
                reason: error.message
            }));
        }
        return { contract: CONTRACT, artifact: metadata, record, warnings };
    }

    tail({ botId, limit = DEFAULT_TAIL_ENTRIES } = {}) {
        const normalizedBotId = Layout.assertBotId(botId);
        const warnings = [];
        let file;
        try { file = this.#safeArtifactFile(normalizedBotId, Layout.ACTIVE_JOURNAL_FILE, { allowMissing: true, allowOversize: true }); }
        catch (error) {
            return {
                contract: CONTRACT,
                botId: normalizedBotId,
                entries: [],
                warnings: [warning('RUNTIME_FAILURE_JOURNAL_UNREADABLE', 'Không thể đọc nhật ký lỗi runtime.', { reason: error.message })]
            };
        }
        if (!file) return { contract: CONTRACT, botId: normalizedBotId, entries: [], warnings };

        const maxEntries = safeLimit(limit, DEFAULT_TAIL_ENTRIES, MAX_TAIL_ENTRIES);
        const fd = this.#openReadOnlyNoFollow(file.path);
        let buffer;
        let start = 0;
        try {
            const currentStat = fs.fstatSync(fd);
            if (!currentStat.isFile()) throw new Error('Runtime failure journal is no longer a regular file.');
            const bytesToRead = Math.min(currentStat.size, MAX_TAIL_BYTES, this.maxReadBytes);
            start = Math.max(0, currentStat.size - bytesToRead);
            buffer = Buffer.alloc(bytesToRead);
            const bytesRead = bytesToRead > 0 ? fs.readSync(fd, buffer, 0, bytesToRead, start) : 0;
            buffer = buffer.subarray(0, bytesRead);
        } finally { fs.closeSync(fd); }

        let text = buffer.toString('utf8');
        if (start > 0) {
            const newline = text.indexOf('\n');
            if (newline < 0) text = '';
            else text = text.slice(newline + 1);
        }
        if (text && !text.endsWith('\n')) {
            const lastNewline = text.lastIndexOf('\n');
            text = lastNewline >= 0 ? text.slice(0, lastNewline + 1) : '';
            warnings.push(warning('RUNTIME_FAILURE_JOURNAL_PARTIAL_LINE', 'Đã bỏ qua dòng journal đang ghi dở.', { botId: normalizedBotId }));
        }

        const entries = [];
        const lines = text.split(/\r?\n/).filter(Boolean);
        for (const line of lines.slice(-maxEntries)) {
            try { entries.push(Redactor.sanitize(JSON.parse(line))); }
            catch (error) {
                warnings.push(warning('RUNTIME_FAILURE_JOURNAL_CORRUPT_ENTRY', 'Đã bỏ qua một dòng journal lỗi runtime bị hỏng.', {
                    botId: normalizedBotId,
                    reason: error.message
                }));
            }
        }
        return { contract: CONTRACT, botId: normalizedBotId, entries, warnings };
    }

    #loadConfig() {
        const registry = this.configuration?.registry || this.configuration;
        if (registry?.require) {
            const app = registry.require('app');
            return this.#validateConfig(app?.diagnostics?.runtimeFailures);
        }
        const appSpec = ConfigSpecs.find(spec => spec.key === 'app');
        if (!appSpec) throw new Error('App config spec is unavailable.');
        const configPath = path.resolve(this.baseDir, appSpec.file);
        const relative = path.relative(this.baseDir, configPath);
        if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
            throw new Error('App config path escapes project base.');
        }
        const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return this.#validateConfig(parsed?.diagnostics?.runtimeFailures);
    }

    #validateConfig(config) {
        if (!config || typeof config !== 'object') throw new Error('app.diagnostics.runtimeFailures config is required.');
        const directory = String(config.directory || '');
        if (!directory || path.isAbsolute(directory)) throw new Error('app.diagnostics.runtimeFailures.directory must be relative.');
        const normalized = path.normalize(directory);
        if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw new Error('app.diagnostics.runtimeFailures.directory escapes project base.');
        if (!Number.isFinite(Number(config.maxFileMb)) || Number(config.maxFileMb) <= 0) throw new Error('app.diagnostics.runtimeFailures.maxFileMb must be > 0.');
        return Object.freeze({ ...config, directory });
    }

    #rootState({ allowMissing }) {
        let stat;
        try { stat = fs.lstatSync(this.rootDirectory); }
        catch (error) {
            if (allowMissing && error?.code === 'ENOENT') return { exists: false };
            throw error;
        }
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Runtime failure artifact root must be a real directory.');
        const realBase = fs.realpathSync(this.baseDir);
        const realRoot = fs.realpathSync(this.rootDirectory);
        this.#assertContained(realBase, realRoot, 'Runtime failure artifact root escapes project base.');
        return { exists: true, stat, realRoot };
    }

    #listBotIds(warnings) {
        const out = [];
        for (const entry of fs.readdirSync(this.rootDirectory, { withFileTypes: true })) {
            if (!Layout.BOT_ID_PATTERN.test(entry.name)) continue;
            const directory = Layout.resolveBotDirectory(this.rootDirectory, entry.name);
            let stat;
            try { stat = fs.lstatSync(directory); }
            catch (error) {
                warnings.push(warning('RUNTIME_FAILURE_BOT_DIRECTORY_UNREADABLE', 'Không thể đọc thư mục lỗi runtime của bot.', { botId: entry.name, reason: error.message }));
                continue;
            }
            if (!stat.isDirectory() || stat.isSymbolicLink()) {
                warnings.push(warning('RUNTIME_FAILURE_BOT_DIRECTORY_UNSAFE', 'Đã bỏ qua thư mục lỗi runtime không an toàn.', { botId: entry.name }));
                continue;
            }
            out.push(entry.name);
        }
        return out;
    }

    #hydrateMetadata(metadata, filePath, size) {
        try {
            const text = this.#readBoundedFile(filePath, size);
            const record = JSON.parse(text);
            metadata.code = typeof record?.code === 'string' ? record.code : record?.diagnostic?.code || null;
            metadata.severity = typeof record?.canonicalError?.severity === 'string' ? record.canonicalError.severity : record?.severity || null;
            metadata.occurredAt = record?.occurredAt || record?.capturedAt || null;
            metadata.correlationId = record?.canonicalError?.correlationId || record?.correlationId || record?.failureId || null;
            metadata.corrupt = false;
        } catch (error) {
            metadata.corrupt = true;
            metadata.warning = warning('RUNTIME_FAILURE_ARTIFACT_CORRUPT', 'Bản ghi lỗi runtime bị hỏng.', { botId: metadata.botId, reason: error.message });
        }
        return metadata;
    }

    #metadataFromStat(botId, stat) {
        return {
            id: encodeArtifactId(botId),
            botId,
            kind: 'last-error',
            modifiedAt: stat.mtime.toISOString(),
            size: stat.size,
            code: null,
            severity: null,
            occurredAt: null,
            correlationId: null,
            corrupt: false
        };
    }

    #safeArtifactFile(botId, fileName, { allowMissing, allowOversize = false }) {
        this.#rootState({ allowMissing });
        const directory = Layout.resolveBotDirectory(this.rootDirectory, botId);
        let directoryStat;
        try { directoryStat = fs.lstatSync(directory); }
        catch (error) {
            if (allowMissing && error?.code === 'ENOENT') return null;
            throw error;
        }
        if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('Unsafe runtime failure bot directory.');
        const filePath = Layout.resolveChild(directory, fileName);
        let stat;
        try { stat = fs.lstatSync(filePath); }
        catch (error) {
            if (allowMissing && error?.code === 'ENOENT') return null;
            throw error;
        }
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Runtime failure artifact must be a regular non-symlink file.');
        if (!allowOversize && stat.size > this.maxReadBytes) throw new Error(`Runtime failure artifact exceeds read limit (${this.maxReadBytes} bytes).`);
        const realRoot = fs.realpathSync(this.rootDirectory);
        const realDirectory = fs.realpathSync(directory);
        const realFile = fs.realpathSync(filePath);
        this.#assertContained(realRoot, realDirectory, 'Runtime failure bot directory escapes configured root.');
        this.#assertContained(realRoot, realFile, 'Runtime failure artifact escapes configured root.');
        return { path: filePath, stat };
    }

    #readBoundedFile(filePath, expectedSize) {
        if (expectedSize > this.maxReadBytes) throw new Error(`Runtime failure artifact exceeds read limit (${this.maxReadBytes} bytes).`);
        const fd = this.#openReadOnlyNoFollow(filePath);
        try {
            const stat = fs.fstatSync(fd);
            if (!stat.isFile()) throw new Error('Runtime failure artifact is no longer a regular file.');
            if (stat.size > this.maxReadBytes) throw new Error(`Runtime failure artifact exceeds read limit (${this.maxReadBytes} bytes).`);
            const buffer = Buffer.alloc(stat.size);
            const bytesRead = stat.size > 0 ? fs.readSync(fd, buffer, 0, stat.size, 0) : 0;
            return buffer.subarray(0, bytesRead).toString('utf8');
        } finally { fs.closeSync(fd); }
    }

    #openReadOnlyNoFollow(filePath) {
        const noFollow = Number(fs.constants.O_NOFOLLOW || 0);
        if (!noFollow) {
            const stat = fs.lstatSync(filePath);
            if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Runtime failure artifact must be a regular non-symlink file.');
            return fs.openSync(filePath, fs.constants.O_RDONLY);
        }
        const flags = fs.constants.O_RDONLY | noFollow;
        try { return fs.openSync(filePath, flags); }
        catch (error) {
            if (!noFollow || !['EINVAL', 'ENOTSUP'].includes(error?.code)) throw error;
            const stat = fs.lstatSync(filePath);
            if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Runtime failure artifact must be a regular non-symlink file.');
            return fs.openSync(filePath, fs.constants.O_RDONLY);
        }
    }

    #assertContained(root, candidate, message) {
        const relative = path.relative(root, candidate);
        if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) throw new Error(message);
    }
}

module.exports = RuntimeFailureArtifactRepository;
module.exports.CONTRACT = CONTRACT;
module.exports.encodeArtifactId = encodeArtifactId;
module.exports.decodeArtifactId = decodeArtifactId;
