'use strict';

class GuiObservationService {
    constructor({ botId, eventBus, guiManager, normalizer = null, store = null, knowledgeRegistry = null, debounceMs = 350, logger = null }) {
        if (!Number.isFinite(debounceMs) || debounceMs < 0) throw new TypeError('debounceMs must be non-negative.');
        Object.assign(this, { botId, eventBus, guiManager, normalizer, store, knowledgeRegistry, debounceMs, logger });
        this.timer = null;
        this.unsubscribers = [];
        this.pendingSource = null;
        this.stopped = false;
    }

    async initialize() {
        this.stopped = false;
        const schedule = event => {
            if (event.botId !== this.botId) return;
            this.#schedule();
        };
        this.unsubscribers.push(this.eventBus.on('gui:opened', schedule));
        this.unsubscribers.push(this.eventBus.on('gui:updated', schedule));
    }

    setSource(source) {
        this.pendingSource = source ? { ...source } : null;
    }

    async observeSession(session = this.guiManager.current(), { source = null } = {}) {
        if (!session?.window) return null;

        // Explicit observations (for example Discord /gui routes) are already
        // stable enough for capture. Cancel the anonymous debounce so it does
        // not create a second technical-name file for the same GUI afterwards.
        if (source && this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
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

    #schedule() {
        if (this.stopped) return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = null;
            this.observeSession().catch(error => {
                this.logger?.error?.('GUI observation failed.', { botId: this.botId, error });
            });
        }, this.debounceMs);
    }

    async stop() {
        this.stopped = true;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
            await this.observeSession().catch(() => {});
        }
        for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    }

    async destroy() {
        await this.stop();
    }
}

module.exports = GuiObservationService;
