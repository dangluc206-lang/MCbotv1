'use strict';

class DiscordInteractionRouter {
    constructor({ panelManager = null, commands = [] } = {}) {
        this.panelManager = panelManager;
        this.commands = [...commands];
    }

    async handle(interaction) {
        if (this.panelManager && await this.panelManager.handleInteraction(interaction)) return true;
        for (const command of this.commands) {
            if (await command.execute(interaction)) return true;
        }
        return false;
    }
}

module.exports = DiscordInteractionRouter;
