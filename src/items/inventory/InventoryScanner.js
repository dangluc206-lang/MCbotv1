'use strict';

class InventoryScanner {
    constructor({ resolver, guiKnowledge = null }) {
        this.resolver = resolver;
        this.guiKnowledge = guiKnowledge;
    }

    scan(snapshot, logicalId, context = 'inventory') {
        return (snapshot?.items || []).filter(item => {
            // InventoryReader has already normalized the Mineflayer item and
            // preserved custom identities such as
            // MMOITEMS_ITEM_ID:DADOTINHLUYEN. Never fall back to a cloned
            // `raw` object here; Map/class-backed component metadata may have
            // been lost during snapshot cloning.
            if (this.guiKnowledge?.matchesLogical(item, logicalId, context)) return true;
            return this.resolver.matches(item, logicalId, context).matched;
        });
    }
}

module.exports = InventoryScanner;
