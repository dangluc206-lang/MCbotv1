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

  function shorten(value) {
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
    return text.length > 80 ? `${text.slice(0, 77)}…` : text;
  }

  // ---- Fleet ----

  function fleetRows(bots, viConnection) {
    if (!bots?.length) return stateView({ empty: 'Không có runtime nào.' });
    return bots.map(bot => {
      const mode = bot.modeOwner?.modeId || bot.modeOwner?.mode || bot.intent?.desiredMode || '—';
      const ops = Number(bot.operation?.active || 0);
      const gui = bot.gui?.definitionId || bot.gui?.title || '—';
      return `<div class="log-line"><span class="log-time">${escapeText(bot.state?.connectionState || '—')}</span>` +
        `<span class="log-level">${escapeText(String(bot.connectionGeneration ?? '—'))}</span>` +
        `<span class="log-scope">${escapeText(bot.botId)}</span>` +
        `<span class="log-message">mode=${escapeText(String(mode))} · ops=${ops} · gen=${escapeText(String(bot.connectionGeneration ?? '—'))} · intent=${escapeText(String(intentText(bot.intent)))} · gui=${escapeText(String(gui))} · services=${(bot.services || []).length}</span></div>`;
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
    const meta = record.meta ? Object.entries(record.meta).filter(([key]) => key !== 'stack' && key !== 'error').map(([key, value]) => `${key}=${shorten(value)}`).join(' · ') : '';
    const stack = String(record.meta?.stack || record.meta?.error?.stack || '').trim();
    const stackHtml = stack ? `<details class="log-stack"><summary>Stack trace</summary><pre>${escapeText(stack)}</pre></details>` : '';
    return `<div class="log-line ${escapeText(record.level)}"><span class="log-time">${escapeText(time)}</span><span class="log-level ${escapeText(record.level)}">${escapeText(String(record.level || '').toUpperCase())}</span><span class="log-scope" title="${escapeText(record.scope)}">${escapeText(record.scope)}</span><span class="log-message">${escapeText(record.message)}${meta ? ` <span class="log-meta">· ${escapeText(meta)}</span>` : ''}${stackHtml}</span></div>`;
  }

  // ---- Incident timeline ----

  function incidentTimeline(incident, diagnostic) {
    const entries = [];
    entries.push(['Incident', `${incident.code || incident.id} · severity ${incident.severity || '—'} · state ${incident.state}`]);
    entries.push(['Bot / generation', `${incident.botId || '—'} · gen ${incident.generation ?? '—'}`]);
    if (incident.firstSeenAt) entries.push(['Lần đầu thấy', String(incident.firstSeenAt)]);
    if (incident.lastSeenAt) entries.push(['Lần cuối thấy', String(incident.lastSeenAt)]);
    if (incident.summary || incident.message) entries.push(['Mô tả', incident.summary || incident.message]);
    const evidence = incident.evidenceRefs || [];
    for (const [index, ref] of evidence.entries()) entries.push(`evidence:${index + 1}`, String(ref));
    if (incident.allowedActions?.length) entries.push(['Hành động cho phép', incident.allowedActions.join(', ')]);
    if (incident.history?.length) {
      for (const entry of incident.history) entries.push(['Transition', `${entry.state || entry.to || '—'} · ${entry.reason || ''} · ${entry.at || ''}`]);
    }
    if (diagnostic) entries.push(['Raw diagnostic (JSON)', `<pre class="compact-output">${escapeText(JSON.stringify(diagnostic, null, 2))}</pre>`]);
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
    return `<pre class="dev-json-output">${escapeText(JSON.stringify(detail, null, 2))}</pre>`;
  }

  // ---- Event stream (EventBus inspector) ----

  function eventLine(record) {
    const time = new Date(record.timestamp).toLocaleTimeString('vi-VN', { hour12: false });
    const type = record.eventType || '—';
    const summary = [record.eventId, type].filter(Boolean).join(' · ');
    const meta = [
      record.botId ? `bot=${escapeText(record.botId)}` : '',
      record.generation ? `gen=${escapeText(String(record.generation))}` : '',
      record.attemptEpoch ? `attempt=${escapeText(String(record.attemptEpoch))}` : '',
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

  // ---- B5 Debug ----

  function b5DebugView(journey, trace) {
    const journeyHtml = journey?.length ? journey.map(entry => {
      const botId = entry.botId || '—';
      const completed = entry.completedB5 ?? '—';
      const state = entry.state || '—';
      return `<div class="b5-journey-card panel"><strong>${escapeText(botId)}</strong><span>${escapeText(state)} · ${escapeText(String(completed))} B5</span></div>`;
    }).join('') : stateView({ empty: 'Chưa có trạng thái B5.' });
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
    stateView, fleetRows, botDetail, logLine, incidentTimeline,
    inspectorView, eventStream, eventLine, logStream, runtimeStateView,
    b5DebugView, diagnosticsView, configDebugView
  });
}));