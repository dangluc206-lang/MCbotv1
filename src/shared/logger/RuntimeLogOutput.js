'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Logger = require('./Logger');
const CompactLogFormatter = require('./CompactLogFormatter');
const VietnamTime = require('../time/VietnamTime');

const LEVELS = Logger.LEVELS;

const LOW_LEVEL_OPERATIONAL_MESSAGES = Object.freeze([
    /^Inventory metadata /,
    /^STEP (START|OK|RETRY|FAIL|CANCELLED)$/,
    /^GUI (OPEN|CLOSE|ACTION START|ACTION OK|CLICK START|CLICK OK)$/,
    /^PV (OPEN START|OPEN OK|READ START|READ OK|TRANSFER START|TRANSFER OK|WITHDRAW CLICK|DEPOSIT CLICK)$/,
    /^KHO (READ START|READ OK|READ CACHE|FORCE REOPEN|OPEN ATTEMPT|COMMAND SEND|COMMAND SENT|GUI VERIFIED)$/,
    /^SMELT (START|OPEN GUI|GUI READY|FIND MATERIAL|MATERIAL RESOLVED|CLICK MATERIAL|ACTION OK)$/,
    /^CONVERT (START|OPEN \/ks|\/ks READY|MENU RESOLVED|ENTER MENU|MENU READY|OPTION RESOLVED|CLICK|ACTION OK)$/,
    /^Sold largest compacted B1 stock\.$/,
    /^CRAFT (START|SNAPSHOT BEFORE|OPEN \/ks|\/ks READY|ENTRY RESOLVED|ENTER MENU|MENU READY|LEARN RECIPES|LEARN RECIPES OK|RECIPE RESOLVED|BIND OUTPUT|BIND OUTPUT OK|OPEN QUANTITY|QUANTITY MENU READY|QUANTITY RESOLVED|PRE-CLICK DELAY|CLICK QUANTITY|POST-CLICK DELAY|QUANTITY GUI CLOSED|CLICK QUANTITY OK|VERIFY START|QUANTITY CANDIDATES|OK)$/,
    /^B5 (PLAN SUMMARY|PROGRESS|FINAL START|DEPOSIT SUCCESS|CRAFT SUCCESS|INPUT READY|QUANTITY DECISION)$/,
    /^B4 STEP SUCCESS$/
]);

function isLowLevelOperationalMessage(message) {
    const text = String(message || '');
    return LOW_LEVEL_OPERATIONAL_MESSAGES.some(pattern => pattern.test(text));
}

const SIGNATURE_META_KEYS = Object.freeze([
    'phase', 'code', 'operation', 'step', 'action', 'resource', 'selectionId',
    'trigger', 'status', 'reason', 'recipeId', 'direction', 'failureType',
    // Keep semantically different GUI/mode attempts distinct while still folding
    // high-frequency repeats from the same state into one ×N summary.
    'attempt', 'windowId', 'definitionId', 'key', 'areaId', 'profile', 'mode', 'targetId', 'slot', 'quantity'
]);

function validLevel(value, fallback) {
    const level = String(value || '').toLowerCase();
    return Object.prototype.hasOwnProperty.call(LEVELS, level) ? level : fallback;
}

function parseBoolean(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function lowestLevel(...levels) {
    return levels
        .filter(Boolean)
        .sort((a, b) => LEVELS[a] - LEVELS[b])[0] || 'info';
}

function fileDate(timestamp) {
    return VietnamTime.dateKey(timestamp);
}

function finiteNumber(value, fallback, minimum = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= minimum ? numeric : fallback;
}

function stablePrimitive(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value instanceof Error) return `${value.name}:${value.code || ''}:${value.message || ''}`;
    if (typeof value === 'object' && typeof value.code === 'string') return String(value.code);
    if (typeof value === 'object' && typeof value.message === 'string') return String(value.message);
    return '';
}

