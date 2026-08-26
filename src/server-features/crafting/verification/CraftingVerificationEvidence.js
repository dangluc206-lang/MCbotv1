'use strict';

const { strongestIdentity } = require('../../../items/ItemIdentity');

class CraftingVerificationEvidence {
    constructor({ inventoryReader, inventoryCounter, guiKnowledge = null, inventoryObservation = null }) {
        Object.assign(this, { inventoryReader, inventoryCounter, guiKnowledge, inventoryObservation });
    }

    inputConsumptionEvidence(before, afterViews, inputRequirements, eventEvidence = null) {
        if (!inputRequirements || typeof inputRequirements !== 'object') return [];
        const evidence = [];
        for (const [inputId, rawRequirement] of Object.entries(inputRequirements)) {
            const requirement = this.normalizeInputRequirement(rawRequirement);
            const expected = requirement.amount;
            if (!inputId || expected <= 0) continue;

            if (requirement.source !== 'inventory') {
                evidence.push({
                    inputId,
                    expected,
                    source: requirement.source,
                    consumed: 0,
                    verified: false,
                    ignored: true,
                    reason: `input-source:${requirement.source}`,
                    snapshotVerified: false,
                    eventVerified: false,
                    snapshotConsumed: 0,
                    eventConsumed: 0,
                    countsBefore: {},
                    countsAfter: {},
                    perSource: {},
                    eventBySource: {}
                });
                continue;
            }

            const beforeCounted = before?.inputCounts?.[inputId]
                || this.countViews(before?.views || [before?.snapshot], inputId);
            const afterCounted = this.countViews(afterViews, inputId);
            const beforeBySource = beforeCounted.countsBySource || {};
            const afterBySource = afterCounted.countsBySource || {};
            let bestConsumed = 0;
            let bestSource = null;
            const perSource = {};

            for (const source of Object.keys(beforeBySource)) {
                if (!Object.prototype.hasOwnProperty.call(afterBySource, source)) continue;
                const beforeValue = Number(beforeBySource[source] || 0);
                const afterValue = Number(afterBySource[source] || 0);
                const consumed = Math.max(0, beforeValue - afterValue);
                perSource[source] = { before: beforeValue, after: afterValue, consumed };
                if (consumed > bestConsumed) {
                    bestConsumed = consumed;
                    bestSource = source;
                }
            }

            const eventInput = eventEvidence?.inputs?.[inputId] || null;
            const eventConsumed = Math.max(0, Number(eventInput?.consumed || 0));
            const snapshotVerified = bestConsumed >= expected;
            const eventVerified = eventConsumed >= expected;

            evidence.push({
                inputId,
                expected,
                consumed: Math.max(bestConsumed, eventConsumed),
                source: eventVerified ? eventInput?.source || 'event' : bestSource,
                verified: snapshotVerified || eventVerified,
                snapshotVerified,
                eventVerified,
                snapshotConsumed: bestConsumed,
                eventConsumed,
                countsBefore: beforeBySource,
                countsAfter: afterBySource,
                perSource,
                eventBySource: eventInput?.bySource || {}
            });
        }
        return evidence;
    }

    normalizeInputRequirement(rawRequirement) {
        if (rawRequirement && typeof rawRequirement === 'object' && !Array.isArray(rawRequirement)) {
            return {
                amount: Math.max(0, Number(rawRequirement.amount) || 0),
                source: String(rawRequirement.source || 'inventory')
            };
        }
        return {
            amount: Math.max(0, Number(rawRequirement) || 0),
            source: 'inventory'
        };
    }

