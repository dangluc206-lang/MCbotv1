'use strict';

const Result = require('../shared/result/Result');
const Status = require('../shared/result/Status');

class ConfigurationService {
    constructor({ loader, validator, registry, crossValidator = null, specs = [], logger = null }) {
        this.loader = loader;
        this.validator = validator;
        this.registry = registry;
        this.crossValidator = crossValidator;
        this.specs = new Map(specs.map(spec => [spec.key, spec]));
        this.logger = logger;
    }

    async loadAll(specs = [...this.specs.values()], { botProfiles = [] } = {}) {
        try {
            const normalized = this.#normalizeSpecs(specs);
            const entries = await Promise.all(normalized.map(async spec => {
                const value = await this.loader.load(spec.file);
                this.validator.assertValid(spec.schema, value);
                return [spec.key, value];
            }));
            const candidate = Object.fromEntries(entries);
            this.crossValidator?.assertValid(candidate, { botProfiles, requireComplete: true });
            this.registry.replaceAll(candidate);
            return Result.ok(this.registry.snapshot(), {
                groups: entries.length,
                schemas: normalized.length,
                crossValidated: Boolean(this.crossValidator)
            });
        } catch (error) {
            this.logger?.error?.('Configuration set load failed.', { error });
            return Result.fail(Status.FAILED, error.message, error, {
                groups: 0,
                published: false
            });
        }
    }

    async load(key, filePath, schemaName = null) {
        try {
            const schema = this.#schemaFor(key, schemaName);
            const value = await this.loader.load(filePath);
            this.validator.assertValid(schema, value);
            this.registry.register(key, value);
            return Result.ok(value, { key, filePath, schema });
        } catch (error) {
            this.logger?.error?.('Configuration load failed.', { key, filePath, error });
            return Result.fail(Status.FAILED, error.message, error, { key, filePath });
        }
    }

    async reload(key, filePath, schemaName = null, {
        botProfiles = [],
        apply = null,
        rollback = null
    } = {}) {
        const previous = this.registry.snapshot();
        let applied = false;
        try {
            if (!Object.prototype.hasOwnProperty.call(previous, key)) {
                throw new Error(`Configuration key is not loaded: ${key}`);
            }
            const schema = this.#schemaFor(key, schemaName);
            const value = await this.loader.load(filePath);
            this.validator.assertValid(schema, value);
            const candidate = { ...previous, [key]: value };
            this.crossValidator?.assertValid(candidate, { botProfiles, requireComplete: true });
            if (typeof apply === 'function') {
                applied = true;
                await apply(value, previous[key]);
            }
            this.registry.replaceAll(candidate);
            return Result.ok(value, {
                key,
                filePath,
                schema,
                reloaded: true,
                crossValidated: Boolean(this.crossValidator)
            });
        } catch (error) {
            let rollbackError = null;
            if (applied && typeof rollback === 'function') {
                try {
                    await rollback(previous[key]);
                } catch (caught) {
                    rollbackError = caught;
                    this.logger?.error?.('Configuration runtime rollback failed.', { key, filePath, error: caught });
                }
            }
            this.logger?.error?.('Configuration reload failed.', { key, filePath, error, rollbackError });
            return Result.fail(Status.FAILED, error.message, error, {
                key,
                filePath,
                reloaded: false,
                rollbackFailed: Boolean(rollbackError),
                rollbackError: rollbackError?.message || null
            });
        }
    }

    get(key) {
        return this.registry.get(key);
    }

    has(key) {
        return this.registry.has(key);
    }

    #schemaFor(key, schemaName) {
        const schema = schemaName || this.specs.get(key)?.schema;
        if (typeof schema !== 'string' || !schema.trim()) {
            throw new Error(`Schema is required for configuration key: ${key}`);
        }
        return schema;
    }

    #normalizeSpecs(specs) {
        if (!Array.isArray(specs) || specs.length === 0) throw new Error('Configuration specs must be a non-empty array.');
        const keys = new Set();
        return specs.map(spec => {
            if (!spec || typeof spec.key !== 'string' || typeof spec.file !== 'string' || typeof spec.schema !== 'string') {
                throw new TypeError('Each configuration spec requires key, file and schema strings.');
            }
            if (keys.has(spec.key)) throw new Error(`Duplicate configuration spec key: ${spec.key}`);
            keys.add(spec.key);
            return spec;
        });
    }
}

module.exports = ConfigurationService;
