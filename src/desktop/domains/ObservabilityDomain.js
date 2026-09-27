'use strict';
// ObservabilityDomain: diagnostics + support-bundle input builder delegate.
class ObservabilityDomain {
  constructor({ artifactsProvider, snapshotProvider, logSnapshotProvider, listProfilesProvider } = {}) {
    Object.assign(this, { artifactsProvider, snapshotProvider, logSnapshotProvider, listProfilesProvider });
  }
  list(o = {}) { return this.artifactsProvider().list({ limit: o.limit ?? 40, botId: o.botId ?? null }); }
  read(id) { return this.artifactsProvider().read(id); }
}
module.exports = ObservabilityDomain;
