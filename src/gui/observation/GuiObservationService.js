'use strict';

const { normalizeConnectionGeneration } = require('../../core/events/EventEnvelope');

class GuiObservationService {
    constructor({ botId, eventBus, guiManager, normalizer = null, store = null, knowledgeRegistry = null, debounceMs = 350, logger = null }) {
        if (!Number.isFinite(debounceMs) || debounceMs < 0) throw new TypeError('debounceMs must be non-negative.');
        Object.assign(this, { botId, eventBus, guiManager, normalizer, store, knowledgeRegistry, debounceMs, logger });
        this.timer = null;
        this.unsubscribers = [];
        this.pendingSource = null;
        this.pendingEvent = null;
        this.stopped = false;
    }

    async initialize() {
        this.stopped = false;
        const schedule = event => {
            if (event.botId !== this.botId) return;
            const generation = normalizeConnectionGeneration(event);
            if (!Number.isInteger(generation) || generation <= 0) return;
            const session = this.guiManager.current();
            if (!session?.active || Number(session.connectionGeneration) !== generation) return;
            if (event.sessionId && session.id !== event.sessionId) return;
            this.#schedule({ generation, sessionId: session.id });
        };
        this.unsubscribers.push(this.eventBus.on('gui:opened', schedule));
        this.unsubscribers.push(this.eventBus.on('gui:updated', schedule));
    }

    setSource(source) {
        this.pendingSource = source ? { ...source } : null;
    }

    async observeSession(session = this.guiManager.current(), { source = null } = {}) {
        if (!session?.window) return null;

        if (source && this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
            this.pendingEvent = null;
        }

        const effectiveSource = source || this.pendingSource || session.source;
        let result;
        if (this.knowledgeRegistry) {
            result = await this.knowledgeRegistry.observe(session, { source: effectiveSource });
        } else {
            const normalized = this.normalizer.normalize(session);
            const key = this.normalizer.keyFor(normalized, { source: effectiveSource });
            const legacyKey = this.normalizer.legacyKeyFor(normalized);
            result = await this.store.upsert(key, normalized, {
                source: effectiveSource,
                aliases: legacyKey !== key ? [legacyKey] : []
            });
        }
        this.pendingSource = null;
        return result;
    }

    #schedule(provenance) {
        if (this.stopped) return;
        if (this.timer) clearTimeout(this.timer);
        this.pendingEvent = { ...provenance };
        this.timer = setTimeout(() => {
            this.timer = null;
            const pending = this.pendingEvent;
            this.pendingEvent = null;
            const session = this.guiManager.current();
            if (!pending || !session?.active) return;
            if (Number(session.connectionGeneration) !== Number(pending.generation) || session.id !== pending.sessionId) return;
            this.observeSession(session).catch(error => {
                this.logger?.error?.('GUI observation failed.', { botId: this.botId, error });
            });
        }, this.debounceMs);
    }

    async stop() {
        this.stopped = true;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
            const pending = this.pendingEvent;
            this.pendingEvent = null;
            const session = this.guiManager.current();
            if (pending && session?.active
                && Number(session.connectionGeneration) === Number(pending.generation)
                && session.id === pending.sessionId) {
                try {
                    await this.observeSession(session);
                } catch (error) {
                    this.logger?.debug?.('GUI observation flush failed during stop.', { botId: this.botId, error });
                }
            }
        }
        for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
        await this.store?.drain?.();
    }

    async destroy() {
        await this.stop();
    }
}

module.exports = GuiObservationService;
