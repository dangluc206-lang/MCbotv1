'use strict';

const Result = require('../../shared/result/Result');
const Status = require('../../shared/result/Status');
const FlowError = require('../../shared/errors/FlowError');
const Operation = require('../../operations/Operation');
const B1MaterialPolicy = require('./b1/B1MaterialPolicy');
const B1StartupReserveTrimmer = require('./b1/B1StartupReserveTrimmer');
const B1BatchProtectionCoordinator = require('./b1/B1BatchProtectionCoordinator');

const B5_HARD_RESERVE_COVERAGE = 1.5;

const B5_SMELTING_RECIPE_IDS = Object.freeze([
    'raw_iron_to_iron',
    'raw_gold_to_gold'
]);

function b5SmeltingRecipeIds() {
    // Ordered hard contract owned by B5 storage protection. Operator/config
    // ordering cannot weaken, omit or extend this sequence.
    return B5_SMELTING_RECIPE_IDS;
}

class B1StorageMaterialService {
    constructor({ storage, minerals, smelting, conversionConfig, smeltingConfig, recipeConfig = null, targetId = 'super_alloy', serverProfile = null, logger = null, now = Date.now }) {
        Object.assign(this, { storage, minerals, smelting, conversionConfig, smeltingConfig, recipeConfig, targetId, serverProfile, logger, now });
        this.#rebuildPolicy();
    }

    reconfigure({ conversionConfig = this.conversionConfig, storageConfig = this.storage?.config } = {}) {
        if (!conversionConfig || typeof conversionConfig !== 'object') throw new TypeError('conversionConfig is required');
        if (!storageConfig || typeof storageConfig !== 'object') throw new TypeError('storageConfig is required');
        this.conversionConfig = conversionConfig;
        this.storage?.reconfigure?.(storageConfig);
        this.#rebuildPolicy();
        return this.status();
    }

