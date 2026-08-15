'use strict';

class DiscordService {
    constructor({
        config,
        commands = null,
        command = null,
        panelManager = null,
        environment = process.env,
        logger = null,
        discord = null
    }) {
        this.name = 'DiscordService';
        this.config = config;
        this.commands = commands ? [...commands] : (command ? [command] : []);
        this.panelManager = panelManager;
        this.environment = environment;
        this.logger = logger;
        this.discord = discord;
        this.client = null;
        this.onInteraction = null;
    }

    async initialize() {}

    async start() {
        if (!this.config.enabled) {
            this.logger?.info?.('Discord integration is disabled.');
            return;
        }

        const token = this.#requiredEnv(this.config.tokenEnv);
        const applicationId = this.#requiredEnv(this.config.applicationIdEnv);
        const guildId = this.config.guildIdEnv ? this.environment[this.config.guildIdEnv] : null;
        const discord = this.discord || require('discord.js');

        const definitions = this.commands.map(command => command.definition(discord.ApplicationCommandOptionType.String));
        const rest = new discord.REST({ version: '10' }).setToken(token);
        const route = guildId
            ? discord.Routes.applicationGuildCommands(applicationId, guildId)
            : discord.Routes.applicationCommands(applicationId);
        await rest.put(route, { body: definitions });

        this.client = new discord.Client({ intents: [discord.GatewayIntentBits.Guilds] });
        this.onInteraction = interaction => {
            Promise.resolve(this.#handleInteraction(interaction)).catch(error => {
                this.logger?.error?.('Discord interaction handler failed.', { error });
            });
        };
        this.client.on(discord.Events.InteractionCreate, this.onInteraction);

        const ready = new Promise((resolve, reject) => {
            let timer = null;
            const cleanup = () => {
                if (timer) clearTimeout(timer);
                this.client.off(discord.Events.ClientReady, onReady);
                this.client.off(discord.Events.Error, onError);
            };
            const onReady = client => { cleanup(); resolve(client); };
            const onError = error => { cleanup(); reject(error); };
            this.client.once(discord.Events.ClientReady, onReady);
            this.client.once(discord.Events.Error, onError);
            timer = setTimeout(() => {
                cleanup();
                reject(new Error('Discord client ready timeout.'));
            }, this.config.readyTimeoutMs);
        });

        await this.client.login(token);
        const client = await ready;

        if (this.panelManager?.enabled) {
            try {
                await this.panelManager.start({ client: this.client, discord, guildId });
            } catch (error) {
                this.logger?.error?.('Discord panels failed to start.', { error });
            }
        }

        this.logger?.info?.('Discord integration is ready.', {
            userId: client.user?.id,
            guildCommand: Boolean(guildId),
            commandNames: definitions.map(definition => definition.name).join(',')
        });
    }

    async stop() {
        if (!this.client) return;
        const discord = this.discord || require('discord.js');
        await this.panelManager?.stop?.();
        if (this.onInteraction) this.client.off(discord.Events.InteractionCreate, this.onInteraction);
        this.client.destroy();
        this.client = null;
        this.onInteraction = null;
    }

    async destroy() { await this.stop(); }

    async #handleInteraction(interaction) {
        if (this.panelManager && await this.panelManager.handleInteraction(interaction)) return true;
        for (const command of this.commands) {
            if (await command.execute(interaction)) return true;
        }
        return false;
    }

    #requiredEnv(name) {
        const value = this.environment[name];
        if (typeof value !== 'string' || !value.trim()) {
            throw new Error(`Required environment variable is missing: ${name}`);
        }
        return value.trim();
    }
}

module.exports = DiscordService;
