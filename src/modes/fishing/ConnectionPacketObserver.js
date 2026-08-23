'use strict';
const { normalizeConnectionGeneration } = require('../../core/events/EventEnvelope');

const Redactor = require('../../shared/security/Redactor');

class ConnectionPacketObserver {
    constructor({ botId, context, eventBus, config = {}, logger = null }) {
        if (!botId || !context || !eventBus) throw new TypeError('ConnectionPacketObserver dependencies are required');
        Object.assign(this, { botId, context, eventBus, logger });
        this.unsubscribers = [];
        this.client = null;
        this.clientGeneration = null;
        this.clientListeners = [];
        this.samples = [];
        this.reconfigure(config);
    }

    reconfigure(config = {}) {
        const packet = config.packetObservation || {};
        const limit = Number(packet.sampleLimit);
        this.config = Object.freeze({ sampleLimit: Number.isInteger(limit) && limit > 0 ? limit : 64 });
        if (this.samples.length > this.config.sampleLimit) this.samples = this.samples.slice(-this.config.sampleLimit);
    }

    async initialize() {
        this.unsubscribers.push(
            this.eventBus.on('connection:client-attached', event => {
                if (event?.botId !== this.botId) return;
                this.#bindCurrent(normalizeConnectionGeneration(event));
            }),
            this.eventBus.on('connection:ended', event => {
                if (event?.botId !== this.botId) return;
                const generation = normalizeConnectionGeneration(event);
                if (!Number.isInteger(generation) || generation <= 0) return;
                if (generation === this.clientGeneration) this.#detachClient();
            })
        );
        if (this.context.has()) this.#bindCurrent(this.context.getGeneration());
    }

    async start() {}

    snapshot() {
        return Object.freeze(this.samples.map(sample => Object.freeze({ ...sample, velocity: sample.velocity ? { ...sample.velocity } : null })));
    }

    #bindCurrent(generation) {
        const client = this.context.get();
        if (!client || !Number.isInteger(Number(generation)) || Number(generation) <= 0) return;
        generation = Number(generation);
        if (this.client === client && this.clientGeneration === generation) return;
        this.#detachClient();
        this.client = client;
        this.clientGeneration = generation;
        const protocol = client._client;
        if (!protocol?.on) return;

        const onEntityVelocity = packet => {
            if (!this.#isCurrent(client, generation)) return;
            try {
                const sample = Object.freeze({
                    botId: this.botId,
                    connectionGeneration: generation,
                    type: 'entity_velocity',
                    entityId: Number.isFinite(Number(packet?.entityId)) ? Number(packet.entityId) : null,
                    velocity: Object.freeze({
                        x: Number(packet?.velocityX || 0),
                        y: Number(packet?.velocityY || 0),
                        z: Number(packet?.velocityZ || 0)
                    }),
                    occurredAt: new Date().toISOString()
                });
                this.#append(sample);
                this.eventBus.emit('fishing:packet-observation', sample);
            } catch (error) {
                this.logger?.debug?.('Fishing packet observation skipped malformed packet.', { error: Redactor.sanitize(error) });
            }
        };
        protocol.on('entity_velocity', onEntityVelocity);
        this.clientListeners.push(() => protocol.removeListener?.('entity_velocity', onEntityVelocity));
    }

    #isCurrent(client, generation) {
        return this.client === client
            && this.context.get() === client
            && Number(this.context.getGeneration()) === Number(generation)
            && Number(this.clientGeneration) === Number(generation);
    }

    #append(sample) {
        this.samples.push(sample);
        while (this.samples.length > this.config.sampleLimit) this.samples.shift();
    }

    #detachClient() {
        for (const off of this.clientListeners.splice(0)) {
            try { off(); } catch (error) { this.logger?.debug?.('Fishing packet listener cleanup failed.', { error: Redactor.sanitize(error) }); }
        }
        this.client = null;
        this.clientGeneration = null;
    }

    async stop() {
        this.#detachClient();
        for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
        this.samples = [];
    }

    async destroy() { await this.stop(); }
}

module.exports = ConnectionPacketObserver;