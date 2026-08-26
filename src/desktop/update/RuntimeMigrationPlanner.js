'use strict';

class RuntimeMigrationPlanner {
    constructor({ compareVersions } = {}) {
        if (typeof compareVersions !== 'function') throw new TypeError('RuntimeMigrationPlanner compareVersions is required.');
        this.compareVersions = compareVersions;
    }

    plan({ migrations = [], fromVersion = null, toVersion = null } = {}) {
        const selected = [];
        for (const migration of migrations) {
            if (!migration?.target || typeof migration.run !== 'function') throw new TypeError('Invalid runtime migration descriptor.');
            const upper = this.compareVersions(toVersion, migration.target);
            if (upper !== null && upper < 0) continue;
            const lower = this.compareVersions(fromVersion, migration.target);
            if (lower !== null && lower >= 0) continue;
            selected.push(migration);
        }
        return Object.freeze(selected.map(item => Object.freeze({ ...item })));
    }
}

module.exports = RuntimeMigrationPlanner;
