'use strict';

class CollectorB5WorkPolicy {
    hasActionableWork(data) {
        const progress = data?.progress || {};
        if (progress.b5DirectReady) return true;
        if (Number(progress.b4CraftableTotal || 0) > 0) return true;
        if (Number(progress.b3PromotableTotal || 0) > 0) return true;
        if (data?.fullPlan?.feasible && Array.isArray(data.finalSteps) && data.finalSteps.length > 0) return true;

        return (data?.chains || []).some(chain => {
            const b2Crafts = Number(chain?.b2Crafts || 0);
            const b3Crafts = Number(chain?.b3Crafts || 0);
            const planned = b2Crafts > 0 || b3Crafts > 0;
            if (chain?.readyToReserve && planned) return true;

            const existingB2 = Number(chain?.vaultB2 || 0) + Number(chain?.inventoryB2 || 0);
            if (Number(chain?.b3InputPerCraft || 0) > 0
                && existingB2 >= Number(chain.b3InputPerCraft)) return true;

            return Boolean(chain?.compactableB1)
                || Number(chain?.inventoryB2 || 0) > 0
                || Number(chain?.inventoryB3 || 0) > 0;
        });
    }

    pressureNeedsMaintenance(pressure) {
        return Boolean(pressure?.known && (pressure.shouldConsumeB1 || pressure.sellRequired || pressure.critical));
    }

    hasMaintenanceWork(data) {
        const progress = data?.progress || {};
        if (Number(progress.b4CraftableTotal || 0) > 0) return true;
        if (Number(progress.b3PromotableTotal || 0) > 0) return true;
        return (data?.chains || []).some(chain => {
            const existingB2 = Number(chain?.vaultB2 || 0) + Number(chain?.inventoryB2 || 0);
            const b3InputPerCraft = Number(chain?.b3InputPerCraft || 0);
            return (b3InputPerCraft > 0 && existingB2 >= b3InputPerCraft)
                || Number(chain?.inventoryB2 || 0) > 0
                || Number(chain?.inventoryB3 || 0) > 0;
        });
    }

    allB3Satisfied(data) {
        const chains = Array.isArray(data?.chains) ? data.chains : [];
        return chains.length > 0 && chains.every(chain =>
            Number(chain?.b2Crafts || 0) <= 0 && Number(chain?.b3Crafts || 0) <= 0
        );
    }
}

module.exports = CollectorB5WorkPolicy;
