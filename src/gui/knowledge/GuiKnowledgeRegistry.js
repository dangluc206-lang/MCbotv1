'use strict';

const { strongestIdentity, identitiesEquivalent, identityStrength } = require('../../items/ItemIdentity');

class GuiKnowledgeRegistry {
    constructor({ botId, normalizer, store, itemResolver, bootstrapMappings = [], logger = null }) {
        if (typeof botId !== 'string' || !botId) throw new TypeError('botId is required.');
        if (!normalizer) throw new TypeError('normalizer is required.');
        if (!store) throw new TypeError('store is required.');
        this.botId = botId;
        this.normalizer = normalizer;
        this.store = store;
        this.itemResolver = itemResolver || null;
        this.logger = logger;
        this.bootstrapMappings = Array.isArray(bootstrapMappings) ? bootstrapMappings : [];
        this.records = new Map();
        this.liveSessions = new Map();
        this.globalItems = new Map();
        this.rejectedStoredStrongBindings = new Map();
    }

    async initialize() {
        const records = await this.store.listRecords();
        for (const record of records) {
            if (record?.id) this.records.set(record.id, record);
        }
        const globalKnowledge = await this.store.readKnowledge();
        for (const [logicalId, entry] of Object.entries(globalKnowledge.items || {})) this.globalItems.set(logicalId, entry);
        await this.#repairStaleStoredBootstrapBindings();
        await this.#bootstrapFromLearnedRecords();
        await this.#bootstrapFromStoredRecords();
        await this.#bootstrapFromSemanticRecords();
        const repaired = await this.#repairConfiguredStrongBindings();
        if (repaired > 0) await this.#invalidatePersonalVaultSemanticAfterRepair();
        this.logger?.debug?.('GUI knowledge loaded.', { botId: this.botId, records: this.records.size, repairedStrongBindings: repaired });
    }

    async stop() {}

    async destroy() {
        this.records.clear();
        this.liveSessions.clear();
        this.globalItems.clear();
    }

    async observe(session, { source = null } = {}) {
        if (!session?.window) return null;
        const effectiveSource = source || session.source || null;
        if (effectiveSource) session.setSource?.(effectiveSource);
        const normalized = this.normalizer.normalize(session);
        const key = this.normalizer.keyFor(normalized, { source: effectiveSource });
        const legacyKey = this.normalizer.legacyKeyFor(normalized);
        const result = await this.store.upsert(key, normalized, {
            source: effectiveSource,
            aliases: legacyKey !== key ? [legacyKey] : []
        });
        this.records.set(key, result.record);
        this.liveSessions.set(key, session);
        return { ...result, key };
    }

    keyForSource(source) {
        return this.normalizer.routeKeyFor(source);
    }

    getBySource(source) {
        const key = this.keyForSource(source);
        return key ? this.records.get(key) || null : null;
    }

    getLiveSession(source) {
        const key = this.keyForSource(source);
        return key ? this.liveSessions.get(key) || null : null;
    }

