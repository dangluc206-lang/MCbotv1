'use strict';

const path = require('node:path');
const OperatorErrorContract = require('../shared/contracts/OperatorErrorContract');
const Redactor = require('../shared/security/Redactor');

const CONTRACT = 'desktop-boot-failure-v1';
const STAGES = Object.freeze([
    'ENVIRONMENT', 'SECRET_PROVIDER', 'CONFIG_PARSE', 'SCHEMA', 'CROSS_CONTRACT',
    'MIGRATION', 'APPLICATION_CREATE', 'RUNTIME_START'
]);

function inferStage(error, fallback = 'APPLICATION_CREATE') {
    const code = String(error?.code || '').toUpperCase();
    const message = String(error?.message || '');
    if (/SECRET|ENCRYPT/.test(code)) return 'SECRET_PROVIDER';
    if (/MIGRAT/.test(code)) return 'MIGRATION';
    if (/JSON|PARSE/.test(code) || error instanceof SyntaxError && /JSON/i.test(message)) return 'CONFIG_PARSE';
    if (/CROSS|CONTRACT/.test(code)) return 'CROSS_CONTRACT';
    if (/SCHEMA|VALIDATION|CONFIG_INVALID/.test(code)) return 'SCHEMA';
    if (/ENV/.test(code)) return 'ENVIRONMENT';
    return STAGES.includes(fallback) ? fallback : 'APPLICATION_CREATE';
}

function safePath(value, baseDir) {
    if (!value) return null;
    const target = path.resolve(String(value));
    if (!baseDir) return path.basename(target);
    const base = path.resolve(baseDir);
    const relative = path.relative(base, target);
    if (relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)) return relative.replace(/\\/g, '/');
    return path.basename(target);
}

function create(error, { stage = null, baseDir = null, occurredAt = new Date().toISOString() } = {}) {
    const resolvedStage = inferStage(error, stage || 'APPLICATION_CREATE');
    const configPath = safePath(error?.path || error?.file || error?.details?.path || error?.details?.file, baseDir);
    const canonical = OperatorErrorContract.create(error, {
        code: error?.code || `DESKTOP_BOOT_${resolvedStage}_FAILED`,
        severity: 'error', retryClass: 'OPERATOR_GUARDED', safeToRetry: false,
        allowedActions: ['inspect-diagnostic', 'edit-config', 'export-support'],
        operatorState: 'ACTION_REQUIRED',
        operatorSummary: `Không thể khởi động hệ thống nền ở bước ${resolvedStage}.`,
        technicalSummary: error?.message || 'Desktop backend startup failed.',
        occurredAt,
        details: { stage: resolvedStage, configPath }
    });
    return Object.freeze(Redactor.sanitize({
        contract: CONTRACT,
        stage: resolvedStage,
        code: canonical.code,
        operatorSummary: canonical.operatorSummary,
        technicalSummary: canonical.technicalSummary,
        configPath,
        allowedActions: canonical.allowedActions,
        correlationId: canonical.correlationId,
        occurredAt
    }));
}

module.exports = Object.freeze({ CONTRACT, STAGES, inferStage, create });
