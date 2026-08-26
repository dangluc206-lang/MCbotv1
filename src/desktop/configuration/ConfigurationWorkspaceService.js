'use strict';

const { createHash, randomUUID } = require('node:crypto');

const CONTRACT = 'desktop-config-workspace-v1';

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}

function digest(value) {
    return createHash('sha256').update(canonical(value)).digest('hex');
}

function semanticDiff(before, after, path = '') {
    if (canonical(before) === canonical(after)) return [];
    if (!before || !after || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) !== Array.isArray(after)) {
        return [{ path: path || '$', before, after }];
    }
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].sort().flatMap(key => semanticDiff(before[key], after[key], path ? `${path}.${key}` : key));
}

function impactFor(key, changes) {
    const liveGroups = new Set(['skyblock', 'skyCommands', 'b5CraftMode']);
    const reconnectPatterns = /(?:server|host|port|auth|username|version)/i;
    const reconnect = changes.some(change => reconnectPatterns.test(change.path));
    return reconnect ? 'RECONNECT' : liveGroups.has(key) ? 'LIVE_RECONFIGURE' : 'BACKEND_RESTART';
}

class ConfigurationWorkspaceService {
    constructor({ loadGroup, saveGroup, validateGroup = null, maxSessions = 20, idFactory = randomUUID } = {}) {
        if (typeof loadGroup !== 'function' || typeof saveGroup !== 'function') throw new TypeError('ConfigurationWorkspaceService loadGroup/saveGroup are required.');
        this.loadGroup = loadGroup;
        this.saveGroup = saveGroup;
        this.validateGroup = validateGroup;
        this.maxSessions = Math.max(1, Math.min(100, Number(maxSessions) || 20));
        this.idFactory = idFactory;
        this.sessions = new Map();
    }

    async open(key) {
        const group = await this.loadGroup(key);
        const value = structuredClone(group.value);
        const session = {
            contract: CONTRACT,
            id: `config-session:${this.idFactory()}`,
            key,
            file: group.file || null,
            schema: group.schema || null,
            revision: digest(value),
            value,
            lastSavedValue: structuredClone(value),
            undoValue: null,
            openedAt: new Date().toISOString()
        };
        this.sessions.set(session.id, session);
        while (this.sessions.size > this.maxSessions) this.sessions.delete(this.sessions.keys().next().value);
        return this.#view(session, value);
    }

    async preview(sessionId, value) {
        const session = this.#session(sessionId);
        const draft = structuredClone(value);
        let validation = { valid: true, errors: [] };
        if (this.validateGroup) validation = await this.validateGroup(session.key, draft);
        const changes = semanticDiff(session.lastSavedValue, draft);
        return Object.freeze({
            contract: CONTRACT,
            sessionId,
            key: session.key,
            loadedRevision: session.revision,
            draftDigest: digest(draft),
            dirty: changes.length > 0,
            valid: validation?.valid !== false,
            errors: validation?.errors || [],
            changes,
            impact: impactFor(session.key, changes),
            migrationPreview: validation?.migrationPreview || null
        });
    }

    async save(sessionId, value, { expectedRevision } = {}) {
        const session = this.#session(sessionId);
        if (expectedRevision !== session.revision) throw Object.assign(new Error('Loaded configuration revision does not match the workspace session.'), { code: 'CONFIG_WORKSPACE_STALE_CLIENT_REVISION' });
        const fresh = await this.loadGroup(session.key);
        const freshDigest = digest(fresh.value);
        if (freshDigest !== session.revision) throw Object.assign(new Error('Configuration changed outside this workspace.'), { code: 'CONFIG_WORKSPACE_EXTERNAL_CONFLICT', currentRevision: freshDigest });
        const preview = await this.preview(sessionId, value);
        if (!preview.valid) throw Object.assign(new Error('Configuration draft is invalid.'), { code: 'CONFIG_WORKSPACE_INVALID', details: preview.errors });
        if (!preview.dirty) return { ...preview, saved: false, result: null };
        const result = await this.saveGroup(session.key, structuredClone(value));
        session.undoValue = structuredClone(session.lastSavedValue);
        session.lastSavedValue = structuredClone(value);
        session.value = structuredClone(value);
        session.revision = digest(value);
        return Object.freeze({ ...await this.preview(sessionId, value), saved: true, result });
    }

    async undo(sessionId) {
        const session = this.#session(sessionId);
        if (!session.undoValue) throw Object.assign(new Error('No saved revision is available to undo.'), { code: 'CONFIG_WORKSPACE_UNDO_EMPTY' });
        const target = structuredClone(session.undoValue);
        const currentRevision = session.revision;
        const previous = structuredClone(session.lastSavedValue);
        const result = await this.save(sessionId, target, { expectedRevision: currentRevision });
        session.undoValue = previous;
        return result;
    }

    close(sessionId) {
        return this.sessions.delete(sessionId);
    }

    #view(session, draft) {
        return Object.freeze({ contract: CONTRACT, sessionId: session.id, key: session.key, file: session.file, schema: session.schema, revision: session.revision, dirty: digest(draft) !== session.revision, value: structuredClone(draft), openedAt: session.openedAt });
    }

    #session(id) {
        const session = this.sessions.get(String(id || ''));
        if (!session) throw Object.assign(new Error('Configuration workspace session does not exist.'), { code: 'CONFIG_WORKSPACE_SESSION_NOT_FOUND' });
        return session;
    }
}

ConfigurationWorkspaceService.CONTRACT = CONTRACT;
ConfigurationWorkspaceService.canonical = canonical;
ConfigurationWorkspaceService.digest = digest;
ConfigurationWorkspaceService.semanticDiff = semanticDiff;
ConfigurationWorkspaceService.impactFor = impactFor;
module.exports = ConfigurationWorkspaceService;
