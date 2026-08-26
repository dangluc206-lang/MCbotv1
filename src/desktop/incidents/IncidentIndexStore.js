'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const Redactor = require('../../shared/security/Redactor');
const OperatorErrorContract = require('../../shared/contracts/OperatorErrorContract');

const CONTRACT = 'desktop-incident-index-v1';
const STATES = Object.freeze(['OPEN', 'RECOVERING', 'NEEDS_ACTION', 'RESOLVED', 'ACKNOWLEDGED']);
const TERMINAL = new Set(['RESOLVED', 'ACKNOWLEDGED']);
const TERMINAL_ACTIONS = new Set(['inspect-diagnostic', 'export-support']);
const TRANSITIONS = Object.freeze({
    OPEN:new Set(['OPEN','RECOVERING','NEEDS_ACTION','RESOLVED','ACKNOWLEDGED']),
    RECOVERING:new Set(['RECOVERING','NEEDS_ACTION','RESOLVED','ACKNOWLEDGED']),
    NEEDS_ACTION:new Set(['NEEDS_ACTION','RECOVERING','RESOLVED','ACKNOWLEDGED']),
    RESOLVED:new Set(['RESOLVED','ACKNOWLEDGED']),
    ACKNOWLEDGED:new Set(['ACKNOWLEDGED'])
});
const SEVERITY_RANK = Object.freeze({ critical: 4, error: 3, warning: 2, info: 1 });

function cleanText(value, maximum = 500) {
    return value == null ? null : String(value).slice(0, maximum);
}

