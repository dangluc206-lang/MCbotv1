(function universal(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.MCbotDevPages = value;
}(typeof globalThis !== 'undefined' ? globalThis : this, function create() {
  'use strict';
  // Pure presenters for the Dev experience. No runtime logic here: they only
  // format data already provided by the shared backend snapshot/IPC surface.

  // ---- Shared state helpers ----

  function stateView({ loading = false, empty = null, error = null, content = '' } = {}) {
    if (loading) return '<div class="dev-state dev-loading"><span class="dev-spinner" aria-hidden="true"></span><p>Đang tải…</p></div>';
    if (error) return `<div class="dev-state dev-error" role="alert"><strong>Lỗi</strong><p>${escapeText(error)}</p></div>`;
    if (empty) return `<div class="dev-state dev-empty"><p>${escapeText(empty)}</p></div>`;
    return content;
  }

  // Entities are assembled at runtime so editor auto-formatting cannot strip them.
  function escapeText(value) {
    const AMP = String.fromCharCode(38);
    return String(value ?? '')
      .replace(/&/g, `${AMP}amp;`)
      .replace(/</g, `${AMP}lt;`)
      .replace(/>/g, `${AMP}gt;`)
      .replace(/"/g, `${AMP}quot;`)
      .replace(/'/g, `${AMP}#39;`);
  }

  function truncateMeta(value) {
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
    return text.length > 80 ? `${text.slice(0, 77)}…` : text;
  }

  // ---- Fleet ----

  function fleetRows(bots, viConnection, incidents = []) {
    if (!bots?.length) return stateView({ empty: 'Không có runtime nào.' });
    const openByBot = new Map();
    for (const incident of (incidents || [])) {
      if (!incident || !incident.botId) continue;
      if (!['OPEN', 'RECOVERING', 'NEEDS_ACTION'].includes(String(incident.state || 'OPEN'))) continue;
      openByBot.set(incident.botId, (openByBot.get(incident.botId) || 0) + 1);
    }
    return bots.map(bot => {
      const mode = bot.modeOwner?.modeId || bot.modeOwner?.mode || bot.intent?.desiredMode || '—';
      const ops = bot.operation?.operations || [];
      const current = ops[0] || null;
      const gui = bot.gui?.definitionId || bot.gui?.title || '—';
      const activeIncident = bot.state?.lastError?.code || '';
      const opText = current
        ? `${current.operationId || '?'}:${current.operationName || current.metadata?.operation || 'op'}@gen${current.connectionGeneration ?? bot.connectionGeneration ?? '?'}`
        : '—';
      const errText = bot.state?.lastError ? ` · err=${bot.state.lastError.code || bot.state.lastError.message || 'err'}` : '';
      const openCount = openByBot.get(bot.botId) || 0;
      return `<div class="log-line"><span class="log-time">${escapeText(bot.state?.connectionState || '—')}</span>` +
        `<span class="log-level">${escapeText(String(bot.connectionGeneration ?? '—'))}</span>` +
        `<span class="log-scope">${escapeText(bot.botId)}</span>` +
        `<span class="log-message">mode=${escapeText(String(mode))} · ops=${ops.length} · op=${escapeText(opText)} · gen=${escapeText(String(bot.connectionGeneration ?? '—'))} · attempt=${escapeText(String(bot.attemptEpoch ?? bot.connectionAttemptEpoch ?? '—'))} · intent=${escapeText(String(intentText(bot.intent)))} · gui=${escapeText(String(gui))}${errText ? ` · ${escapeText(String(errText))}` : ''}${activeIncident ? ` · incident=${escapeText(String(activeIncident))}` : ''} · incidents=${openCount} · services=${(bot.services || []).length}</span></div>`;
    }).join('');
  }

  function intentText(intent) {
    if (!intent) return '—';
    return `${intent.desiredConnection || '—'}${intent.desiredMode ? `/${intent.desiredMode}` : ''}${intent.modeState ? `/${intent.modeState}` : ''}`;
  }

  // ---- Bot detail ----

  function botDetail(bot, helpers) {
    const { viConnection, viPhase, modeInfo, position, activeOperation } = helpers;
    const mode = modeInfo(bot);
    const operation = activeOperation(bot);
    const player = bot.player;
    const conn = bot.state?.connectionState || 'DISCONNECTED';
    const lastError = bot.state?.lastError;
    const warnings = [];
    if (lastError) warnings.push(`Lỗi gần nhất: ${lastError.message || lastError}`);
    if (mode.manualResume) warnings.push('Chờ bấm Tiếp tục sau reconnect.');
    if (mode.paused) warnings.push('Chế độ đang tạm dừng.');
    if (bot.connectionOnline !== true) warnings.push('Bot chưa kết nối.');
    return `<article class="bot-card">
      <div class="bot-head"><div class="bot-name"><strong>${escapeText(bot.profile?.displayName || bot.botId)}</strong><span>${escapeText(bot.profile?.username || bot.botId)}</span></div>
      <span class="badge ${escapeText(String(conn).toLowerCase())}">${escapeText(viConnection(conn))}</span></div>
      <div class="bot-stats">
        <div class="stat"><span>Kết nối</span><strong>${escapeText(viConnection(conn))}</strong></div>
        <div class="stat"><span>Máu / thức ăn</span><strong>${escapeText(player ? `${player.health ?? '—'} / ${player.food ?? '—'}` : '—')}</strong></div>
        <div class="stat"><span>Vị trí</span><strong>${escapeText(position(player))}</strong></div>
        <div class="stat"><span>Ping</span><strong>${escapeText(player?.ping ?? '—')} ms</strong></div>
      </div>
      <div class="mode-box">
        <div class="mode-row"><div><div class="mode-title">${escapeText(mode.name)}</div><div class="mode-phase">${escapeText(mode.phase)}</div></div></div>
        <div class="operation-line"><span>Tác vụ</span><strong>${operation ? `${escapeText(String(operation.active))} · ${escapeText(operation.name)}` : 'Không có tác vụ'}</strong></div>
        ${warnings.length ? warnings.map(w => `<div class="operation-line"><span>Cảnh báo</span><strong>${escapeText(w)}</strong></div>`).join('') : '<div class="operation-line"><span>Cảnh báo</span><strong>Không có</strong></div>'}
      </div>
    </article>`;
  }

  // ---- Log / Event line ----

  function logLine(record) {
    const time = new Date(record.timestamp).toLocaleTimeString('vi-VN', { hour12: false });
    const meta = record.meta ? Object.entries(record.meta).filter(([key]) => key !== 'stack' && key !== 'error').map(([key, value]) => `${key}=${truncateMeta(value)}`).join(' · ') : '';
    const stack = String(record.meta?.stack || record.meta?.error?.stack || '').trim();
    const stackHtml = stack ? `<details class="log-stack"><summary>Stack trace</summary><pre>${escapeText(stack)}</pre></details>` : '';
    return `<div class="log-line ${escapeText(record.level)}"><span class="log-time">${escapeText(time)}</span><span class="log-level ${escapeText(record.level)}">${escapeText(String(record.level || '').toUpperCase())}</span><span class="log-scope" title="${escapeText(record.scope)}">${escapeText(record.scope)}</span><span class="log-message">${escapeText(record.message)}${meta ? ` <span class="log-meta">· ${escapeText(meta)}</span>` : ''}${stackHtml}</span></div>`;
  }

  // ---- Incident timeline (Dev incident-debug: multi-evidence nav) ----
  // Renderer-only: incident → evidence (artifactId list) → operation
  // (operationIds/first-last generation) → recovery (allowedActions/history) → raw JSON.
  // correlation: incidentId, botId, generation, attemptEpoch*, modeId, operationId.
  // (*attemptEpoch lives on events/logs, not on the incident index.)

  function incidentEvidenceNav(safeIndex, total) {
    if (!total) return '';
    return `<div class="actions incident-evidence-nav"><button class="button ghost small" data-evidence-prev ${safeIndex <= 0 ? 'disabled' : ''}>← Prev evidence</button><span class="log-meta">artifact ${safeIndex + 1}/${total}</span><button class="button ghost small" data-evidence-next ${safeIndex >= total - 1 ? 'disabled' : ''}>Next evidence →</button></div>`;
  }

  function incidentTimeline(incident, diagnostic, options = {}) {
    const entries = [];
    entries.push(['Incident', `${incident.code || incident.id} · severity ${incident.severity || '—'} · state ${incident.state}`]);
    const genRange = incident.firstGeneration !== undefined || incident.lastGeneration !== undefined
      ? `${incident.firstGeneration ?? incident.generation ?? '—'} → ${incident.lastGeneration ?? incident.generation ?? '—'}`
      : `${incident.generation ?? '—'}`;
    entries.push(['Bot / generation', `${incident.botId || '—'} · gen ${incident.generation ?? '—'} · range ${genRange}`]);
    entries.push(['Mode / resource', `${incident.modeId || '—'} / ${incident.resource || '—'}`]);
    if (incident.operationIds?.length) entries.push(['Operations', incident.operationIds.join(', ')]);
    entries.push(['Count', String(incident.count ?? 1)]);
    if (incident.firstSeenAt) entries.push(['Lần đầu thấy', String(incident.firstSeenAt)]);
    if (incident.lastSeenAt) entries.push(['Lần cuối thấy', String(incident.lastSeenAt)]);
    if (incident.summary || incident.message) entries.push(['Mô tả', incident.summary || incident.message]);
    const evidence = incident.evidenceRefs || [];
    // P0-5: đánh dấu evidence đang xem (artifact i/n) trong multi-evidence nav.
    const activeIndex = Number(options.evidenceIndex);
    for (const [index, ref] of evidence.entries()) {
      const marker = Number.isInteger(activeIndex) && evidence.length > 1 && index === activeIndex ? ' ← đang xem' : '';
      entries.push([`evidence:${index + 1}/${evidence.length}`, `${String(ref)}${marker}`]);
    }
    if (incident.allowedActions?.length) entries.push(['Hành động cho phép', incident.allowedActions.join(', ')]);
    if (incident.history?.length) {
      for (const entry of incident.history) entries.push(['Transition', `${entry.state || entry.to || '—'} · ${entry.reason || ''} · ${entry.at || ''}`]);
    }
    if (incident.timeline?.length) {
      for (const entry of incident.timeline) entries.push(['Timeline', `${entry.kind || '—'} · ${entry.code || ''} · gen ${entry.generation ?? '—'} · op ${entry.operationId || entry.correlationId || '—'} · ${entry.summary || entry.reason || ''} · ${entry.at || ''}`]);
    }
    if (diagnostic) entries.push(['Raw diagnostic (JSON)', `<pre class="compact-output">${escapeText(JSON.stringify(diagnostic, null, 2))}</pre>`]);
    entries.push(['Raw incident (JSON)', `<pre class="compact-output">${escapeText(JSON.stringify(incident, null, 2))}</pre>`]);
    return `<div class="incident-timeline">${chunk(entries).map(([label, value]) => `<div class="timeline-step"><span>${escapeText(label)}</span><strong>${value}</strong></div>`).join('') || stateView({ empty: 'Không có timeline.' })}</div>`;
  }

  function chunk(entries) {
    const pairs = [];
    for (let i = 0; i < entries.length; i += 2) pairs.push([entries[i], entries[i + 1] ?? '']);
    return pairs;
  }

  // ---- Inspector ----

  function inspectorView(detail) {
    if (!detail) return stateView({ empty: 'Chưa có dữ liệu inspector.' });
    // P0-4: header correlation rút từ botDevDetail (bot/state/intent/generation/
    // modeOwner/operationIds/services) + <pre> raw JSON hiện có. Không đổi botDevDetail.
    const bot = detail.bot || {};
    const ops = bot.operation?.operations || [];
    const current = ops[0] || null;
    const opIds = ops.map(entry => entry?.operationId).filter(Boolean).slice(0, 5);
    const header = [
      `bot=${bot.botId || detail.botId || '—'}`,
      `gen=${bot.connectionGeneration ?? '—'}`,
      `intent=${intentText(bot.intent)}`,
      `mode=${bot.modeOwner?.modeId || bot.modeOwner?.mode || bot.intent?.desiredMode || '—'}`,
      `ops=${ops.length}${current ? ` · current=${current.operationId || '?'}:${current.operationName || current.metadata?.operation || 'op'}` : ''}${opIds.length ? ` · opIds=${opIds.join(',')}` : ''}`,
      `services=${(detail.services || []).length}`
    ].join(' · ');
    return `<div class="inspector-correlation"><span class="log-meta">${escapeText(header)}</span></div>` +
      `<pre class="dev-json-output">${escapeText(JSON.stringify(detail, null, 2))}</pre>`;
  }

  // ---- Event stream (EventBus inspector) ----
  // Renderer-only: unified correlation columns eventId · type · bot · gen ·
  // attempt · mode · operation. eventId is self-generated (copy/grep only),
  // join truth is botId+generation+attemptEpoch+operationId. Raw JSON kept.

  function eventLine(record) {
    const time = new Date(record.timestamp).toLocaleTimeString('vi-VN', { hour12: false });
    const type = record.eventType || '—';
    const opOrMode = record.operationId || record.modeId || '';
    // P0-1: summary dòng đầu hiện đủ botId·gen·attempt·opId/modeId·eventId·type.
    // eventId tự sinh chỉ để copy/grep; join truth là botId+generation+attemptEpoch+operationId.
    const summary = [record.botId || '', record.generation ? `gen ${record.generation}` : '', record.attemptEpoch ? `attempt ${record.attemptEpoch}` : '', opOrMode, record.eventId || '', type].filter(Boolean).join(' · ');
    const meta = [
      record.botId ? `bot=${escapeText(record.botId)}` : '',
      record.generation ? `gen=${escapeText(String(record.generation))}` : '',
      record.attemptEpoch ? `attempt=${escapeText(String(record.attemptEpoch))}` : '',
      record.modeId ? `mode=${escapeText(String(record.modeId))}` : '',
      record.operationId ? `op=${escapeText(String(record.operationId))}` : '',
      record.correlationId && record.correlationId !== record.operationId ? `corr=${escapeText(String(record.correlationId))}` : '',
      record.source ? `source=${escapeText(record.source)}` : '',
      record.subsystem ? `subsystem=${escapeText(record.subsystem)}` : ''
    ].filter(Boolean).join(' · ');
    const rawJson = escapeText(JSON.stringify(record, null, 2));
    return `<div class="event-line ${escapeText(record.severity || 'info')}" data-event-id="${escapeText(record.eventId)}">` +
      `<span class="log-time">${escapeText(time)}</span>` +
      `<span class="log-level ${escapeText(record.severity || 'info')}">${escapeText(String((record.severity || 'info')).toUpperCase())}</span>` +
      `<span class="log-scope">${escapeText(String(record.subsystem || '—'))}</span>` +
      `<div class="event-body"><strong>${escapeText(summary)}</strong>` +
      `<span class="log-meta">${meta ? `· ${meta}` : ''}</span>` +
      `${rawJson ? `<details class="event-raw"><summary>Xem JSON</summary><pre>${rawJson}</pre></details>` : ''}` +
      `<div class="actions event-actions"><button class="button ghost small" data-event-copy="${escapeText(record.eventId)}">Copy</button></div>` +
      `</div></div>`;
  }

  function eventStream(records) {
    if (!records?.length) return stateView({ empty: 'Chưa có sự kiện phù hợp.' });
    return records.map(eventLine).join('');
  }

  // ---- Log stream ----

  function logStream(records) {
    if (!records?.length) return stateView({ empty: 'Không có nhật ký phù hợp.' });
    return records.map(logLine).join('');
  }

  // ---- Runtime state ----

  function runtimeStateView(snapshot) {
    if (!snapshot) return stateView({ empty: 'Chưa có snapshot.' });
    return `<pre class="dev-json-output">${escapeText(JSON.stringify(snapshot, null, 2))}</pre>`;
  }

  // ---- Craft Debug ----
  // Renderer-only: journey operator + trace replay. modes.crafting.details is
  // rendered when present (crafting status/blocker/verification), then trace.

  function craftDebugView(journey, trace) {
    const journeyHtml = journey?.length ? journey.map(entry => {
      const botId = entry.botId || '—';
      const crafting = entry.crafting || null;
      const details = crafting?.details || crafting || null;
      const state = details?.state || crafting?.state || entry.state || '—';
      const target = details?.targetItemId || details?.target || null;
      const units = details?.completedUnits ?? null;
      const remaining = details?.remaining ?? null;
      const reason = details?.lastError || details?.lastBlocker || details?.waitingReason || null;
      const summary = [
        `target=${target || '—'}`,
        `completedUnits=${units ?? '—'}`,
        remaining !== null && remaining !== undefined ? `remaining=${remaining}` : null,
        reason ? `lý do: ${reason}` : null
      ].filter(Boolean).join(' · ');
      const gen = details?.connectionGeneration ?? entry.generation;
      const genText = gen !== undefined && gen !== null ? ` · gen=${gen}` : '';
      return `<div class="craft-journey-card panel"><strong>${escapeText(botId)}</strong><span>${escapeText(state)} · ${escapeText(String(summary))}${escapeText(String(genText))}</span></div>`;
    }).join('') : stateView({ empty: 'Chưa có trạng thái chế tạo.' });
    const traceHtml = trace ? `<pre class="dev-json-output">${escapeText(JSON.stringify(trace, null, 2))}</pre>` : stateView({ empty: 'Chưa có trace.' });
    return `${journeyHtml}${traceHtml}`;
  }

  // ---- Diagnostics ----

  function diagnosticsView(items) {
    if (!items?.length) return stateView({ empty: 'Chưa có bản ghi lỗi runtime.' });
    return items.map(item => {
      const id = item.id || item.name;
      const title = [item.botId, item.code || (item.corrupt ? 'BẢN GHI HỎNG' : 'Lỗi runtime')].filter(Boolean).join(' · ');
      const meta = `${new Date(item.modifiedAt).toLocaleString('vi-VN')} · ${item.size} bytes${item.severity ? ` · ${item.severity}` : ''}`;
      return `<div class="diagnostic-item" data-diagnostic="${escapeText(id)}"><strong>${escapeText(title || id)}</strong><span>${escapeText(meta)}</span></div>`;
    }).join('');
  }

  // ---- Config Debug ----

  function configDebugView(group) {
    if (!group) return stateView({ empty: 'Chọn nhóm cấu hình.' });
    return `<pre class="dev-json-output">${escapeText(JSON.stringify(group, null, 2))}</pre>`;
  }

  return Object.freeze({
    stateView, fleetRows, botDetail, logLine, incidentTimeline, incidentEvidenceNav,
    inspectorView, eventStream, eventLine, logStream, runtimeStateView,
    craftDebugView, diagnosticsView, configDebugView
  });
}));