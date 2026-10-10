'use strict';

// Generic crafting action diagnostics (Slice 6 Step 1).
//
// Step 1 parity rule: same observable semantics as the legacy B-chain
// diagnostics on every current input (same blocker predicate, same dedupe,
// same 12-entry cap, same productive tokens, same summary counts). The only
// intentional difference is the entry shape: role-based generic keys
// (`outputId`/`intermediateId`) instead of B-chain keys (`b3Id`/`b2Id`).
// Role generalization of the status vocabulary happens in Step 2+ together
// with the coordinator emitters, never ahead of them.
// Compat note: legacy actions may still carry `b2Id`/`b3Id`; they are read
// as fallback and exposed under the generic keys.

const BLOCKER_STATUSES = Object.freeze(['waiting', 'new-b2-suppressed', 'deferred-for-space']);
const BLOCKER_REASON_TOKENS = Object.freeze(['not-ready', 'headroom', 'capacity', 'backpressure']);
const PRODUCTIVE_TOKENS = Object.freeze([
    'base-ready',
    'reserved',
    'b2-promoted-to-b3',
    'b3-promoted-to-b4',
    'final-crafted-and-deposited',
    'existing-target-recovered',
    'existing-b5-recovered',
    'compacted-after-b3',
    'all-b1-compacted',
    'intermediate-deposited'
]);

class CraftActionDiagnostics {
    static blockingReasons(actions = []) {
        const blockers = [];
        const seen = new Set();
        for (const action of actions || []) {
            const status = String(action?.status || '').toLowerCase();
            const reason = String(action?.reason || '').trim();
            const isBlocker = status === 'waiting'
                || status === 'new-b2-suppressed'
                || status === 'deferred-for-space'
                || BLOCKER_REASON_TOKENS.some(token => reason.includes(token));
            if (!isBlocker) continue;
            const entry = {
                status: action?.status || 'waiting',
                reason: reason || action?.status || 'waiting',
                baseId: action?.baseId || null,
                targetId: action?.targetId || null,
                outputId: action?.outputId ?? action?.b3Id ?? null,
                intermediateId: action?.intermediateId ?? action?.b2Id ?? null,
                message: action?.message || null
            };
            const key = JSON.stringify(entry);
            if (seen.has(key)) continue;
            seen.add(key);
            blockers.push(entry);
            if (blockers.length >= 12) break;
        }
        return blockers;
    }

    static isProductiveAction(action) {
        const status = String(action?.status || '').toLowerCase();
        if (!status) return false;
        if (['waiting', 'new-b2-suppressed', 'deferred-for-space'].includes(status)) return false;
        if (status.includes('skipped')) return false;
        return PRODUCTIVE_TOKENS.some(token => status === token || status.includes(token));
    }

    static summarizeActions(actions = []) {
        const counts = {};
        for (const action of actions || []) {
            const key = String(action?.status || 'unknown');
            counts[key] = Number(counts[key] || 0) + 1;
        }
        return counts;
    }
}

module.exports = CraftActionDiagnostics;
