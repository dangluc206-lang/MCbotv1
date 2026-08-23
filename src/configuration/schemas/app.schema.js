'use strict';

const path = require('node:path');

const MIN_RUNTIME_FAILURE_FILE_MB = 768 / (1024 * 1024);

function rejectUnknown(value, allowed, label, errors) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const keys = new Set(allowed);
    for (const key of Object.keys(value)) {
        if (!keys.has(key)) errors.push(`${label}.${key} is not allowed`);
    }
}

function isSafeRelativeDirectory(value) {
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f]/.test(value)) return false;
    const trimmed = value.trim();
    if (path.isAbsolute(trimmed) || /^[a-z]:[\\/]/i.test(trimmed) || /^[/\\]{2}/.test(trimmed)) return false;
    const segments = trimmed.replace(/\\/g, '/').split('/');
    return segments.every(segment => segment && segment !== '.' && segment !== '..');
}

module.exports = value => {
    const errors = [];
    const levels = ['debug', 'info', 'warn', 'error'];

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { valid: false, errors: ['app config must be an object'] };
    }
    rejectUnknown(value, [
        'logLevel', 'logging', 'commandIntervalMs', 'shutdownTimeoutMs',
        'operations', 'multiBot', 'controlPlane', 'diagnostics'
    ], 'app', errors);
    if (value.logLevel !== undefined && !levels.includes(value.logLevel)) {
        errors.push('logLevel is invalid');
    }
    for (const key of ['commandIntervalMs', 'shutdownTimeoutMs']) {
        if (value[key] !== undefined && (!Number.isFinite(value[key]) || value[key] < 0)) {
            errors.push(`${key} must be a non-negative number`);
        }
    }

    if (value.operations !== undefined) {
        const operations = value.operations;
        if (!operations || typeof operations !== 'object' || Array.isArray(operations)) {
            errors.push('operations must be an object');
        } else {
            rejectUnknown(operations, [
                'maxPending', 'defaultQueueWaitTimeoutMs',
                'defaultExecutionTimeoutMs', 'shutdownDrainTimeoutMs'
            ], 'operations', errors);
            if (!Number.isInteger(operations.maxPending) || operations.maxPending < 1) {
                errors.push('operations.maxPending must be a positive integer');
            }
            for (const key of [
                'defaultQueueWaitTimeoutMs',
                'defaultExecutionTimeoutMs',
                'shutdownDrainTimeoutMs'
            ]) {
                if (!Number.isFinite(operations[key]) || operations[key] < 0) {
                    errors.push(`operations.${key} must be a non-negative number`);
                }
            }
        }
    }


    if (value.multiBot !== undefined) {
        if (!value.multiBot || typeof value.multiBot !== 'object' || Array.isArray(value.multiBot)) {
            errors.push('multiBot must be an object');
        } else {
            rejectUnknown(value.multiBot, [
                'connectionStartSpacingMs', 'postSuccessSpacingMs',
                'transientFailureCooldownMs', 'connectionResetCooldownMs',
                'lostConnectionCooldownMs', 'loginTooFastCooldownMs'
            ], 'multiBot', errors);
            for (const key of [
                'connectionStartSpacingMs',
                'postSuccessSpacingMs',
                'transientFailureCooldownMs',
                'connectionResetCooldownMs',
                'lostConnectionCooldownMs',
                'loginTooFastCooldownMs'
            ]) {
                if (value.multiBot[key] !== undefined
                    && (!Number.isFinite(value.multiBot[key]) || value.multiBot[key] < 0)) {
                    errors.push(`multiBot.${key} must be a non-negative number`);
                }
            }
        }
    }

    if (value.controlPlane !== undefined) {
        const controlPlane = value.controlPlane;
        if (!controlPlane || typeof controlPlane !== 'object' || Array.isArray(controlPlane)) {
            errors.push('controlPlane must be an object');
        } else {
            rejectUnknown(controlPlane, [
                'enabled', 'intentFile', 'maxBytes', 'concurrency', 'maxPending',
                'taskTimeoutMs', 'shutdownDrainMs'
            ], 'controlPlane', errors);
            if (typeof controlPlane.enabled !== 'boolean') errors.push('controlPlane.enabled must be boolean');
            if (!isSafeRelativeDirectory(controlPlane.intentFile)) errors.push('controlPlane.intentFile must be a safe relative path');
            if (!Number.isInteger(controlPlane.maxBytes) || controlPlane.maxBytes < 1024) errors.push('controlPlane.maxBytes must be an integer >= 1024');
            for (const key of ['concurrency', 'maxPending']) {
                if (!Number.isInteger(controlPlane[key]) || controlPlane[key] < 1) errors.push(`controlPlane.${key} must be a positive integer`);
            }
            for (const key of ['taskTimeoutMs', 'shutdownDrainMs']) {
                if (!Number.isFinite(controlPlane[key]) || controlPlane[key] < 0) errors.push(`controlPlane.${key} must be a non-negative number`);
            }
        }
    }

    if (value.logging !== undefined) {
        if (!value.logging || typeof value.logging !== 'object' || Array.isArray(value.logging)) {
            errors.push('logging must be an object');
        } else {
            rejectUnknown(value.logging, ['console', 'file', 'coalesce'], 'logging', errors);
            const consoleConfig = value.logging.console;
            if (consoleConfig !== undefined) {
                if (!consoleConfig || typeof consoleConfig !== 'object' || Array.isArray(consoleConfig)) {
                    errors.push('logging.console must be an object');
                } else {
                    rejectUnknown(consoleConfig, ['level', 'format', 'meta', 'maxMetaFields'], 'logging.console', errors);
                    if (consoleConfig.level !== undefined && !levels.includes(consoleConfig.level)) errors.push('logging.console.level is invalid');
                    if (consoleConfig.format !== undefined && !['compact', 'json'].includes(consoleConfig.format)) errors.push('logging.console.format is invalid');
                    if (consoleConfig.meta !== undefined && !['none', 'summary', 'full'].includes(consoleConfig.meta)) errors.push('logging.console.meta is invalid');
                    if (consoleConfig.maxMetaFields !== undefined && (!Number.isInteger(consoleConfig.maxMetaFields) || consoleConfig.maxMetaFields < 0)) errors.push('logging.console.maxMetaFields must be a non-negative integer');
                }
            }


            const coalesceConfig = value.logging.coalesce;
            if (coalesceConfig !== undefined) {
                if (!coalesceConfig || typeof coalesceConfig !== 'object' || Array.isArray(coalesceConfig)) {
                    errors.push('logging.coalesce must be an object');
                } else {
                    rejectUnknown(coalesceConfig, ['enabled', 'windowMs', 'maxBuckets', 'levels'], 'logging.coalesce', errors);
                    if (coalesceConfig.enabled !== undefined && typeof coalesceConfig.enabled !== 'boolean') errors.push('logging.coalesce.enabled must be boolean');
                    if (coalesceConfig.windowMs !== undefined && (!Number.isFinite(coalesceConfig.windowMs) || coalesceConfig.windowMs < 0)) errors.push('logging.coalesce.windowMs must be a non-negative number');
                    if (coalesceConfig.maxBuckets !== undefined && (!Number.isInteger(coalesceConfig.maxBuckets) || coalesceConfig.maxBuckets < 1)) errors.push('logging.coalesce.maxBuckets must be a positive integer');
                    if (coalesceConfig.levels !== undefined && (!Array.isArray(coalesceConfig.levels) || coalesceConfig.levels.some(level => !levels.includes(level)))) errors.push('logging.coalesce.levels contains an invalid log level');
                }
            }

            const fileConfig = value.logging.file;
            if (fileConfig !== undefined) {
                if (!fileConfig || typeof fileConfig !== 'object' || Array.isArray(fileConfig)) {
                    errors.push('logging.file must be an object');
                } else {
                    rejectUnknown(fileConfig, [
                        'enabled', 'level', 'directory', 'prefix', 'bufferFlushMs',
                        'bufferMaxBytes', 'retentionDays', 'maxTotalMb', 'cleanupIntervalMs'
                    ], 'logging.file', errors);
                    if (fileConfig.enabled !== undefined && typeof fileConfig.enabled !== 'boolean') errors.push('logging.file.enabled must be boolean');
                    if (fileConfig.level !== undefined && !levels.includes(fileConfig.level)) errors.push('logging.file.level is invalid');
                    if (fileConfig.directory !== undefined && (typeof fileConfig.directory !== 'string' || !fileConfig.directory.trim())) errors.push('logging.file.directory must be a non-empty string');
                    if (fileConfig.prefix !== undefined && (typeof fileConfig.prefix !== 'string' || !fileConfig.prefix.trim())) errors.push('logging.file.prefix must be a non-empty string');
                    if (fileConfig.bufferFlushMs !== undefined && (!Number.isFinite(fileConfig.bufferFlushMs) || fileConfig.bufferFlushMs < 0)) errors.push('logging.file.bufferFlushMs must be a non-negative number');
                    if (fileConfig.bufferMaxBytes !== undefined && (!Number.isFinite(fileConfig.bufferMaxBytes) || fileConfig.bufferMaxBytes < 1024)) errors.push('logging.file.bufferMaxBytes must be at least 1024');
                    if (fileConfig.retentionDays !== undefined && (!Number.isFinite(fileConfig.retentionDays) || fileConfig.retentionDays < 0)) errors.push('logging.file.retentionDays must be a non-negative number');
                    if (fileConfig.maxTotalMb !== undefined && (!Number.isFinite(fileConfig.maxTotalMb) || fileConfig.maxTotalMb < 1)) errors.push('logging.file.maxTotalMb must be at least 1');
                    if (fileConfig.cleanupIntervalMs !== undefined && (!Number.isFinite(fileConfig.cleanupIntervalMs) || fileConfig.cleanupIntervalMs < 60000)) errors.push('logging.file.cleanupIntervalMs must be at least 60000');
                }
            }
        }
    }

    if (!value.diagnostics || typeof value.diagnostics !== 'object' || Array.isArray(value.diagnostics)) {
        errors.push('diagnostics must be an object');
    } else {
        rejectUnknown(value.diagnostics, ['runtimeFailures', 'circuitBreaker'], 'diagnostics', errors);
        const runtimeFailures = value.diagnostics.runtimeFailures;
        if (!runtimeFailures || typeof runtimeFailures !== 'object' || Array.isArray(runtimeFailures)) {
            errors.push('diagnostics.runtimeFailures must be an object');
        } else {
            rejectUnknown(runtimeFailures, [
                'enabled', 'directory', 'repeatWindowMs', 'connectionAggregationMs',
                'maxFileMb', 'maxTotalMb', 'retentionDays', 'cleanupIntervalMs'
            ], 'diagnostics.runtimeFailures', errors);
            if (typeof runtimeFailures.enabled !== 'boolean') errors.push('diagnostics.runtimeFailures.enabled must be boolean');
            if (!isSafeRelativeDirectory(runtimeFailures.directory)) errors.push('diagnostics.runtimeFailures.directory must be a safe relative path');
            for (const key of ['repeatWindowMs', 'connectionAggregationMs', 'cleanupIntervalMs']) {
                if (!Number.isFinite(runtimeFailures[key]) || runtimeFailures[key] < 0) {
                    errors.push(`diagnostics.runtimeFailures.${key} must be a non-negative number`);
                }
            }
            for (const key of ['maxFileMb', 'maxTotalMb']) {
                if (!Number.isFinite(runtimeFailures[key]) || runtimeFailures[key] <= 0) {
                    errors.push(`diagnostics.runtimeFailures.${key} must be greater than 0`);
                }
            }
            if (Number.isFinite(runtimeFailures.maxFileMb) && runtimeFailures.maxFileMb < MIN_RUNTIME_FAILURE_FILE_MB) {
                errors.push(`diagnostics.runtimeFailures.maxFileMb must allow at least 768 bytes (${MIN_RUNTIME_FAILURE_FILE_MB} MB)`);
            }
            if (Number.isFinite(runtimeFailures.maxFileMb)
                && Number.isFinite(runtimeFailures.maxTotalMb)
                && runtimeFailures.maxTotalMb < runtimeFailures.maxFileMb) {
                errors.push('diagnostics.runtimeFailures.maxTotalMb must be >= maxFileMb');
            }
            if (!Number.isFinite(runtimeFailures.retentionDays) || runtimeFailures.retentionDays < 0) {
                errors.push('diagnostics.runtimeFailures.retentionDays must be a non-negative number');
            }
        }

        const breaker = value.diagnostics.circuitBreaker;
        if (!breaker || typeof breaker !== 'object' || Array.isArray(breaker)) {
            errors.push('diagnostics.circuitBreaker must be an object');
        } else {
            rejectUnknown(breaker, [
                'baseBackoffMs', 'maxBackoffMs', 'multiplier', 'jitterRatio',
                'maxConsecutiveFailures', 'openDurationMs'
            ], 'diagnostics.circuitBreaker', errors);
            for (const key of ['baseBackoffMs', 'maxBackoffMs', 'openDurationMs']) {
                if (!Number.isFinite(breaker[key]) || breaker[key] < 0) errors.push(`diagnostics.circuitBreaker.${key} must be a non-negative number`);
            }
            if (Number.isFinite(breaker.baseBackoffMs) && Number.isFinite(breaker.maxBackoffMs) && breaker.maxBackoffMs < breaker.baseBackoffMs) {
                errors.push('diagnostics.circuitBreaker.maxBackoffMs must be >= baseBackoffMs');
            }
            if (!Number.isFinite(breaker.multiplier) || breaker.multiplier < 1) errors.push('diagnostics.circuitBreaker.multiplier must be >= 1');
            if (!Number.isFinite(breaker.jitterRatio) || breaker.jitterRatio < 0 || breaker.jitterRatio > 1) errors.push('diagnostics.circuitBreaker.jitterRatio must be between 0 and 1');
            if (!Number.isInteger(breaker.maxConsecutiveFailures) || breaker.maxConsecutiveFailures < 1) {
                errors.push('diagnostics.circuitBreaker.maxConsecutiveFailures must be a positive integer');
            }
        }
    }

    return { valid: errors.length === 0, errors };
};
