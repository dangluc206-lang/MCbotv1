'use strict';

const { createHash } = require('node:crypto');
const Redactor = require('../../shared/security/Redactor');

const CONTRACT = 'operator-snapshot-v1';

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}

function digest(value) {
    return createHash('sha256').update(canonical(value)).digest('hex');
}

function modeSummary(bot) {
    const owner = bot.modeOwner;
    const modeId = owner?.modeId || owner?.mode || owner?.owner || (typeof owner === 'string' ? owner : bot.intent?.desiredMode || null);
    const status = modeId ? bot.modes?.byId?.[modeId]
        || (bot.modes?.available || []).find(entry => entry.definition?.id === modeId)?.status
        || null : null;
    return {
        id: modeId,
        desiredId: bot.intent?.desiredMode || null,
        phase: status?.phase || (modeId ? 'PENDING' : 'IDLE'),
        paused: status?.paused === true || bot.intent?.modeState === 'PAUSED',
        waitingReason: status?.details?.waitingReason || null,
        faultState: status?.details?.fault?.state || null
    };
}

class OperatorSnapshotProjector {
    constructor({ now = Date.now } = {}) {
        this.now = now;
        this.revision = 0;
        this.lastDigest = null;
        this.lastProjection = null;
    }

    project(snapshot = {}, { incidents = [] } = {}) {
        const bots = (snapshot.bots || []).map(bot => {
            const operations = bot.operation?.operations || [];
            const current = operations[0] || null;
            return Redactor.sanitize({
                id: bot.botId,
                label: bot.profile?.displayName || bot.botId,
                enabled: bot.profile?.enabled !== false,
                online: bot.connectionOnline === true,
                connection: bot.state?.connectionState || 'UNKNOWN',
                generation: bot.connectionGeneration ?? null,
                desiredConnection: bot.intent?.desiredConnection || null,
                mode: modeSummary(bot),
                currentTask: current ? {
                    id: current.operationId || null,
                    name: current.operationName || current.metadata?.operation || 'operation',
                    step: current.metadata?.step || current.status || null,
                    ageMs: Number(current.ageMs || 0)
                } : null,
                lastErrorCode: bot.state?.lastError?.code || null,
                b5: bot.modes?.b5Craft ? {
                    batchId: bot.modes.b5Craft.details?.batchId || null,
                    protectionState: bot.modes.b5Craft.details?.protectionEpisode?.state || null,
                    safeState: bot.modes.b5Craft.details?.recovery?.safeState || null
                } : null
            });
        });
        const openIncidents = incidents.filter(item => ['OPEN','RECOVERING','NEEDS_ACTION'].includes(item.state));
        const stable = {
            lifecycle: snapshot.lifecycle || 'STOPPED',
            fleet: {
                total: bots.length,
                enabled: bots.filter(bot => bot.enabled).length,
                connected: bots.filter(bot => bot.online === true).length,
                activeModes: bots.filter(bot => bot.mode.id).length,
                openIncidents: openIncidents.length
            },
            bots,
            incidents: openIncidents.slice(0, 20).map(item => ({ id: item.id, botId: item.botId, code: item.code, severity: item.severity, state: item.state, lastSeenAt: item.lastSeenAt })),
            system: {
                startedAt: snapshot.system?.startedAt || null,
                uptimeMs: Number(snapshot.system?.uptimeMs || 0),
                memoryMb: Number(snapshot.system?.memoryMb || 0),
                bootFailureCode: snapshot.bootFailure?.code || null
            }
        };
        const nextDigest = digest(stable);
        if (nextDigest !== this.lastDigest) {
            this.revision += 1;
            this.lastDigest = nextDigest;
        }
        const projection = Object.freeze({
            contract: CONTRACT,
            revision: this.revision,
            digest: nextDigest,
            ...stable,
            lastUpdated: snapshot.updatedAt || new Date(this.now()).toISOString(),
            staleAfterMs: 5000
        });
        this.lastProjection = projection;
        return projection;
    }

    status() {
        return { contract: CONTRACT, revision: this.revision, digest: this.lastDigest };
    }
}

OperatorSnapshotProjector.CONTRACT = CONTRACT;
OperatorSnapshotProjector.canonical = canonical;
OperatorSnapshotProjector.digest = digest;
module.exports = OperatorSnapshotProjector;
