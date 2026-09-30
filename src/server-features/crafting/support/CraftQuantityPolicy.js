'use strict';

// Generic crafting quantity policy (Slice 6 Step 5). Single owner of every
// ALL/64/1 decision. Cycle + coordinators receive a policy instance; they
// never infer product semantics from config. Legacy B-chain keys are read
// once at the fromConfig() boundary and mapped to generic names; the stored
// policy is generic-only.
class CraftQuantityPolicy {
    constructor(o) {
        o = o || {};
        const q = o.quantity || {};
        this.enabled = q.enabled !== false;
        this.useAllForIntermediate = this.enabled && q.useAllForIntermediate === true;
        this.useAllForOutput = this.enabled && q.useAllForOutput === true;
        this.useAllForDirectInputWhenExact = this.enabled && q.useAllForDirectInputWhenExact === true;
        this.useAllForTarget = this.enabled && q.useAllForTarget === true;
        this.intermediateBatchSize = Math.max(1, Math.floor(Number(q.intermediateBatchSize) > 0 ? Number(q.intermediateBatchSize) : 64));
        this.outputAllMinEmptySlots = Math.max(1, Math.floor(Number(o.outputAllMinEmptySlots) > 0 ? Number(o.outputAllMinEmptySlots) : 1));
        this.inventorySafetyEmptySlots = Math.max(0, Math.floor(Number(o.inventorySafetyEmptySlots) > 0 ? Number(o.inventorySafetyEmptySlots) : 0));
        this.inputSource = o.inputSource === 'inventory' ? 'inventory' : 'storage';
        Object.freeze(this);
    }
    static fromConfig(config) {
        config = config || {};
        const q = config.quantity || config.quantityOptimization || {};
        const pick = (a, b) => (a !== undefined ? a : b);
        return new CraftQuantityPolicy({
            quantity: {
                enabled: q.enabled,
                useAllForIntermediate: pick(q.useAllForIntermediate, q.useAllForB2),
                useAllForOutput: pick(q.useAllForOutput, q.useAllForB3),
                useAllForDirectInputWhenExact: pick(q.useAllForDirectInputWhenExact, q.useAllForB4WhenExact),
                useAllForTarget: pick(q.useAllForTarget, q.useAllForB5),
                intermediateBatchSize: pick(q.intermediateBatchSize, q.b2BatchSize)
            },
            outputAllMinEmptySlots: pick(config.outputAllMinEmptySlots, config.b3AllMinEmptySlots),
            inventorySafetyEmptySlots: config.inventorySafetyEmptySlots,
            inputSource: pick(config.inputSource, config.b2InputSource)
        });
    }
    loopGuardCode(o) {
        o = o || {};
        if (o.guardExceeded || o.zeroProgressWithFreeSlotStall) return 'CRAFT_RESERVE_LOOP_GUARD';
        return 'CRAFT_RESERVE_INPUT_STALLED';
    }
    intermediateQuantity(o) {
        o = o || {};
        const remaining = Math.max(0, Number(o.planned || 0));
        const have = Math.max(0, Number(o.craftable || 0));
        if (this.useAllForIntermediate && have <= remaining) return { quantity: 'ALL', reason: 'inventory-base-all-bounded-by-current-material-plan' };
        if (remaining >= 64 && have >= 64) return { quantity: 64, reason: 'exact-64-after-base-withdraw' };
        return { quantity: 1, reason: 'exact-one-after-base-withdraw' };
    }
    outputQuantity(o) {
        o = o || {};
        const left = Math.max(0, Number(o.remaining || 0));
        const have = Math.max(0, Number(o.available || 0));
        if (this.useAllForOutput) return { quantity: 'ALL', reason: 'intermediate-accumulated-then-output-all' };
        if (left >= 64 && have >= 64) return { quantity: 64, reason: 'exact-64-batch' };
        return { quantity: 1, reason: 'exact-fallback' };
    }
    finalQuantity(o) {
        o = o || {};
        const left = Math.max(0, Number(o.remaining || 0));
        const max = Number(o.maxCraftable);
        if (!o.isTarget && this.useAllForDirectInputWhenExact && left > 1 && max === left) return { quantity: 'ALL', reason: 'all-is-exact-for-current-direct-inputs' };
        if (o.isTarget && !this.useAllForTarget) return left >= 64 ? { quantity: 64, reason: 'final-target-exact-cycle' } : { quantity: 1, reason: 'final-target-exact-cycle' };
        if (left >= 64 && max >= 64) return { quantity: 64, reason: 'exact-64-batch' };
        return { quantity: 1, reason: 'exact-one' };
    }
    planChain(o) {
        o = o || {};
        const exact = Math.max(0, Number(o.plannedIntermediateExact || 0));
        const plannedOut = Math.max(0, Number(o.plannedOutput || 0));
        const per = Math.max(0, Number(o.basePerIntermediate || 0));
        const immediate = Math.max(0, Number(o.immediatelyCraftable || 0));
        const total = Math.max(0, Number(o.totalEffective || 0));
        const baseNeededFromStorage = Math.max(0, Number(o.baseNeededFromStorage || 0));
        const known = Number.isFinite(total) && per > 0;
        const immediateCrafts = known ? Math.floor(immediate / per) : null;
        const totalCrafts = known ? Math.floor(total / per) : null;
        let planned = 0;
        if (exact > 0) {
            if (this.useAllForIntermediate) {
                planned = known && totalCrafts < 1 ? 0 : exact;
            } else {
                const need = Math.ceil(exact / this.intermediateBatchSize) * this.intermediateBatchSize;
                const full = known ? Math.floor(totalCrafts / this.intermediateBatchSize) * this.intermediateBatchSize : need;
                planned = Math.max(0, Math.min(need, full));
            }
        }
        const requiredRawForStart = planned > 0 && per > 0
            ? (this.useAllForIntermediate ? per : planned * per)
            : baseNeededFromStorage;
        return Object.freeze({
            requiredRawForStart,
            plannedIntermediateExact: exact, plannedIntermediate: planned, plannedOutput: plannedOut,
            intermediateBatchSize: this.intermediateBatchSize, useAllForIntermediate: this.useAllForIntermediate,
            inputSource: this.inputSource, basePerIntermediate: per, immediatelyCraftable: immediate,
            totalEffective: total, immediateIntermediateCrafts: immediateCrafts, totalIntermediateCrafts: totalCrafts,
            decompressionBlocked: total > immediate,
            nextAction: planned > 0 ? (total > immediate ? 'PREPARE_BASE' : 'CRAFT_INTERMEDIATE') : (plannedOut > 0 ? 'CRAFT_OUTPUT' : 'WAIT_MATERIAL')
        });
    }
}
module.exports = CraftQuantityPolicy;
