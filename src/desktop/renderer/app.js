'use strict';

const state = window.MCbotRendererStore.initialState(localStorage.getItem('mcbot.page'), localStorage.getItem('mcbot.devPage'));
const configLabels = window.MCbotConfigGroupCatalog;

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const pageTitles = window.MCbotPageCatalog;

const { formatDuration, connClass, viConnection, viModeBadge, viPressure, viPhase, viWaitingReason, position, activeOperation } = window.MCbotOperatorPresenter;

// Composition root wiring: the snapshot loop owns the accept/paint cycle but gets
// the mutable store, the DOM helper and the page renderers from this file.
const snapshotLoop = window.MCbotRendererSnapshotLoop.create({
  state, $, api, toast, viPhase, formatDuration, syncSelectors, loadStaticData,
  renderDashboard, renderModes, renderDevOverview
});
const { scheduleDynamicRender, acceptSnapshot, refreshSnapshot } = snapshotLoop;
// The desktop e2e harness calls renderFreshness() by bare global name
// (tests/e2e/desktop/support/DesktopElectronHarness.js), so the declaration stays here.
function renderFreshness() { return snapshotLoop.renderFreshness(); }

// Bot-card presenter: owns the per-bot card markup. modeInfo/connectionControlState/
// buttonHtml stay here because the dev pages and the mode page also use them.
const { botCard } = window.MCbotBotCardPresenter.create({
  esc, document, connClass, viConnection, viModeBadge, viWaitingReason, position, activeOperation,
  connectionControlState, modeInfo, buttonHtml, craftingDraft,
  craftingItemsFor: botId => craftingItemsCache[botId] || [],
  CraftingRequestPanel: window.MCbotCraftingRequestPanel
});

function bridgeAvailable() {
  return typeof window !== 'undefined' && Boolean(window.mcbot);
}

function bridgeMissingError(action = 'Thao tác') {
  return new Error(`${action} không khả dụng: cầu kết nối phần mềm (window.mcbot) chưa sẵn sàng. Hãy mở bằng Electron.`);
}

function setBridgeDependentUiDisabled(disabled) {
  for (const id of ['loadB5PureConfig', 'saveB5PureConfig', 'loadB5Rules', 'saveB5Rules', 'loadStorageProtect', 'saveStorageProtect']) {
    const el = document.getElementById(id);
    if (el) {
      el.disabled = disabled;
      if (disabled) el.title = 'Không khả dụng: cầu kết nối phần mềm chưa sẵn sàng.';
      else el.removeAttribute('title');
    }
  }
}

async function api(promise) {
  return window.MCbotRendererApiClient.call(promise);
}

function esc(value) {
  return window.MCbotRendererHtml.escape(value);
}

function toast(message, type = 'ok') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast show${type === 'error' ? ' error' : type === 'warn' ? ' warn' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.className = 'toast'; }, 3200);
}

function confirmInApp({ title, message, destructive = false }) {
  const dialog = $('#confirmDialog');
  return window.MCbotAccessibleDialog.open(dialog, {
    beforeOpen: () => {
      $('#confirmDialogTitle').textContent = title;
      $('#confirmDialogMessage').textContent = message;
      $('#confirmDialogAccept').className = `button ${destructive ? 'danger strong' : 'primary'}`;
    },
    focus: () => $('#confirmDialogAccept').focus()
  }).then(value => value === 'confirm');
}

function promptInApp({ title, message, value = '' }) {
  const dialog = $('#promptDialog');
  const input = $('#promptDialogInput');
  return window.MCbotAccessibleDialog.open(dialog, {
    beforeOpen: () => {
      $('#promptDialogTitle').textContent = title;
      $('#promptDialogMessage').textContent = message;
      input.value = value;
    },
    focus: () => { input.focus(); input.select(); }
  }).then(result => result === 'confirm' ? input.value : null);
}

function reportRendererError(error, source = 'renderer') {
  const value = error instanceof Error ? error : new Error(String(error?.message || error || 'Lỗi giao diện không xác định'));
  const request = window.mcbot?.reportRendererError?.({ message: value.message, stack: value.stack || null, source });
  if (request?.catch) {
    request.catch(reportError => console.error(`[MCbot renderer:${source}:report-failed]`, reportError));
  } else {
    console.error(`[MCbot renderer:${source}]`, value);
  }
}

function connectionControlState(bot) {
  return window.MCbotConnectionViewModel.controlState(bot);
}

function modeInfo(bot) {
  const resolved = window.MCbotModeViewModel.resolve(bot);
  const owner = bot.modeOwner;
  if (!owner && resolved.id) {
    const definition = resolved.definition;
    const connection = window.MCbotConnectionViewModel.modeIntentState(bot);
    const phase = connection.status === 'READY_TO_ENABLE' ? 'Đang chuẩn bị bật chế độ' : 'Đang kết nối để bật chế độ';
    return { id: resolved.id, desiredOnly: true, name: definition?.label || resolved.id, phase, paused: bot.intent?.modeState === 'PAUSED', className: 'pending' };
  }
  if (!owner) return { id: null, name: 'Đang rảnh', phase: 'Không có chế độ chính', paused: false, className: '' };
  const id = resolved.id;
  const target = resolved.status;
  const paused = Boolean(target?.paused);
  const definition = resolved.definition;
  const manualResume = target?.details?.waitingReason === 'manual-resume-after-reconnect';
  return { id, name: definition?.label || id, phase: viPhase(target?.phase || (paused ? 'PAUSED' : 'RUNNING')), paused, manualResume, className: paused || manualResume ? 'paused' : 'running' };
}

function isPending(key) { return state.pending.has(key); }

function buttonHtml({ label, action, bot, mode = '', kind = 'ghost', disabled = false, key = '', title = '' }) {
  const pending = key && isPending(key);
  return `<button class="button ${kind}${pending ? ' pending' : ''}" data-action="${esc(action)}" data-bot="${esc(bot)}"${mode ? ` data-mode="${esc(mode)}"` : ''}${title ? ` title="${esc(title)}"` : ''}${disabled || pending ? ' disabled' : ''}>${esc(pending ? 'Đang xử lý…' : label)}</button>`;
}

function renderMetrics() {
  const bots = state.snapshot?.bots || [];
  const connected = bots.filter(bot => bot.connectionOnline === true).length;
  const runningModes = bots.filter(bot => bot.modeOwner).length;
  const activeOps = bots.reduce((sum, bot) => sum + Number(bot.operation?.active || 0), 0);
  const errors = bots.filter(bot => bot.state?.lastError).length;
  const uptime = state.snapshot?.system?.uptimeMs || 0;
  $('#metrics').innerHTML = [
    ['Bot', bots.length, 'tiến trình đã đăng ký'],
    ['Đã kết nối', connected, `${Math.max(0, bots.length - connected)} chưa kết nối`],
    ['Chế độ', runningModes, 'chế độ chính đang chạy'],
    ['Tác vụ', activeOps, 'tác vụ đang hoạt động'],
    ['Thời gian chạy', formatDuration(uptime), errors ? `${errors} bot có lỗi` : 'hệ thống nền ổn định']
  ].map(([label, value, sub]) => `<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></div>`).join('');
}

const craftingItemsCache = {};
const craftingDrafts = {};
function craftingDraft(botId) {
  return craftingDrafts[botId] || (craftingDrafts[botId] = { itemId: '', quantity: '', all: false });
}
function captureCraftingDraft(panel) {
  const botId = panel?.dataset?.craftRequestBot;
  if (!botId) return;
  craftingDrafts[botId] = {
    itemId: panel.querySelector('[data-craft-request-item]')?.value || '',
    quantity: panel.querySelector('[data-craft-request-quantity]')?.value ?? '',
    all: Boolean(panel.querySelector('[data-craft-request-all]')?.checked)
  };
}
async function hydrateCraftingItems() {
  const panels = [...document.querySelectorAll('[data-craft-request-bot]')];
  for (const panel of panels) {
    const botId = panel.dataset.craftRequestBot;
    if (!botId) continue;
    try {
      if (!craftingItemsCache[botId]) {
        const result = await api(window.mcbot.craftingItems(botId));
        craftingItemsCache[botId] = window.MCbotCraftingRequestPanel.craftables(result?.items || []);
      }
      const items = craftingItemsCache[botId];
      if (!items.length) continue;
      const draft = craftingDraft(botId);
      const select = panel.querySelector('select[data-craft-request-item]');
      if (select) {
        select.innerHTML = window.MCbotCraftingRequestPanel.optionsHtml(items, draft, esc);
        if (draft.itemId) select.value = draft.itemId;
      }
      const start = panel.querySelector('[data-action="craft-request-start"]');
      if (start) start.disabled = false;
    } catch (error) { reportRendererError(error, 'crafting-items'); }
  }
}

function renderDashboard() {
  renderMetrics();
  const bots = state.snapshot?.bots || [];
  $('#dashboardBots').innerHTML = bots.length ? bots.map(bot => botCard(bot)).join('') : '<div class="empty panel">Chưa có tiến trình bot.</div>';
  const banner = $('#setupBanner');
  const lifecycle = state.snapshot?.lifecycle || 'STOPPED';
  if (lifecycle === 'FAILED') {
    banner.classList.remove('hidden');
    const failure = state.snapshot?.bootFailure;
    banner.innerHTML = `<strong>Hệ thống nền khởi động thất bại${failure?.stage ? ` tại ${esc(failure.stage)}` : ''}.</strong><span>${esc(failure?.operatorSummary || 'Mở Nhật ký/Chẩn đoán để xem nguyên nhân.')}${failure?.configPath ? ` Tệp: ${esc(failure.configPath)}.` : ''} Mã: ${esc(failure?.code || 'UNKNOWN')}.</span>`;
  } else if (lifecycle !== 'RUNNING') {
    banner.classList.remove('hidden');
    banner.innerHTML = `<strong>Hệ thống nền đang ${esc(viPhase(lifecycle))}.</strong><span>Điều khiển bot chỉ hoạt động khi hệ thống nền đang chạy.</span>`;
  } else {
    banner.classList.add('hidden');
  }
  renderFirstRun();
  renderHealth();
  hydrateCraftingItems().catch(() => {});
}

