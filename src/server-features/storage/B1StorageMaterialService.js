'use strict';

const Result = require('../../shared/result/Result');
const Status = require('../../shared/result/Status');
const Timeout = require('../../shared/time/Timeout');
const FlowError = require('../../shared/errors/FlowError');
const Operation = require('../../operations/Operation');
const B1MaterialPolicy = require('./b1/B1MaterialPolicy');
const B1StartupReserveTrimmer = require('./b1/B1StartupReserveTrimmer');

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
    async protectForB5Batch({ cancellationToken = null, operationContext = null, expectedGeneration = null, batchId = null, trigger = null, episodeId: requestedEpisodeId = null } = {}) {
        const childOptions = { cancellationToken, operationContext, expectedGeneration };
        const episodeId = String(requestedEpisodeId || operationContext?.operationId || `${batchId || 'b5-batch'}:protect`);
        try {
            cancellationToken?.throwIfCancelled?.();
            const contract = this.#validateB5SmeltingContract({ expectedGeneration, batchId, episodeId });
            if (!contract.success) return contract;

            // A continuation belongs to the exact stable episode/generation.
            // It resumes the immutable sell budget directly: never re-smelt,
            // re-compact or absorb new inflow into this B5 batch.
            if (this.startupReserveTrimmer.hasEpisode(episodeId, { expectedGeneration, batchId })) {
                const resumed = await this.startupReserveTrimmer.run({
                    ...childOptions,
                    targetCoverage: B5_HARD_RESERVE_COVERAGE,
                    batchId,
                    trigger,
                    episodeId
                });
                if (!resumed.success) return resumed;
                return Result.ok({
                    episodeId,
                    batchId,
                    trigger,
                    connectionGeneration: expectedGeneration,
                    operationId: operationContext?.operationId || null,
                    correlationId: operationContext?.correlationId || null,
                    reserveCoverage: B5_HARD_RESERVE_COVERAGE,
                    resumedSellEpisode: true,
                    continuationRequired: resumed.data?.continuationRequired === true,
                    completeForEpisode: resumed.data?.completeForEpisode === true,
                    trimmed: resumed.data || null,
                    finalSnapshot: resumed.data?.finalSnapshot || null
                });
            }

            await this.storage.closeSellGui?.(childOptions);

            const fresh = await this.storage.read({ ...childOptions, refresh: true, forceReopen: true });
            if (!fresh.success) return fresh;

            const smelting = await this.preprocessForCraft({ ...childOptions, initialSnapshot: fresh.data });
            if (!smelting.success) return smelting;

            const compacted = await this.compactAll({
                ...childOptions,
                initialSnapshot: smelting.data?.finalSnapshot || fresh.data
            });
            if (!compacted.success) {
                return this.#contextualize(compacted, {
                    code: 'B1_B5_PROTECTION_COMPACT_UNVERIFIED',
                    step: 'protect-compact-verify',
                    action: 'compact B1 families before immutable sell baseline',
                    details: { batchId, trigger, expectedGeneration, episodeId }
                });
            }
            const unavailableConversion = (compacted.data?.actions || []).find(action =>
                action?.converted === false
                && Number(action?.beforeLoose || 0) > 0
                && action?.reason !== 'below-block-ratio'
                && action?.reason !== 'already-block-form');
            if (unavailableConversion) {
                const error = new FlowError(`Required B1 compaction option is unavailable: ${unavailableConversion.baseId}.`, {
                    code: 'B1_B5_PROTECTION_COMPACT_UNVERIFIED',
                    subsystem: 'b1', operation: 'B1StorageMaterialService', step: 'protect-compact-verify',
                    action: 'compact B1 families before immutable sell baseline', resource: unavailableConversion.baseId,
                    retryable: true,
                    details: { batchId, trigger, expectedGeneration, episodeId, conversion: unavailableConversion }
                });
                return Result.fail(Status.NOT_READY, error.message, error, error.toDiagnostic());
            }

            // The sell episode owns a fresh immutable baseline created only
            // after every conversion has been verified. The trimmer may use
            // later reads for evidence, but must never expand this budget.
            const baselineRead = await this.storage.read({ ...childOptions, refresh: true, forceReopen: true });
            if (!baselineRead.success) return baselineRead;

            const target = B5_HARD_RESERVE_COVERAGE;
            const trimmed = await this.startupReserveTrimmer.run({
                ...childOptions,
                targetCoverage: target,
                initialSnapshot: baselineRead.data,
                batchId,
                trigger,
                episodeId
            });
            if (!trimmed.success) return trimmed;

            return Result.ok({
                episodeId,
                batchId,
                trigger,
                connectionGeneration: expectedGeneration,
                operationId: operationContext?.operationId || null,
                correlationId: operationContext?.correlationId || null,
                reserveCoverage: target,
                resumedSellEpisode: false,
                continuationRequired: trimmed.data?.continuationRequired === true,
                completeForEpisode: trimmed.data?.completeForEpisode === true,
                freshSnapshot: fresh.data,
                smelting: smelting.data || null,
                compacted: compacted.data || null,
                sellBaseline: baselineRead.data,
                trimmed: trimmed.data || null,
                finalSnapshot: trimmed.data?.finalSnapshot
                    || compacted.data?.finalSnapshot
                    || smelting.data?.finalSnapshot
                    || fresh.data
            });
        } catch (error) {
            const wrapped = FlowError.wrap(error, {
                code: 'B1_B5_BATCH_PROTECTION_FAILED',
                subsystem: 'b1',
                operation: 'B1StorageMaterialService',
                step: 'protect-b5-batch',
                action: 'fresh /kho -> smelt -> compact -> trim to B5 reserve'
            });
            return Result.fail(Operation.statusForError(error), wrapped.message, wrapped, wrapped.toDiagnostic());
        } finally {
            // Generation-guarded best-effort cleanup. A stale callback must
            // never close a GUI owned by the replacement generation.
            try { await this.storage.closeSellGui?.(childOptions); } catch (_) { /* best-effort cleanup */ }
        }
    }

    #validateB5SmeltingContract({ expectedGeneration = null, batchId = null, episodeId = null } = {}) {
        const configured = Array.isArray(this.conversionConfig?.smeltingRecipeIds)
            ? this.conversionConfig.smeltingRecipeIds.map(value => String(value))
            : [];
        const missingConfigured = B5_SMELTING_RECIPE_IDS.filter(id => !configured.includes(id));
        const missingDefinitions = B5_SMELTING_RECIPE_IDS.filter(id => !this.smeltingConfig?.recipes?.[id]);
        const smeltingUnavailable = typeof this.smelting?.smelt !== 'function';
        if (missingConfigured.length === 0 && missingDefinitions.length === 0 && !smeltingUnavailable) {
            return Result.ok({ recipeIds: [...B5_SMELTING_RECIPE_IDS] });
        }
        const error = new FlowError('B5 storage protection smelting contract is incomplete.', {
            code: 'B1_B5_PROTECTION_SMELT_CONFIG_INVALID',
            subsystem: 'b1', operation: 'B1StorageMaterialService', step: 'protect-smelt-preflight',
            action: 'validate ordered iron -> gold smelting contract before side effects', retryable: false,
            details: {
                expectedGeneration, batchId, episodeId,
                requiredRecipeIds: [...B5_SMELTING_RECIPE_IDS],
                configuredRecipeIds: configured,
                missingConfigured, missingDefinitions, smeltingUnavailable
            }
        });
        return Result.fail(Status.NOT_READY, error.message, error, error.toDiagnostic());
    }

    async preprocessForCraft({ cancellationToken = null, operationContext = null, expectedGeneration = null, initialSnapshot = null } = {}) {
        try {
            const childOptions = { cancellationToken, operationContext, expectedGeneration };
            const actions = [];
            let snapshot = this.#reusableSnapshot(initialSnapshot);

            for (const recipeId of this.smeltingRecipeIds) {
                cancellationToken?.throwIfCancelled?.();
                const recipe = this.smeltingConfig?.recipes?.[recipeId];
                if (!recipe) throw new Error(`Configured smelting recipe not found: ${recipeId}`);

                snapshot = this.#reusableSnapshot(snapshot);
                const beforeResult = snapshot ? Result.ok(snapshot) : await this.storage.read(childOptions);
                if (!beforeResult.success) {
                    return this.#contextualize(beforeResult, {
                        code: 'B1_STORAGE_READ_FAILED',
                        step: 'preprocess-read-kho',
                        action: 'read /kho before smelting',
                        resource: recipe.input,
                        details: { recipeId }
                    });
                }

                snapshot = beforeResult.data;
                const beforeInput = Number(snapshot?.items?.[recipe.input] || 0);
                if (beforeInput <= 0) continue;
                const beforeOutput = Number(snapshot?.items?.[recipe.output] || 0);

                const smelted = await this.smelting.smelt(recipeId, { entry: 'direct', ...childOptions });
                if (!smelted.success) {
                    return this.#contextualize(smelted, {
                        code: 'B1_SMELTING_ACTION_FAILED',
                        step: 'preprocess-smelt',
                        action: `smelt ${recipe.input}`,
                        resource: recipe.input,
                        details: { recipeId, beforeInput, beforeOutput }
                    });
                }
                if (smelted.data?.skipped) {
                    const error = new FlowError(`Required B5 protection smelting option is unavailable: ${recipeId}.`, {
                        code: 'B1_B5_PROTECTION_SMELT_UNVERIFIED',
                        subsystem: 'b1', operation: 'B1StorageMaterialService', step: 'preprocess-smelt',
                        action: `smelt ${recipe.input}`, resource: recipe.input, retryable: true,
                        details: {
                            recipeId, beforeInput, beforeOutput,
                            afterInput: beforeInput, afterOutput: beforeOutput,
                            attempts: 0, expectedGeneration,
                            operationId: operationContext?.operationId || null,
                            correlationId: operationContext?.correlationId || null,
                            reason: smelted.data.reason || 'option-unavailable'
                        }
                    });
                    return Result.fail(Status.NOT_READY, error.message, error, error.toDiagnostic());
                }

                const verified = await this.#verifySmeltingResult({
                    recipeId,
                    recipe,
                    beforeInput,
                    beforeOutput,
                    ...childOptions
                });
                if (!verified.success) {
                    return this.#contextualize(verified, {
                        code: 'B1_SMELTING_VERIFY_FAILED',
                        step: 'preprocess-smelt-verify',
                        action: 'verify /kho after smelting',
                        resource: recipe.input,
                        details: { recipeId, beforeInput, beforeOutput }
                    });
                }

                snapshot = verified.data?.snapshot || null;
                actions.push({
                    recipeId,
                    beforeInput,
                    afterInput: verified.data.afterInput,
                    beforeOutput,
                    afterOutput: verified.data.afterOutput,
                    verificationAttempt: verified.data.attempt,
                    verified: true,
                    telemetryStale: false
                });
            }

            return Result.ok({ actions, finalSnapshot: snapshot });
        } catch (error) {
            const wrapped = FlowError.wrap(error, {
                code: 'B1_PREPROCESS_FAILED',
                subsystem: 'b1',
                operation: 'B1StorageMaterialService',
                step: 'preprocess',
                action: 'preprocess B1 for crafting'
            });
            return Result.fail(Operation.statusForError(error), wrapped.message, wrapped, wrapped.toDiagnostic());
        }
    }

    async ensureBaseAvailable(baseId, required, {
        cancellationToken = null,
        operationContext = null,
        expectedGeneration = null,
        decompressionPolicy = 'unbounded',
        decompressionMaxRatioOverride = null,
        requireKnownCapacityOverride = false
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
            if (beforeLoose >= amount) {
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

    async #verifySmeltingResult({ recipeId, recipe, beforeInput, beforeOutput, cancellationToken, operationContext = null, expectedGeneration = null }) {
        const attempts = Math.max(1, Number(this.smeltingConfig?.verificationAttempts || 6));
        const retryMs = Math.max(0, Number(this.smeltingConfig?.verificationRetryMs ?? 750));
        let last = { afterInput: beforeInput, afterOutput: beforeOutput, attempt: 0 };

        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            cancellationToken?.throwIfCancelled?.();
            if (attempt > 1 && retryMs > 0) await Timeout.delay(retryMs, { cancellationToken });

            const afterResult = await this.storage.read({
                refresh: true,
                forceReopen: attempt === attempts,
                cancellationToken,
                operationContext,
                expectedGeneration
            });
            if (!afterResult.success) {
                if (attempt >= attempts) return afterResult;
                continue;
            }

            const afterInput = Number(afterResult.data?.items?.[recipe.input] || 0);
            const afterOutput = Number(afterResult.data?.items?.[recipe.output] || 0);
            last = { afterInput, afterOutput, attempt, snapshot: afterResult.data };
            if (afterInput < beforeInput || afterOutput > beforeOutput) {
                return Result.ok({ ...last, verified: true, staleTelemetry: false, attempts });
            }

            this.logger?.debug?.('Waiting for /kho to reflect smelting result.', {
                recipeId,
                attempt,
                attempts,
                beforeInput,
                afterInput,
                beforeOutput,
                afterOutput
            });
        }

        const details = {
            recipeId,
            input: recipe.input,
            output: recipe.output,
            beforeInput,
            beforeOutput,
            afterInput: last.afterInput,
            afterOutput: last.afterOutput,
            attempts,
            expectedGeneration,
            operationId: operationContext?.operationId || null,
            correlationId: operationContext?.correlationId || null
        };
        const error = new FlowError(`Smelting could not be verified from a fresh /kho snapshot: ${recipeId}.`, {
            code: 'B1_B5_PROTECTION_SMELT_UNVERIFIED',
            subsystem: 'b1', operation: 'B1StorageMaterialService', step: 'preprocess-smelt-verify',
            action: 'verify smelting with fresh /kho', resource: recipe.input, retryable: true,
            attempt: attempts, details
        });
        return Result.fail(Status.VERIFICATION_FAILED, error.message, error, error.toDiagnostic());
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
