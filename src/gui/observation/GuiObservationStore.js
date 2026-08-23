'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

class GuiObservationStore {
    constructor({ baseDir, botId, logger = null }) {
        if (typeof baseDir !== 'string' || !baseDir) throw new TypeError('baseDir is required.');
        if (typeof botId !== 'string' || !botId) throw new TypeError('botId is required.');
        this.directory = path.join(baseDir, botId);
        this.logger = logger;
        this.writeTail = Promise.resolve();
    }

    async upsert(key, normalized, { source = null, aliases = [] } = {}) {
        return this.#serializeWrite(key, async () => {
            await fs.mkdir(this.directory, { recursive: true });
            const file = path.join(this.directory, `${key}.json`);
            let previous = await this.#read(file);
            let migratedFrom = null;

            if (!previous) {
                for (const alias of this.#validAliases(key, aliases)) {
                    const aliasFile = path.join(this.directory, `${alias}.json`);
                    const aliasRecord = await this.#read(aliasFile);
                    if (!aliasRecord) continue;
                    previous = aliasRecord;
                    migratedFrom = alias;
                    break;
                }
            }

            const now = new Date().toISOString();
            const structureChanged = previous
                ? JSON.stringify(previous.structure) !== JSON.stringify(normalized.structure)
                : true;

            const record = {
                id: key,
                identity: normalized.identity,
                route: source ? {
                    commandKey: source.commandKey || null,
                    command: source.command || null,
                    clicks: Array.isArray(source.clicks) ? [...source.clicks] : [],
                    actions: Array.isArray(source.actions) ? [...source.actions] : [],
                    source: source.source || null
                } : (previous?.route || null),
                firstSeenAt: previous?.firstSeenAt || now,
                lastSeenAt: now,
                seenCount: Number(previous?.seenCount || 0) + 1,
                revision: previous ? Number(previous.revision || 1) + (structureChanged ? 1 : 0) : 1,
                structure: normalized.structure,
                latest: normalized.latest,
                learned: previous?.learned || {},
                semantic: previous?.semantic || {},
                lastSource: source || previous?.lastSource || null
            };

            await this.#writeAtomic(file, record);

            const aliasesToRemove = [];
            if (migratedFrom) aliasesToRemove.push(migratedFrom);
            for (const alias of this.#validAliases(key, aliases)) {
                if (alias === migratedFrom) continue;
                const aliasFile = path.join(this.directory, `${alias}.json`);
                const aliasRecord = await this.#read(aliasFile);
                if (!aliasRecord) continue;
                if (!this.#sameIdentity(aliasRecord.identity, normalized.identity)) continue;
                aliasesToRemove.push(alias);
            }

            for (const alias of new Set(aliasesToRemove)) {
                await fs.rm(path.join(this.directory, `${alias}.json`), { force: true });
            }

            await this.#updateIndex(key, record, aliasesToRemove);
            this.logger?.debug?.('GUI observation saved.', {
                key,
                migratedFrom,
                revision: record.revision,
                structureChanged
            });
            return { record, structureChanged, created: !previous, migratedFrom };
        });
    }

    async drain() {
        await this.writeTail;
    }

    async listRecords() {
        try {
            await fs.mkdir(this.directory, { recursive: true });
            const names = await fs.readdir(this.directory);
            const records = [];
            for (const name of names) {
                if (!name.endsWith('.json') || name === 'index.json' || name === 'knowledge.json') continue;
                const record = await this.#read(path.join(this.directory, name));
                if (record?.id) records.push(record);
            }
            return records;
        } catch (error) {
            if (error.code === 'ENOENT') return [];
            throw error;
        }
    }

    async readKnowledge() {
        return await this.#read(path.join(this.directory, 'knowledge.json')) || { version: 1, items: {} };
    }

    async updateGlobalItem(logicalId, entry) {
        return this.#serializeWrite('knowledge', async () => {
            await fs.mkdir(this.directory, { recursive: true });
            const file = path.join(this.directory, 'knowledge.json');
            const knowledge = await this.#read(file) || { version: 1, items: {} };
            knowledge.items = { ...(knowledge.items || {}), [logicalId]: entry };
            knowledge.updatedAt = new Date().toISOString();
            await this.#writeAtomic(file, knowledge);
            return knowledge;
        });
    }

    async removeGlobalItem(logicalId) {
        return this.#serializeWrite('knowledge', async () => {
            await fs.mkdir(this.directory, { recursive: true });
            const file = path.join(this.directory, 'knowledge.json');
            const knowledge = await this.#read(file) || { version: 1, items: {} };
            const items = { ...(knowledge.items || {}) };
            delete items[logicalId];
            knowledge.items = items;
            knowledge.updatedAt = new Date().toISOString();
            await this.#writeAtomic(file, knowledge);
            return knowledge;
        });
    }

    async readRecord(key) {
        if (typeof key !== 'string' || !key) return null;
        return this.#read(path.join(this.directory, `${key}.json`));
    }

    async updateLearned(key, roleId, entry) {
        return this.#serializeWrite(key, async () => {
            const file = path.join(this.directory, `${key}.json`);
            const record = await this.#read(file);
            if (!record) return null;
            record.learned = { ...(record.learned || {}), [roleId]: entry };
            await this.#writeAtomic(file, record);
            await this.#updateIndex(key, record);
            return record;
        });
    }

    async updateSemantic(key, namespace, value) {
        return this.#serializeWrite(key, async () => {
            const file = path.join(this.directory, `${key}.json`);
            const record = await this.#read(file);
            if (!record) return null;
            record.semantic = { ...(record.semantic || {}), [namespace]: value };
            await this.#writeAtomic(file, record);
            await this.#updateIndex(key, record);
            return record;
        });
    }

    async invalidateSemantic(key, namespace = null) {
        return this.#serializeWrite(key, async () => {
            const file = path.join(this.directory, `${key}.json`);
            const record = await this.#read(file);
            if (!record) return null;
            if (namespace) {
                const semantic = { ...(record.semantic || {}) };
                delete semantic[namespace];
                record.semantic = semantic;
            } else {
                record.semantic = {};
            }
            await this.#writeAtomic(file, record);
            await this.#updateIndex(key, record);
            return record;
        });
    }

    async #updateIndex(key, record, removeKeys = []) {
        const file = path.join(this.directory, 'index.json');
        const index = await this.#read(file) || { version: 1, guis: {} };
        for (const oldKey of removeKeys) delete index.guis[oldKey];
        index.guis[key] = {
            identity: record.identity,
            route: record.route,
            firstSeenAt: record.firstSeenAt,
            lastSeenAt: record.lastSeenAt,
            seenCount: record.seenCount,
            revision: record.revision
        };
        await this.#writeAtomic(file, index);
    }

    #validAliases(key, aliases) {
        return [...new Set((Array.isArray(aliases) ? aliases : [])
            .filter(alias => typeof alias === 'string' && alias && alias !== key))];
    }

    #sameIdentity(a, b) {
        return JSON.stringify(a || null) === JSON.stringify(b || null);
    }

    async #read(file) {
        try {
            return JSON.parse(await fs.readFile(file, 'utf8'));
        } catch (error) {
            if (error.code === 'ENOENT') return null;
            throw error;
        }
    }

    async #writeAtomic(file, value) {
        const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        try {
            await fs.rename(temp, file);
        } catch (error) {
            if (!['EEXIST', 'EPERM'].includes(error.code)) {
                await this.#cleanupTemp(temp, 'rename-failed');
                throw error;
            }
            await fs.rm(file, { force: true });
            await fs.rename(temp, file);
        }
    }

    async #cleanupTemp(temp, stage) {
        try {
            await fs.rm(temp, { force: true });
        } catch (error) {
            this.logger?.debug?.('GUI observation temp cleanup failed.', { stage, temp: path.basename(temp), error });
        }
    }

    #serializeWrite(key, task) {
        const current = this.writeTail.then(task);
        this.writeTail = current.catch(error => {
            this.logger?.warn?.('GUI observation write failed; queue recovered for the next write.', { key, error });
        });
        return current;
    }
}

module.exports = GuiObservationStore;