function applyPresentationPreferences() {
  document.body.dataset.experience = state.preferences?.experienceLevel === 'advanced' ? 'advanced' : 'standard';
  document.body.dataset.theme = state.preferences?.colorTheme === 'high-contrast' ? 'high-contrast' : 'dark';
  const currentButton = $(`.nav-item[data-page="${state.page}"]`);
  if (currentButton?.dataset.experience === 'advanced' && document.body.dataset.experience !== 'advanced') switchPage('dashboard');
  // Dev shell visibility follows experience level.
  const devShell = $('.dev-shell');
  if (devShell) devShell.classList.toggle('hidden', document.body.dataset.experience !== 'advanced');
}

function renderFirstRun() {
  const panel = $('#firstRunPanel');
  if (!panel) return;
  const firstRun = state.preferences?.firstRun || { status: 'NOT_STARTED', step: 1 };
  if (firstRun.status === 'COMPLETED') { panel.classList.add('hidden'); return; }
  const readiness = state.readiness;
  panel.classList.remove('hidden');
  const stepRoutes = ['dashboard', 'bots', 'settings', 'dashboard', 'modes', 'modes'];
  const stepLabels = ['Chọn mục tiêu sử dụng', 'Tạo hoặc chọn hồ sơ bot', 'Lưu dữ liệu bí mật an toàn', 'Xác thực và xử lý checklist', 'Kết nối có xác nhận', 'Chọn chế độ và đọc policy'];
  const checks = readiness?.checks || [];
  panel.innerHTML = `<div class="first-run-head"><div><h2>Thiết lập lần đầu · bước ${esc(firstRun.step)}/6</h2><p>${esc(stepLabels[Math.max(0, Number(firstRun.step) - 1)])}</p></div><span class="badge ${readiness?.overall === 'READY' ? 'running' : readiness?.overall === 'BLOCKED' ? 'failed' : 'pending'}">${esc(readiness?.overall || 'ĐANG KIỂM TRA')}</span></div>
    <div class="readiness-list">${checks.map(entry => `<div class="readiness-item ${entry.status === 'READY' ? 'ready' : entry.status === 'BLOCKED' ? 'blocked' : ''}"><strong>${esc(entry.summary)}</strong><span>${esc(entry.remediation || entry.status)}</span></div>`).join('') || '<div class="readiness-item"><strong>Đang lấy checklist…</strong></div>'}</div>
    <div class="actions"><button class="button primary" data-first-run-action="continue" data-route="${esc(stepRoutes[Math.max(0, Number(firstRun.step) - 1)])}">Đi tới bước này</button><button class="button ghost" data-first-run-action="next">Đánh dấu xong và tiếp tục</button><button class="button ghost" data-first-run-action="skip">Bỏ qua hướng dẫn</button></div>`;
}

function renderHealth() {
  const root = $('#healthSummary');
  if (!root) return;
  const health = state.health;
  if (!health) { root.innerHTML = '<span>Đang lấy health…</span>'; return; }
  const actionable = (health.probes || []).filter(entry => ['UNHEALTHY', 'DEGRADED', 'UNKNOWN'].includes(entry.status)).slice(0, 8);
  root.innerHTML = `<div><strong>Health: ${esc(health.overall)}</strong><span class="helper">${health.cached ? `Bản cache · ${Math.round(Number(health.ageMs || 0))} ms` : `Lấy lúc ${new Date(health.sampledAt).toLocaleTimeString('vi-VN', { hour12: false })}`}${health.stale ? ' · ĐÃ CŨ' : ''}</span></div><div class="health-probes">${actionable.length ? actionable.map(entry => `<span class="health-probe ${String(entry.status).toLowerCase()}" title="${esc(entry.remediation || entry.summary)}">${esc(entry.botId ? `${entry.botId}: ` : '')}${esc(entry.summary)}</span>`).join('') : '<span class="health-probe healthy">Không có probe bất thường</span>'}</div>`;
}

async function loadReadinessAndHealth({ force = false } = {}) {
  const [readiness, health] = await Promise.all([api(window.mcbot.readiness()), api(window.mcbot.health({ force }))]);
  state.readiness = readiness;
  state.health = health;
  renderFirstRun();
  renderHealth();
}

function incidentStatesForFilter() {
  const selected = $('#incidentStateFilter')?.value || 'ACTIVE';
  if (selected === 'ALL') return null;
  if (selected === 'ACTIVE') return ['OPEN', 'RECOVERING', 'NEEDS_ACTION'];
  return [selected];
}

function renderIncidents() {
  const items = state.incidents || [];
  const badgeCount = items.filter(item => ['OPEN', 'RECOVERING', 'NEEDS_ACTION'].includes(item.state)).length;
  $('#incidentBadge').textContent = String(badgeCount);
  $('#incidentBadge').classList.toggle('hidden', badgeCount === 0);
  const list = $('#incidentList');
  if (!list) return;
  list.innerHTML = window.MCbotIncidentPresenter.list(items, state.selectedIncidentId, esc);
  const selected = items.find(item => item.id === state.selectedIncidentId);
  if (selected) renderIncidentDetail(selected);
  else $('#incidentDetail').innerHTML = '<div class="empty">Chọn một sự cố để xem chuyện gì đã xảy ra, mức an toàn và bước tiếp theo.</div>';
}

function renderIncidentDetail(incident) {
  $('#incidentDetail').innerHTML = window.MCbotIncidentPresenter.detail(incident, esc);
}

async function loadIncidents() {
  const botId = $('#incidentBotFilter')?.value || null;
  const result = await api(window.mcbot.incidents({ limit: 100, states: incidentStatesForFilter(), botId }));
  state.incidents = result.items || [];
  if (state.selectedIncidentId && !state.incidents.some(item => item.id === state.selectedIncidentId)) state.selectedIncidentId = null;
  renderIncidents();
}

function renderB5Journey() {
  const root = $('#b5Journey');
  if (!root) return;
  const items = state.b5Journey || [];
  root.innerHTML = window.MCbotB5JourneyPresenter.render(items, esc);
}

async function loadB5Journey() {
  const result = await api(window.mcbot.b5Journey());
  state.b5Journey = result.items || [];
  renderB5Journey();
}

function renderModes() {
  const bots = state.snapshot?.bots || [];
  $('#modeCards').innerHTML = bots.length ? bots.map(bot => botCard(bot, true)).join('') : '<div class="empty panel">Chưa có tiến trình bot.</div>';
  hydrateCraftingItems().catch(() => {});
}

// ---- Dev experience pages (render-only; data comes from the shared backend) ----

function renderBotDetail() {
  const root = $('#botDetailContent');
  if (!root) return;
  const bot = (state.snapshot?.bots || []).find(entry => entry.botId === $('#botDetailSelect')?.value);
  root.innerHTML = bot ? window.MCbotDevPages.botDetail(bot, { viConnection, viPhase, modeInfo, position, activeOperation }) : '<div class="empty panel">Chọn một bot để xem chi tiết.</div>';
}

function renderDevOverview() {
  const bots = state.snapshot?.bots || [];
  const metrics = $('#devFleetMetrics');
  if (metrics) {
    const connected = bots.filter(bot => bot.connectionOnline === true).length;
    const lifecycle = state.snapshot?.lifecycle || 'STOPPED';
    metrics.innerHTML = [
      ['Lifecycle', viPhase(lifecycle), `uptime ${formatDuration(state.snapshot?.system?.uptimeMs || 0)}`],
      ['Bots', `${connected}/${bots.length}`, 'online / tổng'],
      ['Memory', `${state.snapshot?.system?.memoryMb ?? '—'} MB`, 'RSS process'],
      ['Incidents', String((state.incidents || []).filter(item => ['OPEN','RECOVERING','NEEDS_ACTION'].includes(item.state)).length), 'đang mở']
    ].map(([label, value, sub]) => `<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></div>`).join('');
  }
  const table = $('#devFleetTable');
  if (table) table.innerHTML = window.MCbotDevPages.fleetRows(bots, viConnection, state.incidents || []);
}

async function renderInspector() {
  const output = $('#inspectorOutput');
  if (!output) return;
  const botId = $('#inspectorBotSelect')?.value;
  if (!botId) { output.textContent = 'Chọn một bot để inspect.'; return; }
  try { output.textContent = JSON.stringify(await api(window.mcbot.botDevDetail(botId)), null, 2); }
  catch (error) { output.textContent = `Inspector lỗi: ${error.message}`; }
}

function eventMatches(record) {
  const subsystem = $('#eventSubsystem')?.value || 'all';
  const severity = $('#eventSeverity')?.value || 'all';
  const bot = $('#eventBot')?.value || 'all';
  const generation = ($('#eventGeneration')?.value || '').trim();
  const attempt = ($('#eventAttempt')?.value || '').trim();
  const operation = ($('#eventOperation')?.value || '').trim().toLowerCase();
  const query = ($('#eventSearch')?.value || '').trim().toLowerCase();
  if (subsystem !== 'all' && String(record.subsystem || '') !== subsystem) return false;
  if (severity !== 'all' && String(record.severity || '') !== severity) return false;
  if (bot !== 'all' && String(record.botId || '') !== bot) return false;
  if (generation && String(record.generation ?? '') !== generation) return false;
  if (attempt && String(record.attemptEpoch ?? '') !== attempt) return false;
  if (operation && !`${record.operationId || ''} ${record.correlationId || ''}`.toLowerCase().includes(operation)) return false;
  const text = `${record.eventType || ''} ${record.eventId || ''} ${record.botId || ''} ${record.modeId || ''} ${record.operationId || ''} ${record.correlationId || ''} ${record.subsystem || ''} ${record.source || ''} ${record.severity || ''} ${JSON.stringify(record.payload || {})}`.toLowerCase();
  return !query || text.includes(query);
}

