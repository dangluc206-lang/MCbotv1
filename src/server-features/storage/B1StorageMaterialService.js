'use strict';

const Result = require('../../shared/result/Result');
const Status = require('../../shared/result/Status');
const Timeout = require('../../shared/time/Timeout');
const FlowError = require('../../shared/errors/FlowError');

class B1StorageMaterialService {
    constructor({ storage, minerals, smelting, conversionConfig, smeltingConfig, recipeConfig = null, targetId = 'super_alloy', logger = null }) {
        Object.assign(this, { storage, minerals, smelting, conversionConfig, smeltingConfig, recipeConfig, targetId, logger });
        this.resources = this.#validateResources(conversionConfig?.resources);
        this.smeltingRecipeIds = Object.freeze([...(conversionConfig?.smeltingRecipeIds || [])]);
        this.b1DemandWeights = this.#deriveB1DemandWeights(recipeConfig, targetId);
        this.rawInputsByBase = this.#deriveRawInputsByBase(smeltingConfig);
        this.lastPressureObservation = null;
        this.lastMaterialObservation = null;
    }

    effectiveItems(items = {}) {
        const output = { ...(items || {}) };
        for (const resource of Object.values(this.resources)) {
            const loose = Number(items?.[resource.baseId] || 0);
            const canExpandBlocks = resource.blockId
                && this.minerals?.isAvailable?.(resource.baseId, 'toBase') !== false;
            const blocks = canExpandBlocks ? Number(items?.[resource.blockId] || 0) : 0;
            output[resource.baseId] = loose + (blocks * resource.ratio);
        }
        return output;
    }

    // Returns only B1 that can be made loose without risking a /kho capacity
    // spike. The conversion GUI has no quantity selector, so block -> base may
    // expand the entire stored block stack at once. Planner must not count that
    // stock as immediately craftable when the peak decompressed size would cross
    // the configured safety ceiling.
    craftableItems(snapshot = {}) {
        const items = snapshot?.items || snapshot || {};
        const output = { ...(items || {}) };
        for (const resource of Object.values(this.resources)) {
            const loose = Number(items?.[resource.baseId] || 0);
            const canExpandBlocks = resource.blockId
                && this.minerals?.isAvailable?.(resource.baseId, 'toBase') !== false;
            if (!canExpandBlocks) {
                output[resource.baseId] = loose;
                continue;
            }
            const assessment = this.#assessBlockExpansion(snapshot, resource);
            const blocks = assessment.safe ? Number(items?.[resource.blockId] || 0) : 0;
            output[resource.baseId] = loose + (blocks * resource.ratio);
        }
        return output;
    }

    coverageSnapshot(snapshot = {}) {
        const items = snapshot?.items || snapshot || {};
        const materials = {};
        for (const resource of Object.values(this.resources)) {
            const requiredPerB5 = Math.max(1, Number(this.b1DemandWeights?.[resource.baseId] || 1));
            const loose = Math.max(0, Number(items?.[resource.baseId] || 0));
            const blocks = resource.blockId ? Math.max(0, Number(items?.[resource.blockId] || 0)) : 0;
            let rawEffective = 0;
            const raw = [];
            for (const entry of this.rawInputsByBase?.[resource.baseId] || []) {
                const count = Math.max(0, Number(items?.[entry.inputId] || 0));
                const effective = count * entry.basePerInput;
                rawEffective += effective;
                raw.push(Object.freeze({ ...entry, count, effective }));
            }
            const effectiveB1 = loose + (blocks * resource.ratio) + rawEffective;
            materials[resource.baseId] = Object.freeze({
                baseId: resource.baseId,
                blockId: resource.blockId,
                loose,
                blocks,
                raw: Object.freeze(raw),
                rawEffective,
                effectiveB1,
                requiredPerB5,
                coverage: effectiveB1 / requiredPerB5
            });
        }
        return Object.freeze(materials);
    }

