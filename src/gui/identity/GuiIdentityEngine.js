'use strict';

const TitleTextExtractor = require('../detection/TitleTextExtractor');

const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));

function safeNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function immutable(value) {
    if (value === null || value === undefined || typeof value !== 'object') return value;
    if (Array.isArray(value)) return Object.freeze(value.map(immutable));
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, immutable(child)])));
}

/**
 * Confidence-based GUI identity classifier.
 *
 * The old detector answered a binary question: first matching definition wins.
 * That is unsafe on custom servers where titles overlap (for example both
 * /kho and /pv 2 contain the word "kho") or where command-driven GUIs refresh
 * in place. V2 scores independent evidence and exposes the evidence/margin so
 * callers can decide whether a GUI is safe to operate on.
 */
class GuiIdentityEngine {
    constructor({ registry, titleMatcher, layoutMatcher, fingerprintMatcher, config = {}, titleExtractor = null }) {
        if (!registry) throw new TypeError('GUI registry is required.');
        this.registry = registry;
        this.titleMatcher = titleMatcher;
        this.layoutMatcher = layoutMatcher;
        this.fingerprintMatcher = fingerprintMatcher;
        this.titleExtractor = titleExtractor || new TitleTextExtractor();
        this.config = Object.freeze({
            minimumConfidence: safeNumber(config.minimumConfidence, 0.62),
            minimumMargin: safeNumber(config.minimumMargin, 0.08),
            expectedMinimumConfidence: safeNumber(config.expectedMinimumConfidence, 0.58),
            titleWeight: safeNumber(config.titleWeight, 0.46),
            layoutWeight: safeNumber(config.layoutWeight, 0.16),
            fingerprintWeight: safeNumber(config.fingerprintWeight, 0.38),
            expectedIdWeight: safeNumber(config.expectedIdWeight, 0.42),
            expectedConflictWeight: safeNumber(config.expectedConflictWeight, 0.20),
            previousIdWeight: safeNumber(config.previousIdWeight, 0.08),
            unknownPenalty: safeNumber(config.unknownPenalty, 0.14),
            maxSemanticWeight: safeNumber(config.maxSemanticWeight, 0.50),
            candidateLimit: Math.max(2, Math.floor(safeNumber(config.candidateLimit, 5)))
        });
    }