function renderEventStream() {
  if ($('#eventPause')?.checked) return;
  const consoleEl = $('#eventConsole');
  if (!consoleEl) return;
  const filtered = state.events.filter(eventMatches).slice(-800);
  consoleEl.innerHTML = filtered.map(record => window.MCbotDevPages.eventLine(record)).join('') || '<div class="empty">Chưa có sự kiện phù hợp.</div>';
  $('#eventCount').textContent = `${filtered.length} / ${state.events.length} sự kiện`;
  if ($('#eventAutoScroll')?.checked) consoleEl.scrollTop = consoleEl.scrollHeight;
}

function scheduleEventRender() {
  if (state.devPage !== 'events' || $('#eventPause')?.checked) return;
  requestAnimationFrame(renderEventStream);
}

async function loadEvents() {
  if (state.eventsLoaded) return;
  try { state.events = await api(window.mcbot.eventSnapshot(1200)); state.eventsLoaded = true; }
  catch (error) { reportRendererError(error, 'events-load'); }
}

function clearEventView() {
  state.events = [];
  state.eventsLoaded = false;
  loadEvents().then(renderEventStream).catch(() => {});
}

async function copyEventRecord(eventId) {
  const record = state.events.find(entry => entry.eventId === eventId);
  if (!record) return;
  await navigator.clipboard.writeText(JSON.stringify(record, null, 2));
  toast('Đã sao chép sự kiện JSON.');
}

function renderIncidentDebug() {
  const list = $('#incidentDebugList');
  if (!list) return;
  const items = state.incidents || [];
  list.innerHTML = items.length ? items.map(item => `<div class="incident-item ${item.id === state.incidentDebugId ? 'selected' : ''}" data-incident-debug-id="${esc(item.id)}"><strong>${esc(item.code || item.id)}</strong><span>${esc(item.botId || '')} · ${esc(item.state)} · ${esc(item.severity || '')}</span></div>`).join('') : '<div class="empty">Không có sự cố nào.</div>';
}

async function renderIncidentDebugDetail() {
  const detail = $('#incidentDebugDetail');
  if (!detail) return;
  const summary = (state.incidents || []).find(item => item.id === state.incidentDebugId);
  if (!summary) { detail.innerHTML = '<div class="empty">Chọn một sự cố để xem timeline đầy đủ.</div>'; return; }
  // incident(id) detail carries first/lastGeneration + operationIds for the
  // multi-evidence nav; fall back to the list summary when backend is offline.
  let incident = summary;
  try { incident = await api(window.mcbot.readIncident(summary.id)); }
  catch { incident = summary; }
  // Navigate every evidence artifact (one-way evidenceRefs → artifactId), then
  // render incident → evidence → operation → recovery → raw JSON.
  const evidence = incident.evidenceRefs || [];
  const diagnostics = [];
  for (const artifactId of evidence) {
    try { diagnostics.push(await api(window.mcbot.readDiagnostic(artifactId))); }
    catch { diagnostics.push(null); }
  }
  // P0-5: prev/next qua mọi evidenceRefs bằng readDiagnostic hiện có (không thêm IPC).
  const requested = Number(state.incidentEvidenceIndex || 0);
  const safeIndex = window.MCbotRendererStore.clampEvidenceIndex(state, evidence.length) ?? (evidence.length ? Math.max(0, Math.min(evidence.length - 1, requested)) : 0);
  state.incidentEvidenceIndex = safeIndex;
  const diagnostic = evidence.length ? (diagnostics[safeIndex] || null) : null;
  const evidenceNav = window.MCbotDevPages.incidentEvidenceNav(safeIndex, evidence.length);
  detail.innerHTML = evidenceNav + window.MCbotDevPages.incidentTimeline(incident, diagnostic, { evidenceIndex: safeIndex });
  const prev = detail.querySelector('[data-evidence-prev]');
  const next = detail.querySelector('[data-evidence-next]');
  if (prev) prev.onclick = () => { state.incidentEvidenceIndex = Math.max(0, safeIndex - 1); renderIncidentDebugDetail().catch(() => {}); };
  if (next) next.onclick = () => { state.incidentEvidenceIndex = Math.min(evidence.length - 1, safeIndex + 1); renderIncidentDebugDetail().catch(() => {}); };
}

function renderRuntimeState() {
  const output = $('#runtimeStateOutput');
  if (output && state.snapshot) output.textContent = JSON.stringify(state.snapshot, null, 2);
}

async function renderB5Debug() {
  const botId = $('#b5DebugBotSelect')?.value;
  const traceEl = $('#b5DebugTrace');
  if (!botId || !traceEl) return;
  const journey = state.b5Journey.find(item => item.botId === botId);
  const bot = (state.snapshot?.bots || []).find(entry => entry.botId === botId) || null;
  // Render modes.crafting.details (crafting status/blocker/verification) first,
  // then journey + trace replay fixture. Read-only, no runtime logic.
  const details = bot?.modes?.crafting?.details || bot?.modes?.b5Craft?.details || null;
  const detailsHtml = details ? `<div class="section-head"><div><h2>modes.crafting.details</h2><p>Raw crafting status của bot hiện tại</p></div></div><pre class="log-console panel">${esc(JSON.stringify(details, null, 2))}</pre>` : '';
  $('#b5DebugJourney').innerHTML = detailsHtml + window.MCbotB5JourneyPresenter.render(journey ? [journey] : [], esc);
  try { traceEl.textContent = JSON.stringify(await api(window.mcbot.b5Trace(botId)), null, 2); }
  catch (error) { traceEl.textContent = `Trace lỗi: ${error.message}`; }
}

async function loadConfigDebug() {
  const key = $('#configDebugGroup')?.value;
  if (!key) return;
  try {
    const group = await api(window.mcbot.configGroup(key));
    $('#configDebugOutput').textContent = JSON.stringify(group, null, 2);
    $('#configDebugHint').textContent = `effective value · schema ${group.schema} · file ${group.file}`;
  } catch (error) { $('#configDebugOutput').textContent = `Lỗi: ${error.message}`; $('#configDebugHint').textContent = ''; }
}

function renderProfiles() {
  const profiles = state.profiles || [];
  if (!profiles.length) {
    $('#profilesTable').innerHTML = `<div class="empty">${state.snapshot?.lifecycle === 'RUNNING' ? 'Không có hồ sơ bot.' : 'Khởi động hệ thống nền để tải hồ sơ.'}</div>`;
    return;
  }
  $('#profilesTable').innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Mã bot</th><th>Tên</th><th>Tài khoản</th><th>Xác thực</th><th>Phiên bản</th><th>Máy chủ</th><th>Sky</th><th>Đã bật</th><th></th></tr></thead><tbody>${profiles.map(profile => `<tr data-profile="${esc(profile.id)}">
    <td class="mono">${esc(profile.id)}</td>
    <td><input aria-label="Tên hiển thị ${esc(profile.id)}" data-field="displayName" value="${esc(profile.displayName || '')}"></td>
    <td><input aria-label="Tên tài khoản ${esc(profile.id)}" data-field="username" value="${esc(profile.username || '')}"></td>
    <td><select aria-label="Xác thực ${esc(profile.id)}" data-field="auth"><option value="offline" ${profile.auth === 'offline' ? 'selected' : ''}>offline</option><option value="microsoft" ${profile.auth === 'microsoft' ? 'selected' : ''}>microsoft</option></select></td>
    <td><input aria-label="Phiên bản ${esc(profile.id)}" data-field="version" value="${esc(profile.version || '')}"></td>
    <td><input aria-label="Hồ sơ máy chủ ${esc(profile.id)}" data-field="serverProfile" value="${esc(profile.serverProfile || 'default')}"></td>
    <td><select aria-label="Sky mặc định ${esc(profile.id)}" data-field="skyblockSelection"><option value="sky1" ${profile.skyblockSelection === 'sky1' || !profile.skyblockSelection ? 'selected' : ''}>Sky 1</option><option value="sky2" ${profile.skyblockSelection === 'sky2' ? 'selected' : ''}>Sky 2</option></select></td>
    <td><input aria-label="Bật hồ sơ ${esc(profile.id)}" type="checkbox" data-field="enabled" ${profile.enabled ? 'checked' : ''}></td>
    <td class="profile-actions"><button class="button primary small" data-action="save-profile" data-bot="${esc(profile.id)}">Lưu</button><button class="button ghost small" data-action="clone-profile" data-bot="${esc(profile.id)}">Nhân bản</button><button class="button danger small" data-action="delete-profile" data-bot="${esc(profile.id)}" ${profile.enabled ? 'disabled title="Tắt bot trước khi xóa"' : ''}>Xóa</button></td>
  </tr>`).join('')}</tbody></table></div>`;
}

function syncSelect(element, html, preferred = null) {
  if (!element) return;
  const current = preferred ?? element.value;
  if (element.innerHTML !== html) element.innerHTML = html;
  if ([...element.options].some(option => option.value === current)) element.value = current;
}

function syncSelectors() {
  const bots = state.snapshot?.bots || [];
  const botOptions = bots.map(bot => `<option value="${esc(bot.botId)}">${esc(bot.profile?.displayName || bot.botId)}</option>`).join('');
  const commandOptions = (state.commands || []).map(command => `<option value="${esc(command.key)}">${command.scope === 'sky' ? `[${esc(command.skyId)}] ` : ''}${esc(command.command)} · ${esc(command.label || command.key)}</option>`).join('');
  const guiCommandOptions = (state.commands || []).filter(command => command.scope !== 'sky').map(command => `<option value="${esc(command.key)}">${esc(command.command)} · ${esc(command.label || command.key)}</option>`).join('');
  const signature = `${bots.map(bot => `${bot.botId}:${bot.profile?.displayName || ''}`).join('|')}::${state.commands.map(command => `${command.key}:${command.command || ''}`).join('|')}`;
  if (signature === state.selectorSignature) return;
  state.selectorSignature = signature;
  for (const id of ['guiBot', 'commandBot', 'skyCommandBot', 'collectorConfigBot', 'fishingConfigBot', 'secretBotSelect', 'botDetailSelect', 'inspectorBotSelect', 'b5DebugBotSelect']) syncSelect($('#' + id), botOptions);
  syncSelect($('#eventBot'), '<option value="all">Mọi bot</option>' + botOptions, 'all');
  syncSelect($('#incidentBotFilter'), '<option value="">Tất cả bot</option>' + botOptions);
  syncSelect($('#logBot'), '<option value="all">Mọi bot</option>' + botOptions, localStorage.getItem('mcbot.logBot') || 'all');
  syncSelect($('#guiCommand'), guiCommandOptions);
  syncSelect($('#commandKey'), commandOptions);
}

async function loadProfiles() {
  if (state.snapshot?.lifecycle !== 'RUNNING') { state.profiles = []; state.profilesLoaded = false; renderProfiles(); return; }
  state.profiles = await api(window.mcbot.profiles());
  state.profilesLoaded = true;
  renderProfiles();
}

async function loadCommands() {
  if (state.snapshot?.lifecycle !== 'RUNNING') { state.commands = []; state.commandsLoaded = false; state.selectorSignature = ''; syncSelectors(); return; }
  state.commands = await api(window.mcbot.commands());
  state.commandsLoaded = true;
  state.selectorSignature = '';
  syncSelectors();
}

function renderSkyCommands() {
  const skySelect = $('#skyCommandSky');
  const list = $('#skyCommandList');
  if (!skySelect || !list) return;
  const selections = state.skyCommandSelections.length ? state.skyCommandSelections : Object.keys(state.skyCommands || {});
  const preferred = skySelect.value || selections[0] || '';
  syncSelect(skySelect, selections.map(id => `<option value="${esc(id)}">${esc(id)}</option>`).join(''), preferred);
  const skyId = skySelect.value || selections[0] || '';
  const entries = Object.entries(state.skyCommands?.[skyId] || {}).sort(([a],[b]) => a.localeCompare(b));
  list.innerHTML = entries.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>ID</th><th>Tên</th><th>Lệnh</th><th>Bật</th><th></th></tr></thead><tbody>${entries.map(([id, d]) => `<tr>
    <td class="mono">${esc(id)}</td><td>${esc(d.label || id)}</td><td class="mono">${esc(d.command)}</td><td>${d.enabled === false ? 'Tắt' : 'Bật'}</td>
    <td class="profile-actions"><button class="button ghost small" data-sky-command-action="edit" data-sky="${esc(skyId)}" data-command-id="${esc(id)}">Sửa</button><button class="button primary small" data-sky-command-action="send" data-sky="${esc(skyId)}" data-command-id="${esc(id)}" ${d.enabled === false ? 'disabled' : ''}>Gửi</button><button class="button danger small" data-sky-command-action="delete" data-sky="${esc(skyId)}" data-command-id="${esc(id)}">Xóa</button></td>
  </tr>`).join('')}</tbody></table></div>` : '<div class="empty">Sky này chưa có lệnh riêng.</div>';
}

