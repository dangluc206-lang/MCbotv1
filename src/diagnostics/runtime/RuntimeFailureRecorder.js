'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createFailureEvent, signature: failureSignature } = require('./RuntimeFailureEvent');
const Redactor = require('../../shared/security/Redactor');
const Layout = require('./RuntimeFailureArtifactLayout');

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_RECORD_BYTES = 768;

class RuntimeFailureRecorder {
    constructor({
        botId,
        eventBus,
        baseDir,
        config,
        guiManager = null,
        inventoryObservationService = null,
        logger = null,
        clock = () => Date.now()
    }) {
        if (!config || typeof config !== 'object') throw new TypeError('RuntimeFailureRecorder config is required.');
        if (typeof config.enabled !== 'boolean') throw new TypeError('RuntimeFailureRecorder config.enabled must be boolean.');
        for (const key of ['repeatWindowMs', 'maxFileMb', 'maxTotalMb', 'retentionDays', 'cleanupIntervalMs']) {
            if (!Number.isFinite(Number(config[key]))) throw new TypeError(`RuntimeFailureRecorder config.${key} is required.`);
        }
        if (Number(config.repeatWindowMs) < 0) throw new RangeError('RuntimeFailureRecorder repeatWindowMs must be >= 0.');
        if (Number(config.cleanupIntervalMs) < 0) throw new RangeError('RuntimeFailureRecorder cleanupIntervalMs must be >= 0.');
        if (Number(config.maxFileMb) <= 0 || Number(config.maxTotalMb) <= 0) throw new RangeError('RuntimeFailureRecorder file quotas must be > 0.');
        if (Number(config.maxTotalMb) < Number(config.maxFileMb)) throw new RangeError('RuntimeFailureRecorder maxTotalMb must be >= maxFileMb.');
        if (Number(config.retentionDays) < 0) throw new RangeError('RuntimeFailureRecorder retentionDays must be >= 0.');
        Layout.assertBotId(botId);
        if (typeof baseDir !== 'string' || !baseDir.trim()) throw new TypeError('RuntimeFailureRecorder baseDir is required.');

        Object.assign(this, { botId, eventBus, guiManager, inventoryObservationService, logger, clock });
        this.config = Object.freeze({
            enabled: config.enabled === true,
            repeatWindowMs: Number(config.repeatWindowMs),
            maxFileMb: Number(config.maxFileMb),
            maxTotalMb: Number(config.maxTotalMb),
            retentionDays: Number(config.retentionDays),
            cleanupIntervalMs: Number(config.cleanupIntervalMs)
        });
        this.baseDirectory = path.resolve(baseDir);
        this.directory = Layout.resolveBotDirectory(this.baseDirectory, botId);
        this.activeFile = Layout.resolveChild(this.directory, Layout.ACTIVE_JOURNAL_FILE);
        this.lastFile = Layout.resolveChild(this.directory, Layout.LAST_ERROR_FILE);
        this.unsubscribers = [];
        this.repeatBuckets = new Map();
        this.seenFailureIds = new Map();
        this.repeatTimer = null;
        this.cleanupTimer = null;
        this.writeChain = Promise.resolve();
        this.stopping = false;
        this.rotationSequence = 0;
        if (this.#maxFileBytes() < MIN_RECORD_BYTES) {
            throw new RangeError(`RuntimeFailureRecorder maxFileMb is too small; at least ${MIN_RECORD_BYTES} bytes are required.`);
        }
    }

