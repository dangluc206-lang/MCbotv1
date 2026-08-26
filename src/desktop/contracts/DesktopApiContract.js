'use strict';

const CONTRACT = 'desktop-api-v1';
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_DEPTH = 10;
const MAX_KEYS = 1000;

const GROUPS = Object.freeze({
    backend: ['mcbot:backend:start','mcbot:backend:stop','mcbot:backend:restart','mcbot:snapshot','mcbot:operator-snapshot','mcbot:bot:detail','mcbot:health','mcbot:readiness','mcbot:app:info','mcbot:renderer:error'],
    fleet: ['mcbot:b5:journey','mcbot:profiles:list','mcbot:profiles:update','mcbot:profiles:create','mcbot:profiles:clone','mcbot:profiles:delete','mcbot:bot:connect','mcbot:bot:disconnect','mcbot:bot:home','mcbot:mode:start','mcbot:mode:pause','mcbot:mode:resume','mcbot:mode:stop','mcbot:mode:restart','mcbot:mode:b5-retry-storage-protection','mcbot:fleet:action'],
    incidents: ['mcbot:incidents:list','mcbot:incidents:read','mcbot:incidents:transition','mcbot:incidents:action','mcbot:logs','mcbot:diagnostics:list','mcbot:diagnostics:read','mcbot:support:export','mcbot:support:preview'],
    command: ['mcbot:commands','mcbot:command:send','mcbot:sky-commands:get','mcbot:sky-commands:save','mcbot:sky-commands:delete','mcbot:sky-commands:send','mcbot:gui:inspect'],
    configuration: ['mcbot:config:collector:get','mcbot:config:collector:update','mcbot:config:fishing:get','mcbot:config:fishing:update-area','mcbot:config:b5-craft:get','mcbot:config:b5-rules:get','mcbot:config:b5-rules:update','mcbot:config:b5-craft:update','mcbot:config:storage-protection:get','mcbot:config:storage-protection:update','mcbot:config:sky-auto-join:get','mcbot:config:sky-auto-join:update','mcbot:config:groups','mcbot:config:group:get','mcbot:config:group:save','mcbot:config:workspace:open','mcbot:config:workspace:preview','mcbot:config:workspace:save','mcbot:config:workspace:undo','mcbot:config:workspace:close','mcbot:custom-mode:modules','mcbot:custom-mode:templates','mcbot:custom-mode:dry-run','mcbot:custom-mode:package','mcbot:mode:presentations','mcbot:custom-mode:list','mcbot:custom-mode:save','mcbot:custom-mode:delete','mcbot:config:backup','mcbot:config:backups','mcbot:config:restore-preview','mcbot:config:restore'],
    update: ['mcbot:update:migration-status','mcbot:update:rollback-config','mcbot:update:local-status','mcbot:update:local-select','mcbot:update:local-clear','mcbot:update:local-install'],
    ai: ['mcbot:ai:status','mcbot:ai:workspace:select','mcbot:ai:workspace:inspect','mcbot:ai:chat'],
    desktop: ['mcbot:secrets:status','mcbot:secrets:set','mcbot:secrets:clear','mcbot:secrets:reset','mcbot:preferences:get','mcbot:preferences:set','mcbot:presentation:search','mcbot:shell:project','mcbot:shell:logs','mcbot:shell:backups','mcbot:shell:support']
});

const READ_SUFFIX = /(?::get|:list|:status|:read|:preview|:search|:info|:snapshot|:health|:readiness|:journey|:groups|:commands|:logs|:backups|:modules)$/;
const ADMIN_CHANNELS = new Set(['mcbot:fleet:action','mcbot:secrets:reset','mcbot:update:local-install','mcbot:config:restore']);
const DEVELOP_CHANNELS = new Set(['mcbot:ai:chat','mcbot:custom-mode:save','mcbot:custom-mode:delete']);
const READ_CHANNELS = new Set(['mcbot:custom-mode:templates','mcbot:custom-mode:dry-run','mcbot:custom-mode:package','mcbot:mode:presentations']);

