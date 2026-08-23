'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Redactor = require('../shared/security/Redactor');
const { immutableClone } = require('../shared/utils/object');

const VERSION = 1;
const BOT_ID = /^[a-z0-9][a-z0-9_-]{1,31}$/;
const CONNECTION_STATES = new Set(['CONNECTED', 'DISCONNECTED']);
const DEFAULT_MODE_IDS = new Set(['collector-b5', 'fishing']);
const MODE_STATES = new Set(['ACTIVE', 'PAUSED']);

class DurableIntentStore {
    constructor({
        baseDir = process.cwd(),
        enabled = true,
        file = 'data/runtime/control/intents.json',
        maxBytes = 262144,
        clock = Date.now,
        logger = null,
        modeCatalog = null,
        modeIds = null
    } = {}) {
        if (typeof clock !== 'function') throw new TypeError('clock must be a function');
        if (!Number.isInteger(maxBytes) || maxBytes < 1024) throw new TypeError('maxBytes must be an integer >= 1024');
        this.name = 'DurableIntentStore';
        this.baseDir = path.resolve(baseDir);
        this.enabled = Boolean(enabled);
        this.relativeFile = this.#safeRelative(file);
        this.filePath = path.resolve(this.baseDir, this.relativeFile);
        this.maxBytes = maxBytes;
        this.clock = clock;
        this.logger = logger;
        const supportedModeIds = modeCatalog?.ids?.() || modeIds || [...DEFAULT_MODE_IDS];
        this.modeIds = new Set(supportedModeIds.map(value => String(value || '').trim()).filter(Boolean));
        if (this.modeIds.size === 0) throw new TypeError('DurableIntentStore requires at least one supported mode id.');
        this.state = immutableClone({ version: VERSION, revision: 0, updatedAt: null, intents: {} });
        this.lifecycleState = 'CREATED';
        this.writeQueue = Promise.resolve();
    }

    async initialize() {
        if (this.lifecycleState === 'DESTROYED') throw new Error('DurableIntentStore is destroyed.');
        if (['INITIALIZED', 'RUNNING'].includes(this.lifecycleState)) return this.snapshot();
        if (this.enabled) this.state = await this.#readFromDisk();
        this.lifecycleState = 'INITIALIZED';
        return this.snapshot();
    }

    async start() {
        if (this.lifecycleState === 'CREATED' || this.lifecycleState === 'STOPPED') await this.initialize();
        if (this.lifecycleState === 'DESTROYED') throw new Error('DurableIntentStore is destroyed.');
        this.lifecycleState = 'RUNNING';
    }

    get(botId) {
        this.#botId(botId);
        return this.state.intents[botId] ? immutableClone(this.state.intents[botId]) : null;
    }

    snapshot() {
        return immutableClone(this.state);
    }

