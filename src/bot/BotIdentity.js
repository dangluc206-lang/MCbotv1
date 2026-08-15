'use strict';

class BotIdentity {
    constructor({ botId, displayName = '', username = '', role = 'default', serverProfile = 'default' }) {
        if (typeof botId !== 'string' || !botId.trim()) throw new TypeError('botId must be a non-empty string');
        this.botId = botId.trim();
        this.displayName = String(displayName || this.botId).trim() || this.botId;
        this.username = String(username || '');
        this.role = String(role || 'default');
        this.serverProfile = String(serverProfile || 'default');
        Object.freeze(this);
    }
}

module.exports = BotIdentity;
