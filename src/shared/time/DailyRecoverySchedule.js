'use strict';

class DailyRecoverySchedule {
    constructor(config = {}) {
        this.enabled = config.enabled === true;
        this.timezoneOffsetMinutes = Number.isFinite(Number(config.timezoneOffsetMinutes))
            ? Number(config.timezoneOffsetMinutes)
            : 420;
        this.sky = this.#normalizeWindow(config.sky, { hour: 3, minute: 0, waitMinutes: 10, retryWindowMinutes: 20 });
        this.server = this.#normalizeWindow(config.server, { hour: 5, minute: 0, waitMinutes: 10, retryWindowMinutes: 20 });
    }

    nowParts(nowMs = Date.now()) {
        const shifted = new Date(nowMs + this.timezoneOffsetMinutes * 60_000);
        return {
            year: shifted.getUTCFullYear(),
            month: shifted.getUTCMonth() + 1,
            day: shifted.getUTCDate(),
            hour: shifted.getUTCHours(),
            minute: shifted.getUTCMinutes(),
            second: shifted.getUTCSeconds(),
            msOfDay: ((shifted.getUTCHours() * 60 + shifted.getUTCMinutes()) * 60 + shifted.getUTCSeconds()) * 1000 + shifted.getUTCMilliseconds()
        };
    }

    dateKey(nowMs = Date.now()) {
        const p = this.nowParts(nowMs);
        return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
    }

    state(kind, nowMs = Date.now()) {
        const window = kind === 'server' ? this.server : this.sky;
        if (!this.enabled || window.enabled === false) {
            return { active: false, due: false, waitMs: 0, dateKey: this.dateKey(nowMs), kind };
        }
        const p = this.nowParts(nowMs);
        const startMs = (window.hour * 60 + window.minute) * 60_000;
        const readyMs = startMs + window.waitMinutes * 60_000;
        const retryEndMs = startMs + window.retryWindowMinutes * 60_000;
        const active = p.msOfDay >= startMs && p.msOfDay < readyMs;
        const due = p.msOfDay >= startMs && p.msOfDay < retryEndMs;
        return {
            kind,
            active,
            due,
            ready: p.msOfDay >= readyMs && p.msOfDay < retryEndMs,
            waitMs: active ? Math.max(0, readyMs - p.msOfDay) : 0,
            dateKey: this.dateKey(nowMs),
            start: `${String(window.hour).padStart(2, '0')}:${String(window.minute).padStart(2, '0')}`,
            resumeAt: this.#timeLabel(readyMs),
            window
        };
    }

    reconnectDelay(nowMs = Date.now()) {
        const state = this.state('server', nowMs);
        return state.active ? state.waitMs : 0;
    }

    #normalizeWindow(raw, defaults) {
        const source = raw && typeof raw === 'object' ? raw : {};
        const hour = source.hour === undefined ? defaults.hour : Number(source.hour);
        const minute = source.minute === undefined ? defaults.minute : Number(source.minute);
        const waitMinutes = source.waitMinutes === undefined ? defaults.waitMinutes : Number(source.waitMinutes);
        const retryWindowMinutes = source.retryWindowMinutes === undefined
            ? defaults.retryWindowMinutes
            : Number(source.retryWindowMinutes);
        if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new TypeError('dailyRecovery hour must be 0..23');
        if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw new TypeError('dailyRecovery minute must be 0..59');
        if (!Number.isFinite(waitMinutes) || waitMinutes < 0) throw new TypeError('dailyRecovery waitMinutes must be non-negative');
        if (!Number.isFinite(retryWindowMinutes) || retryWindowMinutes < waitMinutes) {
            throw new TypeError('dailyRecovery retryWindowMinutes must be >= waitMinutes');
        }
        return Object.freeze({
            enabled: source.enabled !== false,
            hour,
            minute,
            waitMinutes,
            retryWindowMinutes
        });
    }

    #timeLabel(msOfDay) {
        const totalMinutes = Math.floor(msOfDay / 60_000) % (24 * 60);
        const hour = Math.floor(totalMinutes / 60);
        const minute = totalMinutes % 60;
        return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
}

module.exports = DailyRecoverySchedule;
