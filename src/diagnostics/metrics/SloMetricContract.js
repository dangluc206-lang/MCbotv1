'use strict';

const CONTRACT = 'mcbot-local-metric-v1';
const FORBIDDEN_DIMENSIONS = /(?:username|displayname|message|stack|secret|token|password|item|nbt|chat)/i;
const METRICS = Object.freeze({
    mode_start_outcome: Object.freeze({ unit: 'count', dimensions: ['modeId', 'outcome'], retentionDays: 14 }),
    b5_batch_outcome: Object.freeze({ unit: 'count', dimensions: ['outcome', 'faultClass'], retentionDays: 14 }),
    b5_blocker_dwell_ms: Object.freeze({ unit: 'milliseconds', dimensions: ['faultClass'], retentionDays: 14 }),
    retry_count: Object.freeze({ unit: 'count', dimensions: ['subsystem', 'faultClass'], retentionDays: 14 }),
    reconnect_outcome: Object.freeze({ unit: 'count', dimensions: ['outcome'], retentionDays: 14 }),
    incident_mtta_ms: Object.freeze({ unit: 'milliseconds', dimensions: ['severity'], retentionDays: 30 }),
    incident_mttr_ms: Object.freeze({ unit: 'milliseconds', dimensions: ['severity'], retentionDays: 30 }),
    operation_queue_age_ms: Object.freeze({ unit: 'milliseconds', dimensions: ['operationType'], retentionDays: 7 }),
    desktop_render_duration_ms: Object.freeze({ unit: 'milliseconds', dimensions: ['surface'], retentionDays: 7 })
});

function create(name, value, dimensions = {}, { now = Date.now() } = {}) {
    const definition = METRICS[name];
    if (!definition) throw new TypeError(`Unknown SLO metric: ${name}`);
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue < 0) throw new TypeError('Metric value must be a finite non-negative number.');
    if (!dimensions || typeof dimensions !== 'object' || Array.isArray(dimensions)) throw new TypeError('Metric dimensions must be an object.');
    const safe = {};
    for (const [key, rawValue] of Object.entries(dimensions)) {
        if (FORBIDDEN_DIMENSIONS.test(key)) throw new TypeError(`Forbidden high-cardinality metric dimension: ${key}`);
        if (!definition.dimensions.includes(key)) throw new TypeError(`Unsupported dimension for ${name}: ${key}`);
        const text = String(rawValue ?? '').slice(0, 64);
        if (!/^[a-z0-9._:-]*$/i.test(text)) throw new TypeError(`Invalid metric dimension value for ${key}.`);
        safe[key] = text;
    }
    return Object.freeze({ contract: CONTRACT, name, value: numericValue, unit: definition.unit, dimensions: Object.freeze(safe), recordedAt: new Date(now).toISOString() });
}

module.exports = Object.freeze({ CONTRACT, FORBIDDEN_DIMENSIONS, METRICS, create });
