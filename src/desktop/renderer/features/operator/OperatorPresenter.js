(function universal(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.MCbotOperatorPresenter = value;
}(typeof globalThis !== 'undefined' ? globalThis : this, function create() {
  'use strict';
  // Operator-facing label maps and simple formatters. Pure: no DOM, no IPC and
  // no renderer state, so the same helpers serve dashboard, bot and Dev views.

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
    return ({ CONNECTED: 'Đã kết nối', CONNECTING: 'Đang kết nối', LOGGED_IN: 'Đã đăng nhập Minecraft', AUTHENTICATING: 'Đang đăng nhập server', AUTHENTICATION_FAILED: 'Đăng nhập server thất bại', KICKED: 'Bị máy chủ ngắt', RECONNECTING: 'Đang kết nối lại', DISCONNECTED: 'Đã ngắt', DISABLED: 'Đã tắt kết nối', FAILED: 'Lỗi kết nối', IDLE: 'Đang rảnh' })[String(status || '').toUpperCase()] || String(status || 'Không rõ');
  }

  function viModeBadge(className) {
    return ({ running: 'ĐANG CHẠY', paused: 'TẠM DỪNG', pending: 'ĐANG CHUẨN BỊ' })[String(className || '').toLowerCase()] || 'ĐANG RẢNH';
  }

  function viPressure(level) {
    return ({ NORMAL: 'Bình thường', RISING: 'Đang tăng', HIGH: 'Cao', CRITICAL: 'Nguy cấp', UNKNOWN: 'Chưa rõ' })[String(level || '').toUpperCase()] || String(level || 'Chưa rõ');
  }

  function viPhase(phase) {
    const map = { OFF:'Tắt', STOPPED:'Tắt', STARTING:'Đang khởi động', RUNNING:'Đang chạy', PAUSED:'Tạm dừng', PAUSING:'Đang tạm dừng', RESUMING:'Đang tiếp tục', STOPPING:'Đang dừng', PREPARING:'Đang chuẩn bị', WAITING_CONNECTION:'Chờ kết nối', WAITING_SKYBLOCK:'Chờ Skyblock', B1_NORMALIZATION:'Đang nung / đổi khối B1', COOLDOWN:'Đang nghỉ sau chu kỳ', GOING_HOME:'Đang /is', STORAGE_CHECK:'Đang kiểm tra kho', STORAGE_PROTECTION:'Đang bảo vệ kho', READING_B5:'Đang đọc vật liệu B5', CRAFTING:'Đang chế tạo', WAITING_STORAGE:'Chờ giảm áp lực kho', WAITING_HEADROOM:'Chờ chỗ trống để bung khối', WAITING_MATERIALS:'Chờ vật liệu', WAITING_PV2:'Chờ PV2', COMPLETED:'Đã chế xong mục tiêu', WAITING_REQUEST:'Chờ yêu cầu chế tạo', WAITING_RETRY:'Chờ thử lại', WAITING_MANUAL_RESUME:'Chờ bấm Tiếp tục sau reconnect', ERROR:'Lỗi' };
    return map[String(phase || '').toUpperCase()] || String(phase || '—').replaceAll('_',' ');
  }

  function viWaitingReason(reason) {
    return ({ connection:'kết nối', skyblock:'Skyblock', 'storage-pressure':'giảm áp lực kho', materials:'vật liệu', 'pv2-backpressure':'chỗ trống PV2', 'decompression-headroom':'chỗ trống để bung khối', paused:'tiếp tục thủ công', timeout:'thử lại sau timeout', 'not_ready':'hệ thống sẵn sàng', 'manual-resume-after-reconnect':'bấm Tiếp tục sau reconnect', cooldown:'hết thời gian nghỉ sau chu kỳ', 'no-craft-request':'chưa có yêu cầu chế tạo' })[String(reason || '').toLowerCase()] || String(reason || '');
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

  return Object.freeze({ formatDuration, connClass, viConnection, viModeBadge, viPressure, viPhase, viWaitingReason, position, activeOperation });
}));