    /**
     * One-time mode-enable safety trim. `/kho` is the source of truth for total
     * B1 coverage because the sell GUI does not expose raw materials. The sell
     * GUI is used only to execute coarse safe sales for compressed block forms.
     * Raw and loose forms still count toward family coverage/reserve but are never
     * sold directly. This storage is continuously fed, so startup does not chase an exact
     * 3.000 B5 value: by default it sells 64 at a time and stops as soon as
     * another 64 would cross the hard reserve.
     */
    async startupTrimToReserve({ targetCoverage = null, cancellationToken = null } = {}) {
        try {
            const sellConfig = this.storage?.config?.sell || {};
            if (sellConfig.startupTrimEnabled === false) return Result.ok({ skipped: true, reason: 'disabled' });
            const reserveCoverage = Math.max(0, Number(targetCoverage ?? sellConfig.startupReserveCoverage ?? 3));
            const stopCoverage = Math.max(reserveCoverage, Number(sellConfig.startupStopCoverage ?? 3.25));
            const maxClicks = Math.max(1, Number(sellConfig.startupMaxClicks || 20000));
            // Keep the Sell GUI open for a long coarse burst. The local model is
            // deliberately conservative (it subtracts the requested 64 but does
            // not add NPC inflow), so it can safely drive toward the relative
            // stop band without bouncing through /kho after every few clicks.
            const checkpointClicks = Math.max(1, Number(sellConfig.startupCheckpointClicks || 512));
            const maxPasses = Math.max(1, Number(sellConfig.startupMaxPasses || 6));
            const allowSingle = sellConfig.startupAllowSingle === true;
            // `/kho sell` stays open and exposes live material amounts. Do not
            // bounce back to `/kho` every few clicks: that command ping-pong is
            // both unnecessary and unreliable on this server. `/kho` remains
            // the full-coverage source (including raw) at startup and for the
            // final verification; between those points the verified Sell GUI
            // delta is enough to keep a conservative local coverage snapshot.
            const actions = [];
            let snapshotResult = await this.storage.read({ refresh: true, cancellationToken });
            if (!snapshotResult.success) return snapshotResult;
            let snapshot = snapshotResult.data;
            const initialCoverage = this.coverageSnapshot(snapshot);

            this.logger?.warn?.('B5 STARTUP STORAGE SAFETY CHECK.', {
                operation: 'B1StorageMaterialService', step: 'startup-reserve-trim',
                reserveCoverage, stopCoverage, saleGranularity: allowSingle ? '64+1' : '64-only',
                materials: this.#coverageLog(initialCoverage)
            });

            let totalClicks = 0;
            let finalCoverage = initialCoverage;
            let finalCandidate = null;
            for (let pass = 1; pass <= maxPasses && totalClicks < maxClicks; pass += 1) {
                const unavailable = new Set();
                let passClicks = 0;

                while (passClicks < checkpointClicks && totalClicks < maxClicks) {
                    cancellationToken?.throwIfCancelled?.();
                    const coverage = this.coverageSnapshot(snapshot);
                    const candidate = this.#selectReserveSaleAction(
                        snapshot.items || {}, coverage, reserveCoverage, unavailable, {},
                        { allowSingle, minCoverageToSell: stopCoverage }
                    );
                    if (!candidate) break;

                    const sold = await this.storage.sell(candidate.logicalId, {
                        quantity: candidate.quantity,
                        cancellationToken
                    });
                    if (!sold.success) return sold;
                    if (sold.data?.skipped) {
                        unavailable.add(candidate.logicalId);
                        continue;
                    }

                    actions.push({ ...candidate, result: sold.data, pass });
                    totalClicks += 1;
                    passClicks += 1;
                    // Sell GUI amount text is not authoritative on this server:
                    // runtime has exposed bogus values such as 0/1 while /kho
                    // held tens of thousands of blocks. Between full /kho
                    // checkpoints, advance only the conservative local model by
                    // the requested sale quantity. NPC inflow can only make the
                    // real stock higher than this model, so reserve safety is not
                    // weakened by delaying the full /kho checkpoint.
                    snapshot = this.#snapshotAfterSale(snapshot, candidate, sold.data);
                }

                await this.storage.closeSellGui?.();
                const checkpoint = await this.storage.read({ refresh: true, forceReopen: true, cancellationToken });
                if (!checkpoint.success) return checkpoint;
                snapshot = checkpoint.data;
                finalCoverage = this.coverageSnapshot(snapshot);
                finalCandidate = this.#selectReserveSaleAction(
                    snapshot.items || {}, finalCoverage, reserveCoverage, new Set(), {},
                    { allowSingle, minCoverageToSell: stopCoverage }
                );

                this.logger?.info?.('B5 STARTUP STORAGE SAFETY CHECKPOINT.', {
                    operation: 'B1StorageMaterialService', step: 'startup-reserve-trim',
                    pass, clicks: passClicks, totalClicks, reserveCoverage, stopCoverage,
                    canTrimMore: Boolean(finalCandidate),
                    remainingAboveTarget: Object.values(finalCoverage)
                        .filter(entry => entry.coverage > stopCoverage + 1e-9)
                        .map(entry => ({ baseId: entry.baseId, coverage: entry.coverage }))
                });

                if (!finalCandidate) break;
            }

            const remainingSurplus = Object.values(finalCoverage).filter(entry => entry.coverage > stopCoverage + 1e-9);
            if (finalCandidate) {
                return Result.fail(Status.NOT_READY,
                    `Startup B1 safety is still above the relative ${stopCoverage.toFixed(2)} B5 target.`,
                    null,
                    {
                        reserveCoverage,
                        stopCoverage,
                        sales: actions.length,
                        remainingSurplus: remainingSurplus.map(entry => ({ baseId: entry.baseId, coverage: entry.coverage }))
                    }
                );
            }

