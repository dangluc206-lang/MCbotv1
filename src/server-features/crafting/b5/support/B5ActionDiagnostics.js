'use strict';

class B5ActionDiagnostics {
    static blockingReasons(actions = []) {
        const blockers = [];
        const seen = new Set();
        for (const action of actions || []) {
            const status = String(action?.status || '').toLowerCase();
            const reason = String(action?.reason || '').trim();
            const isBlocker = status === 'waiting'
                || status === 'new-b2-suppressed'
                || status === 'deferred-for-space'
                || reason.includes('not-ready')
                || reason.includes('headroom')
                || reason.includes('capacity')
                || reason.includes('backpressure');
            if (!isBlocker) continue;
            const entry = {
                status: action?.status || 'waiting',
                reason: reason || action?.status || 'waiting',
                baseId: action?.baseId || null,
                targetId: action?.targetId || null,
                b3Id: action?.b3Id || null,
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
        return [
            'base-ready', 'reserved', 'b2-promoted-to-b3', 'b3-promoted-to-b4',
            'final-crafted-and-deposited', 'existing-b5-recovered',
            'compacted-after-b3', 'all-b1-compacted', 'intermediate-deposited'
        ].some(token => status === token || status.includes(token));
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

module.exports = B5ActionDiagnostics;