const CATALOG = Object.freeze(Object.fromEntries(Object.entries(GROUPS).flatMap(([owner, channels]) => channels.map(channel => [channel, Object.freeze({
    channel,
    owner,
    permission: ADMIN_CHANNELS.has(channel) ? 'ADMIN' : DEVELOP_CHANNELS.has(channel) ? 'DEVELOP' : READ_CHANNELS.has(channel) || READ_SUFFIX.test(channel) ? 'READ' : 'PATCH',
    sender: 'EXACT_RENDERER_URL',
    request: 'structured-clone-bounded',
    response: CONTRACT
})]))));

function inspectValue(value, depth, counters, seen) {
    if (depth > MAX_DEPTH) throw coded('DESKTOP_IPC_INPUT_DEPTH', 'IPC input exceeds maximum nesting depth.');
    if (value == null || ['string','number','boolean'].includes(typeof value)) {
        if (typeof value === 'string' && value.length > 65536) throw coded('DESKTOP_IPC_INPUT_STRING_SIZE', 'IPC input string is too large.');
        if (typeof value === 'number' && !Number.isFinite(value)) throw coded('DESKTOP_IPC_INPUT_NUMBER', 'IPC input number must be finite.');
        return;
    }
    if (typeof value !== 'object') throw coded('DESKTOP_IPC_INPUT_TYPE', 'IPC input contains an unsupported value type.');
    if (seen.has(value)) throw coded('DESKTOP_IPC_INPUT_CYCLE', 'IPC input must not contain cycles.');
    seen.add(value);
    if (Array.isArray(value)) {
        if (value.length > 1000) throw coded('DESKTOP_IPC_INPUT_ARRAY_SIZE', 'IPC input array is too large.');
        for (const item of value) inspectValue(item, depth + 1, counters, seen);
    } else {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) throw coded('DESKTOP_IPC_INPUT_PROTOTYPE', 'IPC input object prototype is not allowed.');
        const keys = Object.keys(value);
        counters.keys += keys.length;
        if (counters.keys > MAX_KEYS) throw coded('DESKTOP_IPC_INPUT_KEYS', 'IPC input contains too many fields.');
        for (const key of keys) {
            if (['__proto__','prototype','constructor'].includes(key)) throw coded('DESKTOP_IPC_INPUT_KEY', 'IPC input contains a forbidden field.');
            inspectValue(value[key], depth + 1, counters, seen);
        }
    }
    seen.delete(value);
}

function coded(code, message) {
    return Object.assign(new Error(message), { code });
}

function validateRequest(channel, args = []) {
    const definition = CATALOG[channel];
    if (!definition) throw coded('DESKTOP_IPC_UNKNOWN_CHANNEL', `IPC channel is not declared: ${channel}`);
    if (!Array.isArray(args) || args.length > 4) throw coded('DESKTOP_IPC_ARGUMENT_COUNT', 'IPC request has too many arguments.');
    inspectValue(args, 0, { keys: 0 }, new WeakSet());
    let bytes;
    try { bytes = Buffer.byteLength(JSON.stringify(args)); }
    catch { throw coded('DESKTOP_IPC_INPUT_SERIALIZATION', 'IPC request cannot be serialized.'); }
    if (bytes > MAX_REQUEST_BYTES) throw coded('DESKTOP_IPC_INPUT_SIZE', 'IPC request exceeds the bounded payload size.');
    return definition;
}

function success(data) {
    return Object.freeze({ contract: CONTRACT, success: true, data });
}

function failure(error) {
    return Object.freeze({ contract: CONTRACT, success: false, error: Object.freeze({ name: error?.name || 'Error', code: error?.code || null, message: String(error?.message || error || 'Unknown Desktop error').slice(0, 2000) }) });
}

module.exports = Object.freeze({ CONTRACT, GROUPS, CATALOG, MAX_REQUEST_BYTES, MAX_DEPTH, MAX_KEYS, validateRequest, success, failure });
