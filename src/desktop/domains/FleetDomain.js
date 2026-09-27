'use strict';
// FleetDomain: thin composition over existing use-cases (no logic move).
// Owner: fleet + mode lifecycle + crafting requests delegated from facade.
class FleetDomain {
  constructor({ fleetControlUseCases, craftingRequestUseCases } = {}) {
    if (!fleetControlUseCases || !craftingRequestUseCases) throw new TypeError('FleetDomain needs use-cases.');
    Object.assign(this, { fleetControlUseCases, craftingRequestUseCases });
  }
  connect(b) { return this.fleetControlUseCases.connect(b); }
  disconnect(b) { return this.fleetControlUseCases.disconnect(b); }
  home(b) { return this.fleetControlUseCases.home(b); }
  fleetAction(a) { return this.fleetControlUseCases.fleetAction(a); }
  reconcile(r) { return this.fleetControlUseCases.reconcile(r); }
  startMode(b, m) { return this.fleetControlUseCases.startMode(b, m); }
  pauseMode(b) { return this.fleetControlUseCases.pauseMode(b); }
  resumeMode(b) { return this.fleetControlUseCases.resumeMode(b); }
  stopMode(b) { return this.fleetControlUseCases.stopMode(b); }
  restartMode(b) { return this.fleetControlUseCases.restartMode(b); }
  craftingItems(b) { return this.craftingRequestUseCases.items(b); }
  setCraftingRequest(b, r) { return this.craftingRequestUseCases.set(b, r); }
  clearCraftingRequest(b) { return this.craftingRequestUseCases.clear(b); }
}
module.exports = FleetDomain;
