'use strict';

class CraftCampaignSession {
    constructor({ botId, clock = () => Date.now() } = {}) {
        if (!botId) throw new TypeError('CraftCampaignSession botId is required.');
        this.botId = String(botId);
        this.clock = clock;
        this.sequence = 0;
        this.current = null;
    }

    open({ generation, trigger = 'enable' } = {}) {
        this.sequence += 1;
        this.current = Object.freeze({
            campaignId: `${this.botId}:craft-campaign:${this.sequence}`,
            botId: this.botId,
            generation: Number.isFinite(Number(generation)) ? Number(generation) : null,
            trigger: String(trigger),
            openedAt: new Date(this.clock()).toISOString()
        });
        return this.current;
    }

    close() { this.current = null; }
    snapshot() { return this.current ? { ...this.current } : null; }
}

module.exports = CraftCampaignSession;
