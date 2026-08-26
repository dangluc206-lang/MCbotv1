'use strict';

const Result = require('../../../../shared/result/Result');
const KhoMaterialTransfer = require('../../../storage/KhoMaterialTransfer');

class B5StorageFlow {
    constructor({ b1Materials }) {
        if (!b1Materials) throw new TypeError('B5StorageFlow b1Materials is required.');
        this.b1Materials = b1Materials;
        this.storage = b1Materials.storage || null;
        this.logger = b1Materials.logger || null;
        this.transfer = this.storage ? new KhoMaterialTransfer({ storage: this.storage, logger: this.logger }) : null;
        this.activeBaseId = null;
        this.activeGeneration = null;
        this.pendingSwitchBaseId = null;
        this.switchBarrierOperationId = null;
        this.lastFinalizedBaseId = null;
        this.lastFinalizedOperationId = null;
    }

    async compact(baseId, options = {}) {
        await this.#resetGenerationIfNeeded(options);
        if (this.activeBaseId === baseId) {
            const finalized = await this.#finalizeActive(null, options);
            if (finalized?.ready === false) {
                return Result.ok({
                    baseId, converted: false, ready: false,
                    reason: 'active-material-finalize-blocked', blocker: finalized
                });
            }
            return Result.ok({
                baseId, converted: true, finalized: true,
                transfer: finalized.transfer || null,
                compacted: finalized.compacted || null
            });
        }
        return this.b1Materials.compact(baseId, options);
    }

    // Explicit transaction-boundary API used by the B5 inventory contract.
    // It keeps the Codex optimized transfer path while guaranteeing that the
    // current B1 is returned and compacted before the next material begins.
    async finalizeBase(baseId, options = {}) {
        await this.#resetGenerationIfNeeded(options);
        if (!this.activeBaseId) {
            if (options.requireActive === true) {
                return Result.ok({
                    baseId, ready: true, converted: false,
                    skipped: true, reason: 'no-active-material-transaction'
                });
            }
            if (this.#wasFinalizedInOperation(baseId, options)) {
                return Result.ok({
                    baseId, ready: true, converted: false,
                    skipped: true, reason: 'already-finalized-in-current-operation'
                });
            }
            return this.b1Materials.compact(baseId, options);
        }
        if (this.activeBaseId !== baseId) {
            return Result.ok({
                baseId, ready: false, converted: false,
                reason: 'different-active-material', activeBaseId: this.activeBaseId
            });
        }
        const finalized = await this.#finalizeActive(null, options);
        if (finalized?.ready === false) {
            return Result.ok({
                baseId, ready: false, converted: false,
                reason: 'active-material-finalize-blocked', blocker: finalized
            });
        }
        return Result.ok({ baseId, ready: true, converted: true, finalized });
    }

    async compactAll(options = {}) {
        await this.#resetGenerationIfNeeded(options);
        const finalized = await this.#finalizeActive(null, options);
        if (finalized?.ready === false) {
            return Result.ok({
                converted: false,
                ready: false,
                reason: 'active-material-finalize-blocked',
                activeBaseId: this.activeBaseId,
                blocker: finalized
            });
        }
        return this.b1Materials.compactAll(options);
    }

    async prepareBase(baseId, required, options = {}) {
        await this.#resetGenerationIfNeeded(options);
        const switchGate = await this.#handleMaterialSwitch(baseId, options);
        if (switchGate) return Result.ok(switchGate);

        if (this.activeBaseId === baseId) {
            this.pendingSwitchBaseId = null;
            this.switchBarrierOperationId = null;
        }
        this.activeBaseId = baseId;
        this.activeGeneration = this.#generation(options);

        const preflight = await this.#preflightDecompression(baseId, required, options);
        if (preflight.safe === false) {
            this.logger?.info?.('B5 B1 PREP WAIT', {
                operation: 'B5StorageFlow', step: 'preflight-decompression', phase: 'WAIT',
                resource: baseId, reason: preflight.reason, required, preflight
            });
            return Result.ok({
                baseId, required, ready: false, reason: preflight.reason,
                available: preflight.loose ?? null, blocks: preflight.blocks ?? null,
                preflight, transactionOwner: this.activeBaseId
            });
        }

        const prepared = await this.b1Materials.ensureBaseAvailable(baseId, required, options);
        if (prepared?.success === false) return prepared;
        if (prepared?.data?.ready === false) {
            this.#clearTransaction();
            return Result.ok({
                ...(prepared.data || {}), baseId, required, ready: false,
                reason: prepared.data?.reason || 'base-form-unavailable',
                preflight, transactionOwner: this.activeBaseId
            });
        }
        return Result.ok({
            ...(prepared.data || {}), baseId, required, ready: true,
            transfer: null, preflight, transactionOwner: this.activeBaseId,
            acquisitionOwner: 'B2InputAcquisitionFlow'
        });
    }