    async initialize() {
        if (!this.config.enabled) return;
        await this.#enqueue(async () => {
            await this.#ensureSafeDirectoryUnsafe();
            await this.#cleanupStaleTempsUnsafe();
            await this.#cleanupFilesUnsafe();
        }).catch(error => this.#logWriteFailure('initialize', error));
        if (!this.eventBus) return;
        this.unsubscribers.push(this.eventBus.on('runtime:failure', event => {
            if (event?.botId && event.botId !== this.botId) return;
            this.record('runtime:failure', event).catch(error => this.#logWriteFailure('record', error));
        }));
    }

    async start() {
        if (!this.config.enabled || this.config.cleanupIntervalMs === 0 || this.cleanupTimer) return;
        this.cleanupTimer = setInterval(() => {
            this.#enqueue(() => this.#cleanupFilesUnsafe()).catch(error => this.#logWriteFailure('cleanup', error));
        }, this.config.cleanupIntervalMs);
        this.cleanupTimer.unref?.();
    }

    async record(eventName, input = {}) {
        if (!this.config.enabled || this.stopping) return null;
        const arrivalAt = this.clock();
        return this.#enqueue(async () => {
            const suppliedFailureId = typeof input.failureId === 'string' && input.failureId.trim() ? input.failureId.trim() : null;
            const failure = createFailureEvent(input, { botId: this.botId, failureId: suppliedFailureId, now: arrivalAt });

            this.#pruneSeenUnsafe(arrivalAt);
            if (suppliedFailureId && this.seenFailureIds.has(suppliedFailureId)) return null;
            if (suppliedFailureId) this.seenFailureIds.set(suppliedFailureId, arrivalAt);

            const signature = failureSignature(failure);
            if (this.config.repeatWindowMs > 0) {
                const existing = this.repeatBuckets.get(signature);
                if (existing && arrivalAt - existing.lastAt <= this.config.repeatWindowMs) {
                    if (existing.pendingRepeatCount > 0
                        && arrivalAt - existing.summaryWindowStartedAt > this.config.repeatWindowMs) {
                        await this.#flushBucketUnsafe(signature, existing, { remove: false });
                    }
                    existing.pendingRepeatCount += 1;
                    existing.lastAt = arrivalAt;
                    existing.lastFailureId = failure.failureId;
                    existing.lastFailure = failure;
                    this.#scheduleRepeatFlushUnsafe();
                    return null;
                }
                if (existing) await this.#flushBucketUnsafe(signature, existing, { remove: true });
                this.repeatBuckets.set(signature, {
                    signature,
                    firstAt: arrivalAt,
                    lastAt: arrivalAt,
                    summaryWindowStartedAt: arrivalAt,
                    pendingRepeatCount: 0,
                    failureId: failure.failureId,
                    lastFailureId: failure.failureId,
                    eventName,
                    failure,
                    lastFailure: failure
                });
                this.#scheduleRepeatFlushUnsafe();
            }

            const inventory = await this.#captureInventory();
            const record = Redactor.sanitize({
                ...failure,
                receivedAt: new Date(arrivalAt).toISOString(),
                capturedAt: new Date(this.clock()).toISOString(),
                event: eventName,
                runtimeState: { gui: this.guiManager?.describeCurrent?.() || null, inventory }
            });
            await this.#persistFullRecordUnsafe(record);
            return record;
        }).catch(error => {
            this.#logWriteFailure(eventName, error);
            return null;
        });
    }

    async #persistFullRecordUnsafe(record) {
        await this.#ensureSafeDirectoryUnsafe();
        const fittedRecord = this.#fitRecordToQuota(record);
        const temp = `${this.lastFile}.${process.pid}.${this.clock()}.${Math.random().toString(16).slice(2)}.tmp`;
        try {
            await fs.writeFile(temp, `${JSON.stringify(fittedRecord, null, 2)}\n`, 'utf8');
            try { await fs.rename(temp, this.lastFile); }
            catch (error) {
                if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
                await fs.rm(this.lastFile, { force: true });
                await fs.rename(temp, this.lastFile);
            }
        } finally {
            try { await fs.rm(temp, { force: true }); }
            catch (error) { this.#logWriteFailure('temp-cleanup', error); }
        }
        await this.#appendJsonLineUnsafe(fittedRecord);
    }

    async #appendJsonLineUnsafe(record) {
        const fittedRecord = this.#fitRecordToQuota(record);
        const line = `${JSON.stringify(fittedRecord)}\n`;
        const bytes = Buffer.byteLength(line);
        await this.#ensureSafeDirectoryUnsafe();
        let currentSize = 0;
        try { currentSize = (await fs.stat(this.activeFile)).size; }
        catch (error) { if (error?.code !== 'ENOENT') throw error; }

        if (currentSize > 0 && currentSize + bytes > this.#maxFileBytes()) {
            await this.#rotateUnsafe();
            await this.#cleanupFilesUnsafe();
        }
        await fs.appendFile(this.activeFile, line, 'utf8');
        await this.#enforceTotalQuotaUnsafe();
    }

    async #rotateUnsafe() {
        let stat;
        try { stat = await fs.stat(this.activeFile); }
        catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
        if (!stat.isFile() || stat.size <= 0) return null;
        const stamp = new Date(this.clock()).toISOString().replace(/[:.]/g, '-');
        for (let attempt = 0; attempt < 10000; attempt += 1) {
            this.rotationSequence += 1;
            const target = path.join(this.directory, `errors-${stamp}-${String(this.rotationSequence).padStart(4, '0')}.jsonl`);
            try { await fs.access(target); }
            catch (error) {
                if (error?.code !== 'ENOENT') throw error;
                await fs.rename(this.activeFile, target);
                return target;
            }
        }
        throw new Error('Could not allocate a unique runtime failure rotation name.');
    }

    #scheduleRepeatFlushUnsafe() {
        clearTimeout(this.repeatTimer);
        this.repeatTimer = null;
        if (this.repeatBuckets.size === 0 || this.config.repeatWindowMs === 0) return;
        const now = this.clock();
        let earliest = Infinity;
        for (const bucket of this.repeatBuckets.values()) {
            const inactivityDue = bucket.lastAt + this.config.repeatWindowMs;
            const periodicDue = bucket.pendingRepeatCount > 0
                ? bucket.summaryWindowStartedAt + this.config.repeatWindowMs
                : Infinity;
            earliest = Math.min(earliest, inactivityDue, periodicDue);
        }
        if (!Number.isFinite(earliest)) return;
        this.repeatTimer = setTimeout(() => {
            this.repeatTimer = null;
            this.#enqueue(() => this.#flushExpiredUnsafe()).catch(error => this.#logWriteFailure('repeat-summary', error));
        }, Math.max(0, earliest - now));
        this.repeatTimer.unref?.();
    }

    async #flushExpiredUnsafe({ all = false } = {}) {
        if (this.config.repeatWindowMs === 0) return;
        const now = this.clock();
        for (const [signature, bucket] of [...this.repeatBuckets.entries()]) {
            if (all) {
                await this.#flushBucketUnsafe(signature, bucket, { remove: true });
                continue;
            }
            const periodicDue = bucket.pendingRepeatCount > 0
                && now - bucket.summaryWindowStartedAt >= this.config.repeatWindowMs;
            const inactive = now - bucket.lastAt >= this.config.repeatWindowMs;
            if (periodicDue) await this.#flushBucketUnsafe(signature, bucket, { remove: false });
            if (inactive) {
                if (bucket.pendingRepeatCount > 0) await this.#flushBucketUnsafe(signature, bucket, { remove: false });
                this.repeatBuckets.delete(signature);
            }
        }
        this.#scheduleRepeatFlushUnsafe();
    }

    async #flushBucketUnsafe(signature, bucket, { remove } = {}) {
        if (remove) this.repeatBuckets.delete(signature);
        const repeatCount = Math.max(0, Number(bucket.pendingRepeatCount || 0));
        if (repeatCount <= 0) return null;
        const firstAt = bucket.summaryWindowStartedAt;
        const lastAt = bucket.lastAt;
        const failure = bucket.lastFailure || bucket.failure;
        const summary = Redactor.sanitize({
            botId: this.botId,
            failureId: bucket.failureId,
            lastFailureId: bucket.lastFailureId,
            event: 'runtime:failure-repeat-summary',
            code: failure.code,
            operation: failure.operation,
            step: failure.step,
            action: failure.action,
            resource: failure.resource,
            message: failure.message,
            repeatCount,
            firstAt: new Date(firstAt).toISOString(),
            lastAt: new Date(lastAt).toISOString(),
            duration: Math.max(0, lastAt - firstAt),
            durationMs: Math.max(0, lastAt - firstAt)
        });
        await this.#appendJsonLineUnsafe(summary);
        bucket.pendingRepeatCount = 0;
        bucket.summaryWindowStartedAt = this.clock();
        this.logger?.debug?.('Runtime failure repeats compacted.', {
            botId: this.botId,
            code: failure.code,
            operation: failure.operation,
            step: failure.step,
            repeatCount
        });
        return summary;
    }

    #pruneSeenUnsafe(now) {
        const keepMs = Math.max(this.config.repeatWindowMs * 3, 60_000);
        for (const [id, at] of this.seenFailureIds) if (now - at > keepMs) this.seenFailureIds.delete(id);
    }

    async #cleanupFilesUnsafe() {
        const files = await this.#listFailureFilesUnsafe();
        const cutoff = this.config.retentionDays > 0 ? this.clock() - this.config.retentionDays * DAY_MS : 0;
        for (const file of files.filter(file => !file.active).sort((a, b) => a.mtimeMs - b.mtimeMs)) {
            if (!(cutoff > 0 && file.mtimeMs < cutoff)) continue;
            await fs.rm(file.filePath, { force: true });
        }
        await this.#enforceTotalQuotaUnsafe();
    }

    async #enforceTotalQuotaUnsafe() {
        const files = await this.#listFailureFilesUnsafe();
        let total = files.reduce((sum, file) => sum + file.size, 0);
        const maxTotalBytes = this.#maxTotalBytes();
        if (total <= maxTotalBytes) return;
        for (const file of files.filter(file => !file.active).sort((a, b) => a.mtimeMs - b.mtimeMs)) {
            if (total <= maxTotalBytes) break;
            await fs.rm(file.filePath, { force: true });
            total -= file.size;
        }
    }

    async #listFailureFilesUnsafe() {
        let entries;
        try { entries = await fs.readdir(this.directory, { withFileTypes: true }); }
        catch (error) {
            if (error?.code === 'ENOENT') return [];
            throw error;
        }
        const files = [];
        for (const entry of entries) {
            if (!entry.isFile()) continue;
            const active = entry.name === Layout.ACTIVE_JOURNAL_FILE;
            if (!active && !Layout.ROTATED_JOURNAL_PATTERN.test(entry.name)) continue;
            const filePath = this.#verifiedChildPath(entry.name);
            const stat = await fs.lstat(filePath);
            if (!stat.isFile() || stat.isSymbolicLink()) continue;
            files.push({ name: entry.name, filePath, size: stat.size, mtimeMs: stat.mtimeMs, active });
        }
        return files;
    }

    #verifiedChildPath(name) {
        return Layout.resolveChild(this.directory, name);
    }

    async #cleanupStaleTempsUnsafe() {
        let entries;
        try { entries = await fs.readdir(this.directory, { withFileTypes: true }); }
        catch (error) { if (error?.code === 'ENOENT') return; throw error; }
        for (const entry of entries) {
            if (!entry.isFile()) continue;
            if (Layout.TEMP_LAST_ERROR_PATTERN.test(entry.name)) {
                const filePath = this.#verifiedChildPath(entry.name);
                const stat = await fs.lstat(filePath);
                if (stat.isFile() && !stat.isSymbolicLink()) await fs.rm(filePath, { force: true });
            }
        }
    }

    async #ensureSafeDirectoryUnsafe() {
        await fs.mkdir(this.baseDirectory, { recursive: true });
        await fs.mkdir(this.directory, { recursive: true });
        const directoryStat = await fs.lstat(this.directory);
        if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
            throw new Error(`Unsafe runtime failure directory for botId ${this.botId}.`);
        }
        const [realBase, realDirectory] = await Promise.all([
            fs.realpath(this.baseDirectory),
            fs.realpath(this.directory)
        ]);
        const relative = path.relative(realBase, realDirectory);
        if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
            throw new Error(`Runtime failure directory escapes configured base for botId ${this.botId}.`);
        }
    }

    #fitRecordToQuota(record) {
        const sanitized = Redactor.sanitize(record);
        const originalBytes = Buffer.byteLength(`${JSON.stringify(sanitized)}\n`);
        if (originalBytes <= this.#maxFileBytes()) return sanitized;

        const trim = (value, max) => {
            if (value === undefined || value === null) return value ?? null;
            const text = String(value);
            return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 13))}...[TRUNCATED]`;
        };
        const diagnostic = sanitized.diagnostic && typeof sanitized.diagnostic === 'object'
            ? {
                code: trim(sanitized.diagnostic.code, 64),
                subsystem: trim(sanitized.diagnostic.subsystem, 64),
                operation: trim(sanitized.diagnostic.operation, 96),
                step: trim(sanitized.diagnostic.step, 96),
                action: trim(sanitized.diagnostic.action, 96),
                resource: trim(sanitized.diagnostic.resource, 96),
                retryable: sanitized.diagnostic.retryable,
                message: trim(sanitized.diagnostic.message, 192),
                stack: trim(sanitized.diagnostic.stack, 384),
                truncated: true
            }
            : null;
        let reduced = Redactor.sanitize({
            failureId: trim(sanitized.failureId, 80),
            botId: trim(sanitized.botId || this.botId, 32),
            connectionGeneration: sanitized.connectionGeneration ?? null,
            source: trim(sanitized.source, 64),
            subsystem: trim(sanitized.subsystem, 64),
            severity: trim(sanitized.severity, 16),
            code: trim(sanitized.code, 64),
            operation: trim(sanitized.operation, 96),
            step: trim(sanitized.step, 96),
            action: trim(sanitized.action, 96),
            resource: trim(sanitized.resource, 96),
            message: trim(sanitized.message, 256),
            retryable: sanitized.retryable,
            correlationId: trim(sanitized.correlationId, 80),
            operationId: trim(sanitized.operationId, 80),
            occurredAt: trim(sanitized.occurredAt, 40),
            receivedAt: trim(sanitized.receivedAt, 40),
            capturedAt: trim(sanitized.capturedAt, 40),
            phase: trim(sanitized.phase, 48),
            retryInMs: sanitized.retryInMs ?? null,
            event: trim(sanitized.event, 64),
            diagnostic,
            details: '[TRUNCATED]',
            runtimeState: '[TRUNCATED]',
            truncated: true,
            originalBytes
        });
        if (Buffer.byteLength(`${JSON.stringify(reduced)}\n`) <= this.#maxFileBytes()) return reduced;

        reduced = Redactor.sanitize({
            failureId: trim(sanitized.failureId, 48),
            botId: trim(sanitized.botId || this.botId, 32),
            code: trim(sanitized.code, 48),
            operation: trim(sanitized.operation, 64),
            step: trim(sanitized.step, 64),
            message: trim(sanitized.message, 96),
            occurredAt: trim(sanitized.occurredAt, 40),
            event: trim(sanitized.event, 48),
            truncated: true,
            originalBytes
        });
        if (Buffer.byteLength(`${JSON.stringify(reduced)}\n`) <= this.#maxFileBytes()) return reduced;
        throw new RangeError('Runtime failure record cannot fit within configured maxFileMb after safe truncation.');
    }

    #maxFileBytes() { return this.config.maxFileMb * 1024 * 1024; }
    #maxTotalBytes() { return this.config.maxTotalMb * 1024 * 1024; }

    #enqueue(task) {
        const next = this.writeChain.then(task);
        this.writeChain = next.catch(error => {
            this.#logWriteFailure('queue', error);
        });
        return next;
    }

    async #captureInventory() {
        const observer = this.inventoryObservationService;
        if (!observer) return null;
        try {
            const snapshot = await observer.capture('runtime-failure') || observer.latest?.();
            if (!snapshot) return null;
            return Redactor.sanitize({
                capturedAt: snapshot.capturedAt,
                views: (snapshot.views || []).map(view => ({
                    source: view.source,
                    windowId: view.windowId ?? null,
                    slotCount: view.slotCount,
                    emptySlotCount: view.emptySlotCount,
                    inventoryStart: view.inventoryStart ?? null,
                    inventoryEnd: view.inventoryEnd ?? null,
                    items: (view.items || []).map(item => ({
                        slot: item.slot,
                        name: item.name || item.carrier || null,
                        displayName: item.displayName || item.displayNameRaw || null,
                        count: item.count,
                        identityComponents: item.identityComponents || [],
                        identityNbt: item.identityNbt || []
                    }))
                }))
            });
        } catch (error) {
            return { captureError: Redactor.redactText(error?.message || String(error)) };
        }
    }

    #logWriteFailure(stage, error) {
        this.logger?.debug?.('Runtime failure diagnostic write skipped.', { botId: this.botId, stage, error: Redactor.sanitize(error) });
    }

    async stop() {
        if (!this.config.enabled) return;
        if (this.stopping) return this.writeChain;
        this.stopping = true;
        for (const off of this.unsubscribers.splice(0)) off();
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = null;
        clearTimeout(this.repeatTimer);
        this.repeatTimer = null;
        await this.#enqueue(async () => {
            await this.#flushExpiredUnsafe({ all: true });
            await this.#cleanupFilesUnsafe();
        }).catch(error => this.#logWriteFailure('stop', error));
        await this.writeChain;
        this.repeatBuckets.clear();
        this.seenFailureIds.clear();
    }

    async destroy() { await this.stop(); }
}

module.exports = RuntimeFailureRecorder;
