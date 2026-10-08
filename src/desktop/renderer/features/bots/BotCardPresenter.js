(function universal(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.MCbotBotCardPresenter = value;
}(typeof globalThis !== 'undefined' ? globalThis : this, function create() {
  'use strict';
  // Owns the per-bot card markup used by the dashboard and the mode page.
  // The composition root injects the projection helpers, the document, the craft
  // request panel and a read-only getter for the registry cache, so this module
  // keeps no globals and no state of its own.
  // The card markup is moved verbatim out of the legacy facade: whitespace inside
  // the template literals is part of the rendered HTML and must not be reflowed.
  function create(deps) {
    const { esc, document, connClass, viConnection, viModeBadge, viWaitingReason, position, activeOperation, connectionControlState, modeInfo, buttonHtml, craftingDraft, craftingItemsFor, CraftingRequestPanel } = deps;

    function craftingRecoveryAction(bot, mode) {
  const id = bot.botId;
  const craftingDetails = bot.modes?.crafting?.details || {};
  const craftingEpisode = craftingDetails.protectionEpisode || null;
  const craftingCanRetry = mode.id === 'crafting' && craftingDetails.recovery?.allowedActions?.includes('retry-storage-protection') && craftingEpisode;
  return craftingCanRetry ? `<div class="actions"><button class="button warn" data-action="b5-retry-storage" data-bot="${esc(id)}">Thử lại bảo vệ kho</button></div>` : '';
    }

    function mainActionsHtml({ id, profile, connectionView }) {
  return `<div class="actions">
    ${buttonHtml({ label: 'Kết nối', action: 'connect', bot: id, kind: 'primary', disabled: profile.enabled === false || !connectionView.canConnect, key: `connect:${id}` })}
    ${buttonHtml({ label: 'Về đảo', action: 'home', bot: id, disabled: !connectionView.online, key: `home:${id}` })}
    ${buttonHtml({ label: 'Ngắt riêng bot này', action: 'disconnect', bot: id, kind: 'danger', disabled: !connectionView.canDisconnect, key: `disconnect:${id}` })}
  </div>`;
    }

    function modeActionsHtml({ bot, id, mode, fullActions, profile, connectionView }) {
  const availableModes = bot.modes?.available || [
    { definition: { id: 'crafting', label: 'Chế tạo' }, readiness: { ready: true } },
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
      label: `${entry.definition?.label || modeId || 'Chế độ'}${!connectionView.online && !connectionView.connecting && !connectionView.wantsConnected ? ' · tự kết nối' : ''}`,
      action: 'mode-start', bot: id, mode: modeId, kind: 'primary',
      disabled: profileDisabled || blocked || sameMode,
      title: profileDisabled ? 'Hồ sơ bot đang tắt.' : blocked ? `Chưa sẵn sàng: ${missing || 'service mode chưa được bind'}` : !connectionView.online && !connectionView.wantsConnected ? 'Bật mode và tự kết nối bot.' : '',
      key: `mode:${id}`
    });
  }).join('');
  return fullActions ? `<div class="actions">
    ${startModeButtons}
    ${buttonHtml({ label: 'Tạm dừng', action: 'mode-pause', bot: id, disabled: !mode.id || mode.paused, key: `mode:${id}` })}
    ${buttonHtml({ label: 'Tiếp tục', action: 'mode-resume', bot: id, disabled: !mode.id || (!mode.paused && !mode.manualResume), key: `mode:${id}` })}
    ${buttonHtml({ label: 'Khởi động lại chế độ', action: 'mode-restart', bot: id, kind: 'warn', disabled: !mode.id, key: `mode:${id}` })}
    ${buttonHtml({ label: 'Dừng chế độ', action: 'mode-stop', bot: id, kind: 'danger', disabled: !mode.id, key: `mode:${id}` })}
  </div>` : '';
    }

    function statusDetailGrid(bot, player) {
      return `<div class="status-detail-grid">
        <div class="status-detail"><span>Sky gateway</span><strong>${bot.skyAutoJoin ? `${esc(bot.skyAutoJoin?.location || 'UNKNOWN')} · ${esc(bot.skyAutoJoin?.activeTarget || bot.skyAutoJoin?.readyTarget || profile.skyblockSelection || '—')} · ${bot.skyAutoJoin?.ready ? 'Sẵn sàng' : bot.skyAutoJoin?.pending ? 'Đang xử lý' : bot.skyAutoJoin?.target ? 'Đang chờ mode gateway' : 'Không có mode yêu cầu'}` : '—'}</strong></div>
        <div class="status-detail"><span>Bảo vệ kho</span><strong>${bot.storageProtection?.storageProtection ? `Reserve ${esc(bot.storageProtection.storageProtection.reserveCoverage ?? 1.5)} · bán 64-only ${bot.storageProtection.storageProtection.sellingCapabilityEnabled === false ? 'không khả dụng' : 'khả dụng'} · chỉ nung raw iron/raw gold` : '—'}</strong></div>
        <div class="status-detail"><span>GUI hiện tại</span><strong>${esc(bot.gui?.definitionId || bot.gui?.identity?.candidateId || bot.gui?.title || 'Không mở')}${Number.isFinite(bot.gui?.identity?.confidence) ? ` · ${(Number(bot.gui.identity.confidence) * 100).toFixed(0)}%` : ''}</strong></div>
        <div class="status-detail"><span>Tay phụ</span><strong>${esc(player?.offhandItem?.displayName || player?.offhandItem?.name || '—')}</strong></div>
        <div class="status-detail"><span>Ô trống ước tính</span><strong>${esc(player?.inventory?.slotsFreeApprox ?? '—')}</strong></div>
        <div class="status-detail"><span>Hướng nhìn</span><strong>${Number.isFinite(player?.yaw) ? `${Number(player.yaw).toFixed(2)} / ${Number(player.pitch || 0).toFixed(2)}` : '—'}</strong></div>
        <div class="status-detail"><span>Lần thử vào Sky</span><strong>${esc(bot.skyAutoJoin?.pending?.attempt ?? (bot.skyAutoJoin?.ready ? 'Hoàn tất' : '—'))}</strong></div>
        <div class="status-detail"><span>Lỗi gần nhất</span><strong title="${esc(bot.state?.lastError?.message || bot.state?.lastError || '')}">${esc(bot.state?.lastError?.message || bot.state?.lastError || 'Không có')}</strong></div>
      </div>`;
    }

    function craftingTechDetail(bot) {
      const d = bot.modes?.crafting?.details || {}; const blocker = d.lastAutomationBlockers?.[0] || null; const blockerText = blocker ? `${blocker.baseId ? `${blocker.baseId}: ` : ''}${blocker.reason || blocker.status || 'đang chờ'}` : ''; const protection = d.protectionEpisode || null; const protectionBlocker = protection?.blocker || null; const protectionText = protection ? `${protection.state || 'PENDING'} · attempt ${protection.totalAttempts ?? 0}${protectionBlocker ? ` · ${protectionBlocker.resource ? `${protectionBlocker.resource}: ` : ''}${protectionBlocker.reason || protectionBlocker.code || 'blocked'} · backoff ${protectionBlocker.backoffMs ?? 0}ms${Number.isFinite(protection.nextEligibleAt) ? ` · retry ${Math.max(0, protection.nextEligibleAt - Date.now())}ms` : ''}` : ''}` : ''; const trace = d.automation?.trace || null; const decision = trace?.plan?.decision; const traceText = trace ? `${trace.traceId || ''}${decision?.kind ? ` · ${decision.kind}${decision.resource ? ` ${decision.resource}` : ''}` : ''}` : ''; const batchText = d.batchId ? `${d.batchId}${d.batchProtectionRequired ? ' · chờ bảo vệ kho' : ' · đã bảo vệ kho'}` : 'chưa có batch'; return `<div class="operation-line"><span>Chế tạo</span><strong>Đã hoàn tất: ${esc(d.completedTargets ?? 0)} · Engine: ${esc(d.automationRuns ?? 0)} lượt / ${esc(d.productiveCycles ?? 0)} có tiến triển · ${esc(batchText)} · ${esc(d.waitingReason ? `Đang chờ: ${viWaitingReason(d.waitingReason)}` : 'Đang xử lý')}</strong></div>${protectionText ? `<div class="operation-line"><span>Gate bảo vệ kho</span><strong title="${esc(protectionText)}">${esc(protectionText)}</strong></div>` : ''}${traceText ? `<div class="operation-line"><span>Trace chế tạo gần nhất</span><strong title="${esc(traceText)}">${esc(traceText)}</strong></div>` : ''}${blockerText ? `<div class="operation-line"><span>Điểm chặn</span><strong title="${esc(blockerText)}">${esc(blockerText)}</strong></div>` : ''}`;
    }

    function botCard(bot, fullActions = false) {
  const profile = bot.profile || {};
  const connection = bot.state?.connectionState || 'DISCONNECTED';
  const connectionView = connectionControlState(bot);
  const mode = modeInfo(bot);
  const player = bot.player;
  const operation = activeOperation(bot);
  const id = bot.botId;
  const showTech = document.body.dataset.experience === 'advanced';
  const mainActions = mainActionsHtml({ id, profile, connectionView });
  const modeActions = modeActionsHtml({ bot, id, mode, fullActions, profile, connectionView });
  const craftingRecoveryButton = craftingRecoveryAction(bot, mode);
  const held = player?.heldItem?.displayName || player?.heldItem?.name || '—';
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
      ${showTech ? statusDetailGrid(bot, player) : ''}
      ${showTech && mode.id === 'crafting' ? craftingTechDetail(bot) : ''}
    </div>
    ${mainActions}${craftingRecoveryButton}${modeActions}${mode.id === 'crafting' ? CraftingRequestPanel.render({ botId: id, items: craftingItemsFor(id), request: bot.modes?.crafting?.details?.craftRequest || null, phase: bot.modes?.crafting?.phase || '', waitingReason: bot.modes?.crafting?.details?.waitingReason || '', draft: craftingDraft(id), esc }) : ''}
  </article>`;
    }

    return Object.freeze({ botCard });
  }

  return Object.freeze({ create });
}));
