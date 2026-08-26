'use strict';
const Result = require('../../../shared/result/Result');
const Status = require('../../../shared/result/Status');
const Timeout = require('../../../shared/time/Timeout');
const FlowError = require('../../../shared/errors/FlowError');
const Operation = require('../../../operations/Operation');
const COVERAGE = 1.5;
const SMELT_IDS = Object.freeze(['raw_iron_to_iron', 'raw_gold_to_gold']);

class B1BatchProtectionCoordinator {
  constructor({ storage, smelting, conversionConfig, smeltingConfig, startupReserveTrimmer, compactAll, logger = null, now = Date.now }) {
    Object.assign(this, { storage, smelting, conversionConfig, smeltingConfig, startupReserveTrimmer, compactAll, logger, now });
  }
  reconfigure({ conversionConfig = this.conversionConfig, smeltingConfig = this.smeltingConfig, startupReserveTrimmer = this.startupReserveTrimmer } = {}) {
    Object.assign(this, { conversionConfig, smeltingConfig, startupReserveTrimmer }); return this;
  }
  async protect({ cancellationToken = null, operationContext = null, expectedGeneration = null, batchId = null, trigger = null, episodeId: requestedEpisodeId = null } = {}) {
    const child = { cancellationToken, operationContext, expectedGeneration };
    const episodeId = String(requestedEpisodeId || operationContext?.operationId || `${batchId || 'b5-batch'}:protect`);
    try {
      cancellationToken?.throwIfCancelled?.();
      const contract = this.#validateContract({ expectedGeneration, batchId, episodeId });
      if (!contract.success) return contract;
      const resumed = await this.#resume(episodeId, batchId, trigger, child);
      if (resumed) return resumed;
      await this.storage.closeSellGui?.(child);
      const fresh = await this.storage.read({ ...child, refresh: true, forceReopen: true });
      if (!fresh.success) return fresh;
      const smelting = await this.preprocess({ ...child, initialSnapshot: fresh.data });
      if (!smelting.success) return smelting;
      const compacted = await this.compactAll({ ...child, initialSnapshot: smelting.data?.finalSnapshot || fresh.data });
      const invalid = this.#validateCompaction(compacted, { batchId, trigger, expectedGeneration, episodeId });
      if (invalid) return invalid;
      return this.#trim({ episodeId, batchId, trigger, child, expectedGeneration, operationContext, fresh, smelting, compacted });
    } catch (error) {
      const wrapped = FlowError.wrap(error, { code: 'B1_B5_BATCH_PROTECTION_FAILED', subsystem: 'b1', operation: 'B1StorageMaterialService', step: 'protect-b5-batch', action: 'fresh /kho -> smelt -> compact -> trim to B5 reserve' });
      return Result.fail(Operation.statusForError(error), wrapped.message, wrapped, wrapped.toDiagnostic());
    } finally { try { await this.storage.closeSellGui?.(child); } catch (_) {} }
  }
  async #resume(episodeId, batchId, trigger, child) {
    if (!this.startupReserveTrimmer.hasEpisode(episodeId, { expectedGeneration: child.expectedGeneration, batchId })) return null;
    const resumed = await this.startupReserveTrimmer.run({ ...child, targetCoverage: COVERAGE, batchId, trigger, episodeId });
    if (!resumed.success) return resumed;
    return Result.ok({ episodeId, batchId, trigger, connectionGeneration: child.expectedGeneration, operationId: child.operationContext?.operationId || null,
      correlationId: child.operationContext?.correlationId || null, reserveCoverage: COVERAGE, resumedSellEpisode: true,
      continuationRequired: resumed.data?.continuationRequired === true, completeForEpisode: resumed.data?.completeForEpisode === true,
      trimmed: resumed.data || null, finalSnapshot: resumed.data?.finalSnapshot || null });
  }
  #validateCompaction(compacted, details) {
    if (!compacted.success) return this.#contextualize(compacted, { code: 'B1_B5_PROTECTION_COMPACT_UNVERIFIED', step: 'protect-compact-verify', action: 'compact B1 families before immutable sell baseline', details });
    const unavailable = (compacted.data?.actions || []).find(a => a?.converted === false && Number(a?.beforeLoose || 0) > 0 && a?.reason !== 'below-block-ratio' && a?.reason !== 'already-block-form');
    if (!unavailable) return null;
    const error = new FlowError(`Required B1 compaction option is unavailable: ${unavailable.baseId}.`, { code: 'B1_B5_PROTECTION_COMPACT_UNVERIFIED', subsystem: 'b1', operation: 'B1StorageMaterialService', step: 'protect-compact-verify', action: 'compact B1 families before immutable sell baseline', resource: unavailable.baseId, retryable: true, details: { ...details, conversion: unavailable } });
    return Result.fail(Status.NOT_READY, error.message, error, error.toDiagnostic());
  }
  async #trim({ episodeId, batchId, trigger, child, expectedGeneration, operationContext, fresh, smelting, compacted }) {
    const baseline = await this.storage.read({ ...child, refresh: true, forceReopen: true });
    if (!baseline.success) return baseline;
    const trimmed = await this.startupReserveTrimmer.run({ ...child, targetCoverage: COVERAGE, initialSnapshot: baseline.data, batchId, trigger, episodeId });
    if (!trimmed.success) return trimmed;
    return Result.ok({ episodeId, batchId, trigger, connectionGeneration: expectedGeneration, operationId: operationContext?.operationId || null, correlationId: operationContext?.correlationId || null,
      reserveCoverage: COVERAGE, resumedSellEpisode: false, continuationRequired: trimmed.data?.continuationRequired === true, completeForEpisode: trimmed.data?.completeForEpisode === true,
      freshSnapshot: fresh.data, smelting: smelting.data || null, compacted: compacted.data || null, sellBaseline: baseline.data, trimmed: trimmed.data || null,
      finalSnapshot: trimmed.data?.finalSnapshot || compacted.data?.finalSnapshot || smelting.data?.finalSnapshot || fresh.data });
  }
  #validateContract({ expectedGeneration = null, batchId = null, episodeId = null } = {}) {
    const configured = Array.isArray(this.conversionConfig?.smeltingRecipeIds) ? this.conversionConfig.smeltingRecipeIds.map(String) : [];
    const missingConfigured = SMELT_IDS.filter(id => !configured.includes(id));
    const missingDefinitions = SMELT_IDS.filter(id => !this.smeltingConfig?.recipes?.[id]);
    const smeltingUnavailable = typeof this.smelting?.smelt !== 'function';
    if (!missingConfigured.length && !missingDefinitions.length && !smeltingUnavailable) return Result.ok({ recipeIds: [...SMELT_IDS] });
    const error = new FlowError('B5 storage protection smelting contract is incomplete.', { code: 'B1_B5_PROTECTION_SMELT_CONFIG_INVALID', subsystem: 'b1', operation: 'B1StorageMaterialService', step: 'protect-smelt-preflight', action: 'validate ordered iron -> gold smelting contract before side effects', retryable: false,
      details: { expectedGeneration, batchId, episodeId, requiredRecipeIds: [...SMELT_IDS], configuredRecipeIds: configured, missingConfigured, missingDefinitions, smeltingUnavailable } });
    return Result.fail(Status.NOT_READY, error.message, error, error.toDiagnostic());
  }
  async preprocess({ cancellationToken = null, operationContext = null, expectedGeneration = null, initialSnapshot = null } = {}) {
    try {
      const child = { cancellationToken, operationContext, expectedGeneration }; const actions = []; let snapshot = this.#reusable(initialSnapshot);
      for (const recipeId of SMELT_IDS) {
        const one = await this.#smeltOne(recipeId, snapshot, child);
        if (one?.success === false) return one;
        snapshot = one.snapshot || snapshot;
        if (one.action) actions.push(one.action);
      }
      return Result.ok({ actions, finalSnapshot: snapshot });
    } catch (error) {
      const wrapped = FlowError.wrap(error, { code: 'B1_PREPROCESS_FAILED', subsystem: 'b1', operation: 'B1StorageMaterialService', step: 'preprocess', action: 'preprocess B1 for crafting' });
      return Result.fail(Operation.statusForError(error), wrapped.message, wrapped, wrapped.toDiagnostic());
    }
  }
  async #smeltOne(recipeId, snapshot, child) {
    child.cancellationToken?.throwIfCancelled?.(); const recipe = this.smeltingConfig?.recipes?.[recipeId];
    if (!recipe) throw new Error(`Configured smelting recipe not found: ${recipeId}`);
    snapshot = this.#reusable(snapshot); const before = snapshot ? Result.ok(snapshot) : await this.storage.read(child);
    if (!before.success) return this.#contextualize(before, { code: 'B1_STORAGE_READ_FAILED', step: 'preprocess-read-kho', action: 'read /kho before smelting', resource: recipe.input, details: { recipeId } });
    const beforeInput = Number(before.data?.items?.[recipe.input] || 0); if (beforeInput <= 0) return { snapshot: before.data };
    const beforeOutput = Number(before.data?.items?.[recipe.output] || 0); const smelted = await this.smelting.smelt(recipeId, { entry: 'direct', ...child });
    if (!smelted.success) return this.#contextualize(smelted, { code: 'B1_SMELTING_ACTION_FAILED', step: 'preprocess-smelt', action: `smelt ${recipe.input}`, resource: recipe.input, details: { recipeId, beforeInput, beforeOutput } });
    if (smelted.data?.skipped) return this.#unavailable(recipeId, recipe, beforeInput, beforeOutput, child, smelted);
    const verified = await this.#verify({ recipeId, recipe, beforeInput, beforeOutput, ...child });
    if (!verified.success) return this.#contextualize(verified, { code: 'B1_SMELTING_VERIFY_FAILED', step: 'preprocess-smelt-verify', action: 'verify /kho after smelting', resource: recipe.input, details: { recipeId, beforeInput, beforeOutput } });
    return { snapshot: verified.data?.snapshot || null, action: { recipeId, beforeInput, afterInput: verified.data.afterInput, beforeOutput, afterOutput: verified.data.afterOutput, verificationAttempt: verified.data.attempt, verified: true, telemetryStale: false } };
  }
  #unavailable(recipeId, recipe, beforeInput, beforeOutput, child, smelted) {
    const error = new FlowError(`Required B5 protection smelting option is unavailable: ${recipeId}.`, { code: 'B1_B5_PROTECTION_SMELT_UNVERIFIED', subsystem: 'b1', operation: 'B1StorageMaterialService', step: 'preprocess-smelt', action: `smelt ${recipe.input}`, resource: recipe.input, retryable: true,
      details: { recipeId, beforeInput, beforeOutput, afterInput: beforeInput, afterOutput: beforeOutput, attempts: 0, expectedGeneration: child.expectedGeneration, operationId: child.operationContext?.operationId || null, correlationId: child.operationContext?.correlationId || null, reason: smelted.data.reason || 'option-unavailable' } });
    return Result.fail(Status.NOT_READY, error.message, error, error.toDiagnostic());
  }
  async #verify({ recipeId, recipe, beforeInput, beforeOutput, cancellationToken, operationContext = null, expectedGeneration = null }) {
    const attempts = Math.max(1, Number(this.smeltingConfig?.verificationAttempts || 6)); const retryMs = Math.max(0, Number(this.smeltingConfig?.verificationRetryMs ?? 750));
    let last = { afterInput: beforeInput, afterOutput: beforeOutput, attempt: 0 };
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      cancellationToken?.throwIfCancelled?.(); if (attempt > 1 && retryMs > 0) await Timeout.delay(retryMs, { cancellationToken });
      const read = await this.storage.read({ refresh: true, forceReopen: attempt === attempts, cancellationToken, operationContext, expectedGeneration });
      if (!read.success) { if (attempt >= attempts) return read; continue; }
      const afterInput = Number(read.data?.items?.[recipe.input] || 0), afterOutput = Number(read.data?.items?.[recipe.output] || 0); last = { afterInput, afterOutput, attempt, snapshot: read.data };
      if (afterInput < beforeInput || afterOutput > beforeOutput) return Result.ok({ ...last, verified: true, staleTelemetry: false, attempts });
      this.logger?.debug?.('Waiting for /kho to reflect smelting result.', { recipeId, attempt, attempts, beforeInput, afterInput, beforeOutput, afterOutput });
    }
    const details = { recipeId, input: recipe.input, output: recipe.output, beforeInput, beforeOutput, afterInput: last.afterInput, afterOutput: last.afterOutput, attempts, expectedGeneration, operationId: operationContext?.operationId || null, correlationId: operationContext?.correlationId || null };
    const error = new FlowError(`Smelting could not be verified from a fresh /kho snapshot: ${recipeId}.`, { code: 'B1_B5_PROTECTION_SMELT_UNVERIFIED', subsystem: 'b1', operation: 'B1StorageMaterialService', step: 'preprocess-smelt-verify', action: 'verify smelting with fresh /kho', resource: recipe.input, retryable: true, attempt: attempts, details });
    return Result.fail(Status.VERIFICATION_FAILED, error.message, error, error.toDiagnostic());
  }
  #reusable(snapshot, maxAgeMs = 1000) {
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.items || typeof snapshot.items !== 'object') return null;
    const captured = Number(snapshot.capturedAt); return Number.isFinite(captured) && this.now() - captured <= Math.max(0, Number(maxAgeMs || 0)) ? snapshot : null;
  }
  #contextualize(result, context) {
    if (result?.success !== false) return result;
    const wrapped = FlowError.wrap(result.error || new Error(result.message || 'B1 action failed.'), { subsystem: 'b1', operation: 'B1StorageMaterialService', ...context, details: { ...(result.meta || {}), ...(context.details || {}) } });
    return Result.fail(result.status || Status.FAILED, wrapped.message, wrapped, wrapped.toDiagnostic());
  }
}
module.exports = B1BatchProtectionCoordinator;
