'use strict';

const StorageTextParser = require('./StorageTextParser');

class KhoCapacityReader {
    constructor({ itemResolver, config, textParser = new StorageTextParser() }) {
        this.itemResolver = itemResolver;
        this.config = config;
        this.textParser = textParser;
    }

    reconfigure(config) {
        this.config = config || {};
        return this;
    }

    read(window) {
        const rule = this.config?.capacityIndicator;
        if (!rule) return null;

        // Do not trust one configured slot blindly. Server GUI revisions can
        // move the capacity item while leaving another decorative item in that
        // slot. Try the strongest candidates first, but only accept a candidate
        // after its text actually parses as storage-capacity telemetry.
        for (const item of this.#indicatorCandidates(window, rule)) {
            const parsed = this.#parseIndicator(item, rule);
            if (parsed) return parsed;
        }
        return null;
    }

    #parseIndicator(item, rule) {
        if (!item) return null;
        const lines = this.textParser.itemLines(item);
        const text = this.textParser.normalizeText(lines.join('\n'));
        const used = this.textParser.firstAbsoluteMatch(text, rule.usedPatterns || [], 'value')
            ?? this.textParser.firstAbsoluteNumberAfterLabel(lines, /(?:da\s*su\s*dung|used)\s*:?/i);
        const free = this.textParser.firstAbsoluteMatch(text, rule.freePatterns || [], 'value')
            ?? this.textParser.firstAbsoluteNumberAfterLabel(lines, /(?:dang\s*trong|con\s*trong|free)\s*:?/i);
        const limit = this.textParser.firstAbsoluteMatch(text, rule.limitPatterns || [], 'value')
            ?? this.textParser.firstAbsoluteNumberAfterLabel(lines, /(?:dung\s*luong|suc\s*chua|capacity|limit)\s*:?/i);

        if (Number.isSafeInteger(used) || Number.isSafeInteger(free) || Number.isSafeInteger(limit)) {
            const resolvedLimit = Number.isSafeInteger(limit)
                ? limit
                : (Number.isSafeInteger(used) && Number.isSafeInteger(free) ? used + free : null);
            const resolvedUsed = Number.isSafeInteger(used)
                ? used
                : (Number.isSafeInteger(resolvedLimit) && Number.isSafeInteger(free) ? resolvedLimit - free : null);
            const resolvedFree = Number.isSafeInteger(free)
                ? free
                : (Number.isSafeInteger(resolvedLimit) && Number.isSafeInteger(resolvedUsed) ? resolvedLimit - resolvedUsed : null);

            const usedPercent = this.#readPercent(text, /(?:da\s*su\s*dung|used)\s*:?\s*[\d.,]+\s*[/|]\s*([\d.,]+)\s*%/i)
                ?? this.textParser.firstPercentAfterLabel(lines, /(?:da\s*su\s*dung|used)\s*:?/i)
                ?? (Number.isSafeInteger(resolvedUsed) && Number.isSafeInteger(resolvedLimit) && resolvedLimit > 0
                    ? (resolvedUsed / resolvedLimit) * 100
                    : null);
            const freePercent = this.#readPercent(text, /(?:dang\s*trong|con\s*trong|free)\s*:?\s*[\d.,]+\s*[/|]\s*([\d.,]+)\s*%/i)
                ?? this.textParser.firstPercentAfterLabel(lines, /(?:dang\s*trong|con\s*trong|free)\s*:?/i)
                ?? (Number.isSafeInteger(resolvedFree) && Number.isSafeInteger(resolvedLimit) && resolvedLimit > 0
                    ? (resolvedFree / resolvedLimit) * 100
                    : null);

            return Object.freeze({
                used: resolvedUsed,
                free: resolvedFree,
                limit: resolvedLimit,
                total: resolvedLimit,
                usedPercent,
                freePercent,
                usageRatio: Number.isSafeInteger(resolvedUsed) && Number.isSafeInteger(resolvedLimit) && resolvedLimit > 0
                    ? resolvedUsed / resolvedLimit
                    : null
            });
        }

        if (typeof rule.regex === 'string' && rule.regex) {
            const match = new RegExp(rule.regex, 'i').exec(text);
            if (!match) return null;
            const legacyUsed = this.textParser.parseNumber(match.groups?.used ?? match[1]);
            const legacyLimit = this.textParser.parseNumber(match.groups?.limit ?? match[2]);
            if (!Number.isSafeInteger(legacyUsed) || !Number.isSafeInteger(legacyLimit)) return null;
            const legacyFree = Math.max(0, legacyLimit - legacyUsed);
            return Object.freeze({
                used: legacyUsed,
                limit: legacyLimit,
                total: legacyLimit,
                free: legacyFree,
                usedPercent: legacyLimit > 0 ? (legacyUsed / legacyLimit) * 100 : null,
                freePercent: legacyLimit > 0 ? (legacyFree / legacyLimit) * 100 : null,
                usageRatio: legacyLimit > 0 ? legacyUsed / legacyLimit : null
            });
        }

        return null;
    }

    #indicatorCandidates(window, rule) {
        const slots = window?.slots || [];
        const output = [];
        const seen = new Set();
        const add = item => {
            if (!item || seen.has(item)) return;
            seen.add(item);
            output.push(item);
        };

        const configuredSlot = Number.isInteger(Number(rule.slot)) ? Number(rule.slot) : 49;
        if (configuredSlot >= 0) add(slots[configuredSlot]);

        if (typeof rule.itemId === 'string' && rule.itemId) {
            for (const raw of slots) {
                if (raw && this.itemResolver.matches(raw, rule.itemId, 'storage-menu').matched) add(raw);
            }
        }

        if (rule.scanAllSlots === true) {
            for (const raw of slots) add(raw);
        }

        return output;
    }

    #readPercent(text, expression) {
        const match = expression.exec(text);
        return this.textParser.parsePercent(match?.[1]);
    }
}

module.exports = KhoCapacityReader;