    eventEvidence(since, outputId, inputRequirements, inventorySource = 'all', connectionGeneration = null) {
        const empty = { outputDelta: 0, outputBySource: {}, inputs: {}, eventCount: 0, mmoCandidates: [] };
        if (!this.inventoryObservation?.eventsSince) return empty;
        const allEvents = this.inventoryObservation.eventsSince(since, { connectionGeneration }) || [];
        const events = inventorySource === 'all'
            ? allEvents
            : allEvents.filter(event => event?.source === inventorySource);
        if (!Array.isArray(events) || events.length === 0) return empty;

        const outputBySource = {};
        const inputById = {};
        for (const [inputId, rawRequirement] of Object.entries(inputRequirements || {})) {
            const requirement = this.normalizeInputRequirement(rawRequirement);
            if (requirement.source === 'inventory' && requirement.amount > 0) inputById[inputId] = {};
        }

        for (const event of events) {
            const source = event?.source || 'unknown';
            const outputDelta = this.logicalItemDelta(event, outputId);
            outputBySource[source] = Number(outputBySource[source] || 0) + outputDelta;

            for (const inputId of Object.keys(inputById)) {
                const delta = this.logicalItemDelta(event, inputId);
                inputById[inputId][source] = Number(inputById[inputId][source] || 0) + delta;
            }
        }

        const positiveOutput = Object.fromEntries(
            Object.entries(outputBySource).map(([source, delta]) => [source, Math.max(0, Number(delta) || 0)])
        );
        const outputDelta = Math.max(0, ...Object.values(positiveOutput));
        const inputs = {};
        for (const [inputId, bySourceRaw] of Object.entries(inputById)) {
            const bySource = Object.fromEntries(
                Object.entries(bySourceRaw).map(([source, delta]) => [source, Math.max(0, -(Number(delta) || 0))])
            );
            const entries = Object.entries(bySource).sort((a, b) => b[1] - a[1]);
            inputs[inputId] = {
                consumed: entries[0]?.[1] || 0,
                source: entries[0]?.[0] || null,
                bySource
            };
        }
        return {
            outputDelta,
            outputBySource: positiveOutput,
            inputs,
            eventCount: events.length,
            mmoCandidates: this.mmoEventCandidates(since, inventorySource, connectionGeneration).map(candidate => ({
                identity: candidate.identity,
                delta: candidate.delta,
                bySource: candidate.bySource
            })),
            identitySamples: this.eventIdentitySamples(events)
        };
    }


    eventIdentitySamples(events) {
        const samples = [];
        for (const event of events || []) {
            const item = event?.newItem || event?.oldItem;
            if (!item) continue;
            const ids = [
                ...(Array.isArray(item.identityComponents) ? item.identityComponents : []),
                ...(Array.isArray(item.identityNbt) ? item.identityNbt : [])
            ].map(String).filter(Boolean);
            if (!item.customMetadataPresent && ids.length === 0 && samples.length >= 4) continue;
            samples.push({
                source: event.source || 'unknown',
                slot: Number.isInteger(event.slot) ? event.slot : null,
                name: item.name || null,
                displayName: item.displayName || null,
                count: Number(item.count || 0),
                identityComponents: Array.isArray(item.identityComponents) ? item.identityComponents.slice(0, 4) : [],
                identityNbt: Array.isArray(item.identityNbt) ? item.identityNbt.slice(0, 4) : [],
                customMetadataPresent: Boolean(item.customMetadataPresent)
            });
            if (samples.length >= 8) break;
        }
        return samples;
    }

    logicalItemDelta(event, logicalId) {
        if (!logicalId) return 0;
        const countOne = item => {
            if (!item) return 0;
            try {
                return this.inventoryCounter.count({ items: [item] }, logicalId);
            } catch {
                return 0;
            }
        };
        return countOne(event?.newItem) - countOne(event?.oldItem);
    }

    readViews(inventorySource = 'all') {
        if (inventorySource === 'bot-inventory' && typeof this.inventoryReader.readBotInventory === 'function') {
            const snapshot = this.inventoryReader.readBotInventory();
            return snapshot ? [snapshot] : [];
        }
        if (typeof this.inventoryReader.readViews === 'function') {
            const views = this.inventoryReader.readViews();
            if (Array.isArray(views) && views.length > 0) return views.filter(Boolean);
        }
        const snapshot = this.inventoryReader.read();
        return snapshot ? [snapshot] : [];
    }

    countViews(views, outputId) {
        const countsBySource = {};
        let best = { count: 0, snapshot: views?.[0] || null };
        for (const snapshot of views || []) {
            if (!snapshot) continue;
            const source = snapshot.source || 'unknown';
            const count = this.inventoryCounter.count(snapshot, outputId);
            countsBySource[source] = Math.max(Number(countsBySource[source] || 0), count);
            if (count > best.count || !best.snapshot) best = { count, snapshot };
        }
        return { ...best, countsBySource };
    }

