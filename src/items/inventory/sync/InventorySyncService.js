'use strict';

const Timeout = require('../../../shared/time/Timeout');
const { identitiesEquivalent } = require('../../ItemIdentity');
const FlowError = require('../../../shared/errors/FlowError');

class InventorySyncService {
    constructor({ botId, context, reader, observation = null, logger = null, config = {} }) {
        Object.assign(this, { botId, context, reader, observation, logger });
        this.config = this.#validateConfig(config);
    }

    async waitForStable({
        since = Date.now(),
        beforeViews = [],
        reason = 'post-action',
        expectedIdentity = null,
        expectedDelta = null,
        inventorySource = 'all',
        expectedGeneration = null
    } = {}) {
        const startedAt = Date.now();
        const bot = this.context.require();
        const generation = expectedGeneration == null ? Number(this.context.getGeneration?.()) : Number(expectedGeneration);
        if (!Number.isInteger(generation) || generation <= 0 || Number(this.context.getGeneration?.()) !== generation) {
            throw new TypeError('Inventory sync requires the current connection generation.');
        }
        this.#assertOwner(bot, generation, 'start');
        const targetDelta = Math.max(0, Number(expectedDelta) || 0);
        const beforeIdentityCount = expectedIdentity
            ? this.#countIdentity(beforeViews, expectedIdentity)
            : 0;

        await this.#waitTicks(bot, this.config.minTicks);
        this.#assertOwner(bot, generation, 'after-min-ticks');

        let previousSignature = null;
        let stablePasses = 0;
        let attempt = 0;
        let last = null;
        let firstSnapshot = true;

        while (Date.now() - startedAt <= this.config.timeoutMs) {
            this.#assertOwner(bot, generation, 'poll');
            attempt += 1;
            const eventsBeforeRead = this.#eventsSince(since, inventorySource, generation);
            const debugSlots = this.#slotsFromEvents(eventsBeforeRead);
            const views = this.#readViews(inventorySource, {
                debugMetadataReason: this.config.debugMetadata && firstSnapshot
                    ? `${reason}:first-settled-snapshot`
                    : null,
                debugMaxItems: this.config.debugMaxItems,
                debugFocusIdentity: expectedIdentity,
                debugSlots
            });
            firstSnapshot = false;

            const signature = this.#signature(views);
            stablePasses = signature === previousSignature ? stablePasses + 1 : 1;
            previousSignature = signature;

            const events = this.#eventsSince(since, inventorySource, generation) || eventsBeforeRead;
            const lastEventAt = events.reduce((max, event) => Math.max(max, Number(event?.at || 0)), Number(since) || 0);
            const quietForMs = Math.max(0, Date.now() - lastEventAt);
            const quiet = quietForMs >= this.config.quietMs;

            const afterIdentityCount = expectedIdentity
                ? this.#countIdentity(views, expectedIdentity)
                : 0;
            const identityDelta = expectedIdentity ? afterIdentityCount - beforeIdentityCount : null;
            const metadataReady = !expectedIdentity
                || (targetDelta > 0 ? identityDelta >= targetDelta : afterIdentityCount > 0);

            last = {
                reason,
                attempt,
                startedAt,
                capturedAt: Date.now(),
                elapsedMs: Date.now() - startedAt,
                quietForMs,
                eventCount: events.length,
                stablePasses,
                expectedIdentity,
                expectedDelta: targetDelta || null,
                beforeIdentityCount,
                afterIdentityCount,
                identityDelta,
                metadataReady,
                stable: quiet && stablePasses >= this.config.stablePasses,
                views
            };

