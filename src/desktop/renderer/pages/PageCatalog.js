(function universal(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.MCbotPageCatalog = value;
}(typeof globalThis !== 'undefined' ? globalThis : this, function create() {
  'use strict';
  return Object.freeze({
    dashboard:Object.freeze({ title:'Tổng quan', subtitle:'Theo dõi và điều khiển toàn bộ bot', group:'OPERATE' }),
    bots:Object.freeze({ title:'Bot', subtitle:'Quản lý hồ sơ và kết nối', group:'OPERATE' }),
    modes:Object.freeze({ title:'Chế độ', subtitle:'B5 thuần, bảo vệ kho, Skyblock và các chế độ hiện có', group:'OPERATE' }),
    builder:Object.freeze({ title:'Tạo chế độ', subtitle:'Ghép mô-đun an toàn thành luồng tự động', group:'BUILD' }),
    incidents:Object.freeze({ title:'Sự cố', subtitle:'Theo dõi, xử lý và xác nhận các sự cố bền vững', group:'MAINTAIN' }),
    logs:Object.freeze({ title:'Nhật ký', subtitle:'Theo dõi hoạt động theo thời gian thực', group:'MAINTAIN' }),
    settings:Object.freeze({ title:'Cài đặt', subtitle:'Ứng dụng, cấu hình an toàn, dữ liệu và bảo mật', group:'MAINTAIN' }),
    tools:Object.freeze({ title:'Công cụ', subtitle:'Trung tâm lệnh và kiểm tra GUI', group:'ADVANCED' }),
    diagnostics:Object.freeze({ title:'Chẩn đoán', subtitle:'Lỗi khi chạy và gói hỗ trợ', group:'ADVANCED' }),
    ai:Object.freeze({ title:'AI Local', subtitle:'Development agent bị giới hạn permission và workspace', group:'ADVANCED' })
  });
}));
