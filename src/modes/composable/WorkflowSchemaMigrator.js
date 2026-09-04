'use strict';

const CURRENT_SCHEMA_VERSION = 1;

class WorkflowSchemaMigrator {
    constructor({ currentVersion = CURRENT_SCHEMA_VERSION } = {}) {
        this.currentVersion = currentVersion;
    }

    migrate(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw this.#error('WORKFLOW_MIGRATION_INVALID', 'Workflow definition must be an object.');
        let result = JSON.parse(JSON.stringify(value));
        let version = Number.isInteger(result.schemaVersion) ? result.schemaVersion : 0;
        if (version < 0 || version > this.currentVersion) throw this.#error('WORKFLOW_SCHEMA_UNSUPPORTED', `Unsupported workflow schema version: ${version}`);
        while (version < this.currentVersion) {
            result = this.#migrateOne(result, version);
            version += 1;
            result.schemaVersion = version;
        }
        result.schemaVersion = this.currentVersion;
        return Object.freeze(result);
    }

    #migrateOne(value, version) {
        if (version === 0) {
            const result = { ...value };
            if (!result.workflow) result.workflow = {};
            if (result.workflow.loop && !Array.isArray(result.workflow.loop.steps)) result.workflow.loop = { ...result.workflow.loop, steps: [] };
            if (result.workflow.start == null) result.workflow.start = [];
            if (result.workflow.stop == null) result.workflow.stop = [];
            return result;
        }
        throw this.#error('WORKFLOW_MIGRATION_MISSING', `No migration registered for schema version ${version}.`);
    }

    #error(code, message) {
        const error = new Error(message);
        error.code = code;
        return error;
    }
}

WorkflowSchemaMigrator.CURRENT_SCHEMA_VERSION = CURRENT_SCHEMA_VERSION;
module.exports = WorkflowSchemaMigrator;
