'use strict';

const { createHash } = require('node:crypto');
const Redactor = require('../../shared/security/Redactor');

const CONTRACT = 'support-bundle';
const VERSION = 2;
const PROTECTED = /(^|\/)(?:\.[^/]+(?:\/|$)|data(?:\/|$)|node_modules(?:\/|$)|config\/bots(?:\/|$))/i;
const ALLOWED = Object.freeze([
    /^RELEASE_NOTES\.txt$/,
    /^architecture\/(?:baseline|error-vocabulary|slo)\/current\.json$/,
    /^evidence\/(?:runtime-failure|health|mode-status|platform-snapshot|log-summary|trace|replay)-[a-z0-9._-]+\.json$/i
]);
const PSEUDONYM_KEYS = /^(?:botId|username|displayName|profileId)$/i;

function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) freeze(child);
    return Object.freeze(value);
}

function digest(value) {
    return createHash('sha256').update(value).digest('hex');
}

function normalizePath(value) {
    const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized || normalized.includes('..') || normalized.startsWith('/') || PROTECTED.test(normalized) || !ALLOWED.some(pattern => pattern.test(normalized))) {
        throw Object.assign(new Error(`Support bundle path is not allowlisted: ${normalized || '<empty>'}`), {
            code: 'SUPPORT_BUNDLE_PATH_BLOCKED', path: normalized
        });
    }
    return normalized;
}

function pseudonym(value, salt, prefix) {
    return `${prefix}-${digest(`${salt}:${String(value)}`).slice(0, 12)}`;
}

function pseudonymize(value, salt, seen = new WeakSet()) {
    if (value === null || value === undefined || typeof value !== 'object') return value;
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    try {
        if (Array.isArray(value)) return value.map(child => pseudonymize(child, salt, seen));
        const output = {};
        const profileLike = Object.prototype.hasOwnProperty.call(value, 'username') || Object.prototype.hasOwnProperty.call(value, 'auth');
        for (const [key, child] of Object.entries(value)) {
            if (typeof child === 'string' && (PSEUDONYM_KEYS.test(key) || (key === 'id' && profileLike))) {
                output[key] = pseudonym(child, salt, /user|display/i.test(key) ? 'user' : 'bot');
            } else {
                output[key] = pseudonymize(child, salt, seen);
            }
        }
        return output;
    } finally {
        // Track only the current recursion ancestry. A shared object referenced
        // by two independent branches is not a cycle and must retain its data.
        seen.delete(value);
    }
}

function categoryFor(filePath) {
    const match = /^evidence\/([a-z-]+)-/i.exec(filePath);
    return match ? match[1] : filePath.startsWith('architecture/') ? 'architecture' : 'release-notes';
}

class SupportBundleBuilder {
    constructor({ maxEntries = 32, maxEntryBytes = 256 * 1024, maxTotalBytes = 1024 * 1024, maxBuildMs = 5000, clock = () => Date.now() } = {}) {
        this.maxEntries = Math.max(1, Math.min(128, Number(maxEntries) || 32));
        this.maxEntryBytes = Math.max(256, Number(maxEntryBytes) || 256 * 1024);
        this.maxTotalBytes = Math.max(this.maxEntryBytes, Number(maxTotalBytes) || 1024 * 1024);
        this.maxBuildMs = Math.max(50, Number(maxBuildMs) || 5000);
        this.clock = clock;
    }