    setIntent(botId, intent, { expectedRevision = null } = {}) {
        return this.#enqueue(async () => {
            this.#writable();
            const id = this.#botId(botId);
            const current = this.state.intents[id] || null;
            if (expectedRevision !== null && Number(expectedRevision) !== Number(current?.revision || 0)) {
                const error = new Error(`Intent revision conflict for ${id}.`);
                error.code = 'INTENT_REVISION_CONFLICT';
                throw error;
            }
            const normalized = this.#intent(id, intent, (current?.revision || 0) + 1);
            const intents = { ...this.state.intents, [id]: normalized };
            await this.#commit(intents);
            return this.get(id);
        });
    }

    patchIntent(botId, patch, options = {}) {
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return Promise.reject(new TypeError('intent patch must be an object'));
        return this.#enqueue(async () => {
            this.#writable();
            const id = this.#botId(botId);
            const current = this.state.intents[id] || {
                desiredConnection: 'DISCONNECTED',
                desiredMode: null,
                modeState: null,
                source: 'system'
            };
            if (options.expectedRevision !== null && options.expectedRevision !== undefined
                && Number(options.expectedRevision) !== Number(current.revision || 0)) {
                const error = new Error(`Intent revision conflict for ${id}.`);
                error.code = 'INTENT_REVISION_CONFLICT';
                throw error;
            }
            const normalized = this.#intent(id, { ...current, ...patch }, (current.revision || 0) + 1);
            const intents = { ...this.state.intents, [id]: normalized };
            await this.#commit(intents);
            return this.get(id);
        });
    }

    remove(botId, { expectedRevision = null } = {}) {
        return this.#enqueue(async () => {
            this.#writable();
            const id = this.#botId(botId);
            const current = this.state.intents[id];
            if (!current) return false;
            if (expectedRevision !== null && Number(expectedRevision) !== Number(current.revision)) {
                const error = new Error(`Intent revision conflict for ${id}.`);
                error.code = 'INTENT_REVISION_CONFLICT';
                throw error;
            }
            const intents = { ...this.state.intents };
            delete intents[id];
            await this.#commit(intents);
            return true;
        });
    }

    async stop() {
        await this.writeQueue;
        if (this.lifecycleState !== 'DESTROYED') this.lifecycleState = 'STOPPED';
    }

    async destroy() {
        if (this.lifecycleState === 'DESTROYED') return;
        await this.stop();
        this.lifecycleState = 'DESTROYED';
    }

    #enqueue(work) {
        const task = this.writeQueue.then(work, work);
        this.writeQueue = task.then(
            () => undefined,
            error => {
                this.logger?.error?.('Durable intent mutation failed.', { error });
            }
        );
        return task;
    }

    async #commit(intents) {
        const next = immutableClone({
            version: VERSION,
            revision: this.state.revision + 1,
            updatedAt: this.#timestamp(),
            intents
        });
        this.#document(next);
        if (this.enabled) await this.#atomicWrite(next);
        this.state = next;
    }

    async #readFromDisk() {
        await this.#assertSafeParents();
        let stat;
        try {
            stat = await fs.lstat(this.filePath);
        } catch (error) {
            if (error.code === 'ENOENT') return immutableClone({ version: VERSION, revision: 0, updatedAt: null, intents: {} });
            throw error;
        }
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Durable intent path must be a regular file, not a link.');
        if (stat.size > this.maxBytes) throw new Error(`Durable intent file exceeds ${this.maxBytes} bytes.`);
        const text = await fs.readFile(this.filePath, 'utf8');
        const document = JSON.parse(text);
        this.#document(document);
        return immutableClone(document);
    }

    async #atomicWrite(document) {
        const directory = path.dirname(this.filePath);
        await this.#assertSafeParents();
        await fs.mkdir(directory, { recursive: true });
        await this.#assertSafeParents();
        try {
            const existing = await fs.lstat(this.filePath);
            if (!existing.isFile() || existing.isSymbolicLink()) throw new Error('Durable intent target must be a regular file.');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        const content = `${JSON.stringify(document, null, 2)}\n`;
        if (Buffer.byteLength(content) > this.maxBytes) throw new Error(`Durable intent snapshot exceeds ${this.maxBytes} bytes.`);
        const temp = `${this.filePath}.${process.pid}.${this.state.revision + 1}.${randomUUID()}.tmp`;
        let handle = null;
        try {
            handle = await fs.open(temp, 'wx');
            await handle.writeFile(content, 'utf8');
            await handle.sync();
            await handle.close();
            handle = null;
            await fs.rename(temp, this.filePath);
        } finally {
            if (handle) await handle.close();
            try {
                await fs.rm(temp, { force: true });
            } catch (error) {
                this.logger?.warn?.('Temporary durable intent file cleanup failed.', { file: temp, error });
            }
        }
    }

    #document(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Durable intent document must be an object.');
        const allowed = new Set(['version', 'revision', 'updatedAt', 'intents']);
        for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`Unknown durable intent document key: ${key}`);
        if (value.version !== VERSION) throw new Error(`Unsupported durable intent version: ${value.version}`);
        if (!Number.isInteger(value.revision) || value.revision < 0) throw new Error('Durable intent revision must be a non-negative integer.');
        if (value.updatedAt !== null && !Number.isFinite(Date.parse(value.updatedAt))) throw new Error('Durable intent updatedAt is invalid.');
        if (!value.intents || typeof value.intents !== 'object' || Array.isArray(value.intents)) throw new Error('Durable intents must be an object.');
        for (const [botId, intent] of Object.entries(value.intents)) {
            const normalized = this.#intent(botId, intent, intent?.revision);
            const normalizedKeys = Object.keys(normalized).sort();
            const actualKeys = Object.keys(intent || {}).sort();
            if (normalizedKeys.length !== actualKeys.length
                || normalizedKeys.some((key, index) => key !== actualKeys[index])
                || normalizedKeys.some(key => normalized[key] !== intent[key])) {
                throw new Error(`Durable intent is not canonical: ${botId}`);
            }
        }
    }

    #intent(botId, value, revision) {
        this.#botId(botId);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Intent for ${botId} must be an object.`);
        const allowed = new Set(['botId', 'desiredConnection', 'desiredMode', 'modeState', 'revision', 'updatedAt', 'source']);
        for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`Unknown intent key for ${botId}: ${key}`);
        const desiredConnection = value.desiredConnection;
        const desiredMode = value.desiredMode === undefined ? null : value.desiredMode;
        const modeState = value.modeState === undefined ? null : value.modeState;
        if (!CONNECTION_STATES.has(desiredConnection)) throw new Error(`Intent ${botId}.desiredConnection is invalid.`);
        if (desiredMode !== null && !this.modeIds.has(desiredMode)) throw new Error(`Intent ${botId}.desiredMode is invalid.`);
        if (desiredMode === null && modeState !== null) throw new Error(`Intent ${botId}.modeState must be null without a mode.`);
        if (desiredMode !== null && !MODE_STATES.has(modeState)) throw new Error(`Intent ${botId}.modeState is invalid.`);
        if (desiredMode !== null && desiredConnection !== 'CONNECTED') throw new Error(`Intent ${botId} cannot request a mode while disconnected.`);
        if (!Number.isInteger(revision) || revision < 1) throw new Error(`Intent ${botId}.revision must be a positive integer.`);
        const updatedAt = value.updatedAt && Number.isFinite(Date.parse(value.updatedAt)) ? value.updatedAt : this.#timestamp();
        const source = String(Redactor.sanitize(value.source || 'system')).slice(0, 128);
        return {
            botId,
            desiredConnection,
            desiredMode,
            modeState,
            revision,
            updatedAt,
            source
        };
    }

    #writable() {
        if (!['INITIALIZED', 'RUNNING'].includes(this.lifecycleState)) throw new Error('DurableIntentStore is not initialized.');
    }

    #botId(value) {
        const botId = String(value || '').trim();
        if (!BOT_ID.test(botId)) throw new TypeError('Durable intent botId is invalid.');
        return botId;
    }

    #safeRelative(value) {
        if (typeof value !== 'string' || !value.trim() || path.isAbsolute(value) || /^[a-z]:[\\/]/i.test(value)) {
            throw new TypeError('Durable intent file must be a safe relative path.');
        }
        const normalized = value.replace(/\\/g, '/');
        if (normalized.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
            throw new TypeError('Durable intent file must be a safe relative path.');
        }
        return normalized;
    }

    async #assertSafeParents() {
        const relativeDirectory = path.dirname(this.relativeFile).replace(/\\/g, '/');
        if (relativeDirectory === '.') return;
        let current = this.baseDir;
        for (const segment of relativeDirectory.split('/')) {
            current = path.join(current, segment);
            try {
                const stat = await fs.lstat(current);
                if (stat.isSymbolicLink() || !stat.isDirectory()) {
                    throw new Error(`Durable intent parent must be a real directory: ${segment}`);
                }
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
        }
    }

    #timestamp() {
        const date = new Date(this.clock());
        if (!Number.isFinite(date.getTime())) throw new Error('Durable intent clock returned invalid time.');
        return date.toISOString();
    }
}

DurableIntentStore.VERSION = VERSION;
module.exports = DurableIntentStore;
