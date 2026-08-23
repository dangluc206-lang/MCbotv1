'use strict';

class DiscordPanelFormatter {
    constructor({ botId }) {
        this.botId = botId;
    }

    recoveryAdvice({ online, collectorMode, fishingMode, gui }) {
        if (!online) return '`Bot offline → Join Server.`';
        const active = fishingMode.enabled ? fishingMode : collectorMode.enabled ? collectorMode : null;
        if (active?.lastError || active?.phase === 'ERROR' || active?.phase === 'WAITING_RETRY') {
            if (gui?.windowId !== null && gui?.windowId !== undefined) {
                return '`Reset thao tác → Restart mode. Không cần thoát bot.`';
            }
            return '`Restart mode để hủy state cũ và bật lại từ đầu. Không reconnect.`';
        }
        if (active?.paused) return '`Chạy tiếp; nếu state vẫn sai thì Restart mode.`';
        if (gui?.windowId !== null && gui?.windowId !== undefined && !active) return '`Có GUI đang mở; Reset thao tác để đóng sạch.`';
        if (active) return '`Mode đang chạy. Tạm dừng để can thiệp; Restart mode nếu hành vi sai.`';
        return '`Không có mode đang chạy; chọn mode cần bật.`';
    }

    operationStatusText(snapshot) {
        if (!snapshot) return '`active=0 | pending=0`';
        return `\`active=${Number(snapshot.active || 0)} | pending=${Number(snapshot.pending || 0)}\``;
    }

    itemText(item) {
        if (!item) return '`Trống`';
        const raw = item.displayName || item.name || 'item';
        const name = String(raw).replace(/§[0-9A-FK-OR]/gi, '').trim() || item.name || 'item';
        const count = Number(item.count || 1);
        return `\`${name}${count > 1 ? ` x${count}` : ''}\``;
    }

    simpleB5ProgressText(status) {
        if (!status?.enabled) return '`Chưa chạy`';
        if (status.paused) return '`Tạm dừng`';
        if (status.lastError) return '`Đang thử lại sau lỗi`';
        const remaining = Number(status.remainingSteps);
        if (Number.isFinite(remaining)) return `Còn **${Math.max(0, Math.floor(remaining))} bước**`;
        return '`Đang tính...`';
    }

    fishingAreasText(areas) {
        if (!Array.isArray(areas) || areas.length === 0) return '`Đang đọc /afk...`';
        return areas.map(area => {
            const occupancy = area?.known ? `${area.current}/${area.capacity}` : '?/?';
            const state = area?.full === true ? 'đầy' : area?.full === false ? 'còn chỗ' : 'chưa rõ';
            return `Slot ${area.menuSlot}: **${occupancy}** (${state})`;
        }).join('\n');
    }

    positionText(position) {
        if (!position) return '-';
        return `${this.number(position.x)}, ${this.number(position.y)}, ${this.number(position.z)}`;
    }

    number(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return '-';
        return Number.isInteger(number) ? String(number) : String(Math.round(number * 10) / 10);
    }

    marker(kind) {
        return `mcbot-${kind}-panel:${this.botId}`;
    }

    positive(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : fallback;
    }
}

module.exports = DiscordPanelFormatter;