async function loadSkyCommands() {
  if (state.snapshot?.lifecycle !== 'RUNNING') {
    state.skyCommands = {};
    state.skyCommandSelections = [];
    renderSkyCommands();
    return;
  }
  const group = await api(window.mcbot.skyCommands());
  state.skyCommands = group.value || {};
  state.skyCommandSelections = Array.isArray(group.selections) ? group.selections : [];
  renderSkyCommands();
}

function clearSkyCommandEditor() {
  state.skyCommandEditingId = null;
  $('#skyCommandId').value = '';
  $('#skyCommandLabel').value = '';
  $('#skyCommandValue').value = '';
  $('#skyCommandDescription').value = '';
  $('#skyCommandEnabled').checked = true;
}

async function saveSkyCommandFromEditor() {
  const result = await api(window.mcbot.saveSkyCommand({
    skyId: $('#skyCommandSky').value,
    commandId: $('#skyCommandId').value,
    previousCommandId: state.skyCommandEditingId,
    label: $('#skyCommandLabel').value,
    command: $('#skyCommandValue').value,
    description: $('#skyCommandDescription').value,
    enabled: $('#skyCommandEnabled').checked
  }));
  await Promise.all([loadSkyCommands(), loadCommands()]);
  clearSkyCommandEditor();
  return result;
}

async function loadStaticData() {
  const jobs = [loadCommands(), loadSkyCommands(), loadConfigurationCatalog(), loadCustomModeCatalog()];
  if (state.page === 'bots' || !state.profilesLoaded) jobs.push(loadProfiles());
  jobs.push(loadReadinessAndHealth());
  if (state.page === 'incidents') jobs.push(loadIncidents());
  if (state.page === 'modes') jobs.push(loadB5Journey());
  await Promise.all(jobs);
}

function logMatches(log) {
  const level = $('#logLevel').value;
  const bot = $('#logBot').value;
  const query = $('#logSearch').value.trim().toLowerCase();
  if (level !== 'all' && log.level !== level) return false;
  const text = `${log.scope || ''} ${log.message || ''} ${log.meta?.botId || ''} ${log.meta?.reason || ''} ${log.meta?.code || ''}`.toLowerCase();
  if (bot !== 'all' && String(log.meta?.botId || '') !== bot) return false;
  return !query || text.includes(query);
}

function renderLogs() {
  if ($('#logPause').checked) return;
  const filtered = state.logs.filter(logMatches).slice(-600);
  const consoleEl = $('#logConsole');
  const autoScroll = $('#logAutoScroll').checked;
  consoleEl.innerHTML = filtered.map(log => {
    const time = new Date(log.timestamp).toLocaleTimeString('vi-VN', { hour12: false });
    const repeat = Number(log.repeatCount || log.meta?.repeatCount || 0);
    const repeatText = repeat > 0 ? ` <span class="log-meta">· lặp ${esc(repeat)} lần</span>` : '';
    const reason = log.meta?.reason && log.level !== 'info' ? ` <span class="log-meta">· ${esc(String(log.meta.reason))}</span>` : '';
    return `<div class="log-line ${esc(log.level)}"><span class="log-time">${esc(time)}</span><span class="log-level ${esc(log.level)}">${esc(String(log.level || '').toUpperCase())}</span><span class="log-scope">${esc(log.scope)}</span><span class="log-message">${esc(log.message)}${reason}${repeatText}</span></div>`;
  }).join('') || '<div class="empty">Không có nhật ký phù hợp.</div>';
  $('#logCount').textContent = `${filtered.length} / ${state.logs.length} dòng`;
  if (autoScroll) consoleEl.scrollTop = consoleEl.scrollHeight;
  state.logUnread = 0;
  updateLogUnread();
}

function scheduleLogRender() {
  if (state.logRenderScheduled || state.devPage !== 'logs' || $('#logPause').checked) return;
  state.logRenderScheduled = true;
  requestAnimationFrame(() => { state.logRenderScheduled = false; renderLogs(); });
}

function updateLogUnread() {
  const badge = $('#logUnreadBadge');
  badge.textContent = String(Math.min(999, state.logUnread));
  badge.classList.toggle('hidden', state.logUnread <= 0);
  $('#logPausedHint').textContent = $('#logPause').checked && state.logUnread ? `${state.logUnread} dòng mới đang chờ` : '';
}

async function refreshDiagnostics() {
  try {
    const response = await api(window.mcbot.diagnostics(80));
    const list = Array.isArray(response) ? response : (response?.items || []);
    const warningCount = Array.isArray(response?.warnings) ? response.warnings.length : 0;
    $('#diagnosticList').innerHTML = list.length ? list.map(item => {
      const id = item.id || item.name;
      const title = [item.botId, item.code || (item.corrupt ? 'BẢN GHI HỎNG' : 'Lỗi runtime')].filter(Boolean).join(' · ');
      const meta = `${new Date(item.modifiedAt).toLocaleString('vi-VN')} · ${item.size} bytes${item.severity ? ` · ${item.severity}` : ''}`;
      return `<div class="diagnostic-item" data-diagnostic="${esc(id)}"><strong>${esc(title || id)}</strong><span>${esc(meta)}</span></div>`;
    }).join('') : '<div class="empty">Chưa có bản ghi lỗi runtime.</div>';
    if (warningCount > 0) toast(`Diagnostics bỏ qua/cảnh báo ${warningCount} artifact không an toàn hoặc bị hỏng.`, 'warn');
  } catch (error) { toast(error.message, 'error'); }
}

async function runAction({ key, button = null, success, fn, refresh = true }) {
  if (key && state.pending.has(key)) return;
  const originalText = button?.textContent;
  if (key) state.pending.add(key);
  if (button) { button.disabled = true; button.classList.add('pending'); button.textContent = 'Đang xử lý…'; }
  scheduleDynamicRender();
  try {
    const result = await fn();
    if (result?.success === false) throw new Error(result.message || result.error?.message || 'Thao tác thất bại');
    if (success) toast(success);
    if (refresh) await refreshSnapshot({ quiet: true });
    return result;
  } catch (error) {
    toast(error.message, 'error');
    reportRendererError(error, key ? `action:${key}` : 'action');
    throw error;
  } finally {
    if (key) state.pending.delete(key);
    if (button) { button.disabled = false; button.classList.remove('pending'); button.textContent = originalText; }
    scheduleDynamicRender();
  }
}

