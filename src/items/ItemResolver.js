'use strict';

const STRENGTH = Object.freeze({
    NONE: 0,
    WEAK: 10,
    MEDIUM: 20,
    STRONG: 30,
    VERY_STRONG: 40
});

class ItemResolver {
    constructor({ registry, matcher }) {
        this.registry = registry;
        this.matcher = matcher;
    }

    resolve(rawItem, context = 'inventory') {
        let best = null;
        let bestRank = -1;
        for (const id of this.registry.ids()) {
            const definition = this.registry.require(id);
            const result = this.matcher.match(rawItem, definition, context);
            if (!result.matched) continue;
            const rank = STRENGTH[result.strength] ?? 0;
            if (rank <= bestRank) continue;
            best = { id, definition, match: result };
            bestRank = rank;
            if (rank >= STRENGTH.VERY_STRONG) break;
        }
        return best;
    }

    matches(rawItem, logicalId, context = 'inventory') {
        return this.matcher.match(rawItem, this.registry.require(logicalId), context);
    }
}

module.exports = ItemResolver;
