(function universal(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.MCbotConfigGroupCatalog = value;
}(typeof globalThis !== 'undefined' ? globalThis : this, function create() {
  'use strict';
  // Vietnamese labels for configuration group keys returned by the
  // 'mcbot:config:groups' IPC contract. Unknown keys fall back to the raw key
  // at the call site, so this map stays a pure presentation catalog.
  return Object.freeze({
    app:'Ứng dụng & vận hành', server:'Máy chủ Minecraft', commands:'Danh sách lệnh', skyCommands:'Lệnh riêng theo Sky', commandResponses:'Phản hồi lệnh', serverLogin:'Đăng nhập server', resourcePack:'Gói tài nguyên', discord:'Discord', guiWindows:'Nhận diện cửa sổ GUI', guiSlots:'Vai trò ô GUI', guiObservation:'Quan sát GUI', inventoryObservation:'Quan sát túi đồ', movement:'Di chuyển', locations:'Vị trí', routes:'Tuyến đường', items:'Nhận diện vật phẩm', storage:'Kho /kho', personalVault:'Kho cá nhân /pv 2', minerals:'Menu khoáng sản', mineralConversions:'Đổi phôi/khối & bảo vệ kho', smelting:'Nung', island:'Đảo /is', dungeon:'Hầm ngục', skyblock:'Vào Skyblock', recipes:'Công thức chế tạo', craftingTiers:'Tầng chế tạo', b5:'Quy tắc B5', collectorB5Mode:'Collector+B5 cũ', craftingMode:'Chế tạo thuần', fishingMode:'Câu cá', dailyRecovery:'Khung phục hồi theo giờ', craftingTargets:'Mục tiêu chế tạo'
  });
}));