            if (last.stable && metadataReady) {
                if (this.config.persistStableSnapshot) {
                    try {
                        await this.observation?.capture?.(`${reason}:stable`, { expectedGeneration: generation });
                    } catch (error) {
                        this.logger?.debug?.('Inventory stable snapshot persistence failed.', { botId: this.botId, reason, generation, error });
                    }
                }
                if (this.config.debugMetadata) {
                    this.#readViews(inventorySource, {
                        debugMetadataReason: `${reason}:stable`,
                        debugMaxItems: this.config.debugMaxItems,
                        debugFocusIdentity: expectedIdentity,
                        debugSlots: this.#slotsFromEvents(events)
                    });
                }
                this.#assertOwner(bot, generation, 'return-stable');
                return last;
            }

            if (this.config.pollTicks > 0) await this.#waitTicks(bot, this.config.pollTicks);
            else if (this.config.pollMs > 0) await Timeout.delay(this.config.pollMs);
            else await Promise.resolve();
            this.#assertOwner(bot, generation, 'after-poll-wait');
        }

        this.#assertOwner(bot, generation, 'timeout');
        const views = last?.views || this.#readViews(inventorySource);
        if (this.config.debugMetadata) {
            this.#readViews(inventorySource, {
                debugMetadataReason: `${reason}:sync-timeout`,
                debugMaxItems: this.config.debugMaxItems,
                debugFocusIdentity: expectedIdentity,
                debugSlots: this.#slotsFromEvents(this.#eventsSince(since, inventorySource, generation))
            });
        }
        this.logger?.warn?.('Inventory post-action sync timed out; verifier will use the freshest snapshot available.', {
            botId: this.botId,
            reason,
            timeoutMs: this.config.timeoutMs,
            expectedIdentity,
            expectedDelta: targetDelta || null,
            beforeIdentityCount,
            afterIdentityCount: last?.afterIdentityCount ?? this.#countIdentity(views, expectedIdentity),
            identityDelta: last?.identityDelta ?? null,
            eventCount: last?.eventCount ?? 0,
            inventorySource,
            stablePasses: last?.stablePasses ?? 0,
            quietForMs: last?.quietForMs ?? 0
        });
        return {
            ...(last || {}),
            reason,
            timedOut: true,
            stable: false,
            views
        };
    }



    #readViews(inventorySource = 'all', options = {}) {
        if (inventorySource === 'bot-inventory' && typeof this.reader.readBotInventory === 'function') {
            const snapshot = this.reader.readBotInventory(options);
            return snapshot ? [snapshot] : [];
        }
        return this.reader.readViews(options);
    }

    #eventsSince(since, inventorySource = 'all', connectionGeneration = null) {
        const events = this.observation?.eventsSince?.(since, { connectionGeneration }) || [];
        if (inventorySource === 'all') return events;
        return events.filter(event => event?.source === inventorySource);
    }

    #slotsFromEvents(events) {
        const result = {};
        for (const event of events || []) {
            const source = String(event?.source || '');
            const slot = Number(event?.slot);
            if (!source || !Number.isInteger(slot)) continue;
            if (!result[source]) result[source] = [];
            if (!result[source].includes(slot)) result[source].push(slot);
        }
        return result;
    }

    #countIdentity(views, expectedIdentity) {
        if (!expectedIdentity) return 0;
        const counts = new Map();
        for (const view of views || []) {
            let sourceTotal = 0;
            for (const item of view?.items || []) {
                const identities = [
                    ...(Array.isArray(item.identityComponents) ? item.identityComponents : []),
                    ...(Array.isArray(item.identityNbt) ? item.identityNbt : [])
                ];
                if (identities.some(identity => identitiesEquivalent(expectedIdentity, identity))) {
                    sourceTotal += Math.max(0, Number(item.count) || 0);
                }
            }
            counts.set(view?.source || 'unknown', sourceTotal);
        }
        return Math.max(0, ...counts.values());
    }

    #signature(views) {
        return JSON.stringify((views || []).map(view => ({
            source: view?.source || null,
            windowId: view?.windowId ?? null,
            items: (view?.items || []).map(item => ({
                slot: item.slot,
                playerSlot: item.playerSlot,
                name: item.name,
                count: item.count,
                identityComponents: item.identityComponents || [],
                identityNbt: item.identityNbt || [],
                customMetadataPresent: Boolean(item.customMetadataPresent)
            }))
        })));
    }

    async #waitTicks(bot, ticks) {
        const count = Math.max(0, Number(ticks) || 0);
        if (count <= 0) return;
        if (typeof bot?.waitForTicks === 'function') {
            await bot.waitForTicks(count);
            return;
        }
        await Timeout.delay(count * this.config.fallbackTickMs);
    }

    #assertOwner(bot, generation, stage) {
        const current = this.context.get?.();
        const currentGeneration = Number(this.context.getGeneration?.());
        if (current !== bot || currentGeneration !== Number(generation) || this.context.has?.() === false) {
            throw new FlowError('Inventory sync connection changed during verification.', {
                code: 'INVENTORY_SYNC_STALE_GENERATION', subsystem: 'inventory', operation: 'InventorySyncService',
                step: stage, retryable: true,
                details: { expectedGeneration: Number(generation), currentGeneration }
            });
        }
    }

    #validateConfig(config) {
        const value = config && typeof config === 'object' ? config : {};
        return {
            minTicks: Number.isInteger(value.minTicks) && value.minTicks >= 0 ? value.minTicks : 2,
            pollTicks: Number.isInteger(value.pollTicks) && value.pollTicks >= 0 ? value.pollTicks : 1,
            pollMs: Number.isFinite(value.pollMs) && value.pollMs >= 0 ? value.pollMs : 50,
            quietMs: Number.isFinite(value.quietMs) && value.quietMs >= 0 ? value.quietMs : 125,
            timeoutMs: Number.isFinite(value.timeoutMs) && value.timeoutMs > 0 ? value.timeoutMs : 2500,
            stablePasses: Number.isInteger(value.stablePasses) && value.stablePasses > 0 ? value.stablePasses : 2,
            fallbackTickMs: Number.isFinite(value.fallbackTickMs) && value.fallbackTickMs > 0 ? value.fallbackTickMs : 50,
            debugMetadata: value.debugMetadata !== false,
            debugMaxItems: Number.isInteger(value.debugMaxItems) && value.debugMaxItems > 0 ? value.debugMaxItems : 8,
            persistStableSnapshot: value.persistStableSnapshot !== false
        };
    }
}

module.exports = InventorySyncService;