function stableSignature(input = {}) {
    const nested = input.canonicalError || input.diagnostic?.canonicalError || input.diagnostic || input.details?.canonicalError || {};
    const parts = [
        input.botId,
        input.modeId || input.mode,
        input.resource,
        input.code || nested.code,
        input.operation,
        input.step,
        input.blocker?.signature || input.details?.signature
    ].map(value => String(value ?? '').trim().toLowerCase());
    return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

function validActions(input = {}) {
    const surfaces = [input, input.canonicalError, input.diagnostic, input.diagnostic?.canonicalError, input.details, input.details?.canonicalError, input.blocker].filter(Boolean);
    const actions = surfaces.flatMap(surface => Array.isArray(surface.allowedActions) ? surface.allowedActions : []);
    return [...new Set(actions)].filter(action => Object.prototype.hasOwnProperty.call(OperatorErrorContract.ACTION_CATALOG, action));
}

class IncidentIndexStore {
    constructor({ filePath, maxIncidents = 200, maxTimeline = 40, episodeWindowMs = 15 * 60 * 1000, fsImpl = fs, now = Date.now, idFactory = randomUUID } = {}) {
        if (!filePath) throw new TypeError('IncidentIndexStore filePath is required.');
        this.filePath = path.resolve(filePath);
        this.maxIncidents = Math.max(10, Math.min(2000, Number(maxIncidents) || 200));
        this.maxTimeline = Math.max(5, Math.min(200, Number(maxTimeline) || 40));
        this.episodeWindowMs = Math.max(1000, Number(episodeWindowMs) || 900000);
        this.fs = fsImpl;
        this.now = now;
        this.idFactory = idFactory;
        this.incidents = [];
        this.loaded = false;
        this.writeQueue = Promise.resolve();
    }

    async load() {
        if (this.loaded) return this.snapshot();
        try {
            const parsed = JSON.parse(await this.fs.readFile(this.filePath, 'utf8'));
            if (parsed?.contract !== CONTRACT || !Array.isArray(parsed.incidents)) throw new Error('Unsupported incident index contract.');
            this.incidents = parsed.incidents.map(value => this.#normalizeStored(value)).filter(Boolean).slice(0, this.maxIncidents);
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                const corrupt = `${this.filePath}.corrupt-${this.now()}`;
                await this.fs.rename(this.filePath, corrupt).catch(() => undefined);
            }
            this.incidents = [];
        }
        this.loaded = true;
        return this.snapshot();
    }

    snapshot({ states = null, botId = null, limit = this.maxIncidents } = {}) {
        const wanted = Array.isArray(states) ? new Set(states.filter(state => STATES.includes(state))) : null;
        return this.incidents
            .filter(item => (!wanted || wanted.has(item.state)) && (!botId || item.botId === botId))
            .sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0) || Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))
            .slice(0, Math.max(1, Math.min(this.maxIncidents, Number(limit) || this.maxIncidents)))
            .map(item => Redactor.sanitize(JSON.parse(JSON.stringify(item))));
    }

    async ingest(input = {}, { artifactId = null } = {}) {
        await this.load();
        if (artifactId) {
            const alreadyIndexed = this.incidents.find(item => item.evidenceRefs.includes(String(artifactId)));
            if (alreadyIndexed) return Redactor.sanitize(JSON.parse(JSON.stringify(alreadyIndexed)));
        }
        const timestamp = cleanText(input.occurredAt || input.capturedAt || new Date(this.now()).toISOString(), 64);
        const signature = stableSignature(input);
        const nowMs = Date.parse(timestamp) || this.now();
        let incident = this.incidents.find(item => item.signature === signature && !TERMINAL.has(item.state) && nowMs - Date.parse(item.lastSeenAt) <= this.episodeWindowMs);
        const canonical = input.canonicalError || input.diagnostic?.canonicalError || input.diagnostic || input.details?.canonicalError || null;
        const severity = String(canonical?.severity || input.severity || 'error').toLowerCase();
        const retrying = canonical?.operatorState === 'RECOVERING' || input.phase === 'RETRY' || Number(input.retryInMs) > 0;
        const needsAction = canonical?.operatorState === 'ACTION_REQUIRED' || canonical?.operatorState === 'BLOCKED' || canonical?.safeToRetry === false;
        const timelineEntry = Redactor.sanitize({
            at: timestamp,
            kind: incident ? 'REPEATED' : 'OPENED',
            code: cleanText(canonical?.code || input.code || 'RUNTIME_FAILURE', 128),
            phase: cleanText(input.phase, 64),
            artifactId: cleanText(artifactId, 256),
            correlationId: cleanText(canonical?.correlationId || input.correlationId || input.failureId, 128),
            summary: cleanText(canonical?.operatorSummary || input.message || 'Đã ghi nhận lỗi runtime.', 500)
        });
        if (!incident) {
            incident = {
                contract: CONTRACT,
                id: `incident:${this.idFactory()}`,
                signature,
                state: needsAction ? 'NEEDS_ACTION' : retrying ? 'RECOVERING' : 'OPEN',
                severity: SEVERITY_RANK[severity] ? severity : 'error',
                code: timelineEntry.code,
                botId: cleanText(input.botId, 128),
                modeId: cleanText(input.modeId || input.mode, 128),
                resource: cleanText(input.resource, 128),
                generation: Number.isInteger(input.connectionGeneration) ? input.connectionGeneration : null,
                firstSeenAt: timestamp,
                lastSeenAt: timestamp,
                count: 1,
                summary: timelineEntry.summary,
                evidenceRefs: artifactId ? [cleanText(artifactId, 256)] : [],
                allowedActions: validActions(input),
                timeline: [timelineEntry],
                acknowledgedAt: null,
                resolvedAt: null
            };
            this.incidents.unshift(incident);
        } else {
            incident.lastSeenAt = timestamp;
            incident.count += 1;
            if ((SEVERITY_RANK[severity] || 0) > (SEVERITY_RANK[incident.severity] || 0)) incident.severity = severity;
            if (needsAction) incident.state = 'NEEDS_ACTION';
            else if (retrying && incident.state !== 'NEEDS_ACTION') incident.state = 'RECOVERING';
            incident.summary = timelineEntry.summary;
            incident.generation = Number.isInteger(input.connectionGeneration) ? input.connectionGeneration : incident.generation;
            incident.allowedActions = [...new Set([...incident.allowedActions, ...validActions(input)])];
            if (artifactId && !incident.evidenceRefs.includes(artifactId)) incident.evidenceRefs.push(cleanText(artifactId, 256));
            incident.evidenceRefs = incident.evidenceRefs.slice(-10);
            incident.timeline.push(timelineEntry);
            incident.timeline = incident.timeline.slice(-this.maxTimeline);
        }
        this.#trim();
        await this.#persistQueued();
        return Redactor.sanitize(JSON.parse(JSON.stringify(incident)));
    }

    async transition(id, state, { reason = null, actionResult = null, expectedGeneration = undefined } = {}) {
        await this.load();
        if (!STATES.includes(state)) throw new TypeError(`Unknown incident state: ${state}`);
        const incident = this.incidents.find(item => item.id === id);
        if (!incident) throw Object.assign(new Error('Incident does not exist.'), { code: 'DESKTOP_INCIDENT_NOT_FOUND' });
        if (!TRANSITIONS[incident.state]?.has(state)) {
            throw Object.assign(new Error(`Incident transition ${incident.state} -> ${state} is not allowed.`), { code:'DESKTOP_INCIDENT_TRANSITION_INVALID' });
        }
        if (expectedGeneration !== undefined && expectedGeneration !== null && Number(expectedGeneration) !== Number(incident.generation)) {
            throw Object.assign(new Error('Incident connection generation is stale.'), { code: 'DESKTOP_INCIDENT_STALE_GENERATION' });
        }
        const at = new Date(this.now()).toISOString();
        incident.state = state;
        incident.lastSeenAt = at;
        if (state === 'RESOLVED') incident.resolvedAt = at;
        if (state === 'ACKNOWLEDGED') incident.acknowledgedAt = at;
        if (TERMINAL.has(state)) incident.allowedActions = incident.allowedActions.filter(action => TERMINAL_ACTIONS.has(action));
        incident.timeline.push(Redactor.sanitize({ at, kind: state, reason: cleanText(reason, 500), actionResult }));
        incident.timeline = incident.timeline.slice(-this.maxTimeline);
        await this.#persistQueued();
        return Redactor.sanitize(JSON.parse(JSON.stringify(incident)));
    }

    find(id) {
        const incident = this.incidents.find(item => item.id === id);
        return incident ? Redactor.sanitize(JSON.parse(JSON.stringify(incident))) : null;
    }

    async drain() {
        await this.writeQueue;
    }

    #normalizeStored(value) {
        if (!value || value.contract !== CONTRACT || !value.id || !STATES.includes(value.state)) return null;
        return {
            ...Redactor.sanitize(value),
            count: Math.max(1, Number(value.count) || 1),
            evidenceRefs: Array.isArray(value.evidenceRefs) ? value.evidenceRefs.slice(-10) : [],
            allowedActions: validActions(value),
            timeline: Array.isArray(value.timeline) ? value.timeline.slice(-this.maxTimeline) : []
        };
    }

    #trim() {
        this.incidents.sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
        if (this.incidents.length > this.maxIncidents) this.incidents.splice(this.maxIncidents);
    }

    #persistQueued() {
        const payload = JSON.stringify({ contract: CONTRACT, version: 1, incidents: this.incidents }, null, 2) + '\n';
        const work = async () => {
            await this.fs.mkdir(path.dirname(this.filePath), { recursive: true });
            const temp = `${this.filePath}.${process.pid}.${this.idFactory()}.tmp`;
            try {
                await this.fs.writeFile(temp, payload, { encoding: 'utf8', mode: 0o600 });
                await this.fs.rename(temp, this.filePath);
            } finally {
                await this.fs.rm?.(temp, { force: true }).catch?.(() => undefined);
            }
        };
        const task = this.writeQueue.then(work, work);
        this.writeQueue = task.then(() => undefined, () => undefined);
        return task;
    }
}

IncidentIndexStore.CONTRACT = CONTRACT;
IncidentIndexStore.STATES = STATES;
IncidentIndexStore.TRANSITIONS = TRANSITIONS;
IncidentIndexStore.stableSignature = stableSignature;
module.exports = IncidentIndexStore;