    async resolveSlot(session, {
        source,
        roleId,
        bootstrapSlot = null,
        logicalItemId = null,
        context = 'gui'
    }) {
        if (!session?.window) throw new TypeError('GUI session with window is required.');
        if (typeof roleId !== 'string' || !roleId) throw new TypeError('roleId is required.');

        const observed = await this.observe(session, { source });
        const key = observed.key;
        let record = observed.record;
        const learned = record.learned?.[roleId] || null;
        const slots = session.window.slots || [];

        const sample = this.#normalizeBootstrapSlot(bootstrapSlot);

        // 1) Prefer the fingerprint learned for this exact semantic role/route.
        if (learned?.fingerprint) {
            const matched = this.#findFingerprintSlot(slots, learned.fingerprint);
            if (matched >= 0) {
                const actualFingerprint = this.normalizer.fingerprintItem(slots[matched]);
                if (this.#fingerprintNeedsUpgrade(learned.fingerprint, actualFingerprint)) {
                    await this.learnSlot(session, {
                        source,
                        roleId,
                        slot: matched,
                        logicalItemId: logicalItemId || learned.logicalItemId || null,
                        context: context || learned.context || 'gui',
                        bootstrapSlot: learned.bootstrapSlot ?? sample,
                        relearned: false
                    });
                } else if (Number(learned.currentSlot) !== matched) {
                    record = await this.#saveLearned(key, roleId, {
                        ...learned,
                        currentSlot: matched,
                        lastMatchedAt: new Date().toISOString()
                    });
                }
                return matched;
            }
        }

        // 2) Reuse item identity learned globally from another GUI. This is
        // what lets a recipe learned in the crafting GUI be found later even
        // when its slot moves, without trusting a configured display name.
        if (logicalItemId) {
            const globalFingerprint = this.globalItems.get(logicalItemId)?.fingerprint || null;
            const globalMatch = globalFingerprint ? this.#findFingerprintSlot(slots, globalFingerprint) : -1;
            if (globalMatch >= 0) {
                await this.learnSlot(session, {
                    source,
                    roleId,
                    slot: globalMatch,
                    logicalItemId,
                    context,
                    bootstrapSlot: learned?.bootstrapSlot ?? sample,
                    relearned: Boolean(learned)
                });
                return globalMatch;
            }
        }

        // 3) Config/name rules are only a compatibility fallback. They are
        // deliberately below learned fingerprints because server text/font
        // can change while the item identity remains useful.
        if (logicalItemId && this.itemResolver) {
            const fallback = this.#findLogicalSlot(slots, logicalItemId, context);
            if (fallback >= 0) {
                await this.learnSlot(session, {
                    source,
                    roleId,
                    slot: fallback,
                    logicalItemId,
                    context,
                    bootstrapSlot: learned?.bootstrapSlot ?? sample,
                    relearned: Boolean(learned)
                });
                return fallback;
            }
        }

        // 4) Bootstrap slots are samples, not permanent addresses. They are
        // used only when no learned identity can currently locate the item.
        // This also self-heals a stale/corrupt fingerprint instead of leaving
        // a role permanently stuck at -1.
        if (sample !== null && slots[sample]) {
            await this.learnSlot(session, {
                source,
                roleId,
                slot: sample,
                logicalItemId,
                context,
                bootstrapSlot: sample,
                relearned: Boolean(learned)
            });
            return sample;
        }

        return -1;
    }

    async learnBootstrapSlots(session, { source, entries = [] } = {}) {
        if (!session?.window || !Array.isArray(entries) || entries.length === 0) return {};
        const output = {};
        for (const entry of entries) {
            if (!entry || typeof entry.roleId !== 'string' || !entry.roleId) continue;
            const slot = await this.resolveSlot(session, {
                source,
                roleId: entry.roleId,
                bootstrapSlot: entry.bootstrapSlot ?? null,
                logicalItemId: entry.logicalItemId ?? null,
                context: entry.context || 'gui'
            });
            output[entry.roleId] = slot;
        }
        return output;
    }

    async learnSlot(session, {
        source,
        roleId,
        slot,
        logicalItemId = null,
        context = 'gui',
        bootstrapSlot = null,
        relearned = false
    }) {
        if (!session?.window) throw new TypeError('GUI session with window is required.');
        if (!Number.isInteger(slot) || slot < 0) throw new TypeError('slot must be a non-negative integer.');
        const raw = session.window.slots?.[slot];
        if (!raw) return null;
        const observed = await this.observe(session, { source });
        const now = new Date().toISOString();
        const existing = observed.record.learned?.[roleId] || null;
        const entry = {
            roleId,
            logicalItemId: logicalItemId || existing?.logicalItemId || null,
            context: context || existing?.context || null,
            bootstrapSlot: Number.isInteger(bootstrapSlot)
                ? bootstrapSlot
                : (Number.isInteger(existing?.bootstrapSlot) ? existing.bootstrapSlot : null),
            currentSlot: slot,
            fingerprint: this.normalizer.fingerprintItem(raw),
            learnedAt: existing?.learnedAt || now,
            lastMatchedAt: now,
            relearnCount: Number(existing?.relearnCount || 0) + (relearned ? 1 : 0)
        };
        await this.#saveLearned(observed.key, roleId, entry);
        if (logicalItemId) {
            await this.#mergeGlobalItem(logicalItemId, entry.fingerprint, {
                route: observed.key, roleId, slot, source: 'gui-slot'
            }, { allowStrongAlias: false });
        }
        return entry;
    }

    resolveLogicalId(rawItem, context = 'inventory') {
        if (!rawItem) return null;
        const fingerprint = this.normalizer.fingerprintItem(rawItem);
        const configuredStrong = this.#resolveConfiguredStrongLogicalId(rawItem, context);
        if (configuredStrong) return configuredStrong;
        const learned = this.#resolveGlobalLogicalId(fingerprint, { strongOnly: this.#requiresStrongGlobalIdentity(context) });
        if (learned) return learned;
        return this.itemResolver?.resolve(rawItem, context)?.id || null;
    }

    /**
     * Resolve an item and persist its strong custom identity when the logical
     * id was obtained through a trusted fallback (for example a /pv 2 label).
     * This closes the gap where the vault name is recognizable but the same
     * item later has a vanilla English display name in player inventory.
     */
    async resolveAndLearnLogicalId(rawItem, context = 'inventory', { source = 'runtime-resolve', roleId = null } = {}) {
        if (!rawItem) return null;
        const fingerprint = this.normalizer.fingerprintItem(rawItem);
        const configuredStrong = this.#resolveConfiguredStrongLogicalId(rawItem, context);
        if (configuredStrong) {
            await this.#mergeGlobalItem(configuredStrong, fingerprint, { source, roleId, context, configuredStrong: true }, { allowStrongAlias: true });
            return configuredStrong;
        }
        const learned = this.#resolveGlobalLogicalId(fingerprint, { strongOnly: this.#requiresStrongGlobalIdentity(context) });
        if (learned) {
            // A weak historical display-name binding may be what resolved the
            // item. If the live item now exposes a strong MMOItems identity,
            // upgrade that same logical id immediately before it moves to a
            // context where the display name can become vanilla/English.
            if (this.#hasStrongIdentity(fingerprint)) {
                await this.#mergeGlobalItem(learned, fingerprint, { source, roleId, context, upgradedFromResolvedItem: true }, { allowStrongAlias: true });
            }
            return learned;
        }

        const fallback = this.itemResolver?.resolve(rawItem, context)?.id || null;
        if (fallback && this.#hasStrongIdentity(fingerprint)) {
            await this.#mergeGlobalItem(fallback, fingerprint, { source, roleId, context }, { allowStrongAlias: true });
        }
        return fallback;
    }

    async learnLogicalItem(logicalItemId, rawItem, { source = 'runtime', roleId = null, context = null } = {}) {
        if (typeof logicalItemId !== 'string' || !logicalItemId) throw new TypeError('logicalItemId is required.');
        if (!rawItem) throw new TypeError('rawItem is required.');
        // Inventory snapshots are already normalized and contain the stable
        // custom identity fields. Prefer that normalized object over any
        // legacy `raw` copy, whose Map/class component metadata may have been
        // destroyed by snapshot cloning.
        const hasStableIdentityShape = Array.isArray(rawItem.identityComponents)
            || Array.isArray(rawItem.identityNbt)
            || Object.prototype.hasOwnProperty.call(rawItem, 'customMetadataPresent');
        const fingerprintSource = hasStableIdentityShape ? rawItem : (rawItem.raw || rawItem);
        const fingerprint = this.normalizer.fingerprintItem(fingerprintSource);
        return this.#mergeGlobalItem(logicalItemId, fingerprint, { source, roleId, context }, { allowStrongAlias: true });
    }

    matchesLogical(rawItem, logicalId, context = 'inventory') {
        if (!rawItem || typeof logicalId !== 'string' || !logicalId) return false;
        const configuredStrong = this.#resolveConfiguredStrongLogicalId(rawItem, context);
        if (configuredStrong) return configuredStrong === logicalId;
        const learned = this.globalItems.get(logicalId);
        const actual = this.normalizer.fingerprintItem(rawItem);
        if (this.#entryMatchesFingerprint(learned, actual, { strongOnly: this.#requiresStrongGlobalIdentity(context) })) return true;
        try {
            return Boolean(this.itemResolver?.matches(rawItem, logicalId, context)?.matched);
        } catch {
            return false;
        }
    }

    getLogicalBinding(logicalItemId) {
        const entry = this.globalItems.get(logicalItemId);
        return entry ? this.#plain(entry) : null;
    }

    getStrongIdentity(logicalItemId) {
        const entry = this.globalItems.get(logicalItemId);
        const identities = this.#fingerprintsFor(entry)
            .flatMap(fingerprint => this.#identityValues(fingerprint));
        return strongestIdentity(identities);
    }

    async setSemantic(source, namespace, value) {
        if (typeof namespace !== 'string' || !namespace) throw new TypeError('namespace is required.');
        const key = this.keyForSource(source);
        if (!key) return null;
        const record = await this.store.updateSemantic(key, namespace, {
            capturedAt: Date.now(),
            data: this.#plain(value)
        });
        if (record) this.records.set(key, record);
        return record?.semantic?.[namespace] || null;
    }

    getSemantic(source, namespace, { maxAgeMs = Infinity } = {}) {
        const record = this.getBySource(source);
        const semantic = record?.semantic?.[namespace] || null;
        if (!semantic) return null;
        const capturedAt = Number(semantic.capturedAt || 0);
        if (Number.isFinite(maxAgeMs) && maxAgeMs >= 0 && Date.now() - capturedAt > maxAgeMs) return null;
        return semantic.data ?? null;
    }

    async invalidateSemantic(source, namespace = null) {
        const key = this.keyForSource(source);
        if (!key) return;
        const record = await this.store.invalidateSemantic(key, namespace);
        if (record) this.records.set(key, record);
    }

    async #bootstrapFromLearnedRecords() {
        for (const record of this.records.values()) {
            for (const learned of Object.values(record?.learned || {})) {
                if (!learned?.logicalItemId || !learned?.fingerprint) continue;
                await this.#mergeGlobalItem(learned.logicalItemId, learned.fingerprint, {
                    route: record.id, roleId: learned.roleId || null, storedLearned: true
                }, { allowStrongAlias: false });
            }
        }
    }

    async #bootstrapFromStoredRecords() {
        for (const mapping of this.bootstrapMappings) {
            const recordKeys = Array.isArray(mapping?.recordKeys) ? mapping.recordKeys : [];
            const record = recordKeys.map(key => this.records.get(key)).find(Boolean);
            if (!record) continue;
            const bySlot = new Map((record.latest?.items || []).map(item => [Number(item.slot), item]));
            for (const entry of mapping.entries || []) {
                const logicalItemId = entry?.logicalItemId;
                const slot = Number(entry?.bootstrapSlot);
                if (!logicalItemId || !Number.isInteger(slot) || slot < 0) continue;
                const raw = bySlot.get(slot);
                if (!raw) continue;
                await this.#mergeGlobalItem(logicalItemId, this.normalizer.fingerprintItem(raw), {
                    route: record.id, roleId: entry.roleId || null, slot, storedBootstrap: true
                }, { allowStrongAlias: false });
            }
        }
    }

    /**
     * Migrate old /pv 2 semantic snapshots. Older versions remembered the
     * logicalId and slot but did not persist the logicalId -> MMOItems binding.
     * The GUI observation from the same record still contains the slot's full
     * identity, so pair them on startup and repair global knowledge.
     */
    async #bootstrapFromSemanticRecords() {
        for (const record of this.records.values()) {
            const semanticItems = record?.semantic?.personalVault?.data?.items;
            if (!Array.isArray(semanticItems) || semanticItems.length === 0) continue;
            const latestBySlot = new Map((record.latest?.items || []).map(item => [Number(item.slot), item]));
            for (const semanticItem of semanticItems) {
                const logicalItemId = semanticItem?.logicalId;
                const slot = Number(semanticItem?.slot);
                if (!logicalItemId || !Number.isInteger(slot) || slot < 0) continue;
                const observed = latestBySlot.get(slot);
                if (!observed) continue;
                const fingerprint = this.normalizer.fingerprintItem(observed);
                if (!this.#hasStrongIdentity(fingerprint)) continue;
                await this.#mergeGlobalItem(logicalItemId, fingerprint, {
                    route: record.id, slot, semantic: 'personalVault', migrated: true
                }, { allowStrongAlias: true });
            }
        }
    }

    async #mergeGlobalItem(logicalItemId, fingerprint, learnedFrom = {}, { allowStrongAlias = true } = {}) {
        if (!fingerprint) return this.globalItems.get(logicalItemId) || null;
        if (this.#isRejectedStoredStrongBinding(logicalItemId, fingerprint, learnedFrom)) {
            this.logger?.debug?.('Skipped stale strong identity from stored GUI knowledge.', {
                botId: this.botId, logicalItemId, identity: strongestIdentity(this.#identityValues(fingerprint)), learnedFrom
            });
            return this.globalItems.get(logicalItemId) || null;
        }
        await this.#evictStrongIdentityFromOtherLogicalIds(logicalItemId, fingerprint, learnedFrom);
        const now = new Date().toISOString();
        const existing = this.globalItems.get(logicalItemId) || null;
        const fingerprints = this.#fingerprintsFor(existing);
        const incomingIdentity = strongestIdentity(this.#identityValues(fingerprint));
        const existingStrong = fingerprints
            .map(candidate => strongestIdentity(this.#identityValues(candidate)))
            .filter(Boolean);

        const equivalentIndex = fingerprints.findIndex(candidate => this.#fingerprintMatches(candidate, fingerprint));
        if (equivalentIndex < 0) {
            const conflictingStrong = incomingIdentity && existingStrong.some(identity => !identitiesEquivalent(identity, incomingIdentity));
            if (!conflictingStrong || allowStrongAlias) fingerprints.push(fingerprint);
            else this.logger?.warn?.('Logical item identity conflict ignored.', {
                botId: this.botId, logicalItemId, existingIdentities: existingStrong, incomingIdentity, learnedFrom
            });
        } else if (this.#fingerprintNeedsUpgrade(fingerprints[equivalentIndex], fingerprint)) {
            fingerprints[equivalentIndex] = fingerprint;
        }

        // Once a stable custom identity exists, weak display-name fingerprints
        // are no longer used as aliases. They were only bootstrap evidence and
        // could otherwise make a vanilla item look like a server custom item.
        if (fingerprints.some(candidate => this.#hasStrongIdentity(candidate))) {
            for (let index = fingerprints.length - 1; index >= 0; index -= 1) {
                if (!this.#hasStrongIdentity(fingerprints[index])) fingerprints.splice(index, 1);
            }
        }

        // Never demote a strong MMOItems binding to a display-name-only
        // fingerprint. Prefer the strongest canonical identity as primary,
        // while retaining trusted aliases for alternate GUI representations.
        fingerprints.sort((a, b) => this.#fingerprintStrength(b) - this.#fingerprintStrength(a));
        const primary = fingerprints[0] || fingerprint;
        const globalEntry = {
            logicalItemId,
            fingerprint: primary,
            fingerprints,
            learnedFrom,
            learnedAt: existing?.learnedAt || now,
            lastSeenAt: now
        };
        const globalKnowledge = await this.store.updateGlobalItem(logicalItemId, globalEntry);
        this.globalItems.set(logicalItemId, globalKnowledge.items[logicalItemId]);
        return this.globalItems.get(logicalItemId);
    }


    #resolveConfiguredStrongLogicalId(rawItem, context) {
        try {
            const resolved = this.itemResolver?.resolve(rawItem, context) || null;
            if (!resolved?.id) return null;
            const details = Array.isArray(resolved.match?.details) ? resolved.match.details : [];
            const identityMatched = resolved.match?.strength === 'VERY_STRONG'
                || details.some(detail => detail?.matched && detail?.field === 'identity');
            return identityMatched ? resolved.id : null;
        } catch {
            return null;
        }
    }

    async #repairConfiguredStrongBindings() {
        const repairs = [];
        for (const [logicalId, entry] of this.globalItems.entries()) {
            for (const fingerprint of this.#fingerprintsFor(entry)) {
                if (!this.#hasStrongIdentity(fingerprint)) continue;
                const configured = this.#resolveConfiguredStrongLogicalId(fingerprint, 'personal-vault')
                    || this.#resolveConfiguredStrongLogicalId(fingerprint, 'inventory');
                if (configured && configured !== logicalId) repairs.push({ from: logicalId, to: configured, fingerprint });
            }
        }
        for (const repair of repairs) {
            await this.#mergeGlobalItem(repair.to, repair.fingerprint, {
                source: 'startup-strong-identity-repair', migratedFrom: repair.from, configuredStrong: true
            }, { allowStrongAlias: true });
            this.logger?.warn?.('Repaired corrupted logical item identity binding.', {
                botId: this.botId,
                from: repair.from,
                to: repair.to,
                identity: strongestIdentity(this.#identityValues(repair.fingerprint))
            });
        }
        return repairs.length;
    }

    async #repairStaleStoredBootstrapBindings() {
        for (const mapping of this.bootstrapMappings) {
            const recordKeys = Array.isArray(mapping?.recordKeys) ? mapping.recordKeys : [];
            const record = recordKeys.map(key => this.records.get(key)).find(Boolean);
            if (!record) continue;
            const bySlot = new Map((record.latest?.items || []).map(item => [Number(item.slot), item]));
            for (const entry of mapping.entries || []) {
                const logicalItemId = entry?.logicalItemId;
                const slot = Number(entry?.bootstrapSlot);
                if (!logicalItemId || !Number.isInteger(slot) || slot < 0) continue;
                const existing = this.globalItems.get(logicalItemId);
                if (!existing?.learnedFrom?.storedBootstrap) continue;
                const strongExisting = this.#fingerprintsFor(existing).filter(fp => this.#hasStrongIdentity(fp));
                if (strongExisting.length === 0) continue;
                const current = bySlot.get(slot);
                if (!current) continue;
                const currentFingerprint = this.normalizer.fingerprintItem(current);
                if (strongExisting.some(fp => this.#fingerprintMatches(fp, currentFingerprint))) continue;
                if (this.#hasStrongIdentity(currentFingerprint)) continue;
                const oldCarriers = new Set(strongExisting.map(fp => String(fp?.name || '')).filter(Boolean));
                const currentCarrier = String(currentFingerprint?.name || '');
                // A recipe icon can omit the output's MMOItems metadata, so do
                // not discard a strong binding merely because the current icon
                // is metadata-light. Only reject the old bootstrap binding when
                // even the carrier changed (e.g. old diamond_pickaxe vs current
                // netherite_scrap for the tungsten recipe slot).
                if (!currentCarrier || oldCarriers.has(currentCarrier)) continue;

                const rejected = this.rejectedStoredStrongBindings.get(logicalItemId) || [];
                for (const fingerprint of strongExisting) {
                    const identity = strongestIdentity(this.#identityValues(fingerprint));
                    if (identity && !rejected.some(value => identitiesEquivalent(value, identity))) rejected.push(identity);
                }
                this.rejectedStoredStrongBindings.set(logicalItemId, rejected);
                this.globalItems.delete(logicalItemId);
                await this.store.removeGlobalItem?.(logicalItemId);
                this.logger?.warn?.('Removed stale strong identity learned from an old crafting bootstrap slot.', {
                    botId: this.botId,
                    logicalItemId,
                    bootstrapSlot: slot,
                    oldIdentities: strongExisting.flatMap(fp => this.#identityValues(fp)),
                    currentCarrier: currentFingerprint?.name || null
                });
            }
        }
    }

    #isRejectedStoredStrongBinding(logicalItemId, fingerprint, learnedFrom) {
        const sourceIsStored = Boolean(learnedFrom?.storedBootstrap || learnedFrom?.storedLearned);
        if (!sourceIsStored) return false;
        const rejected = this.rejectedStoredStrongBindings.get(logicalItemId) || [];
        if (rejected.length === 0) return false;
        const identity = strongestIdentity(this.#identityValues(fingerprint));
        return Boolean(identity && rejected.some(value => identitiesEquivalent(value, identity)));
    }

    async #evictStrongIdentityFromOtherLogicalIds(logicalItemId, fingerprint, learnedFrom) {
        const identity = strongestIdentity(this.#identityValues(fingerprint));
        if (!identity || identityStrength(identity) < 80) return;
        for (const [otherId, entry] of [...this.globalItems.entries()]) {
            if (otherId === logicalItemId) continue;
            const fingerprints = this.#fingerprintsFor(entry);
            const kept = fingerprints.filter(candidate => !this.#identityValues(candidate)
                .some(value => identitiesEquivalent(identity, value)));
            if (kept.length === fingerprints.length) continue;

            if (kept.length === 0) {
                this.globalItems.delete(otherId);
                await this.store.removeGlobalItem?.(otherId);
            } else {
                kept.sort((a, b) => this.#fingerprintStrength(b) - this.#fingerprintStrength(a));
                const updated = { ...entry, fingerprint: kept[0], fingerprints: kept, lastSeenAt: new Date().toISOString() };
                const knowledge = await this.store.updateGlobalItem(otherId, updated);
                this.globalItems.set(otherId, knowledge.items[otherId]);
            }
            this.logger?.warn?.('Strong item identity moved to a different logical item.', {
                botId: this.botId,
                identity,
                from: otherId,
                to: logicalItemId,
                learnedFrom
            });
        }
    }

    async #invalidatePersonalVaultSemanticAfterRepair() {
        for (const [key, record] of [...this.records.entries()]) {
            if (!record?.semantic?.personalVault) continue;
            const updated = await this.store.invalidateSemantic(key, 'personalVault');
            if (updated) this.records.set(key, updated);
        }
    }

    #resolveGlobalLogicalId(fingerprint, { strongOnly = false } = {}) {
        for (const [logicalId, learned] of this.globalItems.entries()) {
            if (this.#entryMatchesFingerprint(learned, fingerprint, { strongOnly })) return logicalId;
        }
        return null;
    }

    #entryMatchesFingerprint(entry, fingerprint, { strongOnly = false } = {}) {
        if (!entry || !fingerprint) return false;
        if (strongOnly) {
            const actualIdentity = strongestIdentity(this.#identityValues(fingerprint));
            if (!actualIdentity || identityStrength(actualIdentity) < 80) return false;
            return this.#fingerprintsFor(entry).some(candidate => this.#identityValues(candidate)
                .some(value => identitiesEquivalent(value, actualIdentity)));
        }
        return this.#fingerprintsFor(entry).some(candidate => this.#fingerprintMatches(candidate, fingerprint));
    }

    #requiresStrongGlobalIdentity(context) {
        return context === 'inventory' || context === 'personal-vault';
    }

    #fingerprintsFor(entry) {
        if (!entry) return [];
        const values = [];
        if (entry.fingerprint) values.push(entry.fingerprint);
        if (Array.isArray(entry.fingerprints)) values.push(...entry.fingerprints.filter(Boolean));
        const seen = new Set();
        return values.filter(value => {
            const key = JSON.stringify(value);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    #fingerprintStrength(fingerprint) {
        const identity = strongestIdentity(this.#identityValues(fingerprint));
        return identity ? 1000 + identityStrength(identity) : 0;
    }

    #hasStrongIdentity(fingerprint) {
        const identity = strongestIdentity(this.#identityValues(fingerprint));
        return Boolean(identity && identityStrength(identity) >= 80);
    }

    async #saveLearned(key, roleId, entry) {
        const record = await this.store.updateLearned(key, roleId, entry);
        if (record) this.records.set(key, record);
        return record;
    }

    #normalizeBootstrapSlot(value) {
        if (value === null || value === undefined || value === '') return null;
        const slot = Number(value);
        return Number.isInteger(slot) && slot >= 0 ? slot : null;
    }

    #findFingerprintSlot(slots, fingerprint) {
        for (let slot = 0; slot < slots.length; slot += 1) {
            const raw = slots[slot];
            if (!raw) continue;
            if (this.#fingerprintMatches(fingerprint, this.normalizer.fingerprintItem(raw))) return slot;
        }
        return -1;
    }

    #fingerprintMatches(expected, actual) {
        if (!expected || !actual) return false;

        const expectedIds = this.#identityValues(expected);
        const actualIds = this.#identityValues(actual);
        const expectedStrongest = strongestIdentity(expectedIds);
        if (expectedStrongest) {
            // Custom server identity is authoritative. The vanilla carrier and
            // display name may deliberately look like Redstone Dust, Coal, etc.
            return actualIds.some(actualId => identitiesEquivalent(expectedStrongest, actualId));
        }

        if (expected.customModelData !== null && expected.customModelData !== undefined
            && Number(expected.customModelData) !== Number(actual.customModelData)) return false;

        const expectedDisplay = String(expected.displayName || '');
        const actualDisplay = String(actual.displayName || '');
        if (expectedDisplay) return expectedDisplay === actualDisplay;

        const expectedName = String(expected.name || '');
        if (expectedName && expectedName !== String(actual.name || '')) return false;

        const expectedLore = Array.isArray(expected.lore) ? expected.lore.filter(Boolean) : [];
        if (expectedLore.length > 0) {
            const actualLore = Array.isArray(actual.lore) ? actual.lore.filter(Boolean) : [];
            return JSON.stringify(expectedLore) === JSON.stringify(actualLore);
        }
        return Boolean(expectedName);
    }

    #fingerprintNeedsUpgrade(existing, actual) {
        const existingIds = this.#identityValues(existing);
        const actualIds = this.#identityValues(actual);
        return actualIds.length > 0 && (existingIds.length === 0
            || strongestIdentity(existingIds) !== strongestIdentity(actualIds));
    }

    #identityValues(fingerprint) {
        return [...new Set([
            ...(Array.isArray(fingerprint?.identityComponents) ? fingerprint.identityComponents : []),
            ...(Array.isArray(fingerprint?.identityNbt) ? fingerprint.identityNbt : [])
        ].filter(Boolean).map(String))];
    }

    #findLogicalSlot(slots, logicalItemId, context) {
        return slots.findIndex(raw => raw && this.matchesLogical(raw, logicalItemId, context));
    }

    #plain(value) {
        if (value === null || value === undefined) return value;
        if (typeof value !== 'object') return value;
        if (Array.isArray(value)) return value.map(item => this.#plain(item));
        const output = {};
        for (const [key, child] of Object.entries(value)) {
            if (typeof child === 'function') continue;
            output[key] = this.#plain(child);
        }
        return output;
    }
}

module.exports = GuiKnowledgeRegistry;