    build({ botId = null, incidentId = null, entries = [], warnings = [], createdAt = null, pseudonymSalt = 'local-support-bundle', cancellationToken = null } = {}) {
        if (!Array.isArray(entries)) throw new TypeError('Support bundle entries must be an array.');
        if (entries.length > this.maxEntries) throw Object.assign(new RangeError('Support bundle entry limit exceeded.'), { code: 'SUPPORT_BUNDLE_ENTRY_LIMIT' });
        const startedAt = this.clock();
        const files = [];
        const manifestWarnings = (Array.isArray(warnings) ? warnings : []).map(value => Redactor.sanitize(value));
        let totalBytes = 0;

        for (const entry of [...entries].sort((left, right) => String(left?.path || '').localeCompare(String(right?.path || '')))) {
            cancellationToken?.throwIfCancelled?.();
            if (this.clock() - startedAt > this.maxBuildMs) throw Object.assign(new Error('Support bundle build timed out.'), { code: 'SUPPORT_BUNDLE_TIMEOUT' });
            const filePath = normalizePath(entry?.path);
            try {
                const sanitized = Redactor.sanitize(entry.value ?? entry.content ?? null);
                const privateValue = pseudonymize(sanitized, pseudonymSalt);
                const serialized = typeof privateValue === 'string' ? Redactor.redactText(privateValue) : JSON.stringify(privateValue, null, 2);
                const content = Redactor.redactText(serialized);
                const bytes = Buffer.byteLength(content);
                if (bytes > this.maxEntryBytes) throw Object.assign(new RangeError(`Support bundle entry too large: ${filePath}`), { code: 'SUPPORT_BUNDLE_ENTRY_TOO_LARGE', path: filePath, bytes });
                if (totalBytes + bytes > this.maxTotalBytes) throw Object.assign(new RangeError('Support bundle total size limit exceeded.'), { code: 'SUPPORT_BUNDLE_TOTAL_TOO_LARGE', bytes: totalBytes + bytes });
                totalBytes += bytes;
                files.push(Object.freeze({ path: filePath, category: entry.category || categoryFor(filePath), piiLevel: 'PSEUDONYMIZED', bytes, sha256: digest(content), content }));
            } catch (error) {
                if (entry?.optional !== true) throw error;
                manifestWarnings.push(Redactor.sanitize({ code: error.code || 'SUPPORT_BUNDLE_OPTIONAL_ENTRY_SKIPPED', path: filePath, message: error.message }));
            }
        }

        const manifest = {
            contract: CONTRACT,
            version: VERSION,
            createdAt: createdAt || new Date().toISOString(),
            botId: botId == null ? null : pseudonym(botId, pseudonymSalt, 'bot'),
            incidentId: incidentId == null ? null : String(incidentId),
            privacy: { default: 'PSEUDONYMIZED', rawIdentityIncluded: false, remoteTelemetry: false },
            entryCount: files.length,
            totalBytes,
            warnings: manifestWarnings,
            files: files.map(({ path, category, piiLevel, bytes, sha256 }) => ({ path, category, piiLevel, bytes, sha256 }))
        };
        const manifestHash = digest(JSON.stringify(manifest));
        return freeze({ ...manifest, manifestHash, files });
    }

    preview(input = {}) {
        return this.previewBundle(this.build(input));
    }

    previewBundle(bundle) {
        const validation = SupportBundleBuilder.validate(bundle);
        if (!validation.valid) throw Object.assign(new Error('Cannot preview an invalid support bundle.'), {
            code: 'SUPPORT_BUNDLE_INVALID', errors: validation.errors
        });
        return freeze({
            contract: bundle.contract,
            version: bundle.version,
            createdAt: bundle.createdAt,
            privacy: bundle.privacy,
            entryCount: bundle.entryCount,
            totalBytes: bundle.totalBytes,
            warnings: bundle.warnings,
            files: bundle.files.map(({ path, category, piiLevel, bytes, sha256 }) => ({ path, category, piiLevel, bytes, sha256 })),
            manifestHash: bundle.manifestHash
        });
    }

    static validate(bundle) {
        const errors = [];
        if (!bundle || bundle.contract !== CONTRACT || bundle.version !== VERSION) errors.push('contract/version');
        if (!Array.isArray(bundle?.files)) errors.push('files');
        if (!Number.isInteger(bundle?.entryCount) || bundle.entryCount !== (bundle?.files || []).length) errors.push('entryCount');
        let totalBytes = 0;
        for (const file of bundle?.files || []) {
            try { normalizePath(file.path); } catch { errors.push(`path:${file.path}`); }
            const content = String(file.content ?? '');
            const bytes = Buffer.byteLength(content);
            totalBytes += bytes;
            if (bytes !== file.bytes) errors.push(`bytes:${file.path}`);
            if (digest(content) !== file.sha256) errors.push(`sha256:${file.path}`);
        }
        if (Number(bundle?.totalBytes) !== totalBytes) errors.push('totalBytes');
        const manifest = {
            contract: bundle?.contract, version: bundle?.version, createdAt: bundle?.createdAt,
            botId: bundle?.botId ?? null, incidentId: bundle?.incidentId ?? null,
            privacy: bundle?.privacy, entryCount: bundle?.entryCount, totalBytes: bundle?.totalBytes,
            warnings: bundle?.warnings,
            files: (bundle?.files || []).map(({ path, category, piiLevel, bytes, sha256 }) => ({ path, category, piiLevel, bytes, sha256 }))
        };
        if (digest(JSON.stringify(manifest)) !== bundle?.manifestHash) errors.push('manifestHash');
        return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
    }
}

SupportBundleBuilder.CONTRACT = CONTRACT;
SupportBundleBuilder.VERSION = VERSION;
SupportBundleBuilder.PROTECTED = PROTECTED;
module.exports = SupportBundleBuilder;
