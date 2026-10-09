'use strict';

const IMPORTANT_INFO = Object.freeze([
    /^MCbot Desktop backend (started|stopped)\.$/,
    /^Connecting Minecraft bot\.$/,
    /^Minecraft bot spawned\.$/,
    /^Minecraft login completed\.$/,
    /^Minecraft reconnect succeeded\.$/,
    /^Pending reconnect cancelled\.$/,
    /^Automatic reconnect (suspended|resumed)\.$/,
    /^Skyblock auto join (attempting \/sky|succeeded)\.$/,
    /^CRAFT REQUEST (SET|CLEARED)\.$/,
    /^CRAFT (START|PROGRESS|INPUT READY|QUANTITY DECISION|FINAL START|DEPOSIT SUCCESS|CRAFT SUCCESS|OK)$/,
    /^KHO HIGH-WATER PROTECTION ACTIVE\.$/
]);

const ALWAYS_HIDE = Object.freeze([
    /^STEP (START|OK|RETRY|FAIL)$/,
    /^GUI (OPEN|CLOSE|ACTION START|ACTION OK|CLICK START|CLICK OK)$/,
    /^PV (OPEN|READ|TRANSFER|WITHDRAW|DEPOSIT)/,
    /^KHO (READ|OPEN|COMMAND|GUI VERIFIED|FORCE REOPEN)/,
    /^CRAFT (START|SNAPSHOT|OPEN|ENTRY|ENTER|MENU|LEARN|RECIPE|BIND|QUANTITY|PRE-CLICK|CLICK|POST-CLICK|VERIFY|OK)/,
]);

const SIGNATURE_KEYS = Object.freeze([
    'botId', 'code', 'status', 'reason', 'phase', 'operation', 'step',
    'resource', 'recipeId', 'targetId', 'selectionId', 'failureClass', 'waitingReason'
]);

class DesktopLogPolicy {
    constructor({ repeatWindowMs = 15000, maxBuckets = 512, clock = Date.now } = {}) {
        if (!Number.isFinite(repeatWindowMs) || repeatWindowMs < 0) throw new TypeError('repeatWindowMs must be non-negative.');
        if (!Number.isInteger(maxBuckets) || maxBuckets < 1) throw new TypeError('maxBuckets must be a positive integer.');
        if (typeof clock !== 'function') throw new TypeError('clock must be a function.');
        this.repeatWindowMs = Number(repeatWindowMs);
        this.maxBuckets = maxBuckets;
        this.clock = clock;
        this.buckets = new Map();
    }

    project(record) {
        if (!record || typeof record !== 'object') return null;
        if (!this.#visible(record)) return null;
        const now = this.clock();
        const signature = this.#signature(record);
        const existing = this.buckets.get(signature);
        if (existing && now - existing.lastAt <= this.repeatWindowMs) {
            existing.count += 1;
            existing.lastAt = now;
            return null;
        }

        let projected = this.#decorate(record);
        if (existing?.count > 0) {
            projected = {
                ...projected,
                repeatCount: existing.count,
                meta: {
                    ...(record.meta || {}),
                    repeatCount: existing.count,
                    repeatWindowMs: Math.max(0, existing.lastAt - existing.firstAt)
                }
            };
        }
        this.buckets.set(signature, { count: 0, firstAt: now, lastAt: now });
        this.#trim();
        return projected;
    }

    reset() {
        this.buckets.clear();
    }

    #visible(record) {
        const level = String(record.level || 'info').toLowerCase();
        const message = String(record.message || '');
        if (level === 'error' || level === 'warn') return true;
        if (level === 'debug') return false;
        if (ALWAYS_HIDE.some(pattern => pattern.test(message))) return false;
        return IMPORTANT_INFO.some(pattern => pattern.test(message));
    }

    #decorate(record) {
        const meta = record.meta && typeof record.meta === 'object' ? record.meta : {};
        const translations = {
            'Connecting Minecraft bot.': 'Đang kết nối Minecraft.',
            'Minecraft bot spawned.': 'Bot đã vào server.',
            'Minecraft login completed.': 'Đăng nhập Minecraft hoàn tất.',
            'Minecraft reconnect succeeded.': 'Kết nối lại Minecraft thành công.',
            'Pending reconnect cancelled.': 'Đã hủy lần kết nối lại đang chờ.',
            'Automatic reconnect suspended.': 'Đã tắt tự kết nối lại cho bot.',
            'Automatic reconnect resumed.': 'Đã bật lại tự kết nối cho bot.',
            'Skyblock auto join succeeded.': 'Tự động vào Skyblock thành công.'
        };
        let message = translations[record.message] || record.message;
        if (String(record.message || '').startsWith('CRAFT REQUEST SET.') && meta.targetId) {
            const quantity = meta.quantityMode === 'ALL' ? 'ALL' : (meta.quantity ?? '');
            message = `Đã nhận yêu cầu chế${quantity !== '' ? ` ${quantity} ×` : ''} ${meta.targetId}.`;
        }
        return message === record.message ? record : { ...record, message };
    }

    #signature(record) {
        const meta = record.meta && typeof record.meta === 'object' ? record.meta : {};
        const stableParts = SIGNATURE_KEYS
            .filter(key => meta[key] !== undefined && meta[key] !== null && meta[key] !== '')
            .map(key => `${key}=${String(meta[key])}`);
        const blocker = meta.blocker && typeof meta.blocker === 'object' ? meta.blocker : null;
        if (blocker) {
            if (blocker.reason || blocker.status) stableParts.push(`blocker=${String(blocker.reason || blocker.status)}`);
            if (blocker.baseId || blocker.resource || blocker.targetId) stableParts.push(`blockerResource=${String(blocker.baseId || blocker.resource || blocker.targetId)}`);
        }
        return `${String(record.level || '')}|${String(record.scope || '')}|${String(record.message || '')}|${stableParts.join('|')}`;
    }

    #trim() {
        if (this.buckets.size <= this.maxBuckets) return;
        const entries = [...this.buckets.entries()].sort((a, b) => a[1].lastAt - b[1].lastAt);
        for (let i = 0; i < this.buckets.size - this.maxBuckets; i += 1) this.buckets.delete(entries[i][0]);
    }
}

module.exports = DesktopLogPolicy;
