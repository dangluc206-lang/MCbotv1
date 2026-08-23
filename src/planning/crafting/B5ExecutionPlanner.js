'use strict';

const crypto = require('node:crypto');

function cloneStable(value) {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(cloneStable);
    if (typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, cloneStable(value[key])]));
}

function freezeDeep(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) freezeDeep(child);
    return Object.freeze(value);
}

/**
 * Pure compiler that turns a B5 inspection into a compact execution plan.
 * It does not click/send/wait. The current automation remains the executor;
 * this planner makes its next decision explicit and replayable.
 */
class B5ExecutionPlanner {
    compile(inspection = {}) {
        const replayInput = this.capture(inspection);
        const progress = replayInput.progress || {};
        const targetId = progress.targetId || replayInput.fullPlan?.targetId || 'super_alloy';
        const amount = Math.max(1, Number(progress.amount || replayInput.amount || 1));
        const nextStep = progress.nextStep ? cloneStable(progress.nextStep) : null;
        const blockers = this.#blockers(replayInput);
        const plannedCrafts = Array.isArray(replayInput.fullPlan?.steps)
            ? replayInput.fullPlan.steps.filter(step => Number(step?.crafts || 0) > 0).map(step => ({
                recipeId: step.recipeId || null,
                outputId: step.outputId || null,
                crafts: Number(step.crafts || 0)
            }))
            : [];
        const decision = nextStep
            ? { kind: String(nextStep.kind || 'UNKNOWN'), resource: nextStep.id || nextStep.b2Id || null, reason: nextStep.reason || null }
            : blockers.length > 0
                ? { kind: 'WAIT', resource: blockers[0].resource || null, reason: blockers[0].reason }
                : { kind: progress.feasible ? 'VERIFY' : 'IDLE', resource: targetId, reason: progress.feasible ? 'plan-feasible-no-next-step' : 'no-executable-step' };

        const snapshot = {
            targetId,
            amount,
            additional: Boolean(replayInput.additional),
            storage: cloneStable(replayInput.storage || {}),
            personalVault: cloneStable(replayInput.personalVault || {}),
            personalVaultPressure: cloneStable(replayInput.personalVaultPressure || null),
            inventory: cloneStable(replayInput.inventoryTotals || {}),
            progress: cloneStable(progress)
        };
        const digest = crypto.createHash('sha256').update(JSON.stringify(cloneStable(replayInput))).digest('hex').slice(0, 16);
        return freezeDeep({
            version: 2,
            targetId,
            amount,
            snapshotDigest: digest,
            state: progress.state || (progress.feasible ? 'READY' : 'WAITING_MATERIALS'),
            feasible: Boolean(progress.feasible),
            priority: Array.isArray(progress.priority) ? [...progress.priority] : ['B5', 'B4', 'B3', 'B2'],
            decision,
            nextStep,
            blockers,
            plannedCrafts,
            metrics: {
                remainingStages: Number(progress.remainingStages || 0),
                remainingCrafts: Number(progress.remainingCrafts || 0),
                b3PromotableTotal: Number(progress.b3PromotableTotal || 0),
                b4CraftableTotal: Number(progress.b4CraftableTotal || 0),
                targetExisting: Number(progress.targetExisting || 0)
            },
            snapshot,
            replayInput
        });
    }

    capture(inspection = {}) {
        const progress = inspection.progress || {};
        const fullPlan = inspection.fullPlan || {};
        return freezeDeep({
            amount: Math.max(1, Number(progress.amount || inspection.amount || 1)),
            additional: Boolean(inspection.additional),
            storage: {
                items: cloneStable(inspection.storage?.items || {}),
                capacity: cloneStable(inspection.storage?.capacity || null)
            },
            personalVault: { totals: cloneStable(inspection.personalVault?.totals || {}) },
            personalVaultPressure: cloneStable(inspection.personalVaultPressure || null),
            inventoryTotals: cloneStable(inspection.inventoryTotals || {}),
            fullPlan: {
                targetId: fullPlan.targetId || progress.targetId || 'super_alloy',
                feasible: Boolean(fullPlan.feasible),
                missing: cloneStable(fullPlan.missing || {}),
                steps: Array.isArray(fullPlan.steps) ? fullPlan.steps.map(step => ({
                    recipeId: step?.recipeId || null,
                    outputId: step?.outputId || null,
                    crafts: Number(step?.crafts || 0)
                })) : []
            },
            chains: Array.isArray(inspection.chains) ? inspection.chains.map(chain => ({
                baseId: chain?.baseId || null,
                b2Id: chain?.b2Id || null,
                b3Id: chain?.b3Id || null,
                decompressionBlocked: chain?.decompressionBlocked === true,
                missingRaw: Number(chain?.missingRaw || 0),
                immediateMissingRaw: Number(chain?.immediateMissingRaw || 0),
                storedEffective: Number(chain?.storedEffective || 0),
                storedTotalEffective: Number(chain?.storedTotalEffective || 0)
            })) : [],
            progress: cloneStable({
                ...progress,
                targetId: progress.targetId || fullPlan.targetId || 'super_alloy',
                amount: Math.max(1, Number(progress.amount || inspection.amount || 1)),
                feasible: Boolean(progress.feasible),
                nextStep: progress.nextStep ? cloneStable(progress.nextStep) : null
            })
        });
    }

    toReplayFixture(plan) {
        if (!plan?.replayInput) throw new TypeError('B5 execution plan does not contain replay input.');
        return freezeDeep({
            version: 1,
            inspection: cloneStable(plan.replayInput),
            expected: {
                decisionKind: plan.decision?.kind ?? null,
                decisionResource: plan.decision?.resource ?? null,
                blockers: (plan.blockers || []).map(entry => `${entry.reason}:${entry.resource || ''}`)
            }
        });
    }

    #blockers(inspection) {
        const blockers = [];
        const seen = new Set();
        const push = (reason, resource = null, details = null) => {
            const key = `${reason}:${resource || ''}`;
            if (seen.has(key)) return;
            seen.add(key);
            blockers.push({ reason, resource, details: cloneStable(details) });
        };

        const pressure = inspection.personalVaultPressure || null;
        if (pressure?.critical) push('pv2-capacity-critical', 'personalVault2', pressure);

        for (const chain of inspection.chains || []) {
            if (chain?.decompressionBlocked && Number(chain?.missingRaw || 0) <= 0 && Number(chain?.immediateMissingRaw || 0) > 0) {
                push('decompression-headroom', chain.baseId || null, {
                    immediateMissingRaw: Number(chain.immediateMissingRaw || 0),
                    storedEffective: Number(chain.storedEffective || 0),
                    storedTotalEffective: Number(chain.storedTotalEffective || 0)
                });
            }
        }

        for (const [resource, count] of Object.entries(inspection.fullPlan?.missing || {})) {
            if (Number(count || 0) > 0) push('missing-material', resource, { count: Number(count) });
        }

        if (!inspection.progress?.nextStep && !inspection.fullPlan?.feasible && blockers.length === 0) {
            push('no-executable-step', null, null);
        }
        return blockers;
    }
}

module.exports = B5ExecutionPlanner;
