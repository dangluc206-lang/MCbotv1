'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Timeout = require('../shared/time/Timeout');
const Redactor = require('../shared/security/Redactor');

class CrashMarkerStore {
    constructor({ directory, clock = () => Date.now(), repeatWindowMs = 60000 } = {}) {
        if (!directory) throw new TypeError('CrashMarkerStore directory is required.');
        this.directory = path.resolve(directory);
        this.filePath = path.join(this.directory, 'latest.json');
        this.clock = clock;
        this.repeatWindowMs = Math.max(1000, Number(repeatWindowMs) || 60000);
    }

    record(error, source) {
        const now = this.clock();
        let previous = null;
        try { previous = JSON.parse(fs.readFileSync(this.filePath, 'utf8')); } catch {}
        const repeated = previous && now - Number(previous.occurredAtMs || 0) <= this.repeatWindowMs;
        const crashCount = repeated ? Number(previous.crashCount || 0) + 1 : 1;
        const marker = Redactor.sanitize({
            contract: 'desktop-crash-marker-v1',
            source: String(source || 'desktop-fatal').slice(0, 80),
            code: error?.code || 'DESKTOP_FATAL',
            message: String(error?.message || error || 'Desktop fatal error').slice(0, 1000),
            occurredAt: new Date(now).toISOString(),
            occurredAtMs: now,
            crashCount,
            relaunchAllowed: crashCount === 1
        });
        fs.mkdirSync(this.directory, { recursive: true });
        const temp = `${this.filePath}.tmp-${process.pid}`;
        fs.writeFileSync(temp, `${JSON.stringify(marker, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(temp, this.filePath);
        return marker;
    }
}

function createDesktopFatalRecovery({ markerStore, drain, relaunch = () => {}, terminate, timeoutMs = 5000, logger = console } = {}) {
    if (!markerStore?.record || typeof drain !== 'function' || typeof terminate !== 'function') throw new TypeError('Desktop fatal recovery dependencies are required.');
    let handling = false;
    const handle = async (error, source = 'desktop-fatal') => {
        if (handling) return false;
        handling = true;
        let marker = null;
        try { marker = markerStore.record(error, source); }
        catch (markerError) { logger?.error?.('[MCbot fatal] crash marker failed.', Redactor.sanitize(markerError)); }
        try {
            await Timeout.withTimeout(Promise.resolve().then(() => drain(error, source)), timeoutMs, { message: 'Desktop fatal drain timed out.' });
        } catch (drainError) {
            logger?.error?.('[MCbot fatal] bounded drain failed.', Redactor.sanitize(drainError));
        } finally {
            try { if (marker?.relaunchAllowed) relaunch(); } catch (relaunchError) { logger?.error?.('[MCbot fatal] relaunch failed.', Redactor.sanitize(relaunchError)); }
            terminate(1);
        }
        return true;
    };
    return Object.freeze({ handle, isHandling: () => handling });
}

module.exports = Object.freeze({ CrashMarkerStore, createDesktopFatalRecovery });
