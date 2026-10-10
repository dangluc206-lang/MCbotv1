'use strict';

const INTEGER_RE = /^-?\d+$/;
const INTEGER_MAX_SAFE_DIGITS = 16;

/**
 * Single validation authority for procedure step parameters (G20.1).
 * `ProcedureStepCatalog` stays the declarative field metadata; this module is
 * the pure checker that every entry point (validate / dry-run / save) shares.
 *
 * Contract:
 * - Required field missing/null/empty -> REJECT.
 * - Optional field absent (undefined) -> ACCEPT, never checked.
 * - Optional field provided -> full type + constraint checks (never skipped).
 * - Empty-string optional text -> treated as not provided and dropped.
 *   A malformed value like "abc" in an integer field is NEVER treated as absent.
 * - Integer: actual number or canonical integer string only. No floats, NaN,
 *   Infinity, booleans, objects, arrays, or ambiguous coercions.
 * - Bounds are inclusive on both ends.
 * - Unknown field keys (not in the catalog for that step type) -> REJECT, so a
 *   Registry normalization drop can never silently lose builder data.
 *
 * Integer strings: TypedModuleEditor sends `Number(value)` for number inputs,
 * so IPC drafts carry real numbers. The builder advanced-JSON path (and any
 * hand-written draft) can carry strings, so canonical integer strings
 * ("5000") normalize to numbers; anything else ("5.0", "0x10", "5e2",
 * whitespace-padded, empty) is rejected.
 */
function valueAtPath(object, dottedKey) {
    return dottedKey.split('.').reduce((value, key) => (value == null ? value : value[key]), object);
}

function setAtPath(object, dottedKey, value) {
    const parts = dottedKey.split('.');
    let owner = object;
    for (const part of parts.slice(0, -1)) owner = owner[part] ??= {};
    owner[parts.at(-1)] = value;
}

function isProvided(value) {
    return value !== undefined;
}

function isEmptyText(value) {
    return typeof value === 'string' && !value.trim();
}

function checkInteger(value, field, label) {
    if (typeof value === 'number') {
        if (!Number.isInteger(value)) return `${label}: phải là số nguyên, nhận ${JSON.stringify(value)}.`;
        if (!Number.isSafeInteger(value)) return `${label}: vượt giới hạn số nguyên an toàn.`;
    } else if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!INTEGER_RE.test(trimmed)) return `${label}: phải là số nguyên, nhận ${JSON.stringify(value)}.`;
        // Reject digit strings that exceed the safe-integer range explicitly:
        // Number() would silently round them, losing the configured value.
        const digits = trimmed.replace(/^-/, '');
        if (digits.length > INTEGER_MAX_SAFE_DIGITS || (digits.length === INTEGER_MAX_SAFE_DIGITS && trimmed !== String(Number(trimmed)))) {
            return `${label}: vượt giới hạn số nguyên an toàn.`;
        }
        if (!Number.isSafeInteger(Number(trimmed))) return `${label}: vượt giới hạn số nguyên an toàn.`;
    } else {
        return `${label}: phải là số nguyên, nhận ${JSON.stringify(value)}.`;
    }
    const numeric = Number(value);
    if (field.min !== undefined && numeric < field.min) return `${label}: phải >= ${field.min}, nhận ${JSON.stringify(value)}.`;
    if (field.max !== undefined && numeric > field.max) return `${label}: phải <= ${field.max}, nhận ${JSON.stringify(value)}.`;
    return null;
}

function checkText(value, field, label) {
    if (typeof value !== 'string') return `${label}: phải là chuỗi, nhận ${JSON.stringify(value)}.`;
    if (!value.trim()) return `${label}: không được rỗng.`;
    if (field.pattern && !new RegExp(field.pattern).test(value)) {
        return `${label}: không khớp pattern ${field.pattern}.`;
    }
    if (field.min !== undefined && value.length < field.min) return `${label}: độ dài phải >= ${field.min}.`;
    if (field.max !== undefined && value.length > field.max) return `${label}: độ dài phải <= ${field.max}.`;
    return null;
}

/**
 * Validates one step against its catalog fields.
 * @returns {{ errors: string[], normalizedStep: object }} normalizedStep drops
 * empty optional text fields so they are stored as "not provided".
 */
function validateStepParams(step, catalogFields) {
    const errors = [];
    const declared = new Map((catalogFields || []).map(field => [field.key, field]));
    for (const key of Object.keys(step).filter(key => key !== 'type')) {
        if (!declared.has(key)) {
            errors.push(`step '${step.type}' có tham số không được hỗ trợ: ${key} (runtime sẽ loại bỏ, gây mất dữ liệu).`);
        }
    }
    const normalizedStep = { type: step.type };
    for (const field of declared.values()) {
        const value = valueAtPath(step, field.key);
        const label = `step '${step.type}' tham số ${field.key}`;
        if (!isProvided(value)) {
            if (field.required) errors.push(`step '${step.type}' thiếu tham số bắt buộc: ${field.key}`);
            continue;
        }
        if (value === null) {
            errors.push(`${label}: không được null${field.required ? ' (bắt buộc)' : ''}.`);
            continue;
        }
        // Optional empty text = not provided: drop it. Malformed non-empty
        // values always fall through to the type checks below.
        if (!field.required && field.type === 'text' && isEmptyText(value)) continue;
        if (field.type === 'integer') {
            const failure = checkInteger(value, field, label);
            if (failure) errors.push(failure);
            else setAtPath(normalizedStep, field.key, Number(value));
        } else if (field.type === 'text') {
            const failure = checkText(value, field, label);
            if (failure) errors.push(failure);
            else setAtPath(normalizedStep, field.key, value);
        } else {
            // Unknown field type: never silently accept a value we cannot check.
            errors.push(`${label}: kiểu field không được hỗ trợ: ${field.type}.`);
        }
    }
    return { errors, normalizedStep };
}

module.exports = { validateStepParams, valueAtPath };
