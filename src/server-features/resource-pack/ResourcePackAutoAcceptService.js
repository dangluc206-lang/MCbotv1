'use strict';

class ResourcePackAutoAcceptService {
    constructor({
        botId,
        context,
        eventBus,
        config = {},
        logger = null
    }) {
        if (typeof botId !== 'string' || !botId.trim()) {
            throw new TypeError('botId must be a non-empty string');
        }
        if (!context || typeof context.get !== 'function') {
            throw new TypeError('context is required');
        }
        if (!eventBus || typeof eventBus.on !== 'function') {
            throw new TypeError('eventBus is required');
        }

        this.name = 'ResourcePackAutoAcceptService';
        this.botId = botId;
        this.context = context;
        this.eventBus = eventBus;
        this.logger = logger;
        this.enabled = config.enabled !== false;
        this.autoAccept = config.autoAccept !== false;

        this.initialized = false;
        this.unsubscribers = [];
        this.boundClient = null;
        this.boundGeneration = null;
        this.onResourcePack = null;
    }

    async initialize() {
        if (this.initialized) return;
        this.initialized = true;

        this.logger?.debug?.('Resource pack auto accept initialized.', {
            botId: this.botId,
            enabled: this.enabled,
            autoAccept: this.autoAccept
        });

        this.unsubscribers.push(
            this.eventBus.on('connection:client-attached', event => {
                if (event.botId !== this.botId) return;
                this.#bindCurrentClient(event.connectionGeneration);
            }),
            this.eventBus.on('connection:ended', event => {
                if (event.botId !== this.botId) return;
                if (this.boundGeneration !== event.connectionGeneration) return;
                this.#unbindClient();
            }),
            this.eventBus.on('connection:failed', event => {
                if (event.botId !== this.botId) return;
                if (this.boundGeneration !== event.connectionGeneration) return;
                this.#unbindClient();
            })
        );

        if (this.context.has?.()) {
            this.#bindCurrentClient(this.context.getGeneration());
        }
    }

    async stop() {
        this.#unbindClient();
        for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
        this.initialized = false;
    }

    async destroy() {
        await this.stop();
    }

    #bindCurrentClient(generation) {
        const client = this.context.get();
        if (!client) return;

        if (this.boundClient === client && this.boundGeneration === generation) return;
        this.#unbindClient();

        this.boundClient = client;
        this.boundGeneration = generation;

        if (!this.enabled) {
            this.eventBus.emit('resource-pack:disabled', {
                botId: this.botId,
                connectionGeneration: generation
            });
            return;
        }

        this.onResourcePack = (...args) => {
            if (this.context.get() !== client) return;
            if (this.context.getGeneration() !== generation) return;

            this.logger?.info?.('Server resource pack requested.', {
                botId: this.botId,
                connectionGeneration: generation
            });
            this.eventBus.emit('resource-pack:requested', {
                botId: this.botId,
                connectionGeneration: generation,
                metadata: this.#describeArgs(args)
            });

            if (!this.autoAccept) return;

            try {
                if (typeof client.acceptResourcePack !== 'function') {
                    throw new Error('Mineflayer client does not expose acceptResourcePack().');
                }

                client.acceptResourcePack();

                this.logger?.info?.('Server resource pack accepted.', {
                    botId: this.botId,
                    connectionGeneration: generation
                });
                this.eventBus.emit('resource-pack:accepted', {
                    botId: this.botId,
                    connectionGeneration: generation
                });
                this.eventBus.emit('resource-pack:ready', {
                    botId: this.botId,
                    connectionGeneration: generation
                });
            } catch (error) {
                this.logger?.error?.('Failed to accept server resource pack.', {
                    botId: this.botId,
                    connectionGeneration: generation,
                    error
                });
                this.eventBus.emit('resource-pack:failed', {
                    botId: this.botId,
                    connectionGeneration: generation,
                    error
                });
            }
        };

        client.on?.('resourcePack', this.onResourcePack);
    }

    #unbindClient() {
        if (this.boundClient && this.onResourcePack) {
            this.boundClient.off?.('resourcePack', this.onResourcePack);
        }
        this.boundClient = null;
        this.boundGeneration = null;
        this.onResourcePack = null;
    }

    #describeArgs(args) {
        return args.map(value => {
            if (typeof value === 'string') {
                if (/^https?:\/\//i.test(value)) return { type: 'url' };
                return { type: 'string', length: value.length };
            }
            return { type: value?.constructor?.name || typeof value };
        });
    }
}

module.exports = ResourcePackAutoAcceptService;