    identify(window, {
        expectedId = null,
        source = null,
        previousId = null,
        semanticEvidence = []
    } = {}) {
        if (!window) return this.#unknown('NO_WINDOW', expectedId);
        const sourceExpectedId = source?.guiId || source?.definitionId || null;
        const expected = expectedId || sourceExpectedId || null;
        const titleText = this.titleExtractor.extract(window?.title);
        const candidates = this.registry.entries().map(([id, definition], order) => this.#scoreCandidate({
            id,
            definition,
            order,
            window,
            expectedId: expected,
            previousId,
            semanticEvidence,
            titleText
        })).sort((a, b) => {
            if (b.confidence !== a.confidence) return b.confidence - a.confidence;
            if (b.netScore !== a.netScore) return b.netScore - a.netScore;
            return a.order - b.order;
        });

        const top = candidates[0] || null;
        const runnerUp = candidates[1] || null;
        if (!top) return this.#unknown('NO_DEFINITIONS', expected);
        const margin = clamp(top.confidence - (runnerUp?.confidence || 0));
        const threshold = expected && top.id === expected
            ? this.config.expectedMinimumConfidence
            : this.config.minimumConfidence;
        const enoughConfidence = top.confidence >= threshold;
        const enoughMargin = margin >= this.config.minimumMargin;
        const expectedWinner = Boolean(expected && top.id === expected && top.confidence >= this.config.expectedMinimumConfidence);
        const accepted = enoughConfidence && (enoughMargin || expectedWinner);
        const ambiguous = enoughConfidence && !enoughMargin && !expectedWinner;

        return immutable({
            version: 2,
            id: accepted ? top.id : null,
            candidateId: top.id,
            definition: accepted ? top.definition : null,
            confidence: top.confidence,
            margin,
            accepted,
            ambiguous,
            expectedId: expected,
            previousId: previousId || null,
            title: titleText,
            reason: accepted ? 'IDENTIFIED' : ambiguous ? 'AMBIGUOUS' : 'LOW_CONFIDENCE',
            evidence: top.evidence,
            candidates: candidates.slice(0, this.config.candidateLimit).map(candidate => ({
                id: candidate.id,
                confidence: candidate.confidence,
                netScore: candidate.netScore,
                evidence: candidate.evidence
            }))
        });
    }

    #scoreCandidate({ id, definition, order, window, expectedId, previousId, semanticEvidence, titleText }) {
        let support = 0;
        let contradiction = 0;
        const evidence = [];
        const add = (signal, matched, weight, details = null) => {
            const normalizedWeight = Math.max(0, Number(weight) || 0);
            if (normalizedWeight <= 0) return;
            if (matched) support += normalizedWeight;
            else contradiction += normalizedWeight;
            evidence.push(Object.freeze({ signal, matched: Boolean(matched), weight: normalizedWeight, details }));
        };

        if (definition?.title) {
            let matched = false;
            try { matched = Boolean(this.titleMatcher?.match(window, definition.title)); } catch { matched = false; }
            add('title', matched, this.config.titleWeight, {
                actual: titleText,
                expected: definition.title.regex || definition.title.value || null,
                exact: definition.title.exact === true
            });
        }

        const layoutRule = definition?.layout || {};
        if (Object.keys(layoutRule).length > 0) {
            let matched = false;
            try { matched = Boolean(this.layoutMatcher?.match(window, layoutRule)); } catch { matched = false; }
            add('layout', matched, this.config.layoutWeight, {
                actualSlotCount: Array.isArray(window?.slots) ? window.slots.length : null,
                actualType: window?.type || null,
                expected: layoutRule
            });
        }

        const fingerprints = Array.isArray(definition?.fingerprints) ? definition.fingerprints : [];
        if (fingerprints.length > 0) {
            const perWeight = this.config.fingerprintWeight / fingerprints.length;
            for (const fingerprint of fingerprints) {
                let matched = false;
                try { matched = Boolean(this.fingerprintMatcher?.match(window, fingerprint)); } catch { matched = false; }
                add('fingerprint', matched, perWeight, {
                    slot: fingerprint.slot,
                    itemId: fingerprint.itemId,
                    context: fingerprint.context || 'gui'
                });
            }
        }

        if (expectedId) {
            if (id === expectedId) add('command-context', true, this.config.expectedIdWeight, { expectedId });
            else add('command-context-conflict', false, this.config.expectedConflictWeight, { expectedId });
        }

        if (previousId && !expectedId && id === previousId) {
            add('previous-session', true, this.config.previousIdWeight, { previousId });
        }

        let semanticWeightUsed = 0;
        for (const raw of Array.isArray(semanticEvidence) ? semanticEvidence : []) {
            if (!raw || raw.candidateId !== id) continue;
            const available = Math.max(0, this.config.maxSemanticWeight - semanticWeightUsed);
            if (available <= 0) break;
            const weight = Math.min(available, Math.max(0, Number(raw.weight) || 0));
            semanticWeightUsed += weight;
            add(raw.signal || 'semantic', raw.matched !== false, weight, raw.details || null);
        }

        const denominator = support + contradiction + this.config.unknownPenalty;
        const confidence = denominator > 0 ? clamp(support / denominator) : 0;
        return {
            id,
            definition,
            order,
            support,
            contradiction,
            netScore: support - contradiction,
            confidence,
            evidence: Object.freeze(evidence)
        };
    }

    #unknown(reason, expectedId = null) {
        return immutable({
            version: 2,
            id: null,
            candidateId: null,
            definition: null,
            confidence: 0,
            margin: 0,
            accepted: false,
            ambiguous: false,
            expectedId: expectedId || null,
            previousId: null,
            title: '',
            reason,
            evidence: [],
            candidates: []
        });
    }
}

module.exports = GuiIdentityEngine;