class RuntimeLogOutput {
    constructor({ baseDir = process.cwd(), app = {}, env = process.env, consoleRef = console } = {}) {
        const logging = app.logging && typeof app.logging === 'object' ? app.logging : {};
        const consoleConfig = logging.console && typeof logging.console === 'object' ? logging.console : {};
        const fileConfig = logging.file && typeof logging.file === 'object' ? logging.file : {};
        const coalesceConfig = logging.coalesce && typeof logging.coalesce === 'object' ? logging.coalesce : {};
        this.verboseOperationalLogs = parseBoolean(env.LOG_VERBOSE_OPERATIONS, false);

        const legacyLevel = env.LOG_LEVEL || app.logLevel || 'info';
        this.consoleLevel = validLevel(env.LOG_CONSOLE_LEVEL || legacyLevel || consoleConfig.level, 'info');
        if (!env.LOG_CONSOLE_LEVEL && !env.LOG_LEVEL && consoleConfig.level) {
            this.consoleLevel = validLevel(consoleConfig.level, this.consoleLevel);
        }

        this.consoleFormat = String(env.LOG_FORMAT || consoleConfig.format || 'compact').toLowerCase() === 'json' ? 'json' : 'compact';
        this.consoleMeta = String(env.LOG_META || consoleConfig.meta || 'summary').toLowerCase();
        if (!['none', 'summary', 'full'].includes(this.consoleMeta)) this.consoleMeta = 'summary';
        this.consoleRef = consoleRef;
        this.formatter = new CompactLogFormatter({
            metaMode: this.consoleMeta,
            maxMetaFields: Number.isInteger(consoleConfig.maxMetaFields) ? consoleConfig.maxMetaFields : 4
        });

        this.fileEnabled = parseBoolean(env.LOG_FILE_ENABLED, fileConfig.enabled !== false);
        this.fileLevel = validLevel(env.LOG_FILE_LEVEL || fileConfig.level || 'debug', 'debug');
        this.fileDirectory = path.resolve(baseDir, env.LOG_FILE_DIR || fileConfig.directory || 'data/logs');
        this.filePrefix = String(fileConfig.prefix || 'mcbot').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'mcbot';
        this.fileErrorReported = false;
        this.fileBufferFlushMs = finiteNumber(fileConfig.bufferFlushMs, 250, 0);
        this.fileBufferMaxBytes = finiteNumber(fileConfig.bufferMaxBytes, 65536, 1024);
        this.fileRetentionDays = finiteNumber(fileConfig.retentionDays, 14, 0);
        this.fileMaxTotalBytes = finiteNumber(fileConfig.maxTotalMb, 256, 1) * 1024 * 1024;
        this.fileCleanupIntervalMs = finiteNumber(fileConfig.cleanupIntervalMs, 6 * 60 * 60 * 1000, 60_000);
        this.fileCleanupTimer = null;
        this.fileBuffers = new Map();
        this.fileBufferBytes = 0;
        this.fileFlushTimer = null;

        this.coalesceEnabled = parseBoolean(env.LOG_COALESCE_ENABLED, coalesceConfig.enabled !== false);
        this.coalesceWindowMs = finiteNumber(env.LOG_COALESCE_WINDOW_MS || coalesceConfig.windowMs, 1200, 0);
        this.coalesceLevels = new Set(
            (Array.isArray(coalesceConfig.levels) ? coalesceConfig.levels : ['debug', 'info', 'warn', 'error'])
                .map(level => validLevel(level, null))
                .filter(Boolean)
        );
        this.coalesceMaxBuckets = Math.max(1, Math.floor(finiteNumber(coalesceConfig.maxBuckets, 512, 1)));
        this.repeatBuckets = new Map();
        this.coalesceTimer = null;
        this.minimumLevel = lowestLevel(this.consoleLevel, this.fileEnabled ? this.fileLevel : null);

        if (this.coalesceEnabled && this.coalesceWindowMs > 0) {
            const cadence = Math.max(250, Math.min(this.coalesceWindowMs, 1000));
            this.coalesceTimer = setInterval(() => this.#flushExpiredRepeatBuckets(), cadence);
            this.coalesceTimer.unref?.();
        }

        this.beforeExitHandler = () => this.flush();
        process.once?.('beforeExit', this.beforeExitHandler);
    }

    async initialize() {}

    async start() {
        if (!this.fileEnabled) return;
        this.#cleanupOldLogFiles();
        this.fileCleanupTimer = setInterval(() => this.#cleanupOldLogFiles(), this.fileCleanupIntervalMs);
        this.fileCleanupTimer.unref?.();
    }

    async stop() {
        this.flush();
    }

    async destroy() {
        this.close();
    }

    write(record) {
        if (!record || typeof record !== 'object') return;
        if (!this.verboseOperationalLogs && isLowLevelOperationalMessage(record.message)) return;
        if (!this.#shouldCoalesce(record)) {
            this.#writeDirect(record);
            return;
        }

        const now = Date.now();
        const signature = this.#signature(record);
        const existing = this.repeatBuckets.get(signature);

        if (existing && now - existing.lastAt <= this.coalesceWindowMs) {
            existing.count += 1;
            existing.lastAt = now;
            existing.lastRecord = record;
            return;
        }

        if (existing) this.#flushRepeatBucket(signature, existing);
        this.#writeDirect(record);
        this.repeatBuckets.set(signature, {
            count: 1,
            firstAt: now,
            lastAt: now,
            firstRecord: record,
            lastRecord: record
        });
        this.#trimRepeatBuckets();
    }

    flush() {
        for (const [signature, bucket] of [...this.repeatBuckets.entries()]) {
            this.#flushRepeatBucket(signature, bucket);
        }
        this.#flushFileBuffers();
    }

    close() {
        clearInterval(this.coalesceTimer);
        this.coalesceTimer = null;
        clearTimeout(this.fileFlushTimer);
        this.fileFlushTimer = null;
        clearInterval(this.fileCleanupTimer);
        this.fileCleanupTimer = null;
        this.flush();
        if (this.beforeExitHandler) process.removeListener?.('beforeExit', this.beforeExitHandler);
        this.beforeExitHandler = null;
    }

    #shouldCoalesce(record) {
        return this.coalesceEnabled
            && this.coalesceWindowMs > 0
            && this.coalesceLevels.has(record.level)
            && typeof record.message === 'string'
            && record.message.length > 0;
    }

    #signature(record) {
        const meta = record.meta && typeof record.meta === 'object' ? record.meta : {};
        const stable = SIGNATURE_META_KEYS
            .map(key => `${key}=${stablePrimitive(meta[key])}`)
            .filter(entry => !entry.endsWith('='))
            .join('|');
        return `${record.level}|${record.scope}|${record.message}|${stable}`;
    }

