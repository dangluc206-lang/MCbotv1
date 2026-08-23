'use strict';

class GuiSession {
    constructor({ botId, connectionGeneration, window, definitionId = null, identity = null, source = null, client = null }) {
        const canonicalGeneration = Number(connectionGeneration);
        if (!Number.isInteger(canonicalGeneration) || canonicalGeneration <= 0) {
            throw new TypeError('GuiSession connectionGeneration must be a positive integer.');
        }
        this.id = `${botId}:${canonicalGeneration}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
        this.botId = botId;
        this.connectionGeneration = canonicalGeneration;
        this.client = client;
        this.window = window;
        this.definitionId = definitionId;
        this.identity = identity || null;
        this.source = source ? { ...source } : null;
        this.active = true;
    }

    get generation() { return this.connectionGeneration; }

    setSource(source) {
        this.source = source ? { ...source } : null;
        return this;
    }

    setIdentity(identity) {
        this.identity = identity || null;
        this.definitionId = identity?.id || null;
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