    #rebuildPolicy() {
        this.materialPolicy = new B1MaterialPolicy({
            minerals: this.minerals,
            conversionConfig: this.conversionConfig,
            smeltingConfig: this.smeltingConfig,
            recipeConfig: this.recipeConfig,
            targetId: this.targetId
        });
        this.resources = this.materialPolicy.resources;
        this.startupReserveTrimmer = new B1StartupReserveTrimmer({
            storage: this.storage,
            materialPolicy: this.materialPolicy,
            logger: this.logger,
            profileRef: this.serverProfile ? { id: this.serverProfile.id, revision: this.serverProfile.revision } : null
        });
        this.batchProtection = new B1BatchProtectionCoordinator({
            storage: this.storage,
            smelting: this.smelting,
            conversionConfig: this.conversionConfig,
            smeltingConfig: this.smeltingConfig,
            startupReserveTrimmer: this.startupReserveTrimmer,
            compactAll: options => this.compactAll(options),
            logger: this.logger,
            now: this.now
        });
        this.smeltingRecipeIds = b5SmeltingRecipeIds();
        this.b1DemandWeights = this.materialPolicy.b1DemandWeights;
        this.rawInputsByBase = this.materialPolicy.rawInputsByBase;
    }

    effectiveItems(items = {}) {
        return this.materialPolicy.effectiveItems(items);
    }

    craftableItems(snapshot = {}) {
        return this.materialPolicy.craftableItems(snapshot);
    }

    coverageSnapshot(snapshot = {}) {
        return this.materialPolicy.coverageSnapshot(snapshot);
    }

    shouldStartupTrim() {
        return this.storage?.config?.sell?.enabled !== false;
    }

    status() {
        return Object.freeze({
            storageProtection: Object.freeze({
                enabled: true,
                sellingCapabilityEnabled: this.storage?.config?.sell?.enabled !== false,
                reserveCoverage: B5_HARD_RESERVE_COVERAGE,
                sellQuantity: 64,
                allowSingle: false,
                smeltingRecipeIds: Object.freeze([...this.smeltingRecipeIds])
            })
        });
    }

    protectionEvidenceKey(blocker = null) {
        const latest = this.storage?.latest?.({ maxAgeMs: Infinity });
        if (!latest?.success || !latest.data?.items) return null;
        const items = latest.data.items;
        const resourceId = blocker?.resource || blocker?.material || blocker?.sellId || null;
        let resource = resourceId ? (this.resources?.[resourceId] || Object.values(this.resources || {}).find(entry => entry.sellId === resourceId || entry.blockId === resourceId)) : null;
        if (!resource && resourceId) {
            for (const [baseId, rawEntries] of Object.entries(this.rawInputsByBase || {})) {
                if ((rawEntries || []).some(entry => entry?.recipeId === resourceId || entry?.inputId === resourceId)) {
                    resource = this.resources?.[baseId] || null;
                    break;
                }
            }
        }
        // Evidence changes may only reopen a blocked protection step when the
        // blocker can be tied to a concrete material family. Hashing the entire
        // storage or global capacity would let unrelated inflow retrigger side
        // effects for an unrelated blocker.
        if (!resource) return null;
        const ids = new Set();
        ids.add(resource.baseId);
        if (resource.blockId) ids.add(resource.blockId);
        for (const raw of this.rawInputsByBase?.[resource.baseId] || []) ids.add(raw.inputId);
        const selectedItems = Object.fromEntries([...ids].sort().map(id => [id, Number(items[id] || 0)]));
        return JSON.stringify({
            resource: resource.baseId,
            items: selectedItems
        });
    }

    async startupTrimToReserve(options = {}) {
        return this.startupReserveTrimmer.run(options);
    }

    discardProtectionEpisode(episodeId) {
        return this.startupReserveTrimmer.discardEpisode(episodeId);
    }

    /**
     * Single B5 batch boundary for /kho.
     *
     * Order is intentionally fixed and has no pressure/burst/click policy:
     *   fresh /kho -> smelt raw iron/gold -> compact every B1 family ->
     *   sell surplus in verified 64-only slices above reserve -> verify fresh
     *   /kho. Sub-64 surplus is deliberately retained.
     *
     * Stone is never smelted because only the allowlisted iron/gold recipes can
     * enter this service. Craft-time code must never call this method mid-batch.
     */
    protectForB5Batch(options = {}) {
        return this.batchProtection.protect(options);
    }

    preprocessForCraft(options = {}) {
        return this.batchProtection.preprocess(options);
    }

    async ensureBaseAvailable(baseId, required, {
        cancellationToken = null,
        operationContext = null,
        expectedGeneration = null,
        decompressionPolicy = 'unbounded',
        decompressionMaxRatioOverride = null,
        requireKnownCapacityOverride = false,
        forceDecompress = false
    } = {}) {
        const childOptions = { cancellationToken, operationContext, expectedGeneration };
        try {
            const amount = Number(required || 0);
            if (!Number.isFinite(amount) || amount < 0) throw new Error('required must be non-negative');
            const resource = this.resources[baseId];
            if (!resource) return Result.fail(Status.NOT_FOUND, `B1 resource is not configured: ${baseId}`);

            const beforeResult = await this.storage.read(childOptions);
            if (!beforeResult.success) return beforeResult;
            const beforeLoose = Number(beforeResult.data?.items?.[baseId] || 0);
            if (beforeLoose >= amount && forceDecompress !== true) {
                return Result.ok({ baseId, required: amount, converted: false, ready: true, available: beforeLoose });
            }
            if (!resource.blockId) {
                return Result.fail(Status.NOT_READY, `Not enough ${baseId} in /kho.`, null, {
                    required: amount,
                    available: beforeLoose
                });
            }

            const beforeBlocks = Number(beforeResult.data?.items?.[resource.blockId] || 0);
            const effective = beforeLoose + (beforeBlocks * resource.ratio);
            if (effective < amount) {
                return Result.fail(Status.NOT_READY, `Not enough effective ${baseId} in /kho.`, null, {
                    required: amount,
                    loose: beforeLoose,
                    blocks: beforeBlocks,
                    ratio: resource.ratio,
                    effective
                });
            }

            const expansion = this.materialPolicy.assessBlockExpansion(beforeResult.data, resource, {
                maxRatioOverride: decompressionMaxRatioOverride,
                requireKnownCapacityOverride,
                unbounded: decompressionPolicy === 'unbounded'
            });
            if (!expansion.safe) {
                this.logger?.info?.('Blocked unsafe block -> base expansion for Collector+B5 headroom.', {
                    operation: 'B1StorageMaterialService',
                    step: 'ensure-base-expansion-safety',
                    action: 'wait for headroom before expanding all stored blocks',
                    resource: baseId,
                    required: amount,
                    loose: beforeLoose,
                    blocks: beforeBlocks,
                    ...expansion
                });
                return Result.ok({
                    baseId,
                    required: amount,
                    converted: false,
                    ready: false,
                    reason: expansion.reason || 'unsafe-block-expansion',
                    available: beforeLoose,
                    blocks: beforeBlocks,
                    effective,
                    expansion
                });
            }

            const converted = await this.minerals.toBase(baseId, childOptions);
            if (!converted.success) return converted;
            if (converted.data?.skipped) {
                return Result.ok({
                    baseId,
                    required: amount,
                    converted: false,
                    ready: false,
                    reason: converted.data.reason || 'conversion-option-unavailable',
                    available: beforeLoose,
                    blocks: beforeBlocks,
                    effective
                });
            }

            const afterResult = await this.storage.read({ ...childOptions, refresh: true });
            if (!afterResult.success) return afterResult;
            const afterLoose = Number(afterResult.data?.items?.[baseId] || 0);
            const afterBlocks = Number(afterResult.data?.items?.[resource.blockId] || 0);
            if (afterLoose < amount || (afterLoose <= beforeLoose && afterBlocks >= beforeBlocks)) {
                return Result.fail(Status.VERIFICATION_FAILED, `Block → base verification failed for ${baseId}.`, null, {
                    baseId,
                    required: amount,
                    beforeLoose,
                    afterLoose,
                    beforeBlocks,
                    afterBlocks
                });
            }
            return Result.ok({ baseId, required: amount, converted: true, ready: true, available: afterLoose });
        } catch (error) {
            return Result.fail(Operation.statusForError(error), error.message, error, { baseId, required });
        }
    }

    async compact(baseId, { cancellationToken = null, operationContext = null, expectedGeneration = null, initialSnapshot = null } = {}) {
        const childOptions = { cancellationToken, operationContext, expectedGeneration };
        try {
            const resource = this.resources[baseId];
            if (!resource) return Result.fail(Status.NOT_FOUND, `B1 resource is not configured: ${baseId}`);
            if (!resource.blockId || resource.ratio <= 1) {
                return Result.ok({
                    baseId,
                    converted: false,
                    reason: 'already-block-form',
                    snapshot: this.#reusableSnapshot(initialSnapshot)
                });
            }

            const reusable = this.#reusableSnapshot(initialSnapshot);
            const beforeResult = reusable ? Result.ok(reusable) : await this.storage.read(childOptions);
            if (!beforeResult.success) return beforeResult;
            const beforeLoose = Number(beforeResult.data?.items?.[baseId] || 0);
            if (beforeLoose < resource.ratio) {
                return Result.ok({
                    baseId,
                    converted: false,
                    reason: 'below-block-ratio',
                    loose: beforeLoose,
                    snapshot: beforeResult.data
                });
            }
            const beforeBlocks = Number(beforeResult.data?.items?.[resource.blockId] || 0);

            const converted = await this.minerals.toBlocks(baseId, childOptions);
            if (!converted.success) return converted;
            if (converted.data?.skipped) {
                return Result.ok({
                    baseId,
                    converted: false,
                    reason: converted.data.reason || 'conversion-option-unavailable',
                    beforeLoose,
                    beforeBlocks,
                    snapshot: beforeResult.data
                });
            }

            const afterResult = await this.storage.read({ ...childOptions, refresh: true });
            if (!afterResult.success) return afterResult;
            const afterLoose = Number(afterResult.data?.items?.[baseId] || 0);
            const afterBlocks = Number(afterResult.data?.items?.[resource.blockId] || 0);
            if (afterBlocks <= beforeBlocks && afterLoose >= beforeLoose) {
                return Result.fail(Status.VERIFICATION_FAILED, `Base → block verification failed for ${baseId}.`, null, {
                    baseId,
                    beforeLoose,
                    afterLoose,
                    beforeBlocks,
                    afterBlocks
                });
            }
            return Result.ok({
                baseId,
                converted: true,
                beforeLoose,
                afterLoose,
                beforeBlocks,
                afterBlocks,
                snapshot: afterResult.data
            });
        } catch (error) {
            return Result.fail(Operation.statusForError(error), error.message, error, { baseId });
        }
    }

    async compactAll({ cancellationToken = null, operationContext = null, expectedGeneration = null, initialSnapshot = null } = {}) {
        const actions = [];
        let snapshot = this.#reusableSnapshot(initialSnapshot);
        for (const baseId of Object.keys(this.resources)) {
            cancellationToken?.throwIfCancelled?.();
            const result = await this.compact(baseId, {
                cancellationToken,
                operationContext,
                expectedGeneration,
                initialSnapshot: snapshot
            });
            if (!result.success) return result;
            actions.push(result.data);
            snapshot = result.data?.snapshot || snapshot;
        }
        return Result.ok({ actions, finalSnapshot: snapshot });
    }

    #reusableSnapshot(snapshot, maxAgeMs = 1000) {
        if (!snapshot || typeof snapshot !== 'object') return null;
        const captured = Number(snapshot.capturedAt);
        if (!Number.isFinite(captured)) return null;
        if (this.now() - captured > Math.max(0, Number(maxAgeMs || 0))) return null;
        if (!snapshot.items || typeof snapshot.items !== 'object') return null;
        return snapshot;
    }

    #contextualize(result, context) {
        if (result?.success !== false) return result;
        const wrapped = FlowError.wrap(result.error || new Error(result.message || 'B1 action failed.'), {
            subsystem: 'b1',
            operation: 'B1StorageMaterialService',
            ...context,
            details: { ...(result.meta || {}), ...(context.details || {}) }
        });
        return Result.fail(result.status || Status.FAILED, wrapped.message, wrapped, wrapped.toDiagnostic());
    }
}

module.exports = B1StorageMaterialService;
