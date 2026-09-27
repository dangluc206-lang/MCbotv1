'use strict';
// IncidentDomain: exact ingest + projection moved from DesktopController.
// publishLog + artifactsProvider injected; no direct bundle access.
const VietnamTime = require('../../shared/time/VietnamTime');
const IncidentIndexStore = require('../incidents/IncidentIndexStore');

class IncidentDomain {
    constructor({ incidentIndexStore, artifactsProvider, publishLog } = {}) {
        if (!incidentIndexStore) throw new TypeError('IncidentDomain needs incidentIndexStore.');
        Object.assign(this, { incidentIndexStore, artifactsProvider, publishLog });
    }

    async list({ limit = 100, states = null, botId = null } = {}) {
        await this.incidentIndexStore.load();
        const artifacts = this.artifactsProvider().list({ limit: Math.min(100, Number(limit) || 100), botId, hydrateMetadata: true });
        for (const artifact of artifacts.items || []) {
            try {
                const record = this.artifactsProvider().read(artifact.id);
                await this.incidentIndexStore.ingest(record, { artifactId: artifact.id });
            } catch (error) {
                this.publishLog({ timestamp: VietnamTime.iso(), level: 'warn', scope: 'IncidentCenter', message: 'Không thể lập chỉ mục một runtime failure artifact.', meta: { artifactId: artifact.id, code: error?.code || null } }, { persist: false });
            }
        }
        return { contract: IncidentIndexStore.CONTRACT, items: this.incidentIndexStore.snapshot({ limit, states, botId }), warnings: artifacts.warnings || [] };
    }

    async read(id) {
        await this.incidentIndexStore.load();
        const incident = this.incidentIndexStore.find(id);
        if (!incident) throw Object.assign(new Error('Incident does not exist.'), { code: 'DESKTOP_INCIDENT_NOT_FOUND' });
        return this.enrich(incident);
    }

    transition(id, state, options = {}) {
        return this.incidentIndexStore.transition(id, state, options);
    }

    enrich(incident) {
        const generations = (incident.timeline || []).map(entry => Number(entry?.generation)).filter(value => Number.isInteger(value));
        const operationIds = [...new Set((incident.timeline || []).map(entry => String(entry?.operationId || entry?.correlationId || '').trim()).filter(Boolean))];
        return { ...incident, firstGeneration: generations.length ? generations[0] : (incident.generation ?? null), lastGeneration: generations.length ? generations[generations.length - 1] : (incident.generation ?? null), operationIds };
    }
}

module.exports = IncidentDomain;

