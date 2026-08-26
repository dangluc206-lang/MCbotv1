'use strict';

const state = {
  snapshot: null,
  profiles: [],
  commands: [],
  skyCommands: {},
  skyCommandSelections: [],
  skyCommandEditingId: null,
  logs: [],
  preferences: null,
  appInfo: null,
  guiOutput: null,
  page: localStorage.getItem('mcbot.page') || 'dashboard',
  profilesLoaded: false,
  commandsLoaded: false,
  lastSnapshotReceivedAt: 0,
  renderScheduled: false,
  logRenderScheduled: false,
  logUnread: 0,
  pending: new Set(),
  selectorSignature: '',
  configGroups: [],
  customModes: [],
  customModules: [],
  customTemplates: [],
  customDraft: null,
  localUpdate: null,
  updateMigration: null,
  readiness: null,
  health: null,
  incidents: [],
  selectedIncidentId: null,
  b5Journey: [],
  configWorkspace: null,
  backupCatalog: [],
  ai: { workspace: null, models: [], messages: [], trace: [], busy: false }
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const configLabels = Object.freeze({
  app:'Ứng dụng & vận hành', server:'Máy chủ Minecraft', commands:'Danh sách lệnh', skyCommands:'Lệnh riêng theo Sky', commandResponses:'Phản hồi lệnh', serverLogin:'Đăng nhập server', resourcePack:'Gói tài nguyên', discord:'Discord', guiWindows:'Nhận diện cửa sổ GUI', guiSlots:'Vai trò ô GUI', guiObservation:'Quan sát GUI', inventoryObservation:'Quan sát túi đồ', movement:'Di chuyển', locations:'Vị trí', routes:'Tuyến đường', items:'Nhận diện vật phẩm', storage:'Kho /kho', personalVault:'Kho cá nhân /pv 2', minerals:'Menu khoáng sản', mineralConversions:'Đổi phôi/khối & bảo vệ kho', smelting:'Nung', island:'Đảo /is', dungeon:'Hầm ngục', skyblock:'Vào Skyblock', recipes:'Công thức chế tạo', craftingTiers:'Tầng chế tạo', b5:'Quy tắc B5', collectorB5Mode:'Collector+B5 cũ', b5CraftMode:'Chế B5 thuần', fishingMode:'Câu cá', dailyRecovery:'Khung phục hồi theo giờ'
});

const pageTitles = window.MCbotPageCatalog;

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

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

function connClass(status) {
  const value = String(status || '').toLowerCase();
  return ['connected', 'reconnecting', 'disconnected', 'failed'].includes(value) ? value : '';
}

function viConnection(status) {
  return ({ CONNECTED: 'Đã kết nối', CONNECTING: 'Đang kết nối', RECONNECTING: 'Đang kết nối lại', DISCONNECTED: 'Đã ngắt', FAILED: 'Lỗi', IDLE: 'Đang rảnh' })[String(status || '').toUpperCase()] || String(status || 'Không rõ');
}

function viModeBadge(className) {
  return ({ running: 'ĐANG CHẠY', paused: 'TẠM DỪNG', pending: 'ĐANG CHUẨN BỊ' })[String(className || '').toLowerCase()] || 'ĐANG RẢNH';
}

function viPressure(level) {
  return ({ NORMAL: 'Bình thường', RISING: 'Đang tăng', HIGH: 'Cao', CRITICAL: 'Nguy cấp', UNKNOWN: 'Chưa rõ' })[String(level || '').toUpperCase()] || String(level || 'Chưa rõ');
}

function viPhase(phase) {
  const map = { OFF:'Tắt', STOPPED:'Tắt', STARTING:'Đang khởi động', RUNNING:'Đang chạy', PAUSED:'Tạm dừng', PAUSING:'Đang tạm dừng', RESUMING:'Đang tiếp tục', STOPPING:'Đang dừng', PREPARING:'Đang chuẩn bị', WAITING_CONNECTION:'Chờ kết nối', WAITING_SKYBLOCK:'Chờ Skyblock', B1_NORMALIZATION:'Đang nung / đổi khối B1', B5_COOLDOWN:'Đang nghỉ sau B5', GOING_HOME:'Đang /is', STORAGE_CHECK:'Đang kiểm tra kho', STORAGE_PROTECTION:'Đang bảo vệ kho', READING_B5:'Đang đọc vật liệu B5', CRAFTING:'Đang chế tạo', WAITING_STORAGE:'Chờ giảm áp lực kho', WAITING_HEADROOM:'Chờ chỗ trống để bung khối', WAITING_MATERIALS:'Chờ vật liệu', WAITING_PV2:'Chờ PV2', B5_COMPLETED:'Đã chế xong B5', WAITING_RETRY:'Chờ thử lại', WAITING_MANUAL_RESUME:'Chờ bấm Tiếp tục sau reconnect', ERROR:'Lỗi' };
  return map[String(phase || '').toUpperCase()] || String(phase || '—').replaceAll('_',' ');
}

function viWaitingReason(reason) {
  return ({ connection:'kết nối', skyblock:'Skyblock', 'storage-pressure':'giảm áp lực kho', materials:'vật liệu', 'pv2-backpressure':'chỗ trống PV2', 'decompression-headroom':'chỗ trống để bung khối', paused:'tiếp tục thủ công', timeout:'thử lại sau timeout', 'not_ready':'hệ thống sẵn sàng', 'manual-resume-after-reconnect':'bấm Tiếp tục sau reconnect', 'b5-cooldown':'hết thời gian nghỉ sau B5' })[String(reason || '').toLowerCase()] || String(reason || '');
}

function modeInfo(bot) {
  const resolved = window.MCbotModeViewModel.resolve(bot);
  const owner = bot.modeOwner;
  if (!owner && resolved.id) {
    const definition = resolved.definition;
    const connection = String(bot.state?.connectionState || '').toUpperCase();
    const phase = ['CONNECTED'].includes(connection) ? 'Đang chuẩn bị bật chế độ' : 'Đang kết nối để bật chế độ';
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

function position(player) {
  const p = player?.position;
  return p ? `${Number(p.x).toFixed(1)}, ${Number(p.y).toFixed(1)}, ${Number(p.z).toFixed(1)}` : '—';
}

function activeOperation(bot) {
  const operations = bot.operation?.operations || [];
  const op = operations[0];
  if (!op) return null;
  const meta = op.metadata || {};
  const detail = meta.step || meta.action || meta.operation || op.status || '';
  return { name: op.operationName || op.operationId || 'Tác vụ', detail, active: Number(bot.operation?.active || operations.length) };
}

function isPending(key) { return state.pending.has(key); }

function buttonHtml({ label, action, bot, mode = '', kind = 'ghost', disabled = false, key = '', title = '' }) {
  const pending = key && isPending(key);
  return `<button class="button ${kind}${pending ? ' pending' : ''}" data-action="${esc(action)}" data-bot="${esc(bot)}"${mode ? ` data-mode="${esc(mode)}"` : ''}${title ? ` title="${esc(title)}"` : ''}${disabled || pending ? ' disabled' : ''}>${esc(pending ? 'Đang xử lý…' : label)}</button>`;
}

function renderMetrics() {
  const bots = state.snapshot?.bots || [];
  const connected = bots.filter(bot => bot.state?.connectionState === 'CONNECTED').length;
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

function botCard(bot, fullActions = false) {
  const profile = bot.profile || {};
  const connection = bot.state?.connectionState || 'DISCONNECTED';
  const connected = connection === 'CONNECTED';
  const connecting = connection === 'RECONNECTING' || connection === 'CONNECTING';
  const mode = modeInfo(bot);
  const player = bot.player;
  const operation = activeOperation(bot);
  const id = bot.botId;
  const b5Details = bot.modes?.b5Craft?.details || {};
  const b5Episode = b5Details.protectionEpisode || null;
  const b5CanRetry = mode.id === 'b5-craft' && b5Details.recovery?.allowedActions?.includes('retry-storage-protection') && b5Episode;
  const b5RecoveryButton = b5CanRetry ? `<div class="actions"><button class="button warn" data-action="b5-retry-storage" data-bot="${esc(id)}">Thử lại bảo vệ kho</button></div>` : '';
  const held = player?.heldItem?.displayName || player?.heldItem?.name || '—';
  const mainActions = `<div class="actions">
    ${buttonHtml({ label: 'Kết nối', action: 'connect', bot: id, kind: 'primary', disabled: connected || connecting, key: `connect:${id}` })}
    ${buttonHtml({ label: 'Về đảo', action: 'home', bot: id, disabled: !connected, key: `home:${id}` })}
    ${buttonHtml({ label: 'Ngắt riêng bot này', action: 'disconnect', bot: id, kind: 'danger', disabled: !connected && !connecting, key: `disconnect:${id}` })}
  </div>`;
  const availableModes = bot.modes?.available || [
    { definition: { id: 'b5-craft', label: 'Chế B5 thuần' }, readiness: { ready: true } },
    { definition: { id: 'collector-b5', label: 'Collector+B5 (cũ)' }, readiness: { ready: true } },
    { definition: { id: 'fishing', label: 'Câu cá' }, readiness: { ready: true } }
  ];
  const startModeButtons = availableModes.map(entry => {
    const modeId = entry.definition?.id || '';
    const readiness = entry.readiness || { ready: true, missingCapabilities: [] };
    const profileDisabled = profile.enabled === false;
    const sameMode = mode.id === modeId;
    const blocked = !readiness.ready;
    const missing = (readiness.missingCapabilities || []).join(', ');
    return buttonHtml({
      label: `${entry.definition?.label || modeId || 'Chế độ'}${!connected && !connecting ? ' · tự kết nối' : ''}`,
      action: 'mode-start', bot: id, mode: modeId, kind: 'primary',
      disabled: profileDisabled || blocked || sameMode,
      title: profileDisabled ? 'Hồ sơ bot đang tắt.' : blocked ? `Chưa sẵn sàng: ${missing || 'service mode chưa được bind'}` : !connected ? 'Bật mode và tự kết nối bot.' : '',
      key: `mode:${id}`
    });
  }).join('');
  const modeActions = fullActions ? `<div class="actions">
    ${startModeButtons}
    ${buttonHtml({ label: 'Tạm dừng', action: 'mode-pause', bot: id, disabled: !mode.id || mode.paused, key: `mode:${id}` })}
    ${buttonHtml({ label: 'Tiếp tục', action: 'mode-resume', bot: id, disabled: !mode.id || (!mode.paused && !mode.manualResume), key: `mode:${id}` })}
    ${buttonHtml({ label: 'Khởi động lại chế độ', action: 'mode-restart', bot: id, kind: 'warn', disabled: !mode.id, key: `mode:${id}` })}
    ${buttonHtml({ label: 'Dừng chế độ', action: 'mode-stop', bot: id, kind: 'danger', disabled: !mode.id, key: `mode:${id}` })}
  </div>` : '';
  return `<article class="bot-card">
    <div class="bot-head"><div class="bot-name"><strong>${esc(profile.displayName || id)}</strong><span>${esc(profile.username || id)} · phiên kết nối ${esc(bot.connectionGeneration)} · ${esc(player?.ping ?? '—')} ms</span></div><span class="badge ${connClass(connection)}">${esc(viConnection(connection))}</span></div>
    <div class="bot-stats">
      <div class="stat"><span>Máu / thức ăn</span><strong>${esc(player?.health ?? '—')} / ${esc(player?.food ?? '—')}</strong></div>
      <div class="stat"><span>Túi đồ</span><strong>${esc(player?.inventory?.slotsUsed ?? '—')} ô · ${esc(player?.inventory?.itemCount ?? '—')} vật phẩm</strong></div>
      <div class="stat"><span>Vật phẩm tay chính</span><strong title="${esc(held)}">${esc(held)}</strong></div>
      <div class="stat"><span>Vị trí</span><strong title="${esc(position(player))}">${esc(position(player))}</strong></div>
    </div>
    <div class="mode-box">
      <div class="mode-row"><div><div class="mode-title">${esc(mode.name)}</div><div class="mode-phase">${esc(mode.phase)}</div></div><span class="badge ${mode.className}">${esc(viModeBadge(mode.className))}</span></div>
      ${operation ? `<div class="operation-line"><span>${esc(operation.active)} tác vụ</span><strong title="${esc(operation.detail)}">${esc(operation.name)}${operation.detail ? ` · ${esc(operation.detail)}` : ''}</strong></div>` : '<div class="operation-line"><span>0 tác vụ</span><strong>Không có tác vụ đang chạy</strong></div>'}
      <div class="status-detail-grid">
        <div class="status-detail"><span>Sky gateway</span><strong>${bot.skyAutoJoin ? `${esc(bot.skyAutoJoin?.location || 'UNKNOWN')} · ${esc(bot.skyAutoJoin?.activeTarget || bot.skyAutoJoin?.readyTarget || profile.skyblockSelection || '—')} · ${bot.skyAutoJoin?.ready ? 'Sẵn sàng' : bot.skyAutoJoin?.pending ? 'Đang xử lý' : bot.skyAutoJoin?.target ? 'Đang chờ mode gateway' : 'Không có mode yêu cầu'}` : '—'}</strong></div>
        <div class="status-detail"><span>Bảo vệ kho B5</span><strong>${bot.storageProtection?.storageProtection ? `Reserve ${esc(bot.storageProtection.storageProtection.reserveCoverage ?? 1.5)} B5 · bán 64-only ${bot.storageProtection.storageProtection.sellingCapabilityEnabled === false ? 'không khả dụng' : 'khả dụng'} · chỉ nung raw iron/raw gold` : '—'}</strong></div>
        <div class="status-detail"><span>GUI hiện tại</span><strong>${esc(bot.gui?.definitionId || bot.gui?.identity?.candidateId || bot.gui?.title || 'Không mở')}${Number.isFinite(bot.gui?.identity?.confidence) ? ` · ${(Number(bot.gui.identity.confidence) * 100).toFixed(0)}%` : ''}</strong></div>
        <div class="status-detail"><span>Tay phụ</span><strong>${esc(player?.offhandItem?.displayName || player?.offhandItem?.name || '—')}</strong></div>
        <div class="status-detail"><span>Ô trống ước tính</span><strong>${esc(player?.inventory?.slotsFreeApprox ?? '—')}</strong></div>
        <div class="status-detail"><span>Hướng nhìn</span><strong>${Number.isFinite(player?.yaw) ? `${Number(player.yaw).toFixed(2)} / ${Number(player.pitch || 0).toFixed(2)}` : '—'}</strong></div>
        <div class="status-detail"><span>Lần thử vào Sky</span><strong>${esc(bot.skyAutoJoin?.pending?.attempt ?? (bot.skyAutoJoin?.ready ? 'Hoàn tất' : '—'))}</strong></div>
        <div class="status-detail"><span>Lỗi gần nhất</span><strong title="${esc(bot.state?.lastError?.message || bot.state?.lastError || '')}">${esc(bot.state?.lastError?.message || bot.state?.lastError || 'Không có')}</strong></div>
      </div>
      ${mode.id === 'b5-craft' ? (() => { const d = bot.modes?.b5Craft?.details || {}; const blocker = d.lastAutomationBlockers?.[0] || null; const blockerText = blocker ? `${blocker.baseId ? `${blocker.baseId}: ` : ''}${blocker.reason || blocker.status || 'đang chờ'}` : ''; const protection = d.protectionEpisode || null; const protectionBlocker = protection?.blocker || null; const protectionText = protection ? `${protection.state || 'PENDING'} · attempt ${protection.totalAttempts ?? 0}${protectionBlocker ? ` · ${protectionBlocker.resource ? `${protectionBlocker.resource}: ` : ''}${protectionBlocker.reason || protectionBlocker.code || 'blocked'} · backoff ${protectionBlocker.backoffMs ?? 0}ms${Number.isFinite(protection.nextEligibleAt) ? ` · retry ${Math.max(0, protection.nextEligibleAt - Date.now())}ms` : ''}` : ''}` : ''; const trace = d.b5Automation?.trace || null; const decision = trace?.plan?.decision; const traceText = trace ? `${trace.traceId || ''}${decision?.kind ? ` · ${decision.kind}${decision.resource ? ` ${decision.resource}` : ''}` : ''}` : ''; const batchText = d.batchId ? `${d.batchId}${d.batchProtectionRequired ? ' · chờ bảo vệ kho' : ' · đã bảo vệ kho'}` : 'chưa có batch'; return `<div class="operation-line"><span>B5 thuần</span><strong>Đã hoàn tất: ${esc(d.completedB5 ?? 0)} · Engine: ${esc(d.automationRuns ?? 0)} lượt / ${esc(d.productiveCycles ?? 0)} có tiến triển · ${esc(batchText)} · ${esc(d.waitingReason ? `Đang chờ: ${viWaitingReason(d.waitingReason)}` : 'Đang xử lý')}</strong></div>${protectionText ? `<div class="operation-line"><span>Gate bảo vệ kho</span><strong title="${esc(protectionText)}">${esc(protectionText)}</strong></div>` : ''}${traceText ? `<div class="operation-line"><span>Trace B5 gần nhất</span><strong title="${esc(traceText)}">${esc(traceText)}</strong></div>` : ''}${blockerText ? `<div class="operation-line"><span>Điểm chặn B5</span><strong title="${esc(blockerText)}">${esc(blockerText)}</strong></div>` : ''}`; })() : ''}
    </div>
    ${mainActions}${b5RecoveryButton}${modeActions}
  </article>`;
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
}

function applyPresentationPreferences() {
  document.body.dataset.experience = state.preferences?.experienceLevel === 'advanced' ? 'advanced' : 'standard';
  document.body.dataset.theme = state.preferences?.colorTheme === 'high-contrast' ? 'high-contrast' : 'dark';
  const currentButton = $(`.nav-item[data-page="${state.page}"]`);
  if (currentButton?.dataset.experience === 'advanced' && document.body.dataset.experience !== 'advanced') switchPage('dashboard');
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
  for (const id of ['guiBot', 'commandBot', 'skyCommandBot', 'collectorConfigBot', 'fishingConfigBot', 'secretBotSelect']) syncSelect($('#' + id), botOptions);
  syncSelect($('#incidentBotFilter'), '<option value="">Tất cả bot</option>' + botOptions);
  syncSelect($('#logBot'), '<option value="all">Mọi bot</option>' + botOptions, localStorage.getItem('mcbot.logBot') || 'all');
  syncSelect($('#guiCommand'), guiCommandOptions);
  syncSelect($('#commandKey'), commandOptions);
}

function renderBackend() {
  const lifecycle = state.snapshot?.lifecycle || 'STOPPED';
  $('#backendState').textContent = viPhase(lifecycle);
  $('#backendDot').className = `dot ${String(lifecycle).toLowerCase()}`;
  $('#sidebarFleet').textContent = `${state.snapshot?.bots?.length || 0} bot`;
  $('#sidebarMemory').textContent = `${state.snapshot?.system?.memoryMb ?? '—'} MB`;
  $('#settingsBackendState').textContent = viPhase(lifecycle);
  $('#settingsUptime').textContent = formatDuration(state.snapshot?.system?.uptimeMs || 0);
  $('#settingsMemory').textContent = `${state.snapshot?.system?.memoryMb ?? '—'} MB`;
  $('#startBackend').disabled = lifecycle === 'RUNNING' || lifecycle === 'STARTING';
  $('#stopBackend').disabled = lifecycle !== 'RUNNING';
  $('#restartBackend').disabled = lifecycle === 'STARTING' || lifecycle === 'STOPPING';
}

function renderFreshness() {
  const age = state.lastSnapshotReceivedAt ? Date.now() - state.lastSnapshotReceivedAt : Infinity;
  const threshold = Math.max(5000, Number(state.preferences?.snapshotIntervalMs || 900) * 4);
  const stale = age > threshold;
  const el = $('#liveState');
  el.classList.toggle('stale', stale);
  el.querySelector('strong').textContent = stale ? 'Mất cập nhật trực tiếp' : 'Trực tiếp';
  $('#updatedAt').textContent = state.snapshot?.updatedAt ? `${stale ? 'Lần cuối' : 'Cập nhật'} ${new Date(state.snapshot.updatedAt).toLocaleTimeString('vi-VN', { hour12: false })}` : 'Chưa có bản chụp trạng thái';
}

function scheduleDynamicRender() {
  if (state.renderScheduled) return;
  state.renderScheduled = true;
  requestAnimationFrame(() => {
    state.renderScheduled = false;
    renderBackend();
    syncSelectors();
    if (state.page === 'dashboard') renderDashboard();
    if (state.page === 'modes') renderModes();
    renderFreshness();
  });
}

function acceptSnapshot(snapshot) {
  if (!snapshot) return;
  const previousLifecycle = state.snapshot?.lifecycle;
  state.snapshot = snapshot;
  state.lastSnapshotReceivedAt = Date.now();
  if (previousLifecycle !== 'RUNNING' && snapshot.lifecycle === 'RUNNING') loadStaticData().catch(error => toast(error.message, 'error'));
  scheduleDynamicRender();
}

async function refreshSnapshot({ quiet = false } = {}) {
  try { acceptSnapshot(await api(window.mcbot.snapshot())); }
  catch (error) { if (!quiet) toast(error.message, 'error'); }
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
  if (state.logRenderScheduled || state.page !== 'logs' || $('#logPause').checked) return;
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


function aiLocalConfig() {
  return {
    baseUrl: $('#aiBaseUrl')?.value?.trim() || localStorage.getItem('mcbot.ai.baseUrl') || 'http://127.0.0.1:11434/v1',
    model: $('#aiModel')?.value || localStorage.getItem('mcbot.ai.model') || '',
    permission: $('#aiPermission')?.value || localStorage.getItem('mcbot.ai.permission') || 'READ',
    workspaceRoot: $('#aiWorkspace')?.value || localStorage.getItem('mcbot.ai.workspace') || ''
  };
}

function persistAiLocalConfig() {
  const config = aiLocalConfig();
  localStorage.setItem('mcbot.ai.baseUrl', config.baseUrl);
  localStorage.setItem('mcbot.ai.model', config.model);
  localStorage.setItem('mcbot.ai.permission', config.permission);
  if (config.workspaceRoot) localStorage.setItem('mcbot.ai.workspace', config.workspaceRoot);
}

function renderAiWorkspace() {
  const workspace = state.ai.workspace;
  $('#aiWorkspaceVersion').textContent = workspace?.version || '—';
  $('#aiWorkspaceFiles').textContent = workspace?.fileCount ?? '—';
  $('#aiWorkspaceAgents').textContent = workspace ? (workspace.hasAgents ? 'Có' : 'Không') : '—';
}

function renderAiMessages() {
  const target = $('#aiMessages');
  if (!target) return;
  const messages = state.ai.messages || [];
  target.innerHTML = messages.length ? messages.map(message => `<div class="ai-message ${esc(message.role)}"><span class="ai-message-role">${message.role === 'user' ? 'Bạn' : 'Local AI'}</span>${esc(message.content)}</div>`).join('') : '<div class="ai-empty">Chọn project + model rồi nhập yêu cầu. Ví dụ: “tìm nguyên nhân B5 bị timeout và sửa, sau đó chạy test liên quan”.</div>';
  target.scrollTop = target.scrollHeight;
}

function renderAiTrace() {
  const box = $('#aiTrace');
  if (!box) return;
  const trace = state.ai.trace || [];
  box.classList.toggle('hidden', !trace.length);
  box.textContent = trace.map((entry, index) => `${index + 1}. ${entry.success ? 'OK' : 'FAIL'} ${entry.name} · ${entry.elapsedMs}ms\n${entry.summary || ''}`).join('\n\n');
}

async function inspectAiWorkspace() {
  const root = $('#aiWorkspace').value.trim();
  if (!root) throw new Error('Chưa chọn thư mục project cho Local AI.');
  state.ai.workspace = await api(window.mcbot.inspectAiWorkspace(root));
  localStorage.setItem('mcbot.ai.workspace', state.ai.workspace.root);
  $('#aiWorkspace').value = state.ai.workspace.root;
  renderAiWorkspace();
  return state.ai.workspace;
}

async function refreshAiModels() {
  persistAiLocalConfig();
  const statusTag = $('#aiStatusTag');
  statusTag.textContent = 'ĐANG KIỂM TRA';
  try {
    const status = await api(window.mcbot.aiStatus({ baseUrl: $('#aiBaseUrl').value.trim() }));
    state.ai.models = status.models || [];
    const preferred = localStorage.getItem('mcbot.ai.model') || $('#aiModel').value;
    syncSelect($('#aiModel'), state.ai.models.map(model => `<option value="${esc(model.id)}">${esc(model.id)}</option>`).join('') || '<option value="">Không có model</option>', preferred);
    if (!$('#aiModel').value && state.ai.models[0]) $('#aiModel').value = state.ai.models[0].id;
    statusTag.textContent = 'ĐÃ KẾT NỐI';
    persistAiLocalConfig();
    return status;
  } catch (error) {
    statusTag.textContent = 'MẤT KẾT NỐI';
    throw error;
  }
}

async function sendAiPrompt(promptOverride = null) {
  if (state.ai.busy) return;
  const prompt = String(promptOverride ?? $('#aiPrompt').value).trim();
  if (!prompt) return;
  const config = aiLocalConfig();
  if (!config.workspaceRoot) throw new Error('Chưa chọn project workspace.');
  if (!config.model) throw new Error('Chưa chọn model Local AI.');
  persistAiLocalConfig();
  state.ai.busy = true;
  $('#aiSend').disabled = true;
  $('#aiBusyText').textContent = 'Agent đang đọc project / chạy tool…';
  const priorMessages = state.ai.messages.slice(-24).map(message => ({ role: message.role, content: message.content }));
  state.ai.messages.push({ role: 'user', content: prompt });
  $('#aiPrompt').value = '';
  renderAiMessages();
  try {
    const result = await api(window.mcbot.aiChat({
      workspaceRoot: config.workspaceRoot,
      baseUrl: config.baseUrl,
      model: config.model,
      permission: config.permission,
      messages: priorMessages,
      prompt
    }));
    state.ai.messages.push({ role: 'assistant', content: result.content || '(AI không trả nội dung)' });
    state.ai.trace = result.trace || [];
    state.ai.workspace = { ...(state.ai.workspace || {}), ...(result.workspace || {}) };
    renderAiMessages();
    renderAiTrace();
    renderAiWorkspace();
    $('#aiBusyText').textContent = `Xong · ${result.toolRounds ?? 0} vòng tool · quyền ${result.permission || config.permission}`;
    return result;
  } finally {
    state.ai.busy = false;
    $('#aiSend').disabled = false;
  }
}

function loadAiLocalSettings() {
  $('#aiBaseUrl').value = localStorage.getItem('mcbot.ai.baseUrl') || 'http://127.0.0.1:11434/v1';
  $('#aiPermission').value = localStorage.getItem('mcbot.ai.permission') || 'READ';
  $('#aiWorkspace').value = localStorage.getItem('mcbot.ai.workspace') || '';
  const savedModel = localStorage.getItem('mcbot.ai.model') || '';
  if (savedModel) $('#aiModel').innerHTML = `<option value="${esc(savedModel)}">${esc(savedModel)}</option>`;
  if ($('#aiWorkspace').value) inspectAiWorkspace().catch(error => reportRendererError(error, 'ai-workspace-auto-inspect'));
  renderAiMessages();
  renderAiTrace();
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
    const episode = current?.modes?.b5Craft?.details?.protectionEpisode;
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

function switchPage(page) {
  page = window.MCbotRendererRouter.apply(page, {
    document,
    catalog: pageTitles,
    experienceLevel: state.preferences?.experienceLevel || 'standard'
  });
  state.page = page;
  localStorage.setItem('mcbot.page', page);
  if (page === 'dashboard') renderDashboard();
  if (page === 'modes') { renderModes(); Promise.all([loadB5PureConfig(), loadB5Rules(), loadStorageProtection(), loadB5Journey()]).catch(error => toast(error.message, 'error')); }
  if (page === 'incidents') loadIncidents().catch(error => toast(error.message, 'error'));
  if (page === 'bots' && !state.profilesLoaded) loadProfiles().catch(error => toast(error.message, 'error'));
  if (page === 'builder' && state.snapshot?.lifecycle === 'RUNNING') loadCustomModeCatalog().catch(error => toast(error.message, 'error'));
  if (page === 'settings') { loadBackupCatalog().catch(error => toast(error.message, 'error')); if (state.snapshot?.lifecycle === 'RUNNING' && state.configGroups.length) loadAdvancedConfig().catch(error => toast(error.message, 'error')); }
  if (page === 'logs') { state.logUnread = 0; renderLogs(); }
  if (page === 'diagnostics') refreshDiagnostics();
  if (page === 'ai') { renderAiMessages(); renderAiTrace(); if (!state.ai.models.length) refreshAiModels().catch(error => reportRendererError(error, 'ai-model-auto-refresh')); }
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
  const group = await api(window.mcbot.b5CraftConfig());
  const c = group.value || {};
  $('#b5PureEnabled').checked = c.enabled !== false;
  $('#b5PureHome').checked = c.teleportHomeOnEnable !== false;
  $('#b5PureResume').checked = c.autoResumeOnReconnect !== false;
  $('#b5PurePoll').value = c.pollIntervalMs ?? 10000;
  $('#b5PureCraftDelay').value = c.craftLoopDelayMs ?? 300;
  $('#b5PureCooldownMinutes').value = Math.round(Number(c.postB5CooldownMs ?? 1800000) / 60000);
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
  return api(window.mcbot.updateB5CraftConfig({
    enabled: $('#b5PureEnabled').checked,
    teleportHomeOnEnable: $('#b5PureHome').checked,
    autoResumeOnReconnect: $('#b5PureResume').checked,
    pollIntervalMs: Number($('#b5PurePoll').value),
    craftLoopDelayMs: Number($('#b5PureCraftDelay').value),
    postB5CooldownMs: Number($('#b5PureCooldownMinutes').value) * 60000,
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
}

async function saveB5Rules() {
  if (!$('#b5KeepSurplusPv2').checked) throw new Error('Giữ phần dư ở PV2 là bắt buộc để bảo toàn luồng B5.');
  return api(window.mcbot.updateB5RulesConfig({
    inventorySafetyEmptySlots: Number($('#b5InventorySafety').value),
    b3AllMinEmptySlots: Number($('#b5B3MinSlots').value),
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

function bindEvents() {
  document.addEventListener('click', event => {
    const botAction = event.target.closest('[data-action]');
    if (botAction) handleBotAction(botAction).catch(() => {});
    const fleetAction = event.target.closest('[data-fleet-action]');
    if (fleetAction) handleFleetAction(fleetAction).catch(() => {});
  });
  $('#nav').addEventListener('click', event => { const item = event.target.closest('.nav-item'); if (item) switchPage(item.dataset.page); });
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
  $('#saveB5PureConfig').onclick = event => runAction({ key: 'b5-pure-config', button: event.currentTarget, success: 'Đã lưu cấu hình B5 thuần.', refresh: false, fn: saveB5PureConfig }).catch(() => {});
  $('#loadB5Rules').onclick = () => loadB5Rules().catch(error => toast(error.message, 'error'));
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


  $('#aiBaseUrl').addEventListener('change', persistAiLocalConfig);
  $('#aiModel').addEventListener('change', persistAiLocalConfig);
  $('#aiPermission').addEventListener('change', persistAiLocalConfig);
  $('#aiRefreshModels').onclick = event => runAction({ key: 'ai-models', button: event.currentTarget, success: 'Đã kết nối Local AI.', refresh: false, fn: refreshAiModels }).catch(() => {});
  $('#aiSelectWorkspace').onclick = event => runAction({ key: 'ai-workspace-select', button: event.currentTarget, success: null, refresh: false, fn: async () => {
    const selected = await api(window.mcbot.selectAiWorkspace());
    if (selected?.canceled) return selected;
    state.ai.workspace = selected.workspace;
    $('#aiWorkspace').value = selected.workspace.root;
    persistAiLocalConfig();
    renderAiWorkspace();
    toast(`Đã chọn project ${selected.workspace.name || selected.workspace.root}.`);
    return selected;
  }}).catch(() => {});
  $('#aiInspectWorkspace').onclick = event => runAction({ key: 'ai-workspace-inspect', button: event.currentTarget, success: 'Đã quét lại project.', refresh: false, fn: inspectAiWorkspace }).catch(() => {});
  $('#aiSend').onclick = () => sendAiPrompt().catch(error => { $('#aiBusyText').textContent = `Lỗi: ${error.message}`; toast(error.message, 'error'); });
  $('#aiPrompt').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); sendAiPrompt().catch(error => toast(error.message, 'error')); } });
  $('#aiNewChat').onclick = () => { state.ai.messages = []; state.ai.trace = []; renderAiMessages(); renderAiTrace(); $('#aiBusyText').textContent = 'Sẵn sàng.'; };
  $('#aiCopyLast').onclick = async () => { const last = [...state.ai.messages].reverse().find(message => message.role === 'assistant'); if (!last) return; await navigator.clipboard.writeText(last.content); toast('Đã sao chép trả lời AI.'); };
  $$('.ai-quick-actions [data-ai-prompt]').forEach(button => button.onclick = () => sendAiPrompt(button.dataset.aiPrompt).catch(error => toast(error.message, 'error')));
  $('#rollbackConfigMigration').onclick = async event => { if (!await confirmInApp({ title:'Khôi phục cấu hình trước migration?', message:'Hệ thống nền có thể được khởi động lại sau khi rollback được xác minh.', destructive:true })) return; runAction({ key: 'update-rollback-config', button: event.currentTarget, success: 'Đã khôi phục cấu hình trước migration.', refresh: false, fn: async () => { const result = await api(window.mcbot.rollbackConfigMigration()); await loadUpdateStatus(); return result; } }).catch(() => {}); };

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
}

function restoreLocalPreferences() {
  $('#logLevel').value = localStorage.getItem('mcbot.logLevel') || 'all';
  $('#logSearch').value = localStorage.getItem('mcbot.logSearch') || '';
  $('#logAutoScroll').checked = localStorage.getItem('mcbot.logAutoScroll') !== '0';
  $('#logSearch').addEventListener('input', () => localStorage.setItem('mcbot.logSearch', $('#logSearch').value));
}

async function initialize() {
  bindEvents();
  restoreLocalPreferences();
  loadAiLocalSettings();
  switchPage(state.page);
  window.mcbot.onSnapshot(acceptSnapshot);
  window.mcbot.onLog(log => {
    state.logs.push(log);
    if (state.logs.length > 2500) state.logs.splice(0, state.logs.length - 2500);
    if (state.page !== 'logs' || $('#logPause').checked) { state.logUnread += 1; updateLogUnread(); }
    else scheduleLogRender();
  });
  try { state.logs = await api(window.mcbot.logs(800)); } catch (error) { reportRendererError(error, 'initial-log-load'); }
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
