'use strict';

const Timeout = require('../../../shared/time/Timeout');
const { identitiesEquivalent } = require('../../ItemIdentity');

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
        inventorySource = 'all'
    } = {}) {
        const startedAt = Date.now();
        const bot = this.context.require();
        const targetDelta = Math.max(0, Number(expectedDelta) || 0);
        const beforeIdentityCount = expectedIdentity
            ? this.#countIdentity(beforeViews, expectedIdentity)
            : 0;

        await this.#waitTicks(bot, this.config.minTicks);

        let previousSignature = null;
        let stablePasses = 0;
        let attempt = 0;
        let last = null;
        let firstSnapshot = true;

        while (Date.now() - startedAt <= this.config.timeoutMs) {
            attempt += 1;
            const eventsBeforeRead = this.#eventsSince(since, inventorySource);
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

            const events = this.#eventsSince(since, inventorySource) || eventsBeforeRead;
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
                    await this.observation?.capture?.(`${reason}:stable`).catch?.(() => {});
                }
                if (this.config.debugMetadata) {
                    this.#readViews(inventorySource, {
                        debugMetadataReason: `${reason}:stable`,
                        debugMaxItems: this.config.debugMaxItems,
                        debugFocusIdentity: expectedIdentity,
                        debugSlots: this.#slotsFromEvents(events)
                    });
                }
                return last;
            }

            if (this.config.pollTicks > 0) await this.#waitTicks(bot, this.config.pollTicks);
            else if (this.config.pollMs > 0) await Timeout.delay(this.config.pollMs);
            else await Promise.resolve();
        }

        const views = last?.views || this.#readViews(inventorySource);
        if (this.config.debugMetadata) {
            this.#readViews(inventorySource, {
                debugMetadataReason: `${reason}:sync-timeout`,
                debugMaxItems: this.config.debugMaxItems,
                debugFocusIdentity: expectedIdentity,
                debugSlots: this.#slotsFromEvents(this.#eventsSince(since, inventorySource))
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

    #eventsSince(since, inventorySource = 'all') {
        const events = this.observation?.eventsSince?.(since) || [];
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
