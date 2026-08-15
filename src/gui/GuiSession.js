'use strict';

class GuiSession {
    constructor({ botId, generation, window, definitionId = null, source = null }) {
        this.id = `${botId}:${generation}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
        this.botId = botId;
        this.generation = generation;
        this.window = window;
        this.definitionId = definitionId;
        this.source = source ? { ...source } : null;
        this.active = true;
    }

    setSource(source) {
        this.source = source ? { ...source } : null;
        return this;
    }

    invalidate() {
        this.active = false;
    }

    assertActive() {
        if (!this.active) throw new Error('GUI session is no longer active.');
    }
}

module.exports = GuiSession;