    #flushExpiredRepeatBuckets() {
        const now = Date.now();
        for (const [signature, bucket] of [...this.repeatBuckets.entries()]) {
            if (now - bucket.lastAt >= this.coalesceWindowMs) {
                this.#flushRepeatBucket(signature, bucket);
            }
        }
    }

    #flushRepeatBucket(signature, bucket) {
        this.repeatBuckets.delete(signature);
        const suppressed = Math.max(0, Number(bucket?.count || 0) - 1);
        if (suppressed <= 0 || !bucket?.lastRecord) return;
        const durationMs = Math.max(0, Number(bucket.lastAt || 0) - Number(bucket.firstAt || 0));
        const summary = Object.freeze({
            ...bucket.lastRecord,
            timestamp: VietnamTime.iso(bucket.lastAt || Date.now()),
            repeatCount: suppressed,
            repeatDurationMs: durationMs,
            meta: Object.freeze({
                ...(bucket.lastRecord.meta || {}),
                repeatCount: suppressed,
                repeatDurationMs: durationMs
            })
        });
        this.#writeDirect(summary);
    }

    #trimRepeatBuckets() {
        if (this.repeatBuckets.size <= this.coalesceMaxBuckets) return;
        const entries = [...this.repeatBuckets.entries()].sort((a, b) => a[1].lastAt - b[1].lastAt);
        const removeCount = this.repeatBuckets.size - this.coalesceMaxBuckets;
        for (let index = 0; index < removeCount; index += 1) {
            const [signature, bucket] = entries[index];
            this.#flushRepeatBucket(signature, bucket);
        }
    }

    #writeDirect(record) {
        if (LEVELS[record.level] >= LEVELS[this.consoleLevel]) this.#writeConsole(record);
        if (this.fileEnabled && LEVELS[record.level] >= LEVELS[this.fileLevel]) this.#queueFile(record);
    }

    #writeConsole(record) {
        const line = this.consoleFormat === 'json' ? JSON.stringify(record) : this.formatter.format(record);
        const method = record.level === 'debug'
            ? 'debug'
            : record.level === 'warn'
                ? 'warn'
                : record.level === 'error'
                    ? 'error'
                    : 'log';
        const writer = typeof this.consoleRef?.[method] === 'function' ? this.consoleRef[method] : this.consoleRef?.log;
        writer?.call(this.consoleRef, line);
    }

    #queueFile(record) {
        const file = path.join(this.fileDirectory, `${this.filePrefix}-${fileDate(record.timestamp)}.jsonl`);
        const line = `${JSON.stringify(record)}\n`;
        const previous = this.fileBuffers.get(file) || '';
        this.fileBuffers.set(file, previous + line);
        this.fileBufferBytes += Buffer.byteLength(line);

        if (record.level === 'error' || this.fileBufferBytes >= this.fileBufferMaxBytes || this.fileBufferFlushMs === 0) {
            this.#flushFileBuffers();
            return;
        }
        if (!this.fileFlushTimer) {
            this.fileFlushTimer = setTimeout(() => {
                this.fileFlushTimer = null;
                this.#flushFileBuffers();
            }, this.fileBufferFlushMs);
            this.fileFlushTimer.unref?.();
        }
    }

    #cleanupOldLogFiles() {
        try {
            if (!fs.existsSync(this.fileDirectory)) return;
            const now = Date.now();
            const currentFile = path.join(this.fileDirectory, `${this.filePrefix}-${fileDate(VietnamTime.iso())}.jsonl`);
            const files = fs.readdirSync(this.fileDirectory, { withFileTypes: true })
                .filter(entry => entry.isFile() && entry.name.startsWith(`${this.filePrefix}-`) && entry.name.endsWith('.jsonl'))
                .map(entry => {
                    const filePath = path.join(this.fileDirectory, entry.name);
                    const stat = fs.statSync(filePath);
                    return { filePath, name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs };
                })
                .sort((a, b) => b.mtimeMs - a.mtimeMs);

            const cutoff = this.fileRetentionDays > 0 ? now - this.fileRetentionDays * 24 * 60 * 60 * 1000 : 0;
            let total = files.reduce((sum, file) => sum + file.size, 0);
            for (const file of [...files].sort((a, b) => a.mtimeMs - b.mtimeMs)) {
                if (file.filePath === currentFile) continue;
                const tooOld = cutoff > 0 && file.mtimeMs < cutoff;
                const tooLarge = total > this.fileMaxTotalBytes;
                if (!tooOld && !tooLarge) continue;
                try {
                    fs.rmSync(file.filePath, { force: true });
                    total -= file.size;
                } catch (error) {
                    const writer = typeof this.consoleRef?.warn === 'function' ? this.consoleRef.warn : this.consoleRef?.log;
                    writer?.call(this.consoleRef, `MCbot logger could not remove retained file ${file.name}: ${error?.message || error}`);
                }
            }
        } catch (error) {
            const writer = typeof this.consoleRef?.warn === 'function' ? this.consoleRef.warn : this.consoleRef?.log;
            writer?.call(this.consoleRef, `MCbot logger retention cleanup failed: ${error?.message || error}`);
        }
    }

    #flushFileBuffers() {
        if (this.fileBuffers.size === 0) return;
        const buffers = this.fileBuffers;
        this.fileBuffers = new Map();
        this.fileBufferBytes = 0;
        clearTimeout(this.fileFlushTimer);
        this.fileFlushTimer = null;

        try {
            fs.mkdirSync(this.fileDirectory, { recursive: true });
            for (const [file, text] of buffers.entries()) {
                if (text) fs.appendFileSync(file, text, 'utf8');
            }
        } catch (error) {
            if (this.fileErrorReported) return;
            this.fileErrorReported = true;
            const message = `MCbot logger could not write JSON log file: ${error?.message || error}`;
            const writer = typeof this.consoleRef?.error === 'function' ? this.consoleRef.error : this.consoleRef?.log;
            writer?.call(this.consoleRef, message);
        }
    }
}

RuntimeLogOutput.validLevel = validLevel;
RuntimeLogOutput.parseBoolean = parseBoolean;
module.exports = RuntimeLogOutput;