            this.logger?.warn?.('B5 STARTUP STORAGE SAFETY COMPLETE.', {
                operation: 'B1StorageMaterialService', step: 'startup-reserve-trim',
                reserveCoverage, stopCoverage, sales: actions.length, saleGranularity: allowSingle ? '64+1' : '64-only',
                remainingSurplus: remainingSurplus.map(entry => ({ baseId: entry.baseId, coverage: entry.coverage }))
            });
            return Result.ok({
                skipped: false,
                reserveCoverage,
                stopCoverage,
                actions,
                initialCoverage,
                finalCoverage,
                remainingSurplus: remainingSurplus.map(entry => entry.baseId)
            });
        } catch (error) {
            const wrapped = FlowError.wrap(error, {
                code: 'B1_STARTUP_RESERVE_TRIM_FAILED', subsystem: 'b1', operation: 'B1StorageMaterialService',
                step: 'startup-reserve-trim', action: 'trim B1 surplus to startup reserve'
            });
            return Result.fail(Status.FAILED, wrapped.message, wrapped, wrapped.toDiagnostic());
        }
    }

    async preprocessForCraft({ cancellationToken = null } = {}) {
        try {
            const actions = [];
            for (const recipeId of this.smeltingRecipeIds) {
                cancellationToken?.throwIfCancelled?.();
                const recipe = this.smeltingConfig?.recipes?.[recipeId];
                if (!recipe) throw new Error(`Configured smelting recipe not found: ${recipeId}`);

                const beforeResult = await this.storage.read();
                if (!beforeResult.success) return this.#contextualize(beforeResult, { code: 'B1_STORAGE_READ_FAILED', step: 'preprocess-read-kho', action: 'read /kho before smelting', resource: recipe.input, details: { recipeId } });
                const beforeInput = Number(beforeResult.data?.items?.[recipe.input] || 0);
                if (beforeInput <= 0) continue;
                const beforeOutput = Number(beforeResult.data?.items?.[recipe.output] || 0);

                const smelted = await this.smelting.smelt(recipeId, { entry: 'direct', cancellationToken });
                if (!smelted.success) return this.#contextualize(smelted, { code: 'B1_SMELTING_ACTION_FAILED', step: 'preprocess-smelt', action: `smelt ${recipe.input}`, resource: recipe.input, details: { recipeId, beforeInput, beforeOutput } });
                if (smelted.data?.skipped) {
                    actions.push({
                        recipeId,
                        skipped: true,
                        reason: smelted.data.reason || 'option-unavailable',
                        beforeInput,
                        beforeOutput
                    });
                    continue;
                }

                const verified = await this.#verifySmeltingResult({
                    recipeId,
                    recipe,
                    beforeInput,
                    beforeOutput,
                    cancellationToken
                });
                if (!verified.success) return this.#contextualize(verified, { code: 'B1_SMELTING_VERIFY_FAILED', step: 'preprocess-smelt-verify', action: 'verify /kho after smelting', resource: recipe.input, details: { recipeId, beforeInput, beforeOutput } });
                if (verified.data?.verified === false) {
                    this.logger?.warn?.('B1 smelting action was sent but /kho telemetry stayed unchanged; continuing with fresh planning instead of blocking B5.', {
                        operation: 'B1StorageMaterialService', step: 'preprocess-smelt-verify', phase: 'UNCONFIRMED',
                        action: 'continue after unconfirmed smelting telemetry', resource: recipe.input,
                        recipeId, beforeInput, beforeOutput,
                        afterInput: verified.data.afterInput,
                        afterOutput: verified.data.afterOutput,
                        attempts: verified.data.attempts
                    });
                }
                actions.push({
                    recipeId,
                    beforeInput,
                    afterInput: verified.data.afterInput,
                    beforeOutput,
                    afterOutput: verified.data.afterOutput,
                    verificationAttempt: verified.data.attempt,
                    verified: verified.data?.verified !== false,
                    telemetryStale: verified.data?.verified === false
                });
            }
            return Result.ok({ actions });
        } catch (error) {
            const wrapped = FlowError.wrap(error, { code: 'B1_PREPROCESS_FAILED', subsystem: 'b1', operation: 'B1StorageMaterialService', step: 'preprocess', action: 'preprocess B1 for crafting' });
            return Result.fail(Status.FAILED, wrapped.message, wrapped, wrapped.toDiagnostic());
        }
    }

    async ensureBaseAvailable(baseId, required, { cancellationToken = null } = {}) {
        try {
            const amount = Number(required || 0);
            if (!Number.isFinite(amount) || amount < 0) throw new Error('required must be non-negative');
            const resource = this.resources[baseId];
            if (!resource) return Result.fail(Status.NOT_FOUND, `B1 resource is not configured: ${baseId}`);

            const beforeResult = await this.storage.read();
            if (!beforeResult.success) return beforeResult;
            const beforeLoose = Number(beforeResult.data?.items?.[baseId] || 0);
            if (beforeLoose >= amount) return Result.ok({ baseId, required: amount, converted: false, ready: true, available: beforeLoose });
            if (!resource.blockId) {
                return Result.fail(Status.NOT_READY, `Not enough ${baseId} in /kho.`, null, { required: amount, available: beforeLoose });
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

            const expansion = this.#assessBlockExpansion(beforeResult.data, resource);
            if (!expansion.safe) {
                this.logger?.warn?.('Blocked unsafe block -> base expansion to protect /kho capacity.', {
                    operation: 'B1StorageMaterialService',
                    step: 'ensure-base-expansion-safety',
                    action: 'wait for fresh loose B1 instead of expanding all stored blocks',
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

            const converted = await this.minerals.toBase(baseId, { cancellationToken });
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
            const afterResult = await this.storage.read({ refresh: true });
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
            return Result.fail(Status.FAILED, error.message, error, { baseId, required });
        }
    }

    async compact(baseId, { cancellationToken = null } = {}) {
        try {
            const resource = this.resources[baseId];
            if (!resource) return Result.fail(Status.NOT_FOUND, `B1 resource is not configured: ${baseId}`);
            if (!resource.blockId || resource.ratio <= 1) {
                return Result.ok({ baseId, converted: false, reason: 'already-block-form' });
            }

            const beforeResult = await this.storage.read();
            if (!beforeResult.success) return beforeResult;
            const beforeLoose = Number(beforeResult.data?.items?.[baseId] || 0);
            if (beforeLoose < resource.ratio) {
                return Result.ok({ baseId, converted: false, reason: 'below-block-ratio', loose: beforeLoose });
            }
            const beforeBlocks = Number(beforeResult.data?.items?.[resource.blockId] || 0);

            const converted = await this.minerals.toBlocks(baseId, { cancellationToken });
            if (!converted.success) return converted;
            if (converted.data?.skipped) {
                return Result.ok({
                    baseId,
                    converted: false,
                    reason: converted.data.reason || 'conversion-option-unavailable',
                    beforeLoose,
                    beforeBlocks
                });
            }
            const afterResult = await this.storage.read({ refresh: true });
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
            return Result.ok({ baseId, converted: true, beforeLoose, afterLoose, beforeBlocks, afterBlocks });
        } catch (error) {
            return Result.fail(Status.FAILED, error.message, error, { baseId });
        }
    }

    async compactAll({ cancellationToken = null } = {}) {
        const actions = [];
        for (const baseId of Object.keys(this.resources)) {
            cancellationToken?.throwIfCancelled?.();
            const result = await this.compact(baseId, { cancellationToken });
            if (!result.success) return result;
            actions.push(result.data);
        }
        return Result.ok({ actions });
    }

    // /kho is a continuously-fed buffer. High-water protection first drains
    // any safe compressed block surplus already available. Selling is block-only.
    // If pressure remains, raw -> loose (1:1) and loose -> block compaction are
    // allowed because they are capacity-neutral/reducing; then pressure is read
    // again and only compressed block surplus may be sold.
    async stabilizeStorage({ cancellationToken = null } = {}) {
        try {
            const policy = this.conversionConfig?.storagePressure || {};
            const maxPasses = Math.max(1, Number(policy.maxProtectionPasses || 3));
            const passes = [];
            let pressure = null;
            let pressureBeforeRelief = null;

            for (let pass = 1; pass <= maxPasses; pass += 1) {
                cancellationToken?.throwIfCancelled?.();

                const before = await this.inspectStoragePressure({ cancellationToken });
                if (!before.success) return before;
                pressure = before.data;
                pressureBeforeRelief ||= pressure;

                let relievedBeforeCompact = null;
                let pressureSmelting = null;
                if (pressure?.protectionRequired === true) {
                    relievedBeforeCompact = await this.relieveStoragePressure({ cancellationToken });
                    if (!relievedBeforeCompact.success) return relievedBeforeCompact;
                    pressure = relievedBeforeCompact.data?.pressure || pressure;

                    // Selling is block-only. If pressure remains, raw/loose
                    // B1 must not become a deadlock: smelting raw -> loose is
                    // capacity-neutral, and compacting loose -> block only reduces
                    // /kho occupancy. These maintenance actions are therefore safe
                    // even while protection is active; they create compressed stock
                    // that a later block-only sale can drain.
                    if (pressure?.protectionRequired === true && this.smeltingRecipeIds.length > 0) {
                        pressureSmelting = await this.preprocessForCraft({ cancellationToken });
                        if (!pressureSmelting.success) return pressureSmelting;
                        const afterSmelt = await this.inspectStoragePressure({ cancellationToken });
                        if (!afterSmelt.success) return afterSmelt;
                        pressure = afterSmelt.data;
                    }
                }

                // loose -> block is always capacity-reducing, so keep compacting
                // even while /kho is above high-water. A GUI failure is best-effort
                // and must not re-enable loose selling; existing block surplus can
                // still be sold on the next protection pass.
                const compacted = await this.#compactAllBestEffort({ cancellationToken });

                const afterCompact = await this.inspectStoragePressure({ cancellationToken });
                if (!afterCompact.success) return afterCompact;
                pressure = afterCompact.data;

                let relievedAfterCompact = null;
                if (pressure?.protectionRequired === true) {
                    relievedAfterCompact = await this.relieveStoragePressure({ cancellationToken });
                    if (!relievedAfterCompact.success) return relievedAfterCompact;
                    pressure = relievedAfterCompact.data?.pressure || pressure;
                }

                passes.push({
                    pass,
                    pressureBefore: before.data,
                    relievedBeforeCompact: relievedBeforeCompact?.data || null,
                    pressureSmelting: pressureSmelting?.data || null,
                    compacted,
                    relievedAfterCompact: relievedAfterCompact?.data || null,
                    pressure
                });

                if (pressure?.known && pressure?.protectionRequired === true) continue;
                break;
            }

            return Result.ok({
                passes,
                compacted: passes.at(-1)?.compacted || null,
                relieved: passes.at(-1)?.relievedAfterCompact || passes.at(-1)?.relievedBeforeCompact || null,
                pressureBeforeRelief,
                pressure
            });
        } catch (error) {
            return Result.fail(Status.FAILED, error.message, error);
        }
    }

    async #compactAllBestEffort({ cancellationToken = null } = {}) {
        const actions = [];
        const failures = [];
        for (const baseId of Object.keys(this.resources)) {
            cancellationToken?.throwIfCancelled?.();
            const result = await this.compact(baseId, { cancellationToken });
            if (!result.success) {
                failures.push({ baseId, status: result.status, message: result.message, meta: result.meta || null });
                this.logger?.warn?.('B1 compaction failed during storage stabilization; continuing protection with the remaining resources.', {
                    operation: 'B1StorageMaterialService',
                    step: 'storage-best-effort-compact',
                    resource: baseId,
                    error: result.message
                });
                continue;
            }
            actions.push(result.data);
        }
        return { actions, failures, skipped: false };
    }

    async inspectStoragePressure({ cancellationToken = null } = {}) {
        try {
            cancellationToken?.throwIfCancelled?.();
            const snapshotResult = await this.storage.read({ refresh: true, cancellationToken });
            if (!snapshotResult.success) return snapshotResult;
            const pressure = this.#storagePressure(snapshotResult.data, { record: true });
            const itemUnits = Object.values(snapshotResult.data?.items || {}).reduce((sum, value) => {
                const amount = Number(value);
                return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
            }, 0);
            if (!pressure.known) {
                this.logger?.warn?.('KHO PRESSURE UNKNOWN: /kho items were read but capacity could not be resolved.', {
                    operation: 'B1StorageMaterialService', step: 'storage-pressure-read', itemUnits, capacity: snapshotResult.data?.capacity || null
                });
            } else if (pressure.protectionRequired) {
                this.logger?.warn?.('KHO HIGH-WATER PROTECTION ACTIVE.', {
                    operation: 'B1StorageMaterialService', step: 'storage-pressure-read',
                    used: pressure.used, limit: pressure.limit, usageRatio: pressure.usageRatio,
                    highWaterRatio: pressure.highWaterRatio, lowWaterRatio: pressure.lowWaterRatio, itemUnits
                });
            }
            return Result.ok(pressure);
        } catch (error) {
            return Result.fail(Status.FAILED, error.message, error);
        }
    }

    async relieveStoragePressure({ cancellationToken = null } = {}) {
        try {
            const actions = [];
            const bursts = [];
            const policy = this.conversionConfig?.storagePressure || {};
            const sellConfig = this.storage?.config?.sell || {};
            const reserveCoverage = Math.max(0, Number(sellConfig.startupReserveCoverage ?? 3));
            const allowSingle = sellConfig.pressureAllowSingle === true;
            const baseBurstClicks = Math.max(1, Number(policy.maxSalesPerPass || 8));
            const maxBurstClicks = Math.max(baseBurstClicks, Number(policy.maxSellBurstClicks || 64));
            const maxBursts = Math.max(1, Number(policy.maxSellBurstsPerPass || 6));
            const escalationFactor = Math.max(1, Number(policy.sellBurstEscalationFactor || 2));
            const minImprovementRatio = Math.max(0, Number(policy.minPressureImprovementRatio ?? 0.002));
            let burstBudget = baseBurstClicks;
            let protectionStarted = false;
            let nonImprovingBursts = 0;

            await this.storage.closeSellGui?.();
            let snapshotResult = await this.storage.read({ refresh: true, forceReopen: true, cancellationToken });
            if (!snapshotResult.success) return snapshotResult;
            let snapshot = snapshotResult.data;
            let pressure = this.#storagePressure(snapshot, { record: true });

            for (let burstIndex = 0; burstIndex < maxBursts; burstIndex += 1) {
                cancellationToken?.throwIfCancelled?.();
                if (!pressure.known) {
                    return Result.ok({ sold: actions.length > 0, reason: 'capacity-unknown', pressure, actions, bursts });
                }

                protectionStarted ||= pressure.protectionRequired === true || actions.length > 0;
                if (!protectionStarted) {
                    return Result.ok({ sold: false, reason: 'below-high-water', pressure, actions, bursts });
                }
                if (pressure.usageRatio <= pressure.lowWaterRatio) {
                    return Result.ok({ sold: actions.length > 0, reason: 'low-water-reached', pressure, actions, bursts });
                }

                const ratioBefore = pressure.usageRatio;
                let localSnapshot = snapshot;
                const unavailable = new Set();
                const burstActions = [];
                let exhaustedSafeSurplus = false;

                for (let clickIndex = 0; clickIndex < burstBudget; clickIndex += 1) {
                    cancellationToken?.throwIfCancelled?.();
                    const coverage = this.coverageSnapshot(localSnapshot);
                    const selected = this.#selectReserveSaleAction(
                        localSnapshot?.items || {},
                        coverage,
                        reserveCoverage,
                        unavailable,
                        pressure.materialTrend || {},
                        { allowSingle }
                    );
                    if (!selected) {
                        exhaustedSafeSurplus = true;
                        break;
                    }

                    if (burstActions.length === 0) {
                        this.logger?.warn?.('Protecting continuously-fed /kho with a coarse sell burst.', {
                            operation: 'B1StorageMaterialService', step: 'storage-pressure-sale',
                            usageRatio: pressure.usageRatio, lowWaterRatio: pressure.lowWaterRatio,
                            reserveCoverage, burst: burstIndex + 1, burstBudget,
                            saleGranularity: allowSingle ? '64+1' : '64-only', selected
                        });
                    }

                    const sold = await this.storage.sell(selected.logicalId, {
                        quantity: selected.quantity,
                        cancellationToken
                    });
                    if (!sold.success) return sold;
                    if (sold.data?.skipped) {
                        unavailable.add(selected.logicalId);
                        continue;
                    }

                    const action = { selected, result: sold.data, pressureBefore: pressure, burst: burstIndex + 1 };
                    actions.push(action);
                    burstActions.push(action);
                    localSnapshot = this.#snapshotAfterSale(localSnapshot, selected, sold.data);
                }

                // NPC input continues during the burst. Never infer that a burst
                // actually lowered /kho from our own clicks; close Sell GUI and
                // take a full /kho checkpoint (including raw) before deciding
                // whether to stop, escalate, or choose a different material.
                await this.storage.closeSellGui?.();
                snapshotResult = await this.storage.read({ refresh: true, forceReopen: true, cancellationToken });
                if (!snapshotResult.success) return snapshotResult;
                snapshot = snapshotResult.data;
                pressure = this.#storagePressure(snapshot, { record: true });

                const improvement = Number.isFinite(ratioBefore) && Number.isFinite(pressure.usageRatio)
                    ? ratioBefore - pressure.usageRatio
                    : null;
                const improving = Number.isFinite(improvement) && improvement >= minImprovementRatio;
                nonImprovingBursts = improving ? 0 : nonImprovingBursts + 1;
                bursts.push({
                    burst: burstIndex + 1,
                    budget: burstBudget,
                    clicks: burstActions.length,
                    ratioBefore,
                    ratioAfter: pressure.usageRatio,
                    improvement,
                    exhaustedSafeSurplus,
                    nonImprovingBursts
                });

                if (pressure.known && pressure.usageRatio <= pressure.lowWaterRatio) {
                    return Result.ok({ sold: actions.length > 0, reason: 'low-water-reached', pressure, actions, bursts });
                }
                if (burstActions.length === 0 && exhaustedSafeSurplus) {
                    return Result.ok({
                        sold: actions.length > 0,
                        reason: 'no-safe-surplus-above-reserve',
                        pressure,
                        coverage: this.coverageSnapshot(snapshot),
                        actions,
                        bursts
                    });
                }

                // If incoming B1 masks or exceeds what we just sold, do not
                // restart the whole mode or chase exact material amounts. Stay
                // in the same protection episode and increase the next coarse
                // burst, capped so the GUI loop remains bounded.
                if (!improving) {
                    burstBudget = Math.min(maxBurstClicks, Math.max(baseBurstClicks, Math.ceil(burstBudget * escalationFactor)));
                } else {
                    burstBudget = baseBurstClicks;
                }
            }

            return Result.ok({
                sold: actions.length > 0,
                reason: pressure?.protectionRequired ? 'pressure-persists-after-bounded-bursts' : 'pressure-relieved',
                pressure,
                actions,
                bursts,
                nonImprovingBursts
            });
        } catch (error) {
            return Result.fail(Status.FAILED, error.message, error);
        }
    }

    async sellLargestStoredBlock({ cancellationToken = null } = {}) {
        try {
            cancellationToken?.throwIfCancelled?.();
            const snapshotResult = await this.storage.read({ refresh: true, cancellationToken });
            if (!snapshotResult.success) return snapshotResult;
            const coverage = this.coverageSnapshot(snapshotResult.data);
            const reserveCoverage = Math.max(0, Number(this.storage?.config?.sell?.startupReserveCoverage ?? 3));
            const selected = this.#selectReserveSaleAction(snapshotResult.data?.items || {}, coverage, reserveCoverage, new Set());
            if (!selected) return Result.ok({ sold: false, reason: 'no-safe-surplus-above-reserve' });
            const sold = await this.storage.sell(selected.logicalId, { quantity: selected.quantity, cancellationToken });
            if (!sold.success) return sold;
            return Result.ok({ sold: !sold.data?.skipped, selected, result: sold.data });
        } catch (error) {
            return Result.fail(Status.FAILED, error.message, error);
        }
    }

    #selectReserveSaleAction(items, coverage, reserveCoverage, unavailable = new Set(), materialTrend = {}, { allowSingle = false, minCoverageToSell = reserveCoverage } = {}) {
        const candidates = [];
        const growthWeightMinutes = Math.max(0, Number(this.conversionConfig?.storagePressure?.materialGrowthWeightMinutes ?? 2));
        for (const resource of Object.values(this.resources)) {
            const family = coverage?.[resource.baseId];
            if (!family || !(family.coverage > minCoverageToSell)) continue;
            const reserveBase = family.requiredPerB5 * reserveCoverage;
            const growthPerMinute = Math.max(0, Number(materialTrend?.[resource.baseId]?.growthPerMinute || 0));
            const growthCoveragePerMinute = growthPerMinute / Math.max(1, family.requiredPerB5);
            const pressureScore = (family.coverage - minCoverageToSell) + (growthCoveragePerMinute * growthWeightMinutes);
            const add = (logicalId, count, baseUnitsPerItem) => {
                const stored = Math.max(0, Number(count || 0));
                if (!logicalId || stored <= 0 || unavailable.has(logicalId)) return;
                let quantity = null;
                if (stored >= 64 && family.effectiveB1 - (64 * baseUnitsPerItem) >= reserveBase) quantity = 64;
                else if (allowSingle && stored >= 1 && family.effectiveB1 - baseUnitsPerItem >= reserveBase) quantity = 1;
                if (!quantity) return;
                candidates.push({
                    baseId: resource.baseId,
                    logicalId,
                    quantity,
                    stored,
                    count: stored,
                    baseUnitsPerItem,
                    coverage: family.coverage,
                    coverageB5: family.coverage,
                    surplusCoverage: family.coverage - reserveCoverage,
                    growthPerMinute,
                    growthCoveragePerMinute,
                    pressureScore,
                    effectiveBefore: family.effectiveB1,
                    effectiveAfter: family.effectiveB1 - (quantity * baseUnitsPerItem),
                    reserveBase
                });
            };
            // Sell compressed B1 only. Loose/raw forms still count toward
            // family coverage and therefore protect the 3-B5 reserve, but they
            // are intentionally ignored as sell candidates. Maintenance already
            // compacts loose B1 into blocks; tiny loose leftovers are not worth
            // chasing in a continuously-fed storage.
            if (resource.blockId) add(resource.blockId, items?.[resource.blockId], resource.ratio);
        }
        candidates.sort((a, b) =>
            b.pressureScore - a.pressureScore
            || b.surplusCoverage - a.surplusCoverage
            || b.stored - a.stored
            || a.logicalId.localeCompare(b.logicalId));
        return candidates[0] || null;
    }

    #snapshotAfterSale(snapshot, selected, soldData = {}) {
        const nextItems = { ...(snapshot?.items || {}) };
        const before = Math.max(0, Number(nextItems[selected.logicalId] || 0));
        const requested = Math.max(0, Number(selected.quantity || 0));
        // `/kho sell` is an executor/feedback surface, not the authoritative
        // stock source. Runtime has produced `amountReliable=true` with bogus
        // values such as 0 while `/kho` held >90k blocks. Never let that value
        // collapse the local stock model. For a coarse 64 sale, subtract exactly
        // the requested quantity from the last authoritative `/kho` snapshot.
        // With a continuously-fed storage this is conservative: NPC inflow makes
        // the real amount greater than or equal to the local model. A failed or
        // partially-observed click is caught at the next full `/kho` checkpoint.
        nextItems[selected.logicalId] = Math.max(0, before - requested);
        return { ...(snapshot || {}), items: nextItems };
    }

    #coverageLog(coverage) {
        return Object.values(coverage || {}).map(entry => ({
            baseId: entry.baseId,
            coverage: Number(entry.coverage.toFixed(3)),
            effectiveB1: entry.effectiveB1,
            requiredPerB5: entry.requiredPerB5,
            rawEffective: entry.rawEffective,
            loose: entry.loose,
            blocks: entry.blocks
        }));
    }

    #storagePressure(snapshot, { record = false } = {}) {
        const capacity = snapshot?.capacity || null;
        const policy = this.conversionConfig?.storagePressure || {};
        const ratio = (key, fallback) => {
            const value = Number(policy[key]);
            return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
        };
        const watchRatio = ratio('watchRatio', 0.70);
        const highWaterRatio = Math.max(watchRatio, ratio('highRatio', 0.80));
        const sellRatio = Math.max(highWaterRatio, ratio('usedRatio', highWaterRatio));
        const lowWaterRatio = Math.min(highWaterRatio, ratio('lowWaterRatio', 0.70));
        const criticalRatio = Math.max(sellRatio, ratio('criticalRatio', 0.92));
        const growthHorizonMinutes = Math.max(0, Number(policy.growthHorizonMinutes ?? 0.5));
        const fastGrowthPerMinute = Math.max(0, Number(policy.fastGrowthPerMinute ?? 0.03));

        const usageRatio = Number(capacity?.usageRatio);
        const used = Number(capacity?.used);
        const limit = Number(capacity?.limit ?? capacity?.total);
        const resolvedRatio = Number.isFinite(usageRatio)
            ? usageRatio
            : (Number.isFinite(used) && Number.isFinite(limit) && limit > 0 ? used / limit : null);
        const now = Date.now();
        const previous = this.lastPressureObservation;
        const elapsedMs = previous && Number.isFinite(resolvedRatio)
            ? Math.max(0, now - previous.at)
            : 0;
        const deltaRatio = previous && Number.isFinite(resolvedRatio) && Number.isFinite(previous.usageRatio)
            ? resolvedRatio - previous.usageRatio
            : null;
        const growthPerMinute = Number.isFinite(deltaRatio) && elapsedMs >= 1000
            ? deltaRatio / (elapsedMs / 60_000)
            : null;
        const projectedRatio = Number.isFinite(resolvedRatio)
            ? resolvedRatio + Math.max(0, Number(growthPerMinute || 0)) * growthHorizonMinutes
            : null;
        const growingFast = Number.isFinite(growthPerMinute) && growthPerMinute >= fastGrowthPerMinute;
        const projectedHigh = Number.isFinite(projectedRatio) && projectedRatio >= highWaterRatio;
        // A short sampling interval can make continuous NPC input look like an
        // extreme growth spike. Projection may raise RISING early, but hard
        // protection is only allowed once the real buffer has reached low-water.
        // This prevents a 20-30% full /kho from being mislabeled HIGH merely
        // because two close samples extrapolate above high-water.
        const projectionCanProtect = Number.isFinite(resolvedRatio) && resolvedRatio >= lowWaterRatio;
        const protectionRequired = Number.isFinite(resolvedRatio)
            ? resolvedRatio >= highWaterRatio || (projectionCanProtect && projectedHigh)
            : false;

        let level = 'UNKNOWN';
        if (Number.isFinite(resolvedRatio)) {
            if (resolvedRatio >= criticalRatio) level = 'CRITICAL';
            else if (protectionRequired) level = 'HIGH';
            else if (resolvedRatio >= watchRatio || growingFast) level = 'RISING';
            else level = 'NORMAL';
        }

        const materialTrend = this.#materialTrend(snapshot?.items || {}, now, { record });
        if (record && Number.isFinite(resolvedRatio)) {
            if (!previous || elapsedMs >= 1000) {
                this.lastPressureObservation = Object.freeze({ usageRatio: resolvedRatio, used: Number.isFinite(used) ? used : null, at: now });
            }
        }

        return Object.freeze({
            known: Number.isFinite(resolvedRatio),
            level,
            protectionRequired,
            nearFull: protectionRequired,
            sellRequired: protectionRequired,
            projectedSellRequired: projectionCanProtect && projectedHigh,
            critical: Number.isFinite(resolvedRatio) ? resolvedRatio >= criticalRatio : false,
            shouldConsumeB1: Number.isFinite(resolvedRatio) ? resolvedRatio >= watchRatio || (projectionCanProtect && projectedHigh) : false,
            usageRatio: Number.isFinite(resolvedRatio) ? resolvedRatio : null,
            watchRatio,
            highRatio: highWaterRatio,
            highWaterRatio,
            lowWaterRatio,
            usedRatioThreshold: sellRatio,
            sellRatio,
            criticalRatio,
            used: Number.isFinite(used) ? used : null,
            free: Number.isFinite(Number(capacity?.free)) ? Number(capacity.free) : null,
            limit: Number.isFinite(limit) ? limit : null,
            deltaRatio: Number.isFinite(deltaRatio) ? deltaRatio : null,
            elapsedMs,
            growthPerMinute: Number.isFinite(growthPerMinute) ? growthPerMinute : null,
            projectedRatio: Number.isFinite(projectedRatio) ? projectedRatio : null,
            growingFast,
            materialTrend,
            observedAt: new Date(now).toISOString()
        });
    }

    #assessBlockExpansion(snapshot, resource) {
        const policy = this.conversionConfig?.storagePressure || {};
        const items = snapshot?.items || snapshot || {};
        const blocks = Math.max(0, Number(items?.[resource.blockId] || 0));
        const expansionDelta = Math.max(0, blocks * Math.max(0, resource.ratio - 1));
        if (blocks <= 0 || expansionDelta <= 0) {
            return Object.freeze({ safe: true, reason: 'no-expansion', blocks, expansionDelta, projectedUsed: null, projectedRatio: null });
        }

        const capacity = snapshot?.capacity || null;
        const used = Number(capacity?.used);
        const limit = Number(capacity?.limit ?? capacity?.total);
        const requireKnownCapacity = policy.requireKnownCapacityForDecompression === true;
        const configuredMax = Number(policy.decompressionMaxRatio);
        const highRatio = Number(policy.highRatio);
        const maxRatio = Number.isFinite(configuredMax) && configuredMax > 0 && configuredMax <= 1
            ? configuredMax
            : (Number.isFinite(highRatio) && highRatio > 0 && highRatio <= 1 ? highRatio : 0.85);

        if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) {
            return Object.freeze({
                safe: !requireKnownCapacity,
                reason: requireKnownCapacity ? 'capacity-unknown' : 'capacity-unknown-allowed',
                blocks,
                expansionDelta,
                used: Number.isFinite(used) ? used : null,
                limit: Number.isFinite(limit) ? limit : null,
                projectedUsed: null,
                projectedRatio: null,
                maxRatio
            });
        }

        const projectedUsed = used + expansionDelta;
        const projectedRatio = projectedUsed / limit;
        return Object.freeze({
            safe: projectedRatio <= maxRatio,
            reason: projectedRatio <= maxRatio ? 'within-headroom' : 'unsafe-block-expansion',
            blocks,
            expansionDelta,
            used,
            limit,
            projectedUsed,
            projectedRatio,
            maxRatio
        });
    }

    #largestStoredCandidate(items) {
        return this.#selectSaleCandidate(items, {});
    }

    #selectSaleCandidate(items, materialTrend = {}) {
        const policy = this.conversionConfig?.storagePressure || {};
        const growthWeightMinutes = Math.max(0, Number(policy.materialGrowthWeightMinutes ?? 2));
        const candidates = [];

        for (const resource of Object.values(this.resources)) {
            const demandBaseUnits = Math.max(1, Number(this.b1DemandWeights?.[resource.baseId] || 1));
            const growthPerMinute = Number(materialTrend?.[resource.baseId]?.growthPerMinute || 0);
            const positiveGrowthPerMinute = Math.max(0, growthPerMinute);

            const addCandidate = (logicalId, count, baseUnitsPerStoredItem) => {
                const storedCount = Math.max(0, Number(count || 0));
                if (storedCount <= 0 || !logicalId) return;
                const demandStoredUnits = Math.max(1 / Math.max(1, baseUnitsPerStoredItem), demandBaseUnits / Math.max(1, baseUnitsPerStoredItem));
                const coverageB5 = storedCount / demandStoredUnits;
                const growthStoredPerMinute = positiveGrowthPerMinute / Math.max(1, baseUnitsPerStoredItem);
                const growthCoveragePerMinute = growthStoredPerMinute / demandStoredUnits;
                const pressureScore = coverageB5 + (growthCoveragePerMinute * growthWeightMinutes);
                candidates.push({
                    baseId: resource.baseId,
                    logicalId,
                    count: storedCount,
                    storedUnits: storedCount,
                    baseUnitsPerStoredItem,
                    demandPerB5: demandBaseUnits,
                    demandStoredUnits,
                    coverageB5,
                    growthPerMinute: Number.isFinite(growthPerMinute) ? growthPerMinute : null,
                    pressureScore
                });
            };

            // Capacity is consumed by the ACTUAL stored item count, not by the
            // decompressed base-equivalent amount. Treat loose and block forms as
            // separate sell candidates so 100k loose + 1 block never results in
            // selling only that single block.
            addCandidate(resource.baseId, items?.[resource.baseId], 1);
            if (resource.blockId) addCandidate(resource.blockId, items?.[resource.blockId], resource.ratio);
        }

        candidates.sort((a, b) =>
            b.pressureScore - a.pressureScore
            || b.storedUnits - a.storedUnits
            || b.count - a.count
            || a.logicalId.localeCompare(b.logicalId));
        return candidates[0] || null;
    }

    #materialTrend(items, now, { record = false } = {}) {
        const current = {};
        for (const resource of Object.values(this.resources)) {
            const loose = Math.max(0, Number(items?.[resource.baseId] || 0));
            const blocks = resource.blockId ? Math.max(0, Number(items?.[resource.blockId] || 0)) : 0;
            // Track actual /kho occupancy for this material family. One block is
            // one stored unit, not nine, because /kho capacity counts items.
            current[resource.baseId] = loose + blocks;
        }

        const previous = this.lastMaterialObservation;
        const elapsedMs = previous ? Math.max(0, now - previous.at) : 0;
        const trend = {};
        for (const [baseId, amount] of Object.entries(current)) {
            const before = Number(previous?.items?.[baseId]);
            const delta = Number.isFinite(before) ? amount - before : null;
            const growthPerMinute = Number.isFinite(delta) && elapsedMs >= 1000
                ? delta / (elapsedMs / 60_000)
                : null;
            trend[baseId] = Object.freeze({
                amount,
                delta: Number.isFinite(delta) ? delta : null,
                growthPerMinute: Number.isFinite(growthPerMinute) ? growthPerMinute : null
            });
        }

        if (record && (!previous || elapsedMs >= 1000)) {
            this.lastMaterialObservation = Object.freeze({ items: Object.freeze({ ...current }), at: now });
        }
        return Object.freeze(trend);
    }

    #deriveRawInputsByBase(smeltingConfig) {
        const output = {};
        for (const [recipeId, recipe] of Object.entries(smeltingConfig?.recipes || {})) {
            const baseId = recipe?.output;
            if (!this.resources?.[baseId] || !recipe?.input) continue;
            const inputAmount = Math.max(1, Number(recipe.inputAmount || 1));
            const outputAmount = Math.max(0, Number(recipe.outputAmount || 1));
            const basePerInput = outputAmount / inputAmount;
            if (!(basePerInput > 0)) continue;
            if (!output[baseId]) output[baseId] = [];
            output[baseId].push(Object.freeze({ recipeId, inputId: recipe.input, basePerInput }));
        }
        for (const key of Object.keys(output)) output[key] = Object.freeze(output[key]);
        return Object.freeze(output);
    }

    #deriveB1DemandWeights(recipeConfig, targetId) {
        const recipes = recipeConfig && typeof recipeConfig === 'object' ? recipeConfig : null;
        if (!recipes || !recipes[targetId]) return Object.freeze({});
        const visiting = new Set();
        const expand = (itemId, amount) => {
            if (!recipes[itemId]) return { [itemId]: amount };
            if (visiting.has(itemId)) throw new Error(`Crafting recipe cycle detected while deriving B1 demand: ${itemId}`);
            visiting.add(itemId);
            const recipe = recipes[itemId];
            const outputAmount = Math.max(1, Number(recipe.outputAmount || 1));
            const multiplier = amount / outputAmount;
            const totals = {};
            for (const [inputId, inputAmount] of Object.entries(recipe.inputs || {})) {
                const expanded = expand(inputId, Number(inputAmount) * multiplier);
                for (const [leafId, leafAmount] of Object.entries(expanded)) {
                    totals[leafId] = Number(totals[leafId] || 0) + Number(leafAmount || 0);
                }
            }
            visiting.delete(itemId);
            return totals;
        };
        const leaves = expand(targetId, 1);
        const weights = {};
        for (const baseId of Object.keys(this.resources)) {
            const amount = Number(leaves[baseId] || 0);
            if (amount > 0) weights[baseId] = amount;
        }
        return Object.freeze(weights);
    }

    async #verifySmeltingResult({ recipeId, recipe, beforeInput, beforeOutput, cancellationToken }) {
        const attempts = Math.max(1, Number(this.smeltingConfig?.verificationAttempts || 6));
        const retryMs = Math.max(0, Number(this.smeltingConfig?.verificationRetryMs || 750));
        let last = { afterInput: beforeInput, afterOutput: beforeOutput, attempt: 0 };

        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            cancellationToken?.throwIfCancelled?.();
            if (attempt > 1 && retryMs > 0) await Timeout.delay(retryMs, { cancellationToken });

            // The server can finish the smelting action before /kho's telemetry
            // GUI reflects it. Always request fresh server truth and allow a
            // short polling window instead of treating the first stale snapshot
            // as a failed smelt.
            const afterResult = await this.storage.read({
                refresh: true,
                forceReopen: attempt === attempts,
                cancellationToken
            });
            if (!afterResult.success) {
                if (attempt >= attempts) return afterResult;
                continue;
            }

            const afterInput = Number(afterResult.data?.items?.[recipe.input] || 0);
            const afterOutput = Number(afterResult.data?.items?.[recipe.output] || 0);
            last = { afterInput, afterOutput, attempt };
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

        // A successful /nung click can be applied server-side before the /kho
        // telemetry GUI changes (or the command can be rate-limited). Do not
        // deadlock the whole Collector+B5 loop on stale telemetry. The next B5
        // planning pass reads /kho again and will only craft from resources it
        // can actually prove are available.
        return Result.ok({
            ...last,
            verified: false,
            staleTelemetry: true,
            attempts,
            recipeId,
            input: recipe.input,
            output: recipe.output,
            beforeInput,
            beforeOutput
        });
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

    #validateResources(resources) {
        if (!resources || typeof resources !== 'object') throw new Error('mineralConversions.resources is required');
        const normalized = {};
        for (const [baseId, resource] of Object.entries(resources)) {
            const ratio = Number(resource?.ratio);
            if (resource?.baseId !== baseId) throw new Error(`Invalid baseId for mineral conversion: ${baseId}`);
            if (!Number.isSafeInteger(ratio) || ratio < 1) throw new Error(`Invalid block ratio for ${baseId}`);
            normalized[baseId] = Object.freeze({
                ...resource,
                baseId,
                blockId: resource.blockId || null,
                sellId: resource.sellId || resource.blockId || baseId,
                ratio
            });
        }
        return Object.freeze(normalized);
    }
}

module.exports = B1StorageMaterialService;
