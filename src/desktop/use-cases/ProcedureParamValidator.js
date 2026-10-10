'use strict';

const INTEGER_RE = /^-?\d+$/;
const INTEGER_MAX_SAFE_DIGITS = 16;

/**
 * Single validation authority for procedure step parameters (G20.1; nested
 * dotted-key support fixed in G20.2).
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
 * - Integer strings must be canonical: optional surrounding whitespace is
 *   tolerated (and trimmed before normalize), but anything else ("5.0", "0x10",
 *   "5e2", empty) is rejected.
 * - Bounds are inclusive on both ends.
 * - Unknown field keys (not in the catalog for that step type) -> REJECT, so a
 *   Registry normalization drop can never silently lose builder data.
 * - Dotted field keys (e.g. 'params.pattern') address NESTED step data:
 *   `{ type, params: { pattern } }`. A top-level container (e.g. `params`) is
 *   allowed only when the catalog declares at least one child under it; nested
 *   keys outside the catalog are rejected, and non-object containers are
 *   rejected (never coerced).
 *
 * Integer strings: TypedModuleEditor sends `Number(value)` for number inputs,
 * so IPC drafts carry real numbers. The builder advanced-JSON path (and any
 * hand-written draft) can carry strings, so canonical integer strings
 * ("5000", " 5000 ") normalize to numbers; anything else ("5.0", "0x10",
 * "5e2", empty) is rejected.
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

// A declared container (e.g. `params` for 'params.pattern') must be a plain
// object holding ONLY catalog-declared children. Anything else — arrays, null,
// primitives, or undeclared nested keys — is rejected so undeclared data can
// never ride into the normalized draft inside a container.
function checkContainer(step, containerKey, declared) {
    const label = `step '${step.type}' tham số ${containerKey}`;
    const container = step[containerKey];
    if (container === null || typeof container !== 'object' || Array.isArray(container)) {
        return [`${label}: phải là object chứa các tham số đã khai báo.`];
    }
    const allowed = new Set(
        [...declared.keys()]
            .filter(key => key === containerKey || key.startsWith(`${containerKey}.`))
            .map(key => key.slice(containerKey.length + 1))
            .filter(child => child && !child.includes('.'))
    );
    const problems = [];
    for (const child of Object.keys(container)) {
        if (!allowed.has(child)) {
            problems.push(`${label}.${child}: tham số lồng nhau không được hỗ trợ (runtime sẽ loại bỏ, gây mất dữ liệu).`);
        }
    }
    return problems;
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
 * Dotted catalog keys (e.g. 'params.pattern') address nested step data, so
 * the unknown-key sweep accepts a top-level container only when the catalog
 * declares at least one child beneath it — never as a free-form object.
 * @returns {{ errors: string[], normalizedStep: object }} normalizedStep drops
 * empty optional text fields so they are stored as "not provided".
 */
function validateStepParams(step, catalogFields) {
    const errors = [];
    const declared = new Map((catalogFields || []).map(field => [field.key, field]));
    const containers = new Set(
        [...declared.keys()]
            .filter(key => key.includes('.'))
            .map(key => key.split('.')[0])
    );
    for (const key of Object.keys(step).filter(key => key !== 'type')) {
        if (declared.has(key)) continue;
        if (containers.has(key)) {
            const problems = checkContainer(step, key, declared);
            errors.push(...problems);
            continue;
        }
        errors.push(`step '${step.type}' có tham số không được hỗ trợ: ${key} (runtime sẽ loại bỏ, gây mất dữ liệu).`);
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
