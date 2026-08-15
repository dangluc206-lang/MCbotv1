'use strict';

const MAX_DEPTH = 18;
const MAX_IDENTITIES = 12;
const MAX_STRUCTURAL_KEYS = 20;

function describeItemIdentity(item = {}) {
    const semanticIds = [];
    const structuralKeys = [];
    let customMetadataPresent = false;

    const addStructural = key => {
        const text = String(key || '').trim();
        if (!text || structuralKeys.includes(text) || structuralKeys.length >= MAX_STRUCTURAL_KEYS) return;
        structuralKeys.push(text);
    };

    const addIdentity = value => {
        const text = scalarValue(value);
        if (!isSemanticIdentity(text) || semanticIds.includes(text) || semanticIds.length >= MAX_IDENTITIES) return;
        semanticIds.push(text);
    };

    const visitEntry = (key, entry, context, depth) => {
        const normalized = normalizeKey(key);
        if (isCustomContainer(normalized)) {
            customMetadataPresent = true;
            addStructural(key);
            visit(entry, true, depth + 1);
            return;
        }
        if (isIdentifierKey(normalized) || (context && normalized === 'id')) {
            customMetadataPresent = true;
            addIdentity(canonicalIdentifierToken(key, entry));
            // MMOItems values are commonly stored as a bare value under the
            // MMOITEMS_ITEM_ID key. Recursing into the wrapper would add the
            // bare value a second time and lose the authoritative key prefix.
            if (normalized !== 'mmoitemsitemid') visit(entry, true, depth + 1);
            return;
        }
        if (normalized === 'itemgui') {
            customMetadataPresent = true;
            addStructural(key);
            addIdentity(itemGuiValue(entry));
            visit(entry, true, depth + 1);
            return;
        }
        visit(entry, context, depth + 1);
    };

    const visit = (value, context = false, depth = 0) => {
        if (depth > MAX_DEPTH || value === null || value === undefined) return;
        if (typeof value === 'string') {
            if (context && looksLikeIdentifierToken(value)) addIdentity(value);
            return;
        }
        if (Array.isArray(value)) {
            value.forEach(entry => visit(entry, context, depth + 1));
            return;
        }
        if (value instanceof Map) {
            value.forEach((entry, key) => visitEntry(String(key), entry, context, depth + 1));
            return;
        }
        if (typeof value !== 'object') return;

        const wrapperType = normalizeKey(value.type);
        const wrapperContext = context || isCustomContainer(wrapperType);
        if (isCustomContainer(wrapperType)) {
            customMetadataPresent = true;
            addStructural(value.type);
        }
        if (wrapperType === 'string') {
            if (wrapperContext) addIdentity(value.value);
            return;
        }

        for (const [key, entry] of Object.entries(value)) {
            if (key === 'type') continue;
            visitEntry(key, entry, wrapperContext, depth + 1);
        }
    };

    if (item.customIdentifier !== undefined || item.identifier !== undefined) customMetadataPresent = true;
    addIdentity(item.customIdentifier);
    addIdentity(item.identifier);
    visit(item.components);
    visit(item.componentMap);
    visit(item.nbt);
    if (item.customData !== undefined) {
        customMetadataPresent = true;
        addStructural('customData');
        visit(item.customData, true);
    }

    return { customMetadataPresent, semanticIds, structuralKeys };
}

function canonicalIdentifierToken(key, value) {
    const scalar = scalarValue(value);
    if (!scalar) return '';
    const normalized = normalizeKey(key);
    if (normalized === 'mmoitemsitemid') {
        const match = scalar.match(/^MMOITEMS_ITEM_ID:(.+)$/i);
        const suffix = (match ? match[1] : scalar).trim();
        return suffix ? `MMOITEMS_ITEM_ID:${suffix}` : '';
    }
    return scalar;
}

function identitiesEquivalent(expected, actual) {
    const left = String(expected || '').trim();
    const right = String(actual || '').trim();
    if (!left || !right) return false;
    if (left === right) return true;

    // Compatibility for knowledge written before MMOITEMS identities were
    // canonicalized with their key prefix. Never strip the prefix when
    // storing new data; this suffix match is migration-only.
    const leftMmo = left.match(/^MMOITEMS_ITEM_ID:(.+)$/i);
    const rightMmo = right.match(/^MMOITEMS_ITEM_ID:(.+)$/i);
    if (leftMmo && !rightMmo) return leftMmo[1] === right;
    if (rightMmo && !leftMmo) return rightMmo[1] === left;
    return false;
}

function itemGuiValue(value) {
    if (!value || typeof value !== 'object') return null;
    if (normalizeKey(value.type) === 'string') return scalarValue(value.value);
    return null;
}

function scalarValue(value, depth = 0) {
    if (depth > 5 || value === null || value === undefined) return '';
    if (typeof value === 'string') return value.replace(/[\r\n\t]/g, ' ').trim().slice(0, 200);
    if (typeof value !== 'object') return '';
    if (normalizeKey(value.type) === 'string') return scalarValue(value.value, depth + 1);
    if ('value' in value) return scalarValue(value.value, depth + 1);
    return '';
}

function looksLikeIdentifierToken(value) {
    const text = String(value || '').trim();
    if (!isSemanticIdentity(text)) return false;
    return /(?:^|_)(?:item_?id|identifier)(?::|_|$)/i.test(text)
        || /^mmoitems(?:_|:)/i.test(text)
        || /^[a-z0-9_.-]+:[a-z0-9_.:-]+$/i.test(text);
}

function isSemanticIdentity(value) {
    if (typeof value !== 'string' || value.length < 3 || value.length > 200) return false;
    if (!/^[a-z0-9_:./\-]+$/i.test(value)) return false;
    return !['compound', 'string', 'list', 'byte', 'int', 'long', 'value', 'type', 'itemgui', 'true', 'false']
        .includes(value.toLowerCase());
}

function normalizeKey(value) {
    return String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isIdentifierKey(key) {
    const normalized = normalizeKey(key);
    return ['identifier', 'customidentifier', 'customid', 'itemid', 'itemidentifier', 'internalid', 'mmoitemsitemid']
        .includes(normalized)
        || normalized.endsWith('itemid')
        || normalized.endsWith('identifier');
}

function isCustomContainer(key) {
    const normalized = normalizeKey(key);
    return normalized === 'customdata'
        || normalized === 'extraattributes'
        || normalized.endsWith('customdata')
        || normalized.endsWith('extraattributes');
}

function identityStrength(value) {
    const text = String(value || '');
    if (/^MMOITEMS_ITEM_ID:/i.test(text)) return 100;
    if (/MMOITEMS/i.test(text)) return 95;
    if (/(?:ITEM_?ID|IDENTIFIER)/i.test(text)) return 80;
    if (text.includes(':')) return 50;
    return 10;
}

function strongestIdentity(values = []) {
    return [...new Set((Array.isArray(values) ? values : []).filter(Boolean).map(String))]
        .sort((a, b) => identityStrength(b) - identityStrength(a) || b.length - a.length)[0] || null;
}

module.exports = {
    describeItemIdentity,
    strongestIdentity,
    identityStrength,
    canonicalIdentifierToken,
    identitiesEquivalent
};
