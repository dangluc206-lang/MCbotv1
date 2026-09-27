(function universal(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.MCbotRendererEventBindings = value;
}(typeof globalThis !== 'undefined' ? globalThis : this, function create() {
  'use strict';
  // Owns renderer event wiring: every addEventListener/onclick/onchange/oninput
  // assignment that used to live in the legacy bindEvents facade.
  // The composition root injects the store, helpers and action entry points, so
  // this module keeps no globals and owns no domain state.
  function create(deps) {
    const {
      document, state, $, api, toast, esc, pageTitles,
      handleBotAction, handleFleetAction, switchPage, switchDevPage,
      openCommandPalette, renderCommandPalette, renderFirstRun, renderHealth,
      renderIncidents, loadIncidents, renderB5Journey, loadB5Journey,
      renderModes, renderBotDetail, renderDevOverview, renderInspector,
      renderEventStream, scheduleEventRender, copyEventRecord, renderIncidentDebug,
      renderIncidentDebugDetail, renderRuntimeState, renderB5Debug, loadConfigDebug,
      renderProfiles, loadProfiles, loadCommands, syncSelectors, loadStaticData,
      loadSkyCommands, renderSkyCommands, clearSkyCommandEditor, saveSkyCommandFromEditor,
      renderLogs, scheduleLogRender, updateLogUnread, refreshDiagnostics,
      loadCollectorConfig, loadFishingConfig, fillFishingArea, renderUpdateStatus,
      loadConfigurationCatalog, loadAdvancedConfig, previewAdvancedConfig, saveAdvancedConfig,
      undoAdvancedConfig, renderBackupCatalog, loadBackupCatalog, loadB5PureConfig,
      saveB5PureConfig, loadB5Rules, syncB2InputSourceUi, saveB5Rules,
      loadStorageProtection, saveStorageProtection, defaultModuleStep, newCustomDraft,
      modulePayload, renderWorkflowList, draftFromBuilder, readSteps, fillCustomBuilder,
      renderModulePalette, customModeEntryId, loadCustomModeCatalog, changeWorkflowStep,
      runAction, refreshSnapshot, confirmInApp, reportRendererError, captureCraftingDraft
    } = deps;
document.addEventListener('click', event => {
  const botAction = event.target.closest('[data-action]');
  if (botAction) handleBotAction(botAction).catch(() => {});
  const fleetAction = event.target.closest('[data-fleet-action]');
  if (fleetAction) handleFleetAction(fleetAction).catch(() => {});
});
$('#nav').addEventListener('click', event => { const item = event.target.closest('.nav-item'); if (item) switchPage(item.dataset.page); });
$('#devNav').addEventListener('click', event => { const item = event.target.closest('.dev-nav-item'); if (item) switchDevPage(item.dataset.devPage); });
$('#openCommandPalette').onclick = () => openCommandPalette().catch(error => toast(error.message, 'error'));
$('#commandPaletteInput').addEventListener('input', event => renderCommandPalette(event.target.value).catch(error => toast(error.message, 'error')));
$('#commandPaletteResults').addEventListener('click', event => { const item = event.target.closest('[data-palette-route]'); if (!item) return; $('#commandPaletteDialog').close(); switchPage(item.dataset.paletteRoute); });
$('#firstRunPanel').addEventListener('click', async event => {
  const button = event.target.closest('[data-first-run-action]'); if (!button) return;
  const current = state.preferences?.firstRun || { status:'NOT_STARTED', step:1 };
  const now = new Date().toISOString();
  if (button.dataset.firstRunAction === 'continue') {
    if (current.status === 'NOT_STARTED') state.preferences = await api(window.mcbot.setPreferences({ firstRun:{ ...current, status:'IN_PROGRESS', startedAt:now } }));
    switchPage(button.dataset.route || 'dashboard');
  } else if (button.dataset.firstRunAction === 'next') {
    const step = Math.min(6, Number(current.step || 1) + 1);
    const completed = Number(current.step || 1) >= 6;
    const startedAt = current.startedAt || now;
    state.preferences = await api(window.mcbot.setPreferences({ firstRun:{ status:completed ? 'COMPLETED' : 'IN_PROGRESS', step, startedAt, completedAt:completed ? now : null, durationMs:completed ? Math.max(0, Date.now() - Date.parse(startedAt)) : null } }));
    renderFirstRun();
  } else if (button.dataset.firstRunAction === 'skip') {
    state.preferences = await api(window.mcbot.setPreferences({ firstRun:{ ...current, status:'SKIPPED' } }));
    renderFirstRun();
  }
});
$('#refreshIncidents').onclick = () => loadIncidents().catch(error => toast(error.message, 'error'));
$('#incidentStateFilter').onchange = () => loadIncidents().catch(error => toast(error.message, 'error'));
$('#incidentBotFilter').onchange = () => loadIncidents().catch(error => toast(error.message, 'error'));
$('#incidentList').addEventListener('click', event => { const item = event.target.closest('[data-incident-id]'); if (!item) return; state.selectedIncidentId = item.dataset.incidentId; renderIncidents(); });
$('#incidentDetail').addEventListener('click', async event => {
  const actionButton = event.target.closest('[data-incident-action]');
  const transitionButton = event.target.closest('[data-incident-transition]');
  try {
    if (actionButton) {
      const incident = state.incidents.find(item => item.id === actionButton.dataset.incidentId); if (!incident) return;
      const action = actionButton.dataset.incidentAction;
      if (['retry-storage-protection','reconnect-bot'].includes(action) && !await confirmInApp({ title:'Thực hiện action có guard?', message:`${action} · bot ${incident.botId} · generation ${incident.generation}` })) return;
      const result = await api(window.mcbot.executeIncidentAction(incident.id, action, { expectedGeneration:incident.generation, idempotencyKey:`desktop-incident:${incident.id}:${action}:${crypto.randomUUID()}` }));
      if (action === 'inspect-diagnostic') { switchPage('diagnostics'); $('#diagnosticOutput').textContent = JSON.stringify(result.diagnostic, null, 2); }
      else if (action === 'edit-config') switchPage('settings');
      else if (action === 'export-support') toast(`Gói hỗ trợ: ${result.entryCount} mục · ${result.totalBytes} byte.`);
      else toast('Action sự cố đã được tiếp nhận.');
      await loadIncidents();
    } else if (transitionButton) {
      await api(window.mcbot.transitionIncident(transitionButton.dataset.incidentId, transitionButton.dataset.incidentTransition, {}));
      await loadIncidents();
    }
  } catch (error) { toast(error.message, 'error'); }
});
$('#refreshB5Journey').onclick = () => loadB5Journey().catch(error => toast(error.message, 'error'));
$('#b5Journey').addEventListener('click', event => { const button = event.target.closest('[data-b5-journey-retry]'); if (!button) return; button.dataset.action = 'b5-retry-storage'; button.dataset.bot = button.dataset.b5JourneyRetry; handleBotAction(button).then(loadB5Journey).catch(() => {}); });
$('#refreshBtn').onclick = () => refreshSnapshot();
$('#reloadProfiles').onclick = () => loadProfiles().catch(error => toast(error.message, 'error'));
$('#loadB5PureConfig').onclick = () => loadB5PureConfig().catch(error => toast(error.message, 'error'));
$('#saveB5PureConfig').onclick = event => runAction({ key: 'b5-pure-config', button: event.currentTarget, success: 'Đã lưu cấu hình chế tạo.', refresh: false, fn: saveB5PureConfig }).catch(() => {});
$('#loadB5Rules').onclick = () => loadB5Rules().catch(error => toast(error.message, 'error'));
$('#b5B2InputSource').addEventListener('change', syncB2InputSourceUi);
$('#saveB5Rules').onclick = event => runAction({ key: 'b5-rules-config', button: event.currentTarget, success: 'Đã lưu quy tắc B5. Hãy khởi động lại hệ thống nền để áp dụng đầy đủ.', refresh: false, fn: saveB5Rules }).catch(() => {});
$('#loadStorageProtect').onclick = () => loadStorageProtection().catch(error => toast(error.message, 'error'));
$('#saveStorageProtect').onclick = event => runAction({ key: 'storage-protect-config', button: event.currentTarget, success: 'Đã lưu và áp dụng mức bảo vệ kho cho các bot đang chạy.', refresh: false, fn: saveStorageProtection }).catch(() => {});

$('#skyCommandSky').onchange = () => { renderSkyCommands(); clearSkyCommandEditor(); };
$('#newSkyCommand').onclick = () => clearSkyCommandEditor();
$('#saveSkyCommand').onclick = event => runAction({ key: 'sky-command-save', button: event.currentTarget, success: 'Đã lưu lệnh riêng theo Sky và áp dụng ngay.', refresh: false, fn: saveSkyCommandFromEditor }).catch(() => {});
$('#skyCommandList').addEventListener('click', event => {
  const button = event.target.closest('[data-sky-command-action]');
  if (!button) return;
  const skyId = button.dataset.sky;
  const commandId = button.dataset.commandId;
  const definition = state.skyCommands?.[skyId]?.[commandId];
  if (button.dataset.skyCommandAction === 'edit' && definition) {
    $('#skyCommandSky').value = skyId;
    state.skyCommandEditingId = commandId;
    $('#skyCommandId').value = commandId;
    $('#skyCommandLabel').value = definition.label || commandId;
    $('#skyCommandValue').value = definition.command || '';
    $('#skyCommandDescription').value = definition.description || '';
    $('#skyCommandEnabled').checked = definition.enabled !== false;
    return;
  }
  if (button.dataset.skyCommandAction === 'delete') {
    runAction({ key: `sky-command-delete:${skyId}:${commandId}`, button, success: 'Đã xóa lệnh riêng theo Sky.', refresh: false, fn: async () => {
      const result = await api(window.mcbot.deleteSkyCommand(skyId, commandId));
      await Promise.all([loadSkyCommands(), loadCommands()]);
      return result;
    }}).catch(() => {});
    return;
  }
  if (button.dataset.skyCommandAction === 'send') {
    let args = {};
    try { args = JSON.parse($('#skyCommandArgs').value || '{}'); } catch (error) { toast(`JSON tham số không hợp lệ: ${error.message}`, 'error'); return; }
    runAction({ key: `sky-command-send:${skyId}:${commandId}`, button, success: `Đã gửi ${commandId} cho bot đang ở ${skyId}.`, refresh: false, fn: () => api(window.mcbot.sendSkyCommand($('#skyCommandBot').value, { skyId, commandId, args })) }).catch(() => {});
  }
});

$('#advancedConfigGroup').onchange = () => loadAdvancedConfig().catch(error => toast(error.message, 'error'));
$('#loadAdvancedConfig').onclick = () => loadAdvancedConfig().catch(error => toast(error.message, 'error'));
$('#previewAdvancedConfig').onclick = () => previewAdvancedConfig().catch(error => toast(error.message, 'error'));
$('#saveAdvancedConfig').onclick = event => runAction({ key: 'advanced-config', button: event.currentTarget, success: 'Cấu hình hợp lệ và đã được lưu.', refresh: false, fn: saveAdvancedConfig }).catch(() => {});
$('#undoAdvancedConfig').onclick = event => runAction({ key:'advanced-config-undo', button:event.currentTarget, success:'Đã hoàn tác cấu hình.', refresh:false, fn:undoAdvancedConfig }).catch(() => {});

$('#modulePalette').addEventListener('click', event => {
  const button = event.target.closest('[data-module-add]'); if (!button) return;
  let draft; try { draft = draftFromBuilder(); } catch (error) { toast(`JSON bước không hợp lệ: ${error.message}`, 'error'); return; }
  const step = defaultModuleStep(button.dataset.moduleType);
  if (button.dataset.moduleAdd === 'start') draft.workflow.start.push(step);
  else if (button.dataset.moduleAdd === 'stop') draft.workflow.stop.push(step);
  else draft.workflow.loop.steps.push(step);
  fillCustomBuilder(draft);
});
for (const id of ['customStartSteps','customLoopSteps','customStopSteps']) $('#' + id).addEventListener('click', event => {
  const button = event.target.closest('[data-step-action]'); if (button) return changeWorkflowStep(button);
  const remove = event.target.closest('[data-nested-remove]'); if (remove) return remove.closest('.typed-nested-row')?.remove();
  const add = event.target.closest('[data-nested-add]');
  if (add) add.closest('.typed-nested-section').querySelector(':scope > .typed-nested-list').insertAdjacentHTML('beforeend', window.MCbotTypedModuleEditor.renderNestedRow(defaultModuleStep('wait'), state.customModules, esc, 1));
});
for (const id of ['customStartSteps','customLoopSteps','customStopSteps']) $('#' + id).addEventListener('change', event => {
  const nestedSelect = event.target.closest('.nested-step-type');
  if (nestedSelect) {
    const nestedRow = nestedSelect.closest('.typed-nested-row');
    const step = defaultModuleStep(nestedSelect.value);
    const descriptor = state.customModules.find(item => item.type === step.type);
    nestedRow.querySelector(':scope > .step-editor').innerHTML = window.MCbotTypedModuleEditor.render(step, descriptor, state.customModules, esc, 1);
    return;
  }
  const select = event.target.closest('.step-type'); if (!select) return;
  const row = select.closest('.workflow-step');
  let draft; try { draft = draftFromBuilder(); } catch { draft = state.customDraft || newCustomDraft(); }
  const list = row.dataset.workflowSection === 'start' ? draft.workflow.start : row.dataset.workflowSection === 'stop' ? draft.workflow.stop : draft.workflow.loop.steps;
  list[Number(row.dataset.stepIndex)] = defaultModuleStep(select.value);
  fillCustomBuilder(draft);
});
$('#moduleSearch').oninput = event => renderModulePalette(event.target.value);
$('#applyCustomTemplate').onclick = () => {
  const template = state.customTemplates.find(item => item.id === $('#customModeTemplate').value);
  if (!template) return toast('Chưa chọn mẫu.', 'warn');
  fillCustomBuilder(template.definition); toast(`Đã nạp mẫu ${template.label}.`);
};
$('#dryRunCustomMode').onclick = event => runAction({ key:'custom-mode-dry-run', button:event.currentTarget, success:'Mô phỏng hoàn tất; không gọi capability.', refresh:false, fn:async () => {
  const report = await api(window.mcbot.customModeDryRun(draftFromBuilder(), { connected:true, guiId:null }));
  $('#customModeSimulation').textContent = JSON.stringify(report, null, 2); return report;
}}).catch(() => {});
$('#packageCustomMode').onclick = event => runAction({ key:'custom-mode-package', button:event.currentTarget, success:'Package manifest và digest hợp lệ.', refresh:false, fn:async () => {
  const report = await api(window.mcbot.customModePackage(draftFromBuilder()));
  $('#customModeSimulation').textContent = JSON.stringify(report.manifest, null, 2); return report;
}}).catch(() => {});
$('#newCustomMode').onclick = () => { $('#customModeSelect').value = ''; fillCustomBuilder(); };
$('#clearCustomSteps').onclick = () => { const draft = draftFromBuilder(); draft.workflow.start = []; draft.workflow.loop.steps = []; draft.workflow.stop = []; fillCustomBuilder(draft); };
$('#customModeSelect').onchange = () => {
  const id = $('#customModeSelect').value;
  const entry = state.customModes.find(item => customModeEntryId(item) === id);
  if (!entry?.valid && entry) { fillCustomBuilder({ ...newCustomDraft(), id, label: `${id} (cần sửa)` }); toast(`File mode ${id} đang lỗi. Có thể sửa lại hoặc xóa.`, 'warn'); return; }
  fillCustomBuilder(entry?.raw || null);
};
$('#saveCustomMode').onclick = event => runAction({ key: 'custom-mode-save', button: event.currentTarget, success: 'Đã lưu chế độ. Khởi động lại hệ thống nền để đăng ký chế độ mới.', refresh: false, fn: async () => {
  const definition = draftFromBuilder();
  const existing = state.customModes.find(item => customModeEntryId(item) === definition.id);
  const result = await api(window.mcbot.saveCustomMode(definition, { expectedDigest:existing?.digest || null }));
  await loadCustomModeCatalog(); $('#customModeSelect').value = definition.id; fillCustomBuilder(definition); return result;
}}).catch(() => {});
$('#deleteCustomMode').onclick = async event => {
  const id = $('#customModeSelect').value || $('#customModeId').value.trim();
  if (!id) return toast('Chưa chọn chế độ để xóa.', 'warn');
  if (!await confirmInApp({ title:`Xóa chế độ ${id}?`, message:'File mode sẽ bị xóa; backend cần khởi động lại để cập nhật danh mục.', destructive:true })) return;
  runAction({ key: 'custom-mode-delete', button: event.currentTarget, success: 'Đã xóa chế độ. Khởi động lại hệ thống nền để cập nhật danh mục.', refresh: false, fn: async () => { const result = await api(window.mcbot.deleteCustomMode(id)); await loadCustomModeCatalog(); fillCustomBuilder(); return result; } }).catch(() => {});
};
$('#applyCustomJson').onclick = () => { try { fillCustomBuilder(JSON.parse($('#customModeJson').value)); toast('Đã áp dụng JSON vào trình dựng.'); } catch (error) { toast(`JSON không hợp lệ: ${error.message}`, 'error'); } };
$('#createProfileBtn').onclick = event => runAction({ key: 'profile-create', button: event.currentTarget, success: 'Đã tạo bot mới.', refresh: false, fn: async () => {
  const fields = {
    id: $('#newBotId').value.trim(),
    displayName: $('#newBotDisplayName').value.trim(),
    username: $('#newBotUsername').value.trim(),
    auth: $('#newBotAuth').value,
    version: $('#newBotVersion').value.trim(),
    serverProfile: $('#newBotServerProfile').value.trim(),
    skyblockSelection: $('#newBotSkySelection').value
  };
  const result = await api(window.mcbot.createProfile(fields));
  for (const id of ['newBotId', 'newBotDisplayName', 'newBotUsername']) $('#' + id).value = '';
  await loadProfiles();
  await refreshSnapshot({ quiet: true });
  return result;
} }).catch(() => {});

$('#sendCommandBtn').onclick = async event => {
  let args;
  try { args = JSON.parse($('#commandArgs').value || '{}'); } catch { toast('JSON tham số không hợp lệ.', 'error'); return; }
  if (!args || typeof args !== 'object' || Array.isArray(args)) { toast('Tham số phải là một object JSON.', 'error'); return; }
  await runAction({ key: 'command-send', button: event.currentTarget, success: 'Lệnh đã được xử lý.', refresh: false, fn: async () => {
    const result = await api(window.mcbot.sendCommand($('#commandBot').value, { commandKey: $('#commandKey').value, args, confirm: $('#commandConfirm').checked, timeoutMs: Number($('#commandTimeout').value) }));
    $('#commandOutput').textContent = JSON.stringify(result, null, 2); return result;
  }}).catch(() => {});
};
$('#copyCommandBtn').onclick = () => navigator.clipboard.writeText($('#commandOutput').textContent).then(() => toast('Đã sao chép kết quả lệnh.')).catch(error => { reportRendererError(error, 'clipboard-command'); toast('Không sao chép được kết quả.', 'error'); });

$('#inspectGuiBtn').onclick = event => runAction({ key: 'gui-inspect', button: event.currentTarget, success: 'Đã chụp GUI.', refresh: false, fn: async () => {
  const slots = $('#guiSlots').value.split(',').map(value => Number(value.trim())).filter(Number.isInteger);
  state.guiOutput = await api(window.mcbot.inspectGui($('#guiBot').value, { commandKey: $('#guiCommand').value, slots, timeoutMs: Number($('#guiTimeout').value) }));
  $('#guiOutput').textContent = JSON.stringify(state.guiOutput, null, 2);
  return { success: true };
}}).catch(() => {});
$('#copyGuiBtn').onclick = () => navigator.clipboard.writeText($('#guiOutput').textContent).then(() => toast('Đã sao chép JSON GUI.')).catch(error => { reportRendererError(error, 'clipboard-gui'); toast('Không sao chép được JSON GUI.', 'error'); });

for (const id of ['logLevel', 'logBot']) $('#' + id).addEventListener('change', () => { localStorage.setItem(`mcbot.${id}`, $('#' + id).value); renderLogs(); });
$('#logSearch').addEventListener('input', scheduleLogRender);
$('#logPause').addEventListener('change', () => { if (!$('#logPause').checked) renderLogs(); updateLogUnread(); });
$('#logAutoScroll').addEventListener('change', () => { localStorage.setItem('mcbot.logAutoScroll', $('#logAutoScroll').checked ? '1' : '0'); if ($('#logAutoScroll').checked) renderLogs(); });
$('#clearLogView').onclick = () => { state.logs = []; state.logUnread = 0; renderLogs(); };
$('#openDetailedLogs').onclick = () => runAction({ key: 'open-detailed-logs', refresh: false, fn: () => api(window.mcbot.openLogFolder()) }).catch(() => {});
$('#logConsole').addEventListener('scroll', () => { const el = $('#logConsole'); if (el.scrollHeight - el.scrollTop - el.clientHeight > 100 && $('#logAutoScroll').checked) { $('#logAutoScroll').checked = false; localStorage.setItem('mcbot.logAutoScroll', '0'); } });

$('#refreshDiagnostics').onclick = refreshDiagnostics;
$('#diagnosticList').addEventListener('click', async event => { const item = event.target.closest('[data-diagnostic]'); if (!item) return; try { $('#diagnosticOutput').textContent = JSON.stringify(await api(window.mcbot.readDiagnostic(item.dataset.diagnostic)), null, 2); } catch (error) { toast(error.message, 'error'); } });
$('#exportSupport').onclick = async event => {
  try {
    const preview = await api(window.mcbot.supportBundlePreview());
    const accepted = await confirmInApp({ title: 'Xem trước gói hỗ trợ', message: `${preview.entryCount} mục · ${preview.totalBytes} byte · riêng tư: ${preview.privacy?.default || 'PSEUDONYMIZED'}${preview.warnings?.length ? `\n${preview.warnings.length} cảnh báo sẽ được ghi trong manifest.` : ''}` });
    if (!accepted) return;
    await runAction({ key: 'support-export', button: event.currentTarget, success: 'Đã xuất gói hỗ trợ.', refresh: false, fn: () => api(window.mcbot.exportSupportBundle({ previewId: preview.previewId })) });
  } catch (error) { toast(error.message, 'error'); }
};
$('#openSupport').onclick = () => runAction({ key: 'open-support', success: null, refresh: false, fn: () => api(window.mcbot.openSupportFolder()) }).catch(() => {});

$('#openProject').onclick = () => runAction({ key: 'open-project', refresh: false, fn: () => api(window.mcbot.openProjectFolder()) }).catch(() => {});
$('#openLogs').onclick = () => runAction({ key: 'open-logs', refresh: false, fn: () => api(window.mcbot.openLogFolder()) }).catch(() => {});
$('#openBackups').onclick = () => runAction({ key: 'open-backups', refresh: false, fn: () => api(window.mcbot.openBackupFolder()) }).catch(() => {});
$('#backupConfig').onclick = event => runAction({ key: 'backup-config', button: event.currentTarget, success: 'Đã sao lưu toàn bộ cấu hình với manifest và hash.', refresh: false, fn: async () => { const result = await api(window.mcbot.backupConfig()); await loadBackupCatalog(); return result; } }).catch(() => {});
$('#refreshBackups').onclick = () => loadBackupCatalog().catch(error => toast(error.message, 'error'));
$('#backupCatalog').addEventListener('click', async event => {
  const button = event.target.closest('[data-backup-preview]'); if (!button) return;
  try {
    const preview = await api(window.mcbot.previewConfigRestore(button.dataset.backupPreview));
    const summary = preview.changes.filter(change => change.action !== 'UNCHANGED').map(change => `${change.action}: ${change.path}`).slice(0, 30).join('\n') || 'Không có file thay đổi.';
    if (!await confirmInApp({ title:'Khôi phục backup cấu hình?', message:`${summary}\n\nBackend sẽ dừng, restore được verify đầy đủ và tự rollback nếu lỗi.`, destructive:true })) return;
    await api(window.mcbot.restoreConfigBackup(button.dataset.backupPreview));
    toast('Đã khôi phục và xác minh backup cấu hình.');
    await Promise.all([refreshSnapshot({ quiet:true }), loadBackupCatalog()]);
  } catch (error) { toast(error.message, 'error'); }
});

$('#startBackend').onclick = event => runAction({ key: 'backend', button: event.currentTarget, success: 'Hệ thống nền đã khởi động.', fn: () => api(window.mcbot.backendStart()) }).then(loadStaticData).catch(() => {});
$('#stopBackend').onclick = async event => { if (!await confirmInApp({ title:'Dừng hệ thống nền?', message:'Mọi tiến trình bot và kết nối sẽ dừng.', destructive:true })) return; runAction({ key: 'backend', button: event.currentTarget, success: 'Hệ thống nền đã dừng.', fn: () => api(window.mcbot.backendStop()) }).catch(() => {}); };
$('#restartBackend').onclick = event => runAction({ key: 'backend', button: event.currentTarget, success: 'Hệ thống nền đã khởi động lại.', fn: () => api(window.mcbot.backendRestart()) }).then(loadStaticData).catch(() => {});
$('#emergencyStop').onclick = async event => {
  const count = (state.snapshot?.bots || []).length;
  if (!await confirmInApp({ title: 'Dừng khẩn cấp toàn bộ fleet?', message: `Sẽ thu hồi chế độ, khóa tự kết nối lại và ngắt ${count} bot. Kết quả từng bot sẽ được kiểm tra.`, destructive: true })) return;
  try {
    const envelope = await window.mcbot.fleetAction('emergency-stop');
    if (!envelope?.success) throw new Error(envelope?.error?.message || 'Không gọi được dừng khẩn cấp.');
    const result = envelope.data;
    if (result.outcome === 'SUCCESS') toast(`Đã dừng an toàn ${result.terminalCount}/${result.botCount} bot.`);
    else toast(`Dừng khẩn cấp ${result.outcome}: ${result.terminalCount}/${result.botCount} bot đã terminal. Hãy xem Chẩn đoán và thử lại bot còn lỗi.`, 'warn');
    await refreshSnapshot({ quiet: true });
  } catch (error) { toast(error.message, 'error'); reportRendererError(error, 'action:fleet:emergency-stop'); }
};

$('#secretStatusBtn').onclick = async () => { try { const status = await api(window.mcbot.secretStatus()); $('#secretStatusText').textContent = `Trạng thái: ${status.state} · Mã hóa: ${status.encryptionAvailable ? 'OK' : 'KHÔNG KHẢ DỤNG'} · Đã cấu hình: ${status.keys.join(', ') || 'chưa có'}${status.failedKeys?.length ? ` · Giải mã lỗi: ${status.failedKeys.join(', ')}` : ''}${status.remediation ? ` · ${status.remediation}` : ''}`; } catch (error) { toast(error.message, 'error'); } };
$('#resetSecretStore').onclick = async event => {
  if (!await confirmInApp({ title: 'Reset riêng kho dữ liệu bí mật?', message: 'Thao tác này chỉ xóa tệp secret đã mã hóa. Hồ sơ bot, cấu hình, log và dữ liệu runtime khác được giữ nguyên. Bạn phải nhập lại các secret cần dùng.', destructive: true })) return;
  runAction({ key: 'reset-secret-store', button: event.currentTarget, success: 'Đã reset riêng kho dữ liệu bí mật.', refresh: false, fn: () => api(window.mcbot.resetSecretStore()) }).catch(() => {});
};
$('#clearBotPassword').onclick = async event => {
  const selectedBot = $('#secretBotSelect').value.trim();
  if (!selectedBot) return toast('Chưa chọn bot.', 'warn');
  if (!await confirmInApp({ title:`Xóa mật khẩu ${selectedBot}?`, message:'Hồ sơ bot và dữ liệu khác được giữ nguyên.', destructive:true })) return;
  const key = `MCBOT_${selectedBot.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_PASSWORD`;
  runAction({ key: `clear-secret:${key}`, button: event.currentTarget, success: 'Đã xóa mật khẩu bot. Khởi động lại hệ thống nền để áp dụng.', refresh: false, fn: () => api(window.mcbot.clearSecret(key)) }).catch(() => {});
};
$('#clearDiscordSecrets').onclick = async event => {
  if (!await confirmInApp({ title:'Xóa toàn bộ secret Discord?', message:'Token, Application ID, Guild ID và allowlist đã lưu sẽ bị xóa.', destructive:true })) return;
  runAction({ key: 'clear-discord-secrets', button: event.currentTarget, success: 'Đã xóa dữ liệu bí mật Discord. Khởi động lại hệ thống nền để áp dụng.', refresh: false, fn: async () => {
    for (const key of ['DISCORD_TOKEN', 'DISCORD_APPLICATION_ID', 'DISCORD_GUILD_ID', 'DISCORD_ALLOWED_USER_IDS', 'DISCORD_CONTROL_CHANNEL_ID', 'DISCORD_CONFIG_CHANNEL_ID', 'DISCORD_ERRORS_CHANNEL_ID']) await api(window.mcbot.clearSecret(key));
    return { success: true };
  } }).catch(() => {});
};
$('#saveSecrets').onclick = event => runAction({ key: 'save-secrets', button: event.currentTarget, success: 'Đã lưu dữ liệu bí mật. Khởi động lại hệ thống nền để áp dụng.', refresh: false, fn: async () => {
  const entries = [['DISCORD_TOKEN', $('#secretDiscordToken').value.trim()], ['DISCORD_APPLICATION_ID', $('#secretDiscordAppId').value.trim()], ['DISCORD_GUILD_ID', $('#secretDiscordGuildId').value.trim()], ['DISCORD_ALLOWED_USER_IDS', $('#secretDiscordAllowed').value.trim()]];
  for (const [key, value] of entries) if (value) await api(window.mcbot.setSecret(key, value));
  const selectedBot = $('#secretBotSelect').value.trim(); const password = $('#secretBotPassword').value;
  const key = selectedBot ? `MCBOT_${selectedBot.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_PASSWORD` : '';
  if (key && password) await api(window.mcbot.setSecret(key, password));
  for (const id of ['secretDiscordToken', 'secretDiscordAppId', 'secretDiscordGuildId', 'secretDiscordAllowed', 'secretBotPassword']) $('#' + id).value = '';
  return { success: true };
}}).catch(() => {});

$('#selectLocalUpdate').onclick = event => runAction({ key: 'local-update-select', button: event.currentTarget, success: null, refresh: false, fn: async () => {
  state.localUpdate = await api(window.mcbot.selectLocalUpdateZip());
  renderUpdateStatus();
  if (state.localUpdate?.phase === 'READY') toast(`Đã kiểm tra gói MCbot ${state.localUpdate.selected?.version}.`);
  return state.localUpdate;
}}).catch(() => {});
$('#clearLocalUpdate').onclick = event => runAction({ key: 'local-update-clear', button: event.currentTarget, success: 'Đã bỏ gói ZIP.', refresh: false, fn: async () => {
  state.localUpdate = await api(window.mcbot.clearLocalUpdateZip());
  renderUpdateStatus();
  return state.localUpdate;
}}).catch(() => {});
$('#installLocalUpdate').onclick = async event => {
  const version = state.localUpdate?.selected?.version || 'mới';
  if (!await confirmInApp({ title:`Cập nhật lên ${version}?`, message:'MCbot sẽ sao lưu cấu hình, dừng bot/chế độ, thoát và áp dụng gói ZIP đã xác minh.', destructive:true })) return;
  runAction({ key: 'local-update-install', button: event.currentTarget, success: 'Đã giao gói cập nhật cho tiến trình updater.', refresh: false, fn: () => api(window.mcbot.installLocalUpdateZip()) }).catch(() => {});
};

$('#savePreferences').onclick = event => runAction({ key: 'save-preferences', button: event.currentTarget, success: 'Đã lưu tùy chọn phần mềm.', refresh: false, fn: async () => {
  state.preferences = await api(window.mcbot.setPreferences({ closeToTray: $('#prefCloseToTray').checked, notifyErrors: $('#prefNotifyErrors').checked, startBackendOnLaunch: $('#prefAutoStart').checked, preventSystemSleepWhileActive: $('#prefPreventSleep').checked, launchAtLogin: $('#prefLaunchAtLogin').checked, snapshotIntervalMs: Number($('#prefSnapshotInterval').value), experienceLevel:$('#prefExperienceLevel').value, colorTheme:$('#prefColorTheme').value }));
  applyPresentationPreferences();
  return { success: true };
}}).catch(() => {});

$('#loadCollectorConfig').onclick = loadCollectorConfig;
$('#collectorConfigBot').onchange = loadCollectorConfig;
$('#saveCollectorConfig').onclick = event => runAction({ key: 'collector-config', button: event.currentTarget, success: 'Đã lưu cấu hình Collector+B5.', refresh: false, fn: () => api(window.mcbot.updateCollectorConfig($('#collectorConfigBot').value, { pickupLocation: { x: Number($('#collectorX').value), y: Number($('#collectorY').value), z: Number($('#collectorZ').value) }, craftLoopDelayMs: Number($('#collectorDelay').value), pollSeconds: Number($('#collectorPoll').value), reanchorRadius: Number($('#collectorRadius').value) })) }).catch(() => {});
$('#loadFishingConfig').onclick = loadFishingConfig;
$('#fishingConfigBot').onchange = loadFishingConfig;
$('#fishingArea').onchange = fillFishingArea;
$('#saveFishingConfig').onclick = event => runAction({ key: 'fishing-config', button: event.currentTarget, success: 'Đã lưu cấu hình câu cá.', refresh: false, fn: () => api(window.mcbot.updateFishingArea($('#fishingConfigBot').value, { areaId: $('#fishingArea').value, x: Number($('#fishingX').value), y: Number($('#fishingY').value), z: Number($('#fishingZ').value), pitchDegrees: Number($('#fishingPitch').value) })) }).catch(() => {});

$('#botDetailSelect').onchange = renderBotDetail;
$('#inspectorBotSelect').onchange = () => renderInspector().catch(() => {});
$('#inspectorRefresh').onclick = () => renderInspector().catch(() => {});
for (const id of ['eventSubsystem', 'eventSeverity', 'eventBot']) $('#' + id).addEventListener('change', renderEventStream);
$('#eventSearch').addEventListener('input', () => requestAnimationFrame(renderEventStream));
for (const id of ['eventGeneration', 'eventAttempt', 'eventOperation']) $('#' + id)?.addEventListener('input', () => requestAnimationFrame(renderEventStream));
$('#eventPause').addEventListener('change', () => { if (!$('#eventPause').checked) renderEventStream(); });
$('#eventAutoScroll').addEventListener('change', renderEventStream);
$('#clearEventView').onclick = clearEventView;
$('#eventConsole').addEventListener('click', event => {
  const button = event.target.closest('[data-event-copy]');
  if (!button) return;
  copyEventRecord(button.dataset.eventCopy).catch(error => { reportRendererError(error, 'clipboard-event'); toast('Không sao chép được sự kiện.', 'error'); });
});
$('#incidentDebugList').addEventListener('click', event => {
  const item = event.target.closest('[data-incident-debug-id]');
  if (!item) return;
  window.MCbotRendererStore.selectIncidentDebug(state, item.dataset.incidentDebugId);
  renderIncidentDebug();
  renderIncidentDebugDetail().catch(() => {});
});
$('#refreshIncidentDebug').onclick = () => loadIncidents().then(() => { renderIncidentDebug(); return renderIncidentDebugDetail(); }).catch(error => toast(error.message, 'error'));
$('#runtimeStateRefresh').onclick = () => refreshSnapshot({ quiet: true }).then(renderRuntimeState);
$('#runtimeStateCopy').onclick = () => navigator.clipboard.writeText($('#runtimeStateOutput').textContent || '').then(() => toast('Đã sao chép snapshot JSON.')).catch(error => toast(error.message, 'error'));
$('#b5DebugBotSelect').onchange = () => renderB5Debug().catch(() => {});
$('#b5DebugRefresh').onclick = () => loadB5Journey().then(renderB5Debug).catch(error => toast(error.message, 'error'));
$('#configDebugLoad').onclick = () => loadConfigDebug().catch(error => toast(error.message, 'error'));

document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault(); openCommandPalette().catch(error => toast(error.message, 'error'));
  } else if ((event.ctrlKey || event.metaKey) && !event.shiftKey && /^[1-9]$/.test(event.key)) {
    event.preventDefault(); switchPage(Object.keys(pageTitles)[Number(event.key) - 1]);
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') {
    event.preventDefault(); refreshSnapshot();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
    event.preventDefault(); switchPage('logs');
  }
});
document.addEventListener('input', event => { const panel = event.target?.closest?.('[data-craft-request-bot]'); if (panel) captureCraftingDraft(panel); });
document.addEventListener('change', event => { const panel = event.target?.closest?.('[data-craft-request-bot]'); if (panel) captureCraftingDraft(panel); });
    function bindEvents() {
      bindClickDelegation();
      bindNavigation();
      bindCommandPalette();
      bindFirstRun();
      bindIncidents();
      bindB5Journey();
      bindSkyCommands();
      bindAdvancedConfig();
      bindBuilder();
      bindProfiles();
      bindCommands();
      bindPreferences();
      bindCollectorFishing();
      bindDevInspector();
      bindSecrets();
      bindUpdates();
      bindGlobalKeys();
    }

    return Object.freeze({ bindEvents });
  }

  return Object.freeze({ create });
}));
