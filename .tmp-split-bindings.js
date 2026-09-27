'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const APP = path.resolve('src/desktop/renderer/app.js');
const OUT = path.resolve('src/desktop/renderer/core/RendererEventBindings.js');
const raw = fs.readFileSync(APP, 'utf8');
const lines = raw.split(/\r?\n/);
const startIdx = lines.findIndex(line => line === 'function bindEvents() {');
assert.ok(startIdx >= 0, 'bindEvents must exist');
// bindEvents is the only top-level block closed by a lone '}' before
// restoreLocalPreferences; anchor on that boundary.
const endIdx = lines.findIndex((line, index) => index > startIdx && line === '}' && lines[index + 1] === '' && lines[index + 2] === 'function restoreLocalPreferences() {');
assert.ok(endIdx > startIdx, 'bindEvents end anchor must exist');
const head = lines.slice(0, startIdx);
const body = lines.slice(startIdx + 1, endIdx).map(line => (line.startsWith('  ') ? line.slice(2) : line));
const tail = lines.slice(endIdx + 1);
const moduleSrc = fs.readFileSync(OUT, 'utf8');
const footer = "    function bindEvents() {\n      bindClickDelegation();\n      bindNavigation();\n      bindCommandPalette();\n      bindFirstRun();\n      bindIncidents();\n      bindB5Journey();\n      bindSkyCommands();\n      bindAdvancedConfig();\n      bindBuilder();\n      bindProfiles();\n      bindCommands();\n      bindPreferences();\n      bindCollectorFishing();\n      bindDevInspector();\n      bindSecrets();\n      bindUpdates();\n      bindGlobalKeys();\n    }\n\n    return Object.freeze({ bindEvents });\n  }\n\n  return Object.freeze({ create });\n}));\n";
const created = moduleSrc.replace(/\n$/, '\n') + body.join('\n') + '\n' + footer;
fs.writeFileSync(OUT, created);
const wiring = [
  '// Event bindings: the legacy bindEvents body lives in core/RendererEventBindings.js.',
  '// The facade keeps this alias so initialize() behavior is unchanged.',
  'const { bindEvents } = window.MCbotRendererEventBindings.create({',
  '  document, state, $, api, toast, esc, pageTitles,',
  '  handleBotAction, handleFleetAction, switchPage, switchDevPage,',
  '  openCommandPalette, renderCommandPalette, renderFirstRun, renderHealth,',
  '  renderIncidents, loadIncidents, renderB5Journey, loadB5Journey,',
  '  renderModes, renderBotDetail, renderDevOverview, renderInspector,',
  '  renderEventStream, scheduleEventRender, copyEventRecord, renderIncidentDebug,',
  '  renderIncidentDebugDetail, renderRuntimeState, renderB5Debug, loadConfigDebug,',
  '  renderProfiles, loadProfiles, loadCommands, syncSelectors, loadStaticData,',
  '  loadSkyCommands, renderSkyCommands, clearSkyCommandEditor, saveSkyCommandFromEditor,',
  '  renderLogs, scheduleLogRender, updateLogUnread, refreshDiagnostics,',
  '  loadCollectorConfig, loadFishingConfig, fillFishingArea, renderUpdateStatus,',
  '  loadConfigurationCatalog, loadAdvancedConfig, previewAdvancedConfig, saveAdvancedConfig,',
  '  undoAdvancedConfig, renderBackupCatalog, loadBackupCatalog, loadB5PureConfig,',
  '  saveB5PureConfig, loadB5Rules, syncB2InputSourceUi, saveB5Rules,',
  '  loadStorageProtection, saveStorageProtection, defaultModuleStep, newCustomDraft,',
  '  modulePayload, renderWorkflowList, draftFromBuilder, readSteps, fillCustomBuilder,',
  '  renderModulePalette, customModeEntryId, loadCustomModeCatalog, changeWorkflowStep,',
  '  runAction, refreshSnapshot, confirmInApp, reportRendererError, captureCraftingDraft',
  '});'
];
fs.writeFileSync(APP, head.concat(wiring, tail).join('\n'));
console.log(JSON.stringify({ start: startIdx + 1, end: endIdx + 1, appLines: head.length + wiring.length + tail.length }));
