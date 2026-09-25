(function universal(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.MCbotPageCatalog = value;
}(typeof globalThis !== 'undefined' ? globalThis : this, function create() {
  'use strict';
  // Two experiences share one backend: USER (standard) and DEV (advanced).
  // Group 'USER' is always visible; group 'DEV' requires experienceLevel=advanced.
  return Object.freeze({
    dashboard:Object.freeze({ title:'Tổng quan', subtitle:'Bot đang làm gì và có vấn đề gì không', group:'USER' }),
    bots:Object.freeze({ title:'Bot', subtitle:'Quản lý hồ sơ và kết nối', group:'USER' }),
    'bot-detail':Object.freeze({ title:'Chi tiết bot', subtitle:'Trạng thái, chế độ và cảnh báo của một bot', group:'USER' }),
    modes:Object.freeze({ title:'Chế độ', subtitle:'Chế tạo theo mục tiêu, bảo vệ kho, Skyblock và các chế độ hiện có', group:'USER' }),
    incidents:Object.freeze({ title:'Sự cố', subtitle:'Theo dõi, xử lý và xác nhận các sự cố bền vững', group:'USER' }),
    settings:Object.freeze({ title:'Cài đặt', subtitle:'Ứng dụng, cấu hình an toàn, dữ liệu và bảo mật', group:'USER' }),
    'dev-overview':Object.freeze({ title:'Dev · Tổng quan fleet', subtitle:'Lifecycle, connection, generation, mode, operation, health', group:'DEV' }),
    inspector:Object.freeze({ title:'Dev · Bot Inspector', subtitle:'Toàn bộ trạng thái runtime của một bot', group:'DEV' }),
    events:Object.freeze({ title:'Dev · Event Stream', subtitle:'Sự kiện runtime theo thời gian thực, bản chưa fold', group:'DEV' }),
    logs:Object.freeze({ title:'Dev · Nhật ký', subtitle:'DEBUG/INFO/WARN/ERROR với bộ lọc đầy đủ', group:'DEV' }),
    'incident-debug':Object.freeze({ title:'Dev · Incident Debugger', subtitle:'Timeline sự cố: event → operation → service → recovery', group:'DEV' }),
    'runtime-state':Object.freeze({ title:'Dev · Runtime State', subtitle:'Snapshot lifecycle, intent, mode, operation, services', group:'DEV' }),
    'b5-debug':Object.freeze({ title:'Dev · Craft Debug', subtitle:'Journey, trace replay, blocker và verification chế tạo (tương thích B5)', group:'DEV' }),
    builder:Object.freeze({ title:'Tạo chế độ', subtitle:'Ghép mô-đun an toàn thành luồng tự động', group:'DEV' }),
    tools:Object.freeze({ title:'Dev · Công cụ', subtitle:'Trung tâm lệnh và kiểm tra GUI', group:'DEV' }),
    diagnostics:Object.freeze({ title:'Dev · Chẩn đoán', subtitle:'Lỗi khi chạy và gói hỗ trợ', group:'DEV' }),
    'config-debug':Object.freeze({ title:'Dev · Configuration Debug', subtitle:'Raw config, effective config và diff', group:'DEV' }),
      });
}));