(function universal(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.MCbotDevPages = value;
}(typeof globalThis !== 'undefined' ? globalThis : this, function create() {
  'use strict';
  // Pure presenters for the Dev experience. No runtime logic here: they only
  // format data already provided by the shared backend snapshot/IPC surface.

  function fleetRows(bots, viConnection) {
    return bots.map(bot => {
      const mode = bot.modeOwner?.modeId || bot.modeOwner?.mode || bot.intent?.desiredMode || '—';
      const ops = Number(bot.operation?.active || 0);
      const gui = bot.gui?.definitionId || bot.gui?.title || '—';
      return `<div class="log-line"><span class="log-time">${escapeText(bot.state?.connectionState || '—')}</span>` +
        `<span class="log-level">${escapeText(String(bot.connectionGeneration ?? '—'))}</span>` +
        `<span class="log-scope">${escapeText(bot.botId)}</span>` +
        `<span class="log-message">mode=${escapeText(String(mode))} · ops=${ops} · gen=${escapeText(String(bot.connectionGeneration ?? '—'))} · intent=${escapeText(String(intentText(bot.intent)))} · gui=${escapeText(String(gui))} · services=${(bot.services || []).length}</span></div>`;
    }).join('') || '<div class="empty">Không có runtime nào.</div>';
  }

  function intentText(intent) {
    if (!intent) return '—';
    return `${intent.desiredConnection || '—'}${intent.desiredMode ? `/${intent.desiredMode}` : ''}${intent.modeState ? `/${intent.modeState}` : ''}`;
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

  function logLine(record) {
    const time = new Date(record.timestamp).toLocaleTimeString('vi-VN', { hour12: false });
    const meta = record.meta ? Object.entries(record.meta).filter(([key]) => key !== 'stack').slice(0, 6).map(([key, value]) => `${key}=${shorten(value)}`).join(' · ') : '';
    return `<div class="log-line ${escapeText(record.level)}"><span class="log-time">${escapeText(time)}</span><span class="log-level ${escapeText(record.level)}">${escapeText(String(record.level || '').toUpperCase())}</span><span class="log-scope" title="${escapeText(record.scope)}">${escapeText(record.scope)}</span><span class="log-message">${escapeText(record.message)}${meta ? ` <span class="log-meta">· ${escapeText(meta)}</span>` : ''}</span></div>`;
  }

  function shorten(value) {
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
    return text.length > 80 ? `${text.slice(0, 77)}…` : text;
  }

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
    return `<div class="incident-timeline">${chunk(entries).map(([label, value]) => `<div class="timeline-step"><span>${escapeText(label)}</span><strong>${value}</strong></div>`).join('') || '<div class="empty">Không có timeline.</div>'}</div>`;
  }

  function chunk(entries) {
    const pairs = [];
    for (let i = 0; i < entries.length; i += 2) pairs.push([entries[i], entries[i + 1] ?? '']);
    return pairs;
  }

  return Object.freeze({ fleetRows, botDetail, logLine, incidentTimeline });
}));