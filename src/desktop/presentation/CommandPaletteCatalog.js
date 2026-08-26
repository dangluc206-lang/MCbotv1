'use strict';

const { message } = require('./MessageCatalog');

const ENTRIES = Object.freeze([
    { id: 'route-dashboard', label: 'Tổng quan vận hành', route: 'dashboard', group: 'OPERATE', requirement: 'NONE' },
    { id: 'route-bots', label: 'Thêm hoặc quản lý bot', route: 'bots', group: 'OPERATE', requirement: 'BACKEND_RUNNING_FOR_EDIT' },
    { id: 'route-modes', label: 'Chạy chế độ B5', route: 'modes', group: 'OPERATE', requirement: 'BOT_ENABLED' },
    { id: 'route-incidents', label: `Xử lý ${message('term.incident').toLocaleLowerCase('vi')}`, route: 'incidents', group: 'MAINTAIN', requirement: 'NONE' },
    { id: 'route-builder', label: 'Tạo chế độ', route: 'builder', group: 'BUILD', requirement: 'BACKEND_RUNNING' },
    { id: 'route-settings', label: 'Cấu hình an toàn', route: 'settings', group: 'MAINTAIN', requirement: 'NONE' },
    { id: 'route-diagnostics', label: 'Chẩn đoán kỹ thuật', route: 'diagnostics', group: 'ADVANCED', requirement: 'ADVANCED_PRESENTATION' },
    { id: 'route-ai', label: 'Local AI', route: 'ai', group: 'ADVANCED', requirement: 'ADVANCED_PRESENTATION' }
]);

function search(query, { experienceLevel = 'standard', limit = 12 } = {}) {
    const needle = String(query || '').trim().toLocaleLowerCase('vi');
    return ENTRIES.filter(entry => experienceLevel === 'advanced' || entry.group !== 'ADVANCED')
        .filter(entry => {
            if (!needle) return true;
            const primary = `${entry.label} ${entry.route}`.toLocaleLowerCase('vi');
            return primary.includes(needle) || entry.group.toLocaleLowerCase('vi') === needle;
        })
        .slice(0, Math.max(1, Math.min(30, Number(limit) || 12)))
        .map(entry => ({ ...entry }));
}

module.exports = Object.freeze({ ENTRIES, search });
