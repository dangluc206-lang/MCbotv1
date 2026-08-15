'use strict';

const OMIT_SUMMARY_KEYS = new Set([
    'botId',
    'connectionGeneration',
    'startedAt',
    'stoppedAt',
    'timestamp',
    'enabled'
]);

const PRIORITY_KEYS = [
    'host',
    'port',
    'username',
    'version',
    'command',
    'commandName',
    'selectionId',
    'attempt',
    'trigger',
    'delayMs',
    'reason',
    'status',
    'phase',
    'code',
    'operation',
    'step',
    'action',
    'resource',
    'attempt',
    'recipeId',
    'quantity',
    'slot',
    'itemName',
    'direction',
    'input',
    'output',
    'elapsedMs',
    'expectedDelta',
    'inventorySync',
    'before',
    'after',
    'verificationMode',
    'outputIdentity',
    'inputId',
    'inputExpected',
    'inputConsumed',
    'eventOutputDelta',
    'eventMmoCandidates',
    'eventIdentitySamples',
    'inputSource',
    'eventInputConsumed',
    'eventCount',
    'viewsBefore',
    'viewsAfter',
    'parentStep',
    'parentResource',
    'count',
    'used',
    'free',
    'capacity',
    'lastError'
];

const KEY_ALIASES = Object.freeze({
    username: 'user',
    version: 'ver',
    selectionId: 'selection',
    commandName: 'cmd',
    delayMs: 'delay'
});

function localTime(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '--:--:--';
    return [date.getHours(), date.getMinutes(), date.getSeconds()]
        .map(value => String(value).padStart(2, '0'))
        .join(':');
}

function shortScope(scope) {
    const value = String(scope || 'App');
    const botMatch = /^BotRuntime:(.+)$/i.exec(value);
    if (botMatch) return botMatch[1];
    return value;
}

function truncate(value, max = 90) {
    const text = String(value);
    return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3))}...`;
}

function formatMetaValue(value) {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return /\s/.test(value) ? JSON.stringify(truncate(value)) : truncate(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value && typeof value === 'object') {
        if (typeof value.message === 'string') return JSON.stringify(truncate(value.message));
        try { return truncate(JSON.stringify(value)); } catch { return '[object]'; }
    }
    return truncate(value);
}

function summarizeMeta(meta, maxFields = 4) {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return '';
    const entries = [];
    const seen = new Set();

    const push = key => {
        if (entries.length >= maxFields || seen.has(key) || OMIT_SUMMARY_KEYS.has(key)) return;
        if (!Object.prototype.hasOwnProperty.call(meta, key)) return;
        const value = meta[key];
        if (value === undefined || value === null || value === '') return;
        seen.add(key);
        entries.push(`${KEY_ALIASES[key] || key}=${formatMetaValue(value)}`);
    };

    for (const key of PRIORITY_KEYS) push(key);
    for (const key of Object.keys(meta)) push(key);
    return entries.join(' ');
}

class CompactLogFormatter {
    constructor({ metaMode = 'summary', maxMetaFields = 4 } = {}) {
        this.metaMode = ['none', 'summary', 'full'].includes(metaMode) ? metaMode : 'summary';
        this.maxMetaFields = Number.isInteger(maxMetaFields) && maxMetaFields >= 0 ? maxMetaFields : 4;
    }

    format(record) {
        const level = String(record?.level || 'info').toLowerCase();
        const levelPrefix = level === 'info' ? '' : `${level.toUpperCase()} `;
        const repeatSuffix = Number(record?.repeatCount || 0) > 0 ? ` ×${Number(record.repeatCount)} lặp` : '';
        const base = `${localTime(record?.timestamp)} ${levelPrefix}[${shortScope(record?.scope)}] ${String(record?.message || '')}${repeatSuffix}`;
        if (this.metaMode === 'none' || !record?.meta) return base;
        if (this.metaMode === 'full') {
            try { return `${base} ${JSON.stringify(record.meta)}`; } catch { return `${base} [meta-unserializable]`; }
        }
        const summaryFieldLimit = ['warn', 'error', 'fatal'].includes(level)
            ? Math.max(this.maxMetaFields, 8)
            : this.maxMetaFields;
        const summary = summarizeMeta(record.meta, summaryFieldLimit);
        return summary ? `${base} ${summary}` : base;
    }
}

CompactLogFormatter.summarizeMeta = summarizeMeta;
CompactLogFormatter.shortScope = shortScope;
module.exports = CompactLogFormatter;