async function handleBotAction(button) {
  const action = button.dataset.action;
  const bot = button.dataset.bot;
  if (!action || !bot) return;
  if (action === 'connect') return runAction({ key: `connect:${bot}`, button, success: 'Đã gửi yêu cầu kết nối.', fn: () => api(window.mcbot.connect(bot)) });
  if (action === 'disconnect') { if (!await confirmInApp({ title:`Ngắt riêng ${bot}?`, message:'Bot khác vẫn giữ nguyên kết nối và chế độ.', destructive:true })) return; return runAction({ key: `disconnect:${bot}`, button, success: `Đã ngắt riêng ${bot}.`, fn: () => api(window.mcbot.disconnect(bot)) }); }
  if (action === 'home') return runAction({ key: `home:${bot}`, button, success: 'Đã gửi bot về đảo.', fn: () => api(window.mcbot.goHome(bot)) });
  if (action === 'mode-start') return runAction({ key: `mode:${bot}`, button, success: `Đã gửi yêu cầu bật chế độ ${button.dataset.mode}.`, fn: () => api(window.mcbot.startMode(bot, button.dataset.mode)) });
  if (action === 'mode-pause') return runAction({ key: `mode:${bot}`, button, success: 'Đã tạm dừng chế độ.', fn: () => api(window.mcbot.pauseMode(bot)) });
  if (action === 'mode-resume') return runAction({ key: `mode:${bot}`, button, success: 'Đã tiếp tục chế độ.', fn: () => api(window.mcbot.resumeMode(bot)) });
  if (action === 'mode-stop') return runAction({ key: `mode:${bot}`, button, success: 'Đã dừng chế độ.', fn: () => api(window.mcbot.stopMode(bot)) });
  if (action === 'mode-restart') return runAction({ key: `mode:${bot}`, button, success: 'Đã khởi động lại chế độ.', fn: () => api(window.mcbot.restartMode(bot)) });
  if (action === 'b5-retry-storage') {
    const current = (state.snapshot?.bots || []).find(entry => entry.botId === bot);
    const episode = current?.modes?.crafting?.details?.protectionEpisode;
    if (!episode) throw new Error('Episode bảo vệ kho không còn tồn tại; hãy tải lại trạng thái.');
    const idempotencyKey = `desktop-b5-retry:${bot}:${episode.episodeId}:${crypto.randomUUID()}`;
    return runAction({
      key: `b5-retry:${bot}`, button, success: 'Đã cấp một lần thử bảo vệ kho có kiểm soát.',
      fn: () => api(window.mcbot.retryB5StorageProtection(bot, {
        expectedGeneration: current.connectionGeneration,
        episodeId: episode.episodeId,
        incidentId: episode.correlationId,
        idempotencyKey
      }))
    });
  }
  if (action === 'craft-request-start') {
    const form = window.MCbotCraftingRequestPanel.readForm(button);
    captureCraftingDraft(button.closest('[data-craft-request-bot]'));
    return runAction({ key: `craft-request:${bot}`, button, success: `Đã gửi yêu cầu chế ${form.quantity === 'ALL' ? 'ALL' : form.quantity} × ${form.targetItemId}.`, fn: () => api(window.mcbot.setCraftingRequest(bot, form)) });
  }
  if (action === 'craft-request-clear') {
    craftingDrafts[bot] = { itemId: craftingDraft(bot).itemId, quantity: '', all: false };
    return runAction({ key: `craft-request:${bot}`, button, success: 'Đã xóa yêu cầu chế tạo.', fn: () => api(window.mcbot.clearCraftingRequest(bot)) });
  }
  if (action === 'save-profile') {
    const row = button.closest('tr');
    const fields = {};
    row.querySelectorAll('[data-field]').forEach(input => { fields[input.dataset.field] = input.type === 'checkbox' ? input.checked : input.value; });
    return runAction({ key: `profile:${bot}`, button, success: 'Đã lưu hồ sơ.', fn: () => api(window.mcbot.updateProfile(bot, fields)), refresh: false }).then(loadProfiles);
  }
  if (action === 'clone-profile') {
    const suggested = `${bot}-copy`;
    const newId = (await promptInApp({ title:`Nhân bản ${bot}`, message:'Nhập ID duy nhất cho hồ sơ mới.', value:suggested }))?.trim();
    if (!newId) return;
    return runAction({ key: `profile-clone:${bot}`, button, success: `Đã nhân bản ${bot} thành ${newId}.`, fn: () => api(window.mcbot.cloneProfile(bot, newId)), refresh: false }).then(async () => { await loadProfiles(); await refreshSnapshot({ quiet: true }); });
  }
  if (action === 'delete-profile') {
    if (!await confirmInApp({ title:`Xóa hồ sơ ${bot}?`, message:'Chỉ được xóa khi bot đã tắt và ngắt kết nối.', destructive:true })) return;
    return runAction({ key: `profile-delete:${bot}`, button, success: `Đã xóa hồ sơ ${bot}.`, fn: () => api(window.mcbot.deleteProfile(bot)), refresh: false }).then(async () => { await loadProfiles(); await refreshSnapshot({ quiet: true }); });
  }
}

async function handleFleetAction(button) {
  const action = button.dataset.fleetAction;
  if (!action) return;
  if (['disconnect-all', 'stop-modes-all'].includes(action) && !await confirmInApp({ title:'Xác nhận thao tác toàn fleet?', message:action, destructive:true })) return;
  await runAction({ key: `fleet:${action}`, button, success: `Đã thực hiện ${action}.`, fn: () => api(window.mcbot.fleetAction(action)) });
}

function switchDevPage(page) {
  const experienceLevel = state.preferences?.experienceLevel || 'standard';
  const next = window.MCbotDevRouter.apply(page, {
    document,
    catalog: pageTitles,
    experienceLevel
  });
  if (!next) {
    // Contract unchanged: DEV pages require experienceLevel='advanced'.
    // Never leave a visible nav item silently unresponsive.
    if (experienceLevel !== 'advanced') toast('Công cụ Dev chỉ khả dụng ở chế độ Nâng cao. Bật Mức trải nghiệm “Nâng cao” trong Cài đặt.', 'warn');
    return;
  }
  state.devPage = next;
  localStorage.setItem('mcbot.devPage', next);
  if (next === 'dev-overview') renderDevOverview();
  if (next === 'inspector') renderInspector().catch(error => toast(error.message, 'error'));
  if (next === 'events') { loadEvents().then(renderEventStream).catch(() => {}); }
  if (next === 'logs') { state.logUnread = 0; renderLogs(); }
  if (next === 'incident-debug') { loadIncidents().then(() => { renderIncidentDebug(); renderIncidentDebugDetail().catch(() => {}); }).catch(error => toast(error.message, 'error')); }
  if (next === 'runtime-state') renderRuntimeState();
  if (next === 'b5-debug') { loadB5Journey().then(renderB5Debug).catch(error => toast(error.message, 'error')); }
  if (next === 'diagnostics') refreshDiagnostics();
  if (next === 'config-debug') { if (state.configGroups.length) syncSelect($('#configDebugGroup'), state.configGroups.map(group => `<option value="${esc(group.key)}">${esc(configLabels[group.key] || group.key)}</option>`).join('')); }
}

function switchPage(page) {
  page = window.MCbotRendererRouter.apply(page, {
    document,
    catalog: pageTitles,
    experienceLevel: state.preferences?.experienceLevel || 'standard'
  });
  state.page = page;
  localStorage.setItem('mcbot.page', page);
  // If the target is a Dev nav page, also sync the Dev layout.
  if (window.MCbotDevRouter.isDevNavPage(page)) switchDevPage(page);
  if (page === 'dashboard') renderDashboard();
  if (page === 'modes') { renderModes(); Promise.all([loadB5PureConfig(), loadB5Rules(), loadStorageProtection(), loadB5Journey()]).catch(error => toast(error.message, 'error')); }
  if (page === 'incidents') loadIncidents().catch(error => toast(error.message, 'error'));
  if (page === 'bots' && !state.profilesLoaded) loadProfiles().catch(error => toast(error.message, 'error'));
  if (page === 'builder' && state.snapshot?.lifecycle === 'RUNNING') loadCustomModeCatalog().catch(error => toast(error.message, 'error'));
  if (page === 'settings') { loadBackupCatalog().catch(error => toast(error.message, 'error')); if (state.snapshot?.lifecycle === 'RUNNING' && state.configGroups.length) loadAdvancedConfig().catch(error => toast(error.message, 'error')); }
  if (page === 'logs') { state.logUnread = 0; renderLogs(); }
  if (page === 'diagnostics') refreshDiagnostics();
  if (page === 'bot-detail') renderBotDetail();
  if (page === 'dev-overview') { renderDevOverview(); loadIncidents().catch(() => {}); }
  if (page === 'inspector') renderInspector().catch(error => toast(error.message, 'error'));
  if (page === 'events') { loadEvents().then(renderEventStream).catch(() => {}); }
  if (page === 'incident-debug') { loadIncidents().then(() => { renderIncidentDebug(); renderIncidentDebugDetail().catch(() => {}); }).catch(error => toast(error.message, 'error')); }
  if (page === 'runtime-state') renderRuntimeState();
  if (page === 'b5-debug') { loadB5Journey().then(renderB5Debug).catch(error => toast(error.message, 'error')); }
  if (page === 'config-debug') { if (state.configGroups.length) syncSelect($('#configDebugGroup'), state.configGroups.map(group => `<option value="${esc(group.key)}">${esc(configLabels[group.key] || group.key)}</option>`).join('')); }
}

