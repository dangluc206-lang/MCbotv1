'use strict';

const { normalizeConnectionGeneration } = require('../core/events/EventEnvelope');

function createConnectionEventBinding({ botId, context, eventBus }) {
    if (typeof botId !== 'string' || !botId) throw new TypeError('botId is required');
    if (!context || !eventBus) throw new TypeError('context and eventBus are required');

    let bound = null;
    let offSpawn = null;
    let offEnd = null;

    const clear = expectedGeneration => {
        if (!bound) return;
        if (expectedGeneration != null && bound.generation !== expectedGeneration) return;
        for (const cleanup of bound.cleanup.splice(0)) cleanup();
        bound = null;
    };

    return {
        name: 'ConnectionEventBinding',

        async initialize() {
            if (offSpawn || offEnd) return;
            offSpawn = eventBus.on('connection:spawned', event => {
                if (event?.botId !== botId) return;
                const generation = normalizeConnectionGeneration(event);
                if (!Number.isInteger(generation) || generation <= 0) return;
                const client = context.get();
                if (!client || context.getGeneration() !== generation) return;
                if (bound?.client === client && bound.generation === generation) return;

                clear();
                const cleanup = [];
                const isCurrent = () => context.get() === client && context.getGeneration() === generation;
                const positionSnapshot = () => {
                    const position = client.entity?.position;
                    return position && [position.x, position.y, position.z].every(Number.isFinite)
                        ? Object.freeze({ x: position.x, y: position.y, z: position.z })
                        : null;
                };
                const onMessage = message => {
                    if (!isCurrent()) return;
                    eventBus.emit('command:message', {
                        botId,
                        connectionGeneration: generation,
                        message: String(message)
                    });
                };
                const onMove = () => {
                    if (!isCurrent()) return;
                    eventBus.emit('movement:position', {
                        botId,
                        connectionGeneration: generation,
                        position: positionSnapshot()
                    });
                };
                const onTeleport = () => {
                    if (!isCurrent()) return;
                    eventBus.emit('movement:teleport', {
                        botId,
                        connectionGeneration: generation,
                        position: positionSnapshot()
                    });
                };
                const onDeath = () => {
                    if (!isCurrent()) return;
                    eventBus.emit('player:death', {
                        botId,
                        connectionGeneration: generation,
                        position: positionSnapshot()
                    });
                };

                client.on?.('messagestr', onMessage);
                client.on?.('move', onMove);
                client.on?.('forcedMove', onTeleport);
                client.on?.('death', onDeath);
                cleanup.push(
                    () => client.off?.('messagestr', onMessage),
                    () => client.off?.('move', onMove),
                    () => client.off?.('forcedMove', onTeleport),
                    () => client.off?.('death', onDeath)
                );
                bound = { client, generation, cleanup };
            });
            offEnd = eventBus.on('connection:ended', event => {
                if (event?.botId !== botId) return;
                const generation = normalizeConnectionGeneration(event);
                if (!Number.isInteger(generation) || generation <= 0) return;
                clear(generation);
            });
        },

        async stop() {
            clear();
            offSpawn?.();
            offEnd?.();
            offSpawn = null;
            offEnd = null;
        },

        async destroy() {
            await this.stop();
        }
    };
}

module.exports = createConnectionEventBinding;
