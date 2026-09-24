(function universal(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.MCbotCraftingRequestPanel = value;
}(typeof globalThis !== 'undefined' ? globalThis : this, function create() {
  'use strict';

  const STATE_LABELS = { RUNNING: 'Đang chế', PENDING: 'Chờ bắt đầu', COMPLETED: 'Hoàn thành', EXHAUSTED: 'Dừng: hết khả thi', BLOCKED: 'Bị chặn', FAILED: 'Thất bại' };
  const PHASE_LABELS = { WAITING_REQUEST: 'Chờ yêu cầu mới của operator' };

  // Registry-driven list only: id comes from CraftingTargetRegistry, the label
  // is the real in-game displayName. Tier letters never reach the operator here.
  function craftables(items) {
    return (Array.isArray(items) ? items : [])
      .filter(entry => entry?.id && entry?.displayName)
      .map(entry => ({ id: String(entry.id), displayName: String(entry.displayName) }));
  }

  // Generic status: target + completed amount + state + blocker/waiting reason.
  // Never uses product-specific counters such as completedB5.
  function statusText(request, phase, waitingReason) {
    if (!request?.targetItemId) return { line: 'Không có yêu cầu chế tạo', detail: '' };
    const parts = [];
    if (request.quantityMode === 'ALL') parts.push('ALL');
    else if (Number.isFinite(Number(request.remaining))) parts.push(`còn ${Number(request.remaining)}`);
    parts.push(`đã xong ${Number(request.completedUnits || 0)}`);
    const stateLabel = STATE_LABELS[String(request.state).toUpperCase()] || String(request.state);
    const phaseLabel = PHASE_LABELS[String(phase).toUpperCase()] || '';
    const reason = request.lastError || request.lastBlocker || waitingReason || null;
    const detail = [stateLabel, parts.join(' · '), phaseLabel, reason ? `lý do: ${reason}` : ''].filter(Boolean).join(' · ');
    return { line: `${request.targetDisplayName || request.targetItemId}`, detail };
  }

  // Single source of truth for the <select> body: placeholder only when the
  // registry list is empty, otherwise real item options keyed by item id.
  function optionsHtml(items = [], draft = {}, esc = String) {
    const options = craftables(items);
    if (!options.length) return '<option value="">Không có vật phẩm chế tạo</option>';
    return options.map(entry =>
      `<option value="${esc(entry.id)}"${draft.itemId === entry.id ? ' selected' : ''}>${esc(entry.displayName)}</option>`).join('');
  }

  function render({ botId, items = [], request = null, phase = '', waitingReason = '', draft = {}, esc }) {
    const options = optionsHtml(items, draft, esc);
    const status = statusText(request, phase, waitingReason);
    const hasRequest = Boolean(request?.targetItemId);
    return `<div class="actions craft-request-panel" data-craft-request-bot="${esc(botId)}">
      <select data-craft-request-item aria-label="Vật phẩm cần chế">${options}</select>
      <input data-craft-request-quantity type="number" min="1" step="1" placeholder="Số lượng" aria-label="Số lượng" value="${esc(draft.quantity || '')}">
      <label class="craft-request-all"><input type="checkbox" data-craft-request-all${draft.all ? ' checked' : ''}> ALL</label>
      <button class="button primary" data-action="craft-request-start" data-bot="${esc(botId)}" ${craftables(items).length ? '' : 'disabled'}>Bắt đầu chế</button>
      <button class="button" data-action="craft-request-clear" data-bot="${esc(botId)}" ${hasRequest ? '' : 'disabled'}>Xóa yêu cầu</button>
      <span class="craft-request-status" title="${esc(status.detail)}">${esc(status.line)}${status.detail ? ` · ${esc(status.detail)}` : ''}</span>
    </div>`;
  }

  // UI-boundary validation only. The authoritative request validation stays in
  // CraftingModeService.setCraftRequest / CraftingRequest.
  function readForm(container) {
    const root = container?.closest?.('[data-craft-request-bot]') || container?.closest?.('[data-b5-request-bot]') || container;
    const itemId = String(root?.querySelector?.('[data-craft-request-item]')?.value || root?.querySelector?.('[data-b5-request-item]')?.value || '').trim();
    if (!itemId) throw new Error('Hãy chọn vật phẩm cần chế.');
    const allChecked = Boolean(root?.querySelector?.('[data-craft-request-all]')?.checked || root?.querySelector?.('[data-b5-request-all]')?.checked);
    if (allChecked) return { targetItemId: itemId, quantity: 'ALL' };
    const raw = String(root?.querySelector?.('[data-craft-request-quantity]')?.value ?? root?.querySelector?.('[data-b5-request-quantity]')?.value ?? '').trim();
    if (!raw) throw new Error('Hãy nhập số lượng hoặc chọn ALL.');
    const quantity = Number(raw);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Số lượng phải là số nguyên dương.');
    return { targetItemId: itemId, quantity };
  }

  return Object.freeze({ craftables, optionsHtml, statusText, render, readForm });
}));