async function loadCollectorConfig() {
  try {
    const bot = $('#collectorConfigBot').value; if (!bot) return;
    const config = await api(window.mcbot.collectorConfig(bot));
    const pickup = config.pickupLocation || {};
    $('#collectorX').value = pickup.x ?? '';
    $('#collectorY').value = pickup.y ?? '';
    $('#collectorZ').value = pickup.z ?? '';
    $('#collectorDelay').value = config.craftLoopDelayMs ?? '';
    $('#collectorPoll').value = config.pollIntervalMs ? Number(config.pollIntervalMs) / 1000 : '';
    $('#collectorRadius').value = config.reanchorRadius ?? '';
  } catch (error) { toast(error.message, 'error'); }
}

async function loadFishingConfig() {
  try {
    const bot = $('#fishingConfigBot').value; if (!bot) return;
    const config = await api(window.mcbot.fishingConfig(bot));
    loadFishingConfig.cache = config;
    const areas = Array.isArray(config.resolved?.areas) ? config.resolved.areas : [];
    syncSelect($('#fishingArea'), areas.map(area => `<option value="${esc(area.id)}">${esc(area.id)}</option>`).join(''));
    fillFishingArea();
  } catch (error) { toast(error.message, 'error'); }
}

function fillFishingArea() {
  const config = loadFishingConfig.cache; if (!config) return;
  const areaId = $('#fishingArea').value;
  const shared = (config.resolved?.areas || []).find(area => area.id === areaId) || {};
  const override = config.overrides?.areas?.[areaId] || {};
  const positionValue = Object.keys(override).length ? override : (shared.destination || shared);
  $('#fishingX').value = positionValue.x ?? '';
  $('#fishingY').value = positionValue.y ?? '';
  $('#fishingZ').value = positionValue.z ?? '';
  $('#fishingPitch').value = config.overrides?.shoreFishingPitchDegrees ?? config.resolved?.movement?.shoreFishingPitchDegrees ?? '';
}

async function loadPreferences() {
  try {
    state.preferences = await api(window.mcbot.preferences());
    $('#prefCloseToTray').checked = state.preferences.closeToTray !== false;
    $('#prefNotifyErrors').checked = state.preferences.notifyErrors !== false;
    $('#prefAutoStart').checked = state.preferences.startBackendOnLaunch !== false;
    $('#prefPreventSleep').checked = state.preferences.preventSystemSleepWhileActive !== false;
    $('#prefLaunchAtLogin').checked = state.preferences.launchAtLogin === true;
    $('#prefLaunchAtLogin').disabled = state.preferences.loginItem?.supported === false;
    $('#prefExperienceLevel').value = state.preferences.experienceLevel || 'standard';
    $('#prefColorTheme').value = state.preferences.colorTheme || 'dark';
    const interval = String(state.preferences.snapshotIntervalMs || 900);
    if ([...$('#prefSnapshotInterval').options].some(option => option.value === interval)) $('#prefSnapshotInterval').value = interval;
    applyPresentationPreferences();
    renderFreshness();
  } catch (error) { toast(error.message, 'error'); }
}

function renderUpdateStatus() {
  const local = state.localUpdate || {};
  $('#updateCurrentVersion').textContent = local.currentVersion || state.appInfo?.version || '—';
  $('#localUpdateState').textContent = ({ IDLE:'Chưa chọn', INSPECTING:'Đang kiểm tra', READY:'Sẵn sàng', INSTALL_PENDING:'Đang chuẩn bị cài', ERROR:'Lỗi' })[String(local.phase || '').toUpperCase()] || String(local.phase || 'Chưa chọn');
  $('#localUpdateVersion').textContent = local.selected?.version || '—';
  $('#localUpdateFile').textContent = local.lastError?.message
    || (local.selected ? local.selected.fileName + ' · ' + (local.selected.type === 'patch' ? 'Patch' : 'Full') + ' · ' + local.selected.fileCount + ' file' : 'Chưa chọn gói cập nhật.');
  $('#localUpdateNotes').textContent = local.selected?.notes?.length ? local.selected.notes.map(note => '• ' + note).join('\n') : 'Chưa có ghi chú từ gói ZIP.';
  $('#installLocalUpdate').disabled = local.phase !== 'READY' || !local.selected;
  $('#clearLocalUpdate').disabled = !local.selected && local.phase !== 'ERROR';
  const migration = state.updateMigration;
  $('#updateMigrationText').textContent = migration?.lastBackup ? 'Backup migration gần nhất: ' + migration.lastBackup : (state.appInfo?.packaged ? 'Chưa có backup migration.' : 'Migration cấu hình chỉ chạy trên bản đã cài.');
  $('#rollbackConfigMigration').disabled = !migration?.lastBackup;
}

async function loadUpdateStatus() {
  try {
    [state.localUpdate, state.updateMigration] = await Promise.all([
      api(window.mcbot.localUpdateStatus()),
      api(window.mcbot.updateMigrationStatus())
    ]);
    renderUpdateStatus();
  } catch (error) { toast(error.message, 'error'); }
}


async function loadConfigurationCatalog() {
  if (state.snapshot?.lifecycle !== 'RUNNING') return;
  state.configGroups = await api(window.mcbot.configGroups());
  const options = state.configGroups.map(group => `<option value="${esc(group.key)}">${esc(configLabels[group.key] || group.key)} · ${esc(group.file)}</option>`).join('');
  syncSelect($('#advancedConfigGroup'), options);
}

async function loadAdvancedConfig() {
  const key = $('#advancedConfigGroup').value;
  if (!key) return;
  if (state.configWorkspace?.sessionId) await api(window.mcbot.closeConfigWorkspace(state.configWorkspace.sessionId)).catch(() => {});
  const workspace = await api(window.mcbot.openConfigWorkspace(key));
  state.configWorkspace = workspace;
  $('#advancedConfigJson').value = JSON.stringify(workspace.value, null, 2);
  $('#advancedConfigHint').textContent = `${workspace.file} · schema ${workspace.schema} · revision ${workspace.revision.slice(0, 12)}`;
  $('#advancedConfigDiff').innerHTML = '';
}

async function previewAdvancedConfig() {
  const workspace = state.configWorkspace;
  if (!workspace || workspace.key !== $('#advancedConfigGroup').value) throw new Error('Hãy tải workspace cấu hình trước.');
  let value;
  try { value = JSON.parse($('#advancedConfigJson').value); } catch (error) { throw new Error(`JSON không hợp lệ: ${error.message}`); }
  const preview = await api(window.mcbot.previewConfigWorkspace(workspace.sessionId, value));
  $('#advancedConfigHint').textContent = `${preview.valid ? 'Hợp lệ' : 'KHÔNG HỢP LỆ'} · ${preview.dirty ? `${preview.changes.length} thay đổi` : 'không thay đổi'} · hiệu lực: ${preview.impact}`;
  $('#advancedConfigDiff').innerHTML = preview.errors?.length ? `<div class="setup-banner"><strong>Không thể lưu</strong><span>${preview.errors.map(esc).join(' · ')}</span></div>` : preview.changes.length ? preview.changes.slice(0, 100).map(change => `<div class="config-change"><strong>${esc(change.path)}</strong><span title="${esc(JSON.stringify(change.before))}">${esc(JSON.stringify(change.before))}</span><span title="${esc(JSON.stringify(change.after))}">${esc(JSON.stringify(change.after))}</span></div>`).join('') : '<div class="empty">Không có thay đổi.</div>';
  return { preview, value };
}

async function saveAdvancedConfig() {
  const workspace = state.configWorkspace;
  if (!workspace) throw new Error('Hãy tải workspace cấu hình trước.');
  const { preview, value } = await previewAdvancedConfig();
  if (!preview.valid) throw new Error(preview.errors.join(' · ') || 'Cấu hình không hợp lệ.');
  if (!preview.dirty) return { saved: false };
  const accepted = await confirmInApp({ title: 'Lưu thay đổi cấu hình?', message: `${preview.changes.length} thay đổi · hiệu lực: ${preview.impact}. Backup atomic sẽ được tạo trước khi ghi.` });
  if (!accepted) return { saved: false, canceled: true };
  const result = await api(window.mcbot.saveConfigWorkspace(workspace.sessionId, value, { expectedRevision: workspace.revision }));
  state.configWorkspace = { ...workspace, revision: result.loadedRevision || result.draftDigest, value };
  $('#advancedConfigHint').textContent = `Đã lưu · hiệu lực: ${result.impact} · revision ${String(state.configWorkspace.revision).slice(0, 12)}`;
  await loadConfigurationCatalog();
  return result;
}

async function undoAdvancedConfig() {
  if (!state.configWorkspace) throw new Error('Không có workspace cấu hình đang mở.');
  const accepted = await confirmInApp({ title: 'Hoàn tác bản cấu hình vừa lưu?', message: 'Hệ thống sẽ tạo backup mới, xác thực lại và trả nhóm này về revision trước.' });
  if (!accepted) return { canceled: true };
  const result = await api(window.mcbot.undoConfigWorkspace(state.configWorkspace.sessionId));
  await loadAdvancedConfig();
  return result;
}

function renderBackupCatalog() {
  const root = $('#backupCatalog');
  if (!root) return;
  root.innerHTML = state.backupCatalog.length ? state.backupCatalog.map(entry => `<div class="backup-entry"><div><strong>${esc(entry.reason || entry.id)}</strong><span>${esc(entry.createdAt ? new Date(entry.createdAt).toLocaleString('vi-VN') : 'Không rõ thời gian')} · ${esc(entry.fileCount || 0)} file · ${esc(entry.integrity)} · ${entry.compatible ? 'tương thích' : 'không tương thích'}</span></div><button class="button ghost small" data-backup-preview="${esc(entry.id)}" ${entry.integrity !== 'VALID' || !entry.compatible ? 'disabled' : ''}>Xem diff / khôi phục</button></div>`).join('') : '<div class="empty">Chưa có backup trong catalog.</div>';
}

async function loadBackupCatalog() {
  state.backupCatalog = await api(window.mcbot.configBackups({ limit: 20 }));
  renderBackupCatalog();
}

