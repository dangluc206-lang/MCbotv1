'use strict';
// RendererStore: single state owner for renderer/app.js (M1 extraction).
// No DOM, no IPC here — pure state + reset helpers. app.js keeps bootstrap.
(function universal(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.MCbotRendererStore = value;
}(typeof globalThis !== 'undefined' ? globalThis : this, function create() {
  function initialState(page, devPage) {
    return {
      snapshot: null, profiles: [], commands: [], skyCommands: {},
      skyCommandSelections: [], skyCommandEditingId: null, logs: [],
      preferences: null, appInfo: null, guiOutput: null,
      page: page || 'dashboard', devPage: devPage || 'dev-overview',
      profilesLoaded: false, commandsLoaded: false,
      lastSnapshotReceivedAt: 0, renderScheduled: false,
      logRenderScheduled: false, logUnread: 0,
      pending: new Set(), selectorSignature: '',
      configGroups: [], customModes: [], customModules: [],
      customTemplates: [], customDraft: null, localUpdate: null,
      procedureCatalog: [], procedures: {}, procedureDraft: null,
      updateMigration: null, readiness: null, health: null,
      incidents: [], selectedIncidentId: null, incidentEvidenceIndex: 0,
      craftJourney: [], configWorkspace: null, backupCatalog: [],
      devLogs: [], devLogsLoaded: false, incidentDebugId: null,
      events: [], eventsLoaded: false
    };
  }
  // ponytail: reset evidence index on incident switch; caller owns re-render.
  function selectIncidentDebug(state, id) {
    state.incidentDebugId = id;
    state.incidentEvidenceIndex = 0;
    return state;
  }
  function clampEvidenceIndex(state, length) {
    const req = Number(state.incidentEvidenceIndex || 0);
    state.incidentEvidenceIndex = length ? Math.max(0, Math.min(length - 1, req)) : 0;
    return state.incidentEvidenceIndex;
  }
  return Object.freeze({ initialState, selectIncidentDebug, clampEvidenceIndex });
}));
