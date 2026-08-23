'use strict';

const crypto = require('node:crypto');

const CONTRACT = 'decision-replay-envelope';
const VERSION = 1;
const SENSITIVE = /(?:password|passwd|token|secret|authorization|cookie|session|api[-_]?key|credential)/i;

function canonical(value, path = '$') {
    if (value === undefined) return null;
    if (value === null || ['string','boolean'].includes(typeof value)) return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError(`Replay envelope contains non-finite number at ${path}.`);
        return value;
    }
    if (Array.isArray(value)) return value.map((item,index) => canonical(item, `${path}[${index}]`));
    if (typeof value !== 'object' || value instanceof Date || Buffer.isBuffer(value)) {
        throw new TypeError(`Replay envelope contains unsupported runtime value at ${path}.`);
    }
    const out = {};
    for (const key of Object.keys(value).sort()) {
        out[key] = SENSITIVE.test(key) ? '[REDACTED]' : canonical(value[key], `${path}.${key}`);
    }
    return out;
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function sha(value) {
    return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function ref(value, label) {
    if (!value || typeof value !== 'object') throw new TypeError(`${label} reference is required.`);
    const id = String(value.id || '').trim();
    const revision = String(value.revision || '').trim();
    if (!id || !revision) throw new TypeError(`${label} id/revision are required.`);
    return { id, revision };
}

class DecisionReplayEnvelope {
    static create({ domain, input, decision, result = null, profile, policy, metadata = {} } = {}) {
        const normalizedDomain = String(domain || '').trim();
        if (!normalizedDomain) throw new TypeError('Replay envelope domain is required.');
        const core = canonical({
            contract: CONTRACT,
            version: VERSION,
            domain: normalizedDomain,
            profile: ref(profile, 'profile'),
            policy: ref(policy, 'policy'),
            input: input ?? null,
            decision: decision ?? null
        });
        const envelope = canonical({
            ...core,
            digest: sha(core),
            result: result ?? null,
            metadata: metadata ?? {}
        });
        return deepFreeze(envelope);
    }

    static read(value) {
        if (!value || typeof value !== 'object') throw new TypeError('Replay envelope object is required.');
        if (value.contract !== CONTRACT) throw Object.assign(new TypeError(`Unsupported replay contract: ${value.contract || '<missing>'}.`), { code: 'REPLAY_CONTRACT_UNSUPPORTED' });
        if (Number(value.version) !== VERSION) throw Object.assign(new TypeError(`Unsupported replay envelope version: ${value.version}.`), { code: 'REPLAY_VERSION_UNSUPPORTED', version: value.version });
        const normalized = this.create(value);
        if (value.digest && value.digest !== normalized.digest) throw Object.assign(new Error('Replay envelope digest mismatch.'), { code: 'REPLAY_DIGEST_MISMATCH' });
        return normalized;
    }

    static fromLegacyB5Fixture(fixture, { profile, policy = { id: 'b5-execution-planner', revision: 'v2' } } = {}) {
        if (!fixture || Number(fixture.version) !== 1 || !fixture.inspection) throw new TypeError('B5 replay fixture v1 is required.');
        const expected = fixture.expected || {};
        return this.create({
            domain: 'b5-crafting',
            input: fixture.inspection,
            decision: {
                kind: expected.decisionKind ?? null,
                resource: expected.decisionResource ?? null,
                blockers: Array.isArray(expected.blockers) ? expected.blockers : []
            },
            profile,
            policy,
            metadata: { legacyFixtureVersion: 1 }
        });
    }

    static toLegacyB5Fixture(value) {
        const envelope = this.read(value);
        if (envelope.domain !== 'b5-crafting') throw Object.assign(new TypeError(`Replay domain is not B5: ${envelope.domain}.`), { code: 'REPLAY_DOMAIN_MISMATCH' });
        return deepFreeze({
            version: 1,
            inspection: envelope.input,
            expected: {
                decisionKind: envelope.decision?.kind ?? null,
                decisionResource: envelope.decision?.resource ?? null,
                blockers: Array.isArray(envelope.decision?.blockers) ? envelope.decision.blockers : []
            }
        });
    }

    static digest(value) { return sha(value); }
}

DecisionReplayEnvelope.CONTRACT = CONTRACT;
DecisionReplayEnvelope.VERSION = VERSION;
module.exports = DecisionReplayEnvelope;