    mmoEventCandidates(since, inventorySource = 'all', connectionGeneration = null) {
        if (!this.inventoryObservation?.eventsSince) return [];
        const allEvents = this.inventoryObservation.eventsSince(since, { connectionGeneration }) || [];
        const events = inventorySource === 'all'
            ? allEvents
            : allEvents.filter(event => event?.source === inventorySource);
        if (!Array.isArray(events) || events.length === 0) return [];

        const byIdentity = new Map();
        const ensure = (identity, item) => {
            if (!identity || !/^MMOITEMS_ITEM_ID:/i.test(identity)) return null;
            if (!byIdentity.has(identity)) {
                byIdentity.set(identity, { identity, item: item || null, bySource: {} });
            }
            const entry = byIdentity.get(identity);
            if (!entry.item && item) entry.item = item;
            return entry;
        };
        const identityOf = item => strongestIdentity([
            ...(Array.isArray(item?.identityComponents) ? item.identityComponents : []),
            ...(Array.isArray(item?.identityNbt) ? item.identityNbt : [])
        ]);
        const countOf = item => Math.max(0, Number(item?.count || 0));

        for (const event of events) {
            const source = event?.source || 'unknown';
            const oldIdentity = identityOf(event?.oldItem);
            const newIdentity = identityOf(event?.newItem);

            if (oldIdentity && oldIdentity === newIdentity) {
                const entry = ensure(newIdentity, event?.newItem || event?.oldItem);
                if (!entry) continue;
                entry.bySource[source] = Number(entry.bySource[source] || 0)
                    + (countOf(event?.newItem) - countOf(event?.oldItem));
                continue;
            }

            if (oldIdentity) {
                const entry = ensure(oldIdentity, event?.oldItem);
                if (entry) entry.bySource[source] = Number(entry.bySource[source] || 0) - countOf(event?.oldItem);
            }
            if (newIdentity) {
                const entry = ensure(newIdentity, event?.newItem);
                if (entry) entry.bySource[source] = Number(entry.bySource[source] || 0) + countOf(event?.newItem);
            }
        }

        const candidates = [];
        for (const entry of byIdentity.values()) {
            const positiveBySource = Object.fromEntries(
                Object.entries(entry.bySource).map(([source, delta]) => [
                    source,
                    Math.max(0, Number(delta) || 0)
                ])
            );
            const delta = Math.max(0, ...Object.values(positiveBySource));
            if (delta <= 0 || !entry.item) continue;
            candidates.push({
                identity: entry.identity,
                delta,
                item: entry.item,
                bySource: positiveBySource,
                source: 'craft-output-event-delta'
            });
        }
        return candidates.sort((a, b) => b.delta - a.delta || a.identity.localeCompare(b.identity));
    }

    bestPositiveMmoDeltaFromEvents(since, expectedDelta = null, inventorySource = 'all', connectionGeneration = null) {
        const candidates = this.mmoEventCandidates(since, inventorySource, connectionGeneration);
        if (candidates.length === 0) return null;

        const expected = Number(expectedDelta);
        if (Number.isFinite(expected) && expected > 0) {
            const exact = candidates.filter(candidate => candidate.delta === expected);
            if (exact.length === 1) return exact[0];

            // If pickups of the same custom item happen while the bot is
            // standing at the collector, the observed delta may exceed the
            // requested craft quantity. Accept it only when there is one
            // unambiguous MMOItems candidate large enough to explain the craft.
            const sufficient = candidates.filter(candidate => candidate.delta >= expected);
            if (sufficient.length === 1) return sufficient[0];
        }

        return candidates.length === 1 ? candidates[0] : null;
    }

    aggregateMmoTotalsAcrossViews(views) {
        const aggregate = new Map();
        for (const view of views || []) {
            if (!view) continue;
            const source = view.source || 'unknown';
            const totals = this.mmoTotals(view);
            for (const [identity, entry] of totals.entries()) {
                const count = Math.max(0, Number(entry.count || 0));
                const existing = aggregate.get(identity) || {
                    identity, count: 0, item: entry.item || null, bySource: {}
                };
                existing.bySource[source] = count;
                // currentWindow and bot.inventory mirror the same player
                // inventory. Use the freshest/largest view instead of summing
                // them, otherwise the same stack would be double-counted.
                if (count > existing.count || !existing.item) {
                    existing.count = count;
                    existing.item = entry.item || existing.item;
                }
                aggregate.set(identity, existing);
            }
        }
        return aggregate;
    }

