'use strict';
const DiscordInteractionRouter = require('./DiscordInteractionRouter');

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
        this.interactionRouter = new DiscordInteractionRouter({ panelManager, commands:this.commands });
        this.environment = environment;
        this.logger = logger;
        this.discord = discord;
        this.client = null;
        this.onInteraction = null;
        this.activeInteractions = new Set();
        this.stopping = false;
    }

    async initialize() {}

    async start() {
        this.stopping = false;
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
            if (this.stopping) return;
            const task = Promise.resolve().then(() => this.interactionRouter.handle(interaction));
            this.activeInteractions.add(task);
            task.catch(error => {
                this.logger?.error?.('Discord interaction handler failed.', { error });
            }).finally(() => this.activeInteractions.delete(task));
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
        this.stopping = true;
        const discord = this.discord || require('discord.js');
        if (this.onInteraction) this.client.off(discord.Events.InteractionCreate, this.onInteraction);
        await this.#drainActiveInteractions();
        await this.panelManager?.stop?.();
        this.client.destroy();
        this.client = null;
        this.onInteraction = null;
        this.activeInteractions.clear();
    }

    async #drainActiveInteractions() {
        const pending = [...this.activeInteractions];
        if (pending.length === 0) return;
        const timeoutMs = Math.max(100, Number(this.config.shutdownDrainMs || 5000));
        let timer = null;
        const outcome = await Promise.race([
            Promise.allSettled(pending).then(() => 'settled'),
            new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), timeoutMs); })
        ]);
        if (timer) clearTimeout(timer);
        if (outcome === 'timeout') {
            this.logger?.warn?.('Discord shutdown interaction drain timed out.', {
                pending: this.activeInteractions.size,
                timeoutMs
            });
        }
    }

    async destroy() { await this.stop(); }

    #requiredEnv(name) {
        const value = this.environment[name];
        if (typeof value !== 'string' || !value.trim()) {
            throw new Error(`Required environment variable is missing: ${name}`);
        }
        return value.trim();
    }
}

module.exports = DiscordService;
