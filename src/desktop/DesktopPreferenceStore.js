'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const DEFAULTS = Object.freeze({
    closeToTray: true,
    notifyErrors: true,
    snapshotIntervalMs: 900,
    startBackendOnLaunch: true,
    preventSystemSleepWhileActive: true,
    launchAtLogin: false,
    windowBounds: null,
    windowMaximized: false
});

class DesktopPreferenceStore {
    constructor({ filePath, defaults = DEFAULTS, fsImpl = fs, idFactory = randomUUID } = {}) {
        if (!filePath) throw new TypeError('DesktopPreferenceStore filePath is required');
        if (!fsImpl || typeof fsImpl.writeFile !== 'function' || typeof fsImpl.rename !== 'function') throw new TypeError('DesktopPreferenceStore fsImpl is invalid');
        if (typeof idFactory !== 'function') throw new TypeError('DesktopPreferenceStore idFactory must be a function');
        this.filePath = path.resolve(filePath);
        this.defaults = { ...DEFAULTS, ...(defaults || {}) };
        this.values = { ...this.defaults };
        this.fs = fsImpl;
        this.idFactory = idFactory;
        this.writeQueue = Promise.resolve();
        this.lastCleanupWarning = null;
    }

    async load() {
        try {
            const parsed = JSON.parse(await this.fs.readFile(this.filePath, 'utf8'));
            this.values = this.#normalize({ ...this.defaults, ...(parsed || {}) });
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
            this.values = this.#normalize(this.defaults);
        }
        return this.snapshot();
    }

    snapshot() {
        return { ...this.values };
    }

    get(key) {
        return this.values[key];
    }

    async set(key, value) {
        if (!Object.prototype.hasOwnProperty.call(this.defaults, key)) {
            throw new Error('Unknown desktop preference: ' + key);
        }
        return this.#enqueueMutation({ [key]: value });
    }

    async update(patch = {}) {
        const unknown = Object.keys(patch).filter(key => !Object.prototype.hasOwnProperty.call(this.defaults, key));
        if (unknown.length) throw new Error('Unknown desktop preference(s): ' + unknown.join(', '));
        return this.#enqueueMutation(patch);
    }

    async drain() {
        await this.writeQueue;
        return this.snapshot();
    }

    diagnostics() {
        return { cleanupWarning: this.lastCleanupWarning ? { ...this.lastCleanupWarning } : null };
    }

    #normalize(input) {
        const interval = Number(input.snapshotIntervalMs);
        const rawBounds = input.windowBounds;
        const windowBounds = rawBounds && typeof rawBounds === 'object'
            && [rawBounds.x, rawBounds.y, rawBounds.width, rawBounds.height].every(Number.isFinite)
            ? {
                x: Math.round(rawBounds.x),
                y: Math.round(rawBounds.y),
                width: Math.max(1080, Math.round(rawBounds.width)),
                height: Math.max(700, Math.round(rawBounds.height))
            }
            : null;
        return {
            closeToTray: input.closeToTray !== false,
            notifyErrors: input.notifyErrors !== false,
            snapshotIntervalMs: Number.isFinite(interval) ? Math.max(400, Math.min(5000, Math.round(interval))) : DEFAULTS.snapshotIntervalMs,
            startBackendOnLaunch: input.startBackendOnLaunch !== false,
            preventSystemSleepWhileActive: input.preventSystemSleepWhileActive !== false,
            launchAtLogin: input.launchAtLogin === true,
            windowBounds,
            windowMaximized: input.windowMaximized === true
        };
    }

    #enqueueMutation(patch) {
        const work = async () => {
            const next = this.#normalize({ ...this.values, ...(patch || {}) });
            await this.#persist(next);
            this.values = next;
            return this.snapshot();
        };
        const task = this.writeQueue.then(work, work);
        this.writeQueue = task.then(() => undefined, () => undefined);
        return task;
    }

    async #persist(values) {
        await this.fs.mkdir(path.dirname(this.filePath), { recursive: true });
        const temporary = this.filePath + '.' + process.pid + '.' + this.idFactory() + '.tmp';
        this.lastCleanupWarning = null;
        try {
            await this.fs.writeFile(temporary, JSON.stringify(values, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
            await this.fs.rename(temporary, this.filePath);
        } finally {
            try {
                await this.fs.rm?.(temporary, { force: true });
            } catch (error) {
                this.lastCleanupWarning = Object.freeze({
                    code: error?.code || null,
                    message: error?.message || String(error),
                    tempFile: path.basename(temporary)
                });
            }
        }
    }
}

DesktopPreferenceStore.DEFAULTS = DEFAULTS;
module.exports = DesktopPreferenceStore;