    positiveMmoCandidatesAcrossAllViews(beforeViews, afterViews) {
        const before = this.aggregateMmoTotalsAcrossViews(beforeViews);
        const after = this.aggregateMmoTotalsAcrossViews(afterViews);
        const candidates = [];
        for (const [identity, entry] of after.entries()) {
            const previous = before.get(identity);
            const beforeCount = Math.max(0, Number(previous?.count || 0));
            const afterCount = Math.max(0, Number(entry.count || 0));
            const delta = afterCount - beforeCount;
            if (delta <= 0 || !entry.item) continue;
            candidates.push({
                identity,
                delta,
                before: beforeCount,
                after: afterCount,
                item: entry.item,
                bySourceBefore: previous?.bySource || {},
                bySourceAfter: entry.bySource || {},
                source: 'craft-output-normalized-inventory-delta'
            });
        }
        return candidates.sort((a, b) => b.delta - a.delta || a.identity.localeCompare(b.identity));
    }

    bestPositiveMmoDeltaAcrossAllViews(beforeViews, afterViews, expectedDelta = null) {
        const candidates = this.positiveMmoCandidatesAcrossAllViews(beforeViews, afterViews);
        if (candidates.length === 0) return null;

        const expected = Number(expectedDelta);
        if (Number.isFinite(expected) && expected > 0) {
            const exact = candidates.filter(candidate => candidate.delta === expected);
            if (exact.length === 1) return exact[0];

            const sufficient = candidates.filter(candidate => candidate.delta >= expected);
            if (sufficient.length === 1) return sufficient[0];
        }

        return candidates.length === 1 ? candidates[0] : null;
    }

    bestPositiveMmoDeltaAcrossViews(beforeViews, afterViews, expectedDelta = null) {
        const beforeBySource = new Map((beforeViews || []).filter(Boolean).map(view => [view.source || 'unknown', view]));
        const candidates = [];

        for (const after of afterViews || []) {
            if (!after) continue;
            const source = after.source || 'unknown';
            const before = beforeBySource.get(source);
            if (!before) continue;
            const candidate = this.bestPositiveMmoDelta(before, after, expectedDelta);
            if (candidate) candidates.push({ ...candidate, source });
        }

        if (candidates.length === 0) return null;
        const expected = Number(expectedDelta);
        if (Number.isFinite(expected) && expected > 0) {
            const exact = candidates.filter(candidate => candidate.delta === expected);
            const identities = [...new Set(exact.map(candidate => candidate.identity))];
            if (identities.length === 1) return exact[0];
        }

        const identities = [...new Set(candidates.map(candidate => candidate.identity))];
        if (identities.length === 1) {
            return candidates.sort((a, b) => b.delta - a.delta)[0];
        }
        return null;
    }

    bestPositiveMmoDelta(beforeSnapshot, afterSnapshot, expectedDelta = null) {
        const before = this.mmoTotals(beforeSnapshot);
        const after = this.mmoTotals(afterSnapshot);
        const candidates = [];
        for (const [identity, entry] of after.entries()) {
            const previous = before.get(identity)?.count || 0;
            if (entry.count > previous) candidates.push({
                identity,
                delta: entry.count - previous,
                item: entry.item
            });
        }
        if (candidates.length === 1) return candidates[0];

        const expected = Number(expectedDelta);
        if (Number.isFinite(expected) && expected > 0) {
            const exact = candidates.filter(candidate => candidate.delta === expected);
            if (exact.length === 1) return exact[0];
        }
        return null;
    }

    mmoTotals(snapshot) {
        const totals = new Map();
        for (const item of snapshot?.items || []) {
            const ids = [
                ...(Array.isArray(item.identityComponents) ? item.identityComponents : []),
                ...(Array.isArray(item.identityNbt) ? item.identityNbt : [])
            ];
            const identity = strongestIdentity(ids);
            if (!identity || !/^MMOITEMS_ITEM_ID:/i.test(identity)) continue;
            const existing = totals.get(identity) || { count: 0, item };
            existing.count += Number(item.count || 0);
            if (!existing.item) existing.item = item;
            totals.set(identity, existing);
        }
        return totals;
    }
}

module.exports = CraftingVerificationEvidence;
