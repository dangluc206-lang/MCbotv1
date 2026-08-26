(function universal(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.MCbotIncidentPresenter = value;
}(typeof globalThis !== 'undefined' ? globalThis : this, function create() {
  'use strict';
  const LABELS = Object.freeze({ 'inspect-diagnostic':'Xem bằng chứng', 'export-support':'Xem trước gói hỗ trợ', 'retry-storage-protection':'Thử lại bảo vệ kho', 'reconnect-bot':'Kết nối lại bot', 'edit-config':'Mở cấu hình' });
  function list(items, selectedId, esc) {
    return items.length ? items.map(item => `<button class="incident-row ${item.id === selectedId ? 'selected' : ''}" data-incident-id="${esc(item.id)}"><div class="incident-row-head"><strong>${esc(item.botId || 'Desktop')} · ${esc(item.code)}</strong><span class="badge ${item.severity === 'critical' || item.severity === 'error' ? 'failed' : item.state === 'RECOVERING' ? 'pending' : ''}">${esc(item.state)}</span></div><span>${esc(item.summary)} · lặp ${esc(item.count)} lần · ${new Date(item.lastSeenAt).toLocaleString('vi-VN')}</span></button>`).join('') : '<div class="empty">Không có sự cố trong bộ lọc hiện tại.</div>';
  }
  function detail(incident, esc) {
    const actions = (incident.allowedActions || []).map(action => `<button class="button ${action === 'retry-storage-protection' || action === 'reconnect-bot' ? 'warn' : 'ghost'}" data-incident-action="${esc(action)}" data-incident-id="${esc(incident.id)}">${esc(LABELS[action] || action)}</button>`).join('');
    const transitions = incident.state === 'ACKNOWLEDGED' ? '' : incident.state === 'RESOLVED'
      ? `<button class="button ghost" data-incident-transition="ACKNOWLEDGED" data-incident-id="${esc(incident.id)}">Xác nhận đã xem</button>`
      : `<button class="button ghost" data-incident-transition="ACKNOWLEDGED" data-incident-id="${esc(incident.id)}">Xác nhận đã xem</button><button class="button primary" data-incident-transition="RESOLVED" data-incident-id="${esc(incident.id)}">Đánh dấu đã xử lý</button>`;
    return `<div class="panel-title"><div><h2>${esc(incident.code)}</h2><p>${esc(incident.summary)}</p></div><span class="badge ${incident.severity === 'critical' || incident.severity === 'error' ? 'failed' : 'pending'}">${esc(incident.severity)} · ${esc(incident.state)}</span></div>
      <div class="incident-detail-grid"><div><span>Bot</span><strong>${esc(incident.botId || 'Desktop')}</strong></div><div><span>Mode/resource</span><strong>${esc(incident.modeId || '—')} / ${esc(incident.resource || '—')}</strong></div><div><span>Generation</span><strong>${esc(incident.generation ?? '—')}</strong></div><div><span>An toàn</span><strong>${incident.state === 'NEEDS_ACTION' ? 'Đã dừng, cần quyết định' : incident.state === 'RECOVERING' ? 'Đang phục hồi có kiểm soát' : 'Theo dõi evidence'}</strong></div><div><span>Đã thử</span><strong>${esc(incident.count)} tín hiệu cùng episode</strong></div><div><span>Bằng chứng</span><strong>${esc(incident.evidenceRefs?.length || 0)} artifact</strong></div></div>
      <div class="actions">${actions}${transitions}</div>
      <details class="section-gap"><summary>Dòng thời gian kỹ thuật</summary><ol class="incident-timeline">${(incident.timeline || []).map(entry => `<li><strong>${esc(entry.kind)}</strong> · ${new Date(entry.at).toLocaleString('vi-VN')} · ${esc(entry.summary || entry.reason || entry.code || '')}</li>`).join('')}</ol></details>`;
  }
  return Object.freeze({ list, detail });
}));