async function renderCommandPalette(query = '') {
  const results = await api(window.mcbot.searchPresentation(query, { limit: 20 }));
  $('#commandPaletteResults').innerHTML = results.length ? results.map(entry => `<button type="button" class="palette-result" data-palette-route="${esc(entry.route)}" role="option"><strong>${esc(entry.label)}</strong><span>${esc(entry.group)} · yêu cầu ${esc(entry.requirement)}</span></button>`).join('') : '<div class="empty">Không tìm thấy chức năng được phép.</div>';
}

async function openCommandPalette() {
  const dialog = $('#commandPaletteDialog');
  const input = $('#commandPaletteInput');
  const restoreFocus = document.activeElement;
  const onClose = () => { dialog.removeEventListener('close', onClose); queueMicrotask(() => restoreFocus?.focus?.()); };
  dialog.addEventListener('close', onClose);
  input.value = '';
  await renderCommandPalette('');
  dialog.showModal();
  queueMicrotask(() => input.focus());
}

async function loadB5PureConfig() {
  if (!bridgeAvailable() || typeof window.mcbot.b5CraftConfig !== 'function') throw bridgeMissingError('Tải cấu hình chế tạo');
  const group = await api(window.mcbot.b5CraftConfig());
  const c = group.value || {};
  $('#b5PureEnabled').checked = c.enabled !== false;
  $('#b5PureHome').checked = c.teleportHomeOnEnable !== false;
  $('#b5PureResume').checked = c.autoResumeOnReconnect !== false;
  $('#b5PurePoll').value = c.pollIntervalMs ?? 10000;
  $('#b5PureCraftDelay').value = c.craftLoopDelayMs ?? 300;
  $('#b5PureCooldownMinutes').value = Math.round(Number(c.postCycleCooldownMs ?? c.postB5CooldownMs ?? 1800000) / 60000);
  $('#b5PureRetry').value = c.errorRetryMs ?? 5000;
  $('#b5PureDisconnectedPoll').value = c.disconnectedPollMs ?? 1500;
  $('#b5PureRetryMax').value = c.errorRetryMaxMs ?? 30000;
  $('#b5PureReconcileReads').value = c.reconciliation?.maxFreshReads ?? 3;
  $('#b5PureReconcileRetry').value = c.reconciliation?.retryMs ?? 1000;
  $('#b5PureReconcileUnresolved').value = c.reconciliation?.unresolvedPollMs ?? 15000;
  $('#b5PureRetryAfterNoEffect').checked = c.reconciliation?.allowRetryAfterVerifiedNoEffect !== false;
  $('#b5PureNoProgressBase').value = c.stability?.noProgressBaseDelayMs ?? 10000;
  $('#b5PureNoProgressMax').value = c.stability?.noProgressMaxDelayMs ?? 60000;
  $('#b5PureBlockerThreshold').value = c.stability?.sameBlockerThreshold ?? 2;
  $('#b5PureLogEvery').value = c.stability?.logEveryNthRepeat ?? 5;
}

async function saveB5PureConfig() {
  if (!bridgeAvailable() || typeof window.mcbot.updateB5CraftConfig !== 'function') throw bridgeMissingError('Lưu cấu hình chế tạo');
  return api(window.mcbot.updateB5CraftConfig({
    enabled: $('#b5PureEnabled').checked,
    teleportHomeOnEnable: $('#b5PureHome').checked,
    autoResumeOnReconnect: $('#b5PureResume').checked,
    pollIntervalMs: Number($('#b5PurePoll').value),
    craftLoopDelayMs: Number($('#b5PureCraftDelay').value),
    postCycleCooldownMs: Number($('#b5PureCooldownMinutes').value) * 60000,
    errorRetryMs: Number($('#b5PureRetry').value),
    disconnectedPollMs: Number($('#b5PureDisconnectedPoll').value),
    errorRetryMaxMs: Number($('#b5PureRetryMax').value),
    stability: {
      noProgressBackoffEnabled: true,
      noProgressBaseDelayMs: Number($('#b5PureNoProgressBase').value),
      noProgressMaxDelayMs: Number($('#b5PureNoProgressMax').value),
      sameBlockerThreshold: Number($('#b5PureBlockerThreshold').value),
      logEveryNthRepeat: Number($('#b5PureLogEvery').value)
    },
    reconciliation: {
      maxFreshReads: Number($('#b5PureReconcileReads').value),
      retryMs: Number($('#b5PureReconcileRetry').value),
      unresolvedPollMs: Number($('#b5PureReconcileUnresolved').value),
      allowRetryAfterVerifiedNoEffect: $('#b5PureRetryAfterNoEffect').checked
    }
  }));
}

async function loadB5Rules() {
  const group = await api(window.mcbot.b5RulesConfig());
  const c = group.value || {};
  const quantity = c.quantityOptimization || {};
  const pv = c.personalVaultBackpressure || {};
  $('#b5InventorySafety').value = c.inventorySafetyEmptySlots ?? 2;
  $('#b5B2InputSource').value = c.b2InputSource === 'inventory' ? 'inventory' : 'storage';
  $('#b5B3MinSlots').value = c.b3AllMinEmptySlots ?? 1;
  $('#b5PvMinEmpty').value = pv.minEmptySlots ?? 3;
  $('#b5PvHardMin').value = pv.hardMinEmptySlots ?? 1;
  $('#b5BatchSize').value = quantity.b2BatchSize ?? 64;
  $('#b5QuantityEnabled').checked = quantity.enabled !== false;
  $('#b5B2UseAll').checked = quantity.useAllForB2 === true;
  $('#b5B3UseAll').checked = quantity.useAllForB3 !== false;
  $('#b5B4UseAllExact').checked = quantity.useAllForB4WhenExact !== false;
  $('#b5B5UseAll').checked = quantity.useAllForB5 === true;
  $('#b5KeepSurplusPv2').checked = quantity.keepSurplusInPv2 !== false;
  syncB2InputSourceUi();
}

function syncB2InputSourceUi() {
  const inventorySource = $('#b5B2InputSource').value === 'inventory';
  $('#b5B2UseAll').disabled = inventorySource;
  $('#b5B2UseAll').title = inventorySource
    ? 'Nguồn inventory luôn dùng lượng B1 đã kiểm soát; B2 ALL sẽ không được dùng.'
    : '';
}

async function saveB5Rules() {
  if (!$('#b5KeepSurplusPv2').checked) throw new Error('Giữ phần dư ở PV2 là bắt buộc để bảo toàn luồng B5.');
  return api(window.mcbot.updateB5RulesConfig({
    inventorySafetyEmptySlots: Number($('#b5InventorySafety').value),
    b3AllMinEmptySlots: Number($('#b5B3MinSlots').value),
    b2InputSource: $('#b5B2InputSource').value === 'inventory' ? 'inventory' : 'storage',
    quantityOptimization: {
      enabled: $('#b5QuantityEnabled').checked,
      useAllForB2: $('#b5B2UseAll').checked,
      useAllForB3: $('#b5B3UseAll').checked,
      useAllForB4WhenExact: $('#b5B4UseAllExact').checked,
      useAllForB5: $('#b5B5UseAll').checked,
      keepSurplusInPv2: true,
      b2BatchSize: Number($('#b5BatchSize').value)
    },
    personalVaultBackpressure: {
      minEmptySlots: Number($('#b5PvMinEmpty').value),
      hardMinEmptySlots: Number($('#b5PvHardMin').value)
    }
  }));
}

async function loadStorageProtection() {
  const c = await api(window.mcbot.storageProtectionConfig());
  $('#storageBlockOnly').checked = c.sell?.blockOnly !== false;
  $('#collectorDecompressMax').value = Math.round(Number(c.collector?.b1Decompression?.maxUsageRatio ?? 0.8) * 100);
  $('#collectorRequireKnown').checked = c.collector?.b1Decompression?.requireKnownCapacity !== false;
}

async function saveStorageProtection() {
  const maxUsagePercent = Number($('#collectorDecompressMax').value);
  if (!Number.isFinite(maxUsagePercent) || maxUsagePercent <= 0 || maxUsagePercent > 100) throw new Error('Trần bung B1 của Nhặt+B5 phải nằm trong khoảng 1–100%.');
  return api(window.mcbot.updateStorageProtectionConfig({
    sell: {
      blockOnly: $('#storageBlockOnly').checked
    },
    collector: {
      b1Decompression: {
        maxUsageRatio: maxUsagePercent / 100,
        requireKnownCapacity: $('#collectorRequireKnown').checked
      }
    }
  }));
}

function defaultModuleStep(type) {
  const commandKey = state.commands?.find(command => command.key !== 'login')?.key || '';
  const defaults = {
    command: { type, commandKey, args: {}, confirm: false, timeoutMs: 5000 },
    'sky-command': { type, commandId: '', skyId: null, args: {} },
    'slash-command': { type, command: '/is' },
    'gui-click': { type, slot: 0, button: 0, mode: 0, verifyGui: false, timeoutMs: 3000 },
    wait: { type, ms: 1000 },
    move: { type, x: 0, y: 0, z: 0, radius: 1.2, timeoutMs: 30000 },
    home: { type },
    'sky-join': { type, selection: 'primary' },
    'close-gui': { type },
    'read-storage': { type },
    'storage-protect': { type },
    'b5-cycle': { type },
    'wait-gui': { type, guiId: null, timeoutMs: 5000 },
    look: { type, yaw: 0, pitch: 0, force: true },
    log: { type, level: 'info', message: 'Bước workflow' },
    if: { type, condition: { type: 'connected', guiId: null }, then: [], else: [] },
    repeat: { type, count: 2, steps: [] }
  };
  return JSON.parse(JSON.stringify(defaults[type] || { type }));
}

function newCustomDraft() {
  return { id: '', label: '', description: '', enabled: true, primary: true, durable: true, workflow: { start: [], loop: { enabled: true, intervalMs: 1000, continueOnError: false, steps: [] }, stop: [] } };
}

function modulePayload(step) {
  const copy = JSON.parse(JSON.stringify(step || {}));
  delete copy.type;
  return JSON.stringify(copy, null, 2);
}

function renderWorkflowList(targetId, steps, section) {
  const root = $('#' + targetId);
  root.innerHTML = steps.length ? steps.map((step, index) => {
    const descriptor = state.customModules.find(module => module.type === step.type);
    return `<div class="workflow-step" data-workflow-section="${esc(section)}" data-step-index="${index}"><span class="step-index">${index + 1}</span><select class="step-type">${state.customModules.map(module => `<option value="${esc(module.type)}" ${module.type === step.type ? 'selected' : ''}>${esc(module.label)}</option>`).join('')}</select><div class="step-editor">${window.MCbotTypedModuleEditor.render(step, descriptor, state.customModules, esc)}</div><div class="step-buttons"><button class="button ghost small" data-step-action="up">↑</button><button class="button ghost small" data-step-action="down">↓</button><button class="button danger small" data-step-action="remove">×</button></div></div>`;
  }).join('') : '<div class="empty">Chưa có bước.</div>';
}

function draftFromBuilder() {
  const readSteps = section => {
    const root = section === 'start' ? $('#customStartSteps') : section === 'stop' ? $('#customStopSteps') : $('#customLoopSteps');
    return [...root.querySelectorAll(':scope > .workflow-step')].map(row => {
      const type = row.querySelector('.step-type').value;
      return window.MCbotTypedModuleEditor.read(row, type);
    });
  };
  return {
    id: $('#customModeId').value.trim(),
    label: $('#customModeLabel').value.trim(),
    description: $('#customModeDescription').value.trim(),
    enabled: $('#customModeEnabled').checked,
    primary: true,
    durable: true,
    workflow: {
      start: readSteps('start'),
      loop: { enabled: true, intervalMs: Number($('#customModeLoopDelay').value || 1000), continueOnError: false, steps: readSteps('loop') },
      stop: readSteps('stop')
    }
  };
}

function fillCustomBuilder(definition = null) {
  const d = definition ? JSON.parse(JSON.stringify(definition)) : newCustomDraft();
  state.customDraft = d;
  $('#customModeId').value = d.id || '';
  $('#customModeLabel').value = d.label || '';
  $('#customModeDescription').value = d.description || '';
  $('#customModeEnabled').checked = d.enabled !== false;
  $('#customModeLoopDelay').value = d.workflow?.loop?.intervalMs ?? 1000;
  renderWorkflowList('customStartSteps', d.workflow?.start || [], 'start');
  renderWorkflowList('customLoopSteps', d.workflow?.loop?.steps || [], 'loop');
  renderWorkflowList('customStopSteps', d.workflow?.stop || [], 'stop');
  $('#customModeJson').value = JSON.stringify(d, null, 2);
}

function renderModulePalette(query = '') {
  $('#moduleCount').textContent = String(state.customModules.length);
  const needle = String(query).trim().toLowerCase();
  const modules = state.customModules.filter(module => !needle || `${module.type} ${module.label} ${module.description} ${module.presentation?.category}`.toLowerCase().includes(needle));
  $('#modulePalette').innerHTML = modules.map(module => `<div class="module-card"><strong>${esc(module.label)}</strong><span>${esc(module.description)}</span><small>${esc(module.presentation?.category || 'MODULE')} · rủi ro ${esc(module.presentation?.risk || 'UNKNOWN')}</small><div class="actions compact"><button class="button ghost small" data-module-add="start" data-module-type="${esc(module.type)}">+ Bắt đầu</button><button class="button primary small" data-module-add="loop" data-module-type="${esc(module.type)}">+ Vòng lặp</button><button class="button ghost small" data-module-add="stop" data-module-type="${esc(module.type)}">+ Khi dừng</button></div></div>`).join('');
}

function customModeEntryId(entry) {
  if (entry?.raw?.id) return entry.raw.id;
  const file = String(entry?.file || '').replace(/\\/g, '/').split('/').pop() || '';
  return file.replace(/\.json$/i, '');
}

async function loadCustomModeCatalog() {
  if (state.snapshot?.lifecycle !== 'RUNNING') return;
  [state.customModules, state.customModes, state.customTemplates] = await Promise.all([api(window.mcbot.customModeModules()), api(window.mcbot.customModes()), api(window.mcbot.customModeTemplates())]);
  renderModulePalette();
  const current = $('#customModeSelect')?.value || '';
  const options = '<option value="">— Tạo mới —</option>' + state.customModes.map(entry => { const id = customModeEntryId(entry); return `<option value="${esc(id)}">${esc(entry.raw?.label || id || entry.file)}${entry.valid ? '' : ' · LỖI'}</option>`; }).join('');
  syncSelect($('#customModeSelect'), options, current);
  syncSelect($('#customModeTemplate'), '<option value="">— Thư viện mẫu —</option>' + state.customTemplates.map(item => `<option value="${esc(item.id)}">${esc(item.label)} · ${esc(item.risk)}</option>`).join(''), $('#customModeTemplate').value);
  if (!state.customDraft) fillCustomBuilder();
}

function changeWorkflowStep(button) {
  const row = button.closest('.workflow-step');
  if (!row) return;
  const section = row.dataset.workflowSection;
  let draft;
  try { draft = draftFromBuilder(); } catch (error) { toast(`JSON bước không hợp lệ: ${error.message}`, 'error'); return; }
  const list = section === 'start' ? draft.workflow.start : section === 'stop' ? draft.workflow.stop : draft.workflow.loop.steps;
  const index = Number(row.dataset.stepIndex);
  const action = button.dataset.stepAction;
  if (action === 'remove') list.splice(index, 1);
  if (action === 'up' && index > 0) [list[index - 1], list[index]] = [list[index], list[index - 1]];
  if (action === 'down' && index < list.length - 1) [list[index + 1], list[index]] = [list[index], list[index + 1]];
  fillCustomBuilder(draft);
}

// Event bindings: the legacy bindEvents body lives in core/RendererEventBindings.js.
// The facade keeps this alias so initialize() behavior is unchanged.
const { bindEvents } = window.MCbotRendererEventBindings.create({
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
});

function restoreLocalPreferences() {
  $('#logLevel').value = localStorage.getItem('mcbot.logLevel') || 'all';
  $('#logSearch').value = localStorage.getItem('mcbot.logSearch') || '';
  $('#logAutoScroll').checked = localStorage.getItem('mcbot.logAutoScroll') !== '0';
  $('#logSearch').addEventListener('input', () => localStorage.setItem('mcbot.logSearch', $('#logSearch').value));
}

async function initialize() {
  bindEvents();
  restoreLocalPreferences();
  switchPage(state.page);
  switchDevPage(state.devPage);
  if (!bridgeAvailable()) {
    // BUG-1: Playwright/Chromium without Electron preload has no window.mcbot.
    // Fail closed with operator-safe banner + structured log, never raw TypeError.
    const banner = $('#setupBanner');
    if (banner) {
      banner.classList.remove('hidden');
      banner.innerHTML = '<strong>Chế độ xem ngoại tuyến: cầu kết nối phần mềm chưa sẵn sàng.</strong><span>Mở bằng Electron để điều khiển bot. Các nút tải/lưu cấu hình đã bị vô hiệu hoá.</span>';
    }
    setBridgeDependentUiDisabled(true);
    reportRendererError(new Error('window.mcbot bridge missing at initialize'), 'initialize:bridge-missing');
    toast('Cầu kết nối phần mềm chưa sẵn sàng. Hãy mở bằng Electron.', 'warn');
    return;
  }
  setBridgeDependentUiDisabled(false);
  window.mcbot.onSnapshot(acceptSnapshot);
  window.mcbot.onLog(log => {
    state.logs.push(log);
    if (state.logs.length > 2500) state.logs.splice(0, state.logs.length - 2500);
    if (state.devPage !== 'logs' || $('#logPause').checked) { state.logUnread += 1; updateLogUnread(); }
    else scheduleLogRender();
  });
  try { state.logs = await api(window.mcbot.logs(800)); } catch (error) { reportRendererError(error, 'initial-log-load'); }
  window.mcbot.onDevLog(record => {
    state.devLogs.push(record);
    if (state.devLogs.length > 4000) state.devLogs.splice(0, state.devLogs.length - 4000);
  });
  window.mcbot.onEvent(record => {
    state.events.push(record);
    if (state.events.length > 4000) state.events.splice(0, state.events.length - 4000);
    scheduleEventRender();
  });
  loadEvents().then(renderEventStream).catch(() => {});
  const appInfoPromise = api(window.mcbot.appInfo()).then(info => { state.appInfo = info; $('#appVersion').textContent = `MCbot Desktop · v${info.version}${info.packaged ? '' : ' · DEV'}`; }).catch(error => reportRendererError(error, 'app-info-load'));
  await Promise.all([refreshSnapshot({ quiet: true }), loadPreferences(), appInfoPromise]);
  await Promise.all([loadReadinessAndHealth(), loadIncidents()]).catch(error => toast(error.message, 'error'));
  await loadUpdateStatus();
  if (state.snapshot?.lifecycle === 'RUNNING') await loadStaticData().catch(error => toast(error.message, 'error'));
  renderLogs();
  setInterval(() => { renderFreshness(); if (Date.now() - state.lastSnapshotReceivedAt > 15000) refreshSnapshot({ quiet: true }); }, 1000);
}

window.addEventListener('error', event => reportRendererError(event.error || event.message, 'window-error'));
window.addEventListener('unhandledrejection', event => reportRendererError(event.reason, 'unhandled-rejection'));

initialize().catch(error => { reportRendererError(error, 'initialize'); toast(error.message, 'error'); });
