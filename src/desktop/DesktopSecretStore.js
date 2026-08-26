'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_SECRET_FILE_BYTES = 256 * 1024;
const MAX_SECRET_ENTRIES = 256;
const MAX_ENCRYPTED_VALUE_CHARS = 64 * 1024;

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
        const inspected = this.#inspectRaw();
        const encryptionAvailable = Boolean(this.safeStorage.isEncryptionAvailable?.());
        const keys = Object.keys(inspected.data || {}).sort();
        let state = inspected.state;
        let failedKeys = [];
        if (!encryptionAvailable) state = 'UNAVAILABLE';
        else if (state === 'OK' && keys.length > 0) {
            failedKeys = keys.filter(key => !this.#decrypt(inspected.data[key]).success);
            if (failedKeys.length > 0) state = 'DECRYPT_FAILED';
        }
        if (state === 'OK' && keys.length === 0) state = 'NOT_CONFIGURED';
        const remediation = {
            NOT_CONFIGURED: 'Nhập dữ liệu bí mật cần dùng rồi lưu.',
            UNAVAILABLE: 'Hệ điều hành chưa cung cấp mã hóa an toàn; không thể lưu hoặc đọc secret.',
            CORRUPT: 'Tệp secret bị hỏng hoặc không an toàn. Xác nhận reset riêng secret store rồi nhập lại.',
            DECRYPT_FAILED: 'Một số secret không giải mã được trên phiên hệ điều hành này. Xác nhận reset rồi nhập lại.',
            OK: null
        }[state];
        return Object.freeze({
            contract: 'desktop-secret-state-v1',
            state,
            encryptionAvailable,
            keys,
            failedKeys,
            code: inspected.code,
            remediation,
            recovery: ['CORRUPT', 'DECRYPT_FAILED'].includes(state)
                ? { action: 'reset-secret-store', confirmation: 'DESTRUCTIVE', affects: 'SECRETS_ONLY' }
                : null
        });
    }

    get(key) {
        const inspected = this.#inspectRaw();
        if (inspected.state === 'CORRUPT') return '';
        const raw = inspected.data[key];
        if (!raw) return '';
        if (!this.safeStorage.isEncryptionAvailable?.()) return '';
        const decrypted = this.#decrypt(raw);
        return decrypted.success ? decrypted.value : '';
    }

    set(key, value) {
        const normalizedKey = String(key || '').trim();
        if (!normalizedKey) throw new TypeError('secret key is required');
        if (!isAllowedKey(normalizedKey)) throw new Error(`Unsupported desktop secret key: ${normalizedKey}`);
        if (!this.safeStorage.isEncryptionAvailable?.()) throw new Error('OS secret encryption is not available.');
        const inspected = this.#inspectRaw();
        if (inspected.state === 'CORRUPT') throw Object.assign(new Error('Desktop secret store is corrupt; reset is required before writing.'), { code: 'SECRET_STORE_CORRUPT' });
        const data = inspected.data;
        const text = String(value || '');
        if (!text) delete data[normalizedKey];
        else data[normalizedKey] = this.safeStorage.encryptString(text).toString('base64');
        this.#writeRaw(data);
        return { key: normalizedKey, configured: Boolean(text) };
    }

    clear(key) {
        return this.set(key, '');
    }

    reset() {
        let removed = false;
        try {
            fs.unlinkSync(this.filePath);
            removed = true;
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }
        return { removed, state: this.status() };
    }

    environment(base = process.env) {
        const result = { ...base };
        const inspected = this.#inspectRaw();
        if (inspected.state === 'CORRUPT' || !this.safeStorage.isEncryptionAvailable?.()) return result;
        for (const [key, raw] of Object.entries(inspected.data)) {
            const decrypted = this.#decrypt(raw);
            if (decrypted.success && decrypted.value) result[key] = decrypted.value;
        }
        return result;
    }

    #inspectRaw() {
        try {
            if (!fs.existsSync(this.filePath)) return { state: 'NOT_CONFIGURED', code: null, data: {} };
            const stat = fs.lstatSync(this.filePath);
            if (!stat.isFile() || stat.isSymbolicLink()) return { state: 'CORRUPT', code: 'SECRET_STORE_UNSAFE_FILE', data: {} };
            if (stat.size > MAX_SECRET_FILE_BYTES) return { state: 'CORRUPT', code: 'SECRET_STORE_TOO_LARGE', data: {} };
            const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { state: 'CORRUPT', code: 'SECRET_STORE_INVALID_SHAPE', data: {} };
            const keys = Object.keys(parsed);
            if (keys.length > MAX_SECRET_ENTRIES) return { state: 'CORRUPT', code: 'SECRET_STORE_ENTRY_LIMIT', data: {} };
            if (keys.some(key => !isAllowedKey(key) || typeof parsed[key] !== 'string' || parsed[key].length > MAX_ENCRYPTED_VALUE_CHARS)) {
                return { state: 'CORRUPT', code: 'SECRET_STORE_INVALID_ENTRY', data: {} };
            }
            return { state: keys.length ? 'OK' : 'NOT_CONFIGURED', code: null, data: parsed };
        } catch (error) {
            return { state: 'CORRUPT', code: error?.code === 'ENOENT' ? null : 'SECRET_STORE_CORRUPT', data: {} };
        }
    }

    #decrypt(raw) {
        try { return { success: true, value: this.safeStorage.decryptString(Buffer.from(raw, 'base64')) }; }
        catch { return { success: false, value: '' }; }
    }

    #writeRaw(data) {
        const keys = Object.keys(data || {});
        if (keys.length > MAX_SECRET_ENTRIES) throw Object.assign(new Error('Desktop secret entry limit exceeded.'), { code: 'SECRET_STORE_ENTRY_LIMIT' });
        if (keys.some(key => !isAllowedKey(key) || typeof data[key] !== 'string' || data[key].length > MAX_ENCRYPTED_VALUE_CHARS)) {
            throw Object.assign(new Error('Desktop secret entry is invalid or too large.'), { code: 'SECRET_STORE_INVALID_ENTRY' });
        }
        const serialized = JSON.stringify(data, null, 2);
        if (Buffer.byteLength(serialized) > MAX_SECRET_FILE_BYTES) throw Object.assign(new Error('Desktop secret store size limit exceeded.'), { code: 'SECRET_STORE_TOO_LARGE' });
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        const temp = `${this.filePath}.tmp-${process.pid}-${randomUUID()}`;
        try {
            fs.writeFileSync(temp, serialized, { mode: 0o600 });
            fs.renameSync(temp, this.filePath);
        } catch (error) {
            try { fs.unlinkSync(temp); } catch (cleanupError) { if (cleanupError?.code !== 'ENOENT') error.cleanupError = cleanupError; }
            throw error;
        }
    }
}

module.exports = DesktopSecretStore;
module.exports.MAX_SECRET_FILE_BYTES = MAX_SECRET_FILE_BYTES;
module.exports.MAX_SECRET_ENTRIES = MAX_SECRET_ENTRIES;
