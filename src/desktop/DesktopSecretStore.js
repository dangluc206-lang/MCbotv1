'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FIXED_KEYS = new Set([
    'DISCORD_TOKEN',
    'DISCORD_APPLICATION_ID',
    'DISCORD_GUILD_ID',
    'DISCORD_ALLOWED_USER_IDS',
    'DISCORD_CONTROL_CHANNEL_ID',
    'DISCORD_CONFIG_CHANNEL_ID',
    'DISCORD_ERRORS_CHANNEL_ID'
]);

function isAllowedKey(key) {
    return FIXED_KEYS.has(key) || /^MCBOT_[A-Z0-9_]+_(?:PASSWORD|TOKEN|SECRET)$/.test(key);
}

class DesktopSecretStore {
    constructor({ filePath, safeStorage }) {
        if (!filePath || !safeStorage) throw new TypeError('filePath and safeStorage are required');
        this.filePath = filePath;
        this.safeStorage = safeStorage;
    }

    status() {
        const data = this.#readRaw();
        return {
            encryptionAvailable: Boolean(this.safeStorage.isEncryptionAvailable?.()),
            keys: Object.keys(data).sort()
        };
    }

    get(key) {
        const raw = this.#readRaw()[key];
        if (!raw) return '';
        if (!this.safeStorage.isEncryptionAvailable?.()) return '';
        try {
            return this.safeStorage.decryptString(Buffer.from(raw, 'base64'));
        } catch {
            return '';
        }
    }

    set(key, value) {
        const normalizedKey = String(key || '').trim();
        if (!normalizedKey) throw new TypeError('secret key is required');
        if (!isAllowedKey(normalizedKey)) throw new Error(`Unsupported desktop secret key: ${normalizedKey}`);
        if (!this.safeStorage.isEncryptionAvailable?.()) throw new Error('OS secret encryption is not available.');
        const data = this.#readRaw();
        const text = String(value || '');
        if (!text) delete data[normalizedKey];
        else data[normalizedKey] = this.safeStorage.encryptString(text).toString('base64');
        this.#writeRaw(data);
        return { key: normalizedKey, configured: Boolean(text) };
    }

    clear(key) {
        return this.set(key, '');
    }

    environment(base = process.env) {
        const result = { ...base };
        for (const key of this.status().keys) {
            const value = this.get(key);
            if (value) result[key] = value;
        }
        return result;
    }

    #readRaw() {
        try {
            if (!fs.existsSync(this.filePath)) return {};
            const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }

    #writeRaw(data) {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        const temp = `${this.filePath}.tmp-${process.pid}`;
        fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
        fs.renameSync(temp, this.filePath);
    }
}

module.exports = DesktopSecretStore;
