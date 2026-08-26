'use strict';

const CONTRACT = 'operator-health-v1';
const STATUS_RANK = Object.freeze({ NOT_APPLICABLE: 0, HEALTHY: 1, UNKNOWN: 2, DEGRADED: 3, UNHEALTHY: 4 });

function probe(id, status, summary, { botId = null, evidenceRef = null, remediation = null, ageMs = null } = {}) {
    return Object.freeze({ id, botId, status, summary, evidenceRef, remediation, ageMs });
}

class OperatorHealthService {
    constructor({ snapshotProvider, timeoutMs = 250, cacheTtlMs = 1000, now = Date.now } = {}) {
        if (typeof snapshotProvider !== 'function') throw new TypeError('OperatorHealthService snapshotProvider is required.');
        this.snapshotProvider = snapshotProvider;
        this.timeoutMs = Math.max(25, Math.min(5000, Number(timeoutMs) || 250));
        this.cacheTtlMs = Math.max(0, Math.min(30000, Number(cacheTtlMs) || 1000));
        this.now = now;
        this.cache = null;
        this.inFlight = null;
    }

    sample({ force = false } = {}) {
        const age = this.cache ? this.now() - this.cache.sampledAtMs : Infinity;
        if (!force && this.cache && age <= this.cacheTtlMs) return Promise.resolve(this.#withAge(this.cache.value, age, true));
        if (this.inFlight) return this.inFlight;
        this.inFlight = this.#sampleBounded().then(value => {
            this.cache = { value, sampledAtMs: this.now() };
            return value;
        }).finally(() => { this.inFlight = null; });
        return this.inFlight;
    }

    async #sampleBounded() {
        let timer;
        const timeout = new Promise(resolve => {
            timer = setTimeout(() => resolve({ timedOut: true }), this.timeoutMs);
            timer.unref?.();
        });
        try {
            const result = await Promise.race([Promise.resolve().then(() => this.snapshotProvider()).then(snapshot => ({ snapshot })), timeout]);
            if (result.timedOut) return this.#aggregate([probe('sampler', 'UNKNOWN', 'Health sampler đã hết thời gian chờ.', { remediation: 'Mở Chẩn đoán để kiểm tra backend bị nghẽn.' })], true);
            return this.#project(result.snapshot || {});
        } catch (error) {
            return this.#aggregate([probe('sampler', 'UNKNOWN', 'Không lấy được trạng thái health.', { remediation: error?.message || String(error) })], false);
        } finally { clearTimeout(timer); }
    }

    #project(snapshot) {
        if (snapshot.lifecycle !== 'RUNNING') {
            const state = snapshot.lifecycle === 'FAILED' ? 'UNHEALTHY' : 'UNKNOWN';
            return this.#aggregate([probe('backend', state, `Backend ${snapshot.lifecycle || 'UNKNOWN'}.`, { remediation: snapshot.lifecycle === 'FAILED' ? 'Mở Incident Center và xử lý boot failure.' : 'Khởi động backend khi sẵn sàng.' })], false);
        }
        const probes = [probe('backend', 'HEALTHY', 'Backend đang chạy.')];
        if (snapshot.system?.logPersistenceFailure) probes.push(probe('failure-recorder', 'UNHEALTHY', 'Ghi log chẩn đoán đang lỗi.', { evidenceRef: 'system.logPersistenceFailure', remediation: 'Kiểm tra quyền ghi và dung lượng ổ đĩa.' }));
        else probes.push(probe('failure-recorder', 'HEALTHY', 'Không ghi nhận lỗi persistence chẩn đoán.'));
        for (const bot of snapshot.bots || []) this.#botProbes(bot, probes);
        if (!(snapshot.bots || []).length) probes.push(probe('fleet', 'NOT_APPLICABLE', 'Chưa có bot để đánh giá.'));
        return this.#aggregate(probes, false);
    }

    #botProbes(bot, probes) {
        const botId = bot.botId || null;
        const connection = String(bot.state?.connectionState || 'UNKNOWN').toUpperCase();
        const intentionallyDisconnected = bot.intent?.desiredConnection === 'DISCONNECTED' || bot.profile?.enabled === false;
        if (intentionallyDisconnected) probes.push(probe('reconnect', 'NOT_APPLICABLE', 'Bot đang ngắt có chủ đích.', { botId }));
        else if (connection === 'CONNECTED') probes.push(probe('reconnect', 'HEALTHY', 'Bot đã kết nối.', { botId }));
        else if (['CONNECTING', 'RECONNECTING'].includes(connection)) probes.push(probe('reconnect', 'DEGRADED', 'Bot đang kết nối lại.', { botId, evidenceRef: 'state.connectionState' }));
        else probes.push(probe('reconnect', 'UNHEALTHY', 'Bot cần kết nối nhưng hiện không kết nối.', { botId, evidenceRef: 'state.connectionState', remediation: 'Kiểm tra incident kết nối và dùng action được cho phép.' }));

        const mode = bot.modes?.b5Craft;
        if (!bot.modeOwner) probes.push(probe('mode-progress', 'NOT_APPLICABLE', 'Không có mode đang chạy.', { botId }));
        else if (mode?.details?.fault?.state === 'OPEN') probes.push(probe('mode-progress', 'UNHEALTHY', 'Circuit của mode B5 đang mở.', { botId, evidenceRef: 'modes.b5Craft.details.fault', remediation: 'Xử lý incident trước khi retry có guard.' }));
        else if (mode?.details?.waitingReason) probes.push(probe('mode-progress', 'DEGRADED', `Mode đang chờ: ${mode.details.waitingReason}.`, { botId, evidenceRef: 'modes.b5Craft.details.waitingReason' }));
        else probes.push(probe('mode-progress', 'HEALTHY', 'Mode đang tiến triển hoặc sẵn sàng.', { botId }));

        const operations = bot.operation?.operations || [];
        const oldest = operations.reduce((max, item) => Math.max(max, Number(item.ageMs || 0)), 0);
        probes.push(probe('operation-queue', oldest > 30000 ? 'DEGRADED' : 'HEALTHY', oldest > 30000 ? 'Operation đã chờ quá 30 giây.' : 'Operation queue trong giới hạn.', { botId, ageMs: oldest, evidenceRef: oldest ? 'operation.operations' : null }));
        const guiAge = Number(bot.gui?.ageMs || 0);
        probes.push(probe('gui-session', guiAge > 30000 ? 'DEGRADED' : bot.gui ? 'HEALTHY' : 'NOT_APPLICABLE', guiAge > 30000 ? 'GUI session tồn tại quá lâu.' : bot.gui ? 'GUI session trong giới hạn.' : 'Không có GUI session.', { botId, ageMs: guiAge, evidenceRef: guiAge ? 'gui' : null }));
        const episode = mode?.details?.protectionEpisode;
        if (!episode) probes.push(probe('b5-blocker-dwell', 'NOT_APPLICABLE', 'Không có storage-protection episode.', { botId }));
        else {
            const dwell = Math.max(0, this.now() - Date.parse(episode.lastAttemptAt || episode.startedAt || new Date(this.now()).toISOString()));
            const blocked = episode.state === 'WAITING_BLOCKED';
            probes.push(probe('b5-blocker-dwell', blocked && dwell > 60000 ? 'UNHEALTHY' : blocked ? 'DEGRADED' : 'HEALTHY', blocked ? 'Bảo vệ kho đang dừng an toàn chờ điều kiện.' : 'Bảo vệ kho đang tiến triển.', { botId, ageMs: dwell, evidenceRef: 'modes.b5Craft.details.protectionEpisode', remediation: blocked ? 'Chỉ dùng action retry được DTO cho phép.' : null }));
        }
    }

    #aggregate(probes, timedOut) {
        const applicable = probes.filter(entry => entry.status !== 'NOT_APPLICABLE');
        const overall = applicable.reduce((worst, entry) => STATUS_RANK[entry.status] > STATUS_RANK[worst] ? entry.status : worst, 'HEALTHY');
        return Object.freeze({ contract: CONTRACT, overall, timedOut, stale: false, ageMs: 0, probes: Object.freeze(probes), sampledAt: new Date(this.now()).toISOString() });
    }

    #withAge(value, ageMs, cached) {
        return Object.freeze({ ...value, cached, stale: ageMs > this.cacheTtlMs * 2, ageMs: Math.max(0, ageMs) });
    }
}

OperatorHealthService.CONTRACT = CONTRACT;
OperatorHealthService.STATUS_RANK = STATUS_RANK;
module.exports = OperatorHealthService;