    async returnBaseInventory(baseId, options = {}) {
        await this.#resetGenerationIfNeeded(options);
        if (!this.transfer) {
            return Result.ok({
                baseId, ready: false, reason: 'b1-return-transfer-unavailable', moved: 0
            });
        }
        const transfer = await this.transfer.depositAll(baseId, {
            cancellationToken: options.cancellationToken || options.operationContext?.cancellation?.token || null,
            operationContext: options.operationContext || null,
            expectedGeneration: options.expectedGeneration ?? options.operationContext?.connectionGeneration ?? null
        });
        if (transfer?.ready === false) {
            return Result.ok({
                baseId, ready: false,
                reason: transfer.reason || 'b1-return-to-kho-not-ready',
                moved: Number(transfer?.moved || 0), transfer
            });
        }
        return Result.ok({
            baseId, ready: true, moved: Number(transfer?.moved || 0), transfer
        });
    }

    async #handleMaterialSwitch(requestedBaseId, options) {
        const active = this.activeBaseId;
        if (!active || active === requestedBaseId) return null;
        const operationId = this.#operationId(options);
        if (!this.pendingSwitchBaseId) {
            this.pendingSwitchBaseId = requestedBaseId;
            this.switchBarrierOperationId = operationId;
            return {
                baseId: requestedBaseId, required: 0, ready: false,
                reason: 'material-switch-replan', transactionOwner: active,
                pendingSwitchBaseId: requestedBaseId, switchBarrierOperationId: operationId
            };
        }
        if (operationId && this.switchBarrierOperationId) {
            if (operationId === this.switchBarrierOperationId) {
                return {
                    baseId: requestedBaseId, required: 0, ready: false,
                    reason: 'material-switch-locked', transactionOwner: active,
                    pendingSwitchBaseId: this.pendingSwitchBaseId,
                    switchBarrierOperationId: this.switchBarrierOperationId
                };
            }
        } else if (this.pendingSwitchBaseId !== requestedBaseId) {
            return {
                baseId: requestedBaseId, required: 0, ready: false,
                reason: 'material-switch-locked-no-operation-id', transactionOwner: active,
                pendingSwitchBaseId: this.pendingSwitchBaseId
            };
        }
        const finalized = await this.#finalizeActive(requestedBaseId, options);
        if (finalized?.ready === false) {
            return {
                baseId: requestedBaseId, required: 0, ready: false,
                reason: 'material-finalize-blocked', transactionOwner: active,
                pendingSwitchBaseId: requestedBaseId, blocker: finalized
            };
        }
        return null;
    }

    async #preflightDecompression(baseId, required, options) {
        if (!this.storage?.read) {
            return { safe: true, reason: 'decompression-preflight-delegated', baseId, delegated: true };
        }
        const read = await this.storage.read({
            refresh: true,
            cancellationToken: options.cancellationToken || options.operationContext?.cancellation?.token || null,
            operationContext: options.operationContext || null,
            expectedGeneration: options.expectedGeneration ?? options.operationContext?.connectionGeneration ?? null
        });
        if (read?.success === false) {
            return { safe: false, reason: 'storage-read-failed', baseId, message: read.message || read.error?.message || null };
        }

        const snapshot = read.data;
        const resource = this.b1Materials.resources?.[baseId] || null;
        const loose = Math.max(0, Number(snapshot?.items?.[baseId] || 0));
        const blockId = resource?.blockId || null;
        const blocks = blockId ? Math.max(0, Number(snapshot?.items?.[blockId] || 0)) : 0;
        const ratio = Math.max(1, Number(resource?.ratio || 1));
        const need = Math.max(0, Number(required) || 0);
        if (loose >= need || blocks <= 0 || ratio <= 1) {
            return { safe: true, reason: 'no-decompression-needed', baseId, loose, blocks, ratio, required: need, decompressionNeeded: false };
        }

        const capacity = snapshot?.capacity || null;
        const used = Number(capacity?.used);
        const limit = Number(capacity?.limit ?? capacity?.total);
        const projectedIncrease = blocks * (ratio - 1);
        const projectedUsed = Number.isFinite(used) ? used + projectedIncrease : null;
        if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) {
            return {
                safe: false, reason: 'storage-capacity-unknown', baseId, loose, blocks, ratio, required: need,
                used: Number.isFinite(used) ? used : null,
                limit: Number.isFinite(limit) ? limit : null,
                projectedIncrease
            };
        }
        if (projectedUsed > limit) {
            return {
                safe: false, reason: 'storage-hard-capacity', baseId, loose, blocks, ratio, required: need,
                used, limit, free: Math.max(0, limit - used), projectedIncrease, projectedUsed
            };
        }
        return {
            safe: true, reason: 'full-decompression-fits-capacity', baseId, loose, blocks, ratio,
            required: need, decompressionNeeded: true, used, limit, projectedIncrease, projectedUsed
        };
    }

    async #finalizeActive(nextBaseId, options) {
        const baseId = this.activeBaseId;
        if (!baseId) return { ready: true, skipped: true };
        if (!this.transfer) {
            const compacted = await this.b1Materials.compact(baseId, options);
            if (compacted?.success === false) {
                return { ready: false, reason: 'compact-active-material-failed', baseId, nextBaseId };
            }
            this.#rememberFinalized(baseId, options);
            this.#clearTransaction();
            return { ready: true, baseId, nextBaseId, transfer: null, compacted: compacted?.data || null };
        }
        const transfer = await this.transfer.depositAll(baseId, {
            cancellationToken: options.cancellationToken || options.operationContext?.cancellation?.token || null,
            operationContext: options.operationContext || null,
            expectedGeneration: options.expectedGeneration ?? options.operationContext?.connectionGeneration ?? null
        });
        if (transfer?.ready === false) {
            return { ready: false, reason: transfer.reason || 'b1-return-to-kho-not-ready', baseId, nextBaseId, transfer };
        }
        const compacted = await this.b1Materials.compact(baseId, options);
        if (compacted?.success === false) {
            return {
                ready: false, reason: 'compact-active-material-failed', baseId, nextBaseId, transfer,
                compactStatus: compacted.status || null,
                compactMessage: compacted.message || compacted.error?.message || null
            };
        }
        this.logger?.info?.('B5 B1 MATERIAL TRANSACTION CLOSED', {
            operation: 'B5StorageFlow', step: 'finalize-material', phase: 'OK',
            resource: baseId, nextResource: nextBaseId,
            returnedToKho: Number(transfer?.moved || 0), compacted: compacted?.data || null
        });
        this.#rememberFinalized(baseId, options);
        this.#clearTransaction();
        return { ready: true, baseId, nextBaseId, transfer, compacted: compacted?.data || null };
    }

    #wasFinalizedInOperation(baseId, options) {
        const operationId = this.#operationId(options);
        return Boolean(operationId
            && this.lastFinalizedOperationId === operationId
            && this.lastFinalizedBaseId === baseId);
    }

    #rememberFinalized(baseId, options) {
        const operationId = this.#operationId(options);
        this.lastFinalizedBaseId = operationId ? baseId : null;
        this.lastFinalizedOperationId = operationId;
    }

    async #resetGenerationIfNeeded(options) {
        const generation = this.#generation(options);
        if (this.activeGeneration === null || generation === null) return;
        if (Number(this.activeGeneration) === Number(generation)) return;
        this.#clearTransaction();
        this.lastFinalizedBaseId = null;
        this.lastFinalizedOperationId = null;
    }

    #clearTransaction() {
        this.activeBaseId = null;
        this.activeGeneration = null;
        this.pendingSwitchBaseId = null;
        this.switchBarrierOperationId = null;
    }

    #operationId(options = {}) {
        const value = options.operationContext?.operationId ?? options.operationId ?? null;
        const normalized = String(value || '').trim();
        return normalized || null;
    }

    #generation(options = {}) {
        const candidate = options.expectedGeneration ?? options.operationContext?.connectionGeneration ?? null;
        const value = Number(candidate);
        return Number.isInteger(value) && value > 0 ? value : null;
    }


}

module.exports = B5StorageFlow;
