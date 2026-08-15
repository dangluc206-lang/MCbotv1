'use strict';

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY = /(?:password|passwd|pwd|token|secret|authorization|api[-_ ]?key|apikey|credential|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret)/i;
const KEY_PATTERN = '(?:password|passwd|pwd|token|secret|authorization|api[-_ ]?key|apikey|credential|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret)';
const QUOTE_PATTERN = '(?:\\\\["\']|["\'])';

function isEscaped(text, index) {
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) slashes += 1;
    return slashes % 2 === 1;
}

function isStructuralTail(text, index) {
    return /^\s*(?:[,}\]]|$)/.test(text.slice(index));
}

function consumePlainQuoted(text, start, quote) {
    for (let cursor = start + 1; cursor < text.length; cursor += 1) {
        if (text[cursor] !== quote || isEscaped(text, cursor)) continue;
        if (isStructuralTail(text, cursor + 1)) return cursor + 1;
    }
    return text.length;
}

function consumeEscapedQuoted(text, start, quote) {
    for (let cursor = start + 2; cursor < text.length - 1; cursor += 1) {
        if (text[cursor] !== '\\' || text[cursor + 1] !== quote) continue;
        if (isStructuralTail(text, cursor + 2)) return cursor + 2;
    }
    return text.length;
}

function consumeScalar(text, start) {
    let cursor = start;
    while (cursor < text.length && !/[,}\]]/.test(text[cursor])) cursor += 1;
    return cursor;
}

function redactStructuredSecrets(input) {
    let text = input;
    const keyRegex = new RegExp(`(${QUOTE_PATTERN})(${KEY_PATTERN})\\1\\s*:\\s*`, 'gi');
    let searchFrom = 0;

    while (searchFrom < text.length) {
        keyRegex.lastIndex = searchFrom;
        const match = keyRegex.exec(text);
        if (!match) break;
        const valueStart = keyRegex.lastIndex;

        if (text.startsWith(`"${REDACTED}"`, valueStart)
            || text.startsWith(`'${REDACTED}'`, valueStart)
            || text.startsWith(`\\"${REDACTED}\\"`, valueStart)
            || text.startsWith(`\\'${REDACTED}\\'`, valueStart)) {
            searchFrom = valueStart + REDACTED.length + 2;
            continue;
        }

        const first = text[valueStart];
        const second = text[valueStart + 1];
        let valueEnd;
        let replacement;

        if (first === '\\' && (second === '"' || second === "'")) {
            valueEnd = consumeEscapedQuoted(text, valueStart, second);
            replacement = `\\${second}${REDACTED}\\${second}`;
        } else if (first === '"' || first === "'") {
            valueEnd = consumePlainQuoted(text, valueStart, first);
            replacement = `${first}${REDACTED}${first}`;
        } else {
            valueEnd = consumeScalar(text, valueStart);
            replacement = `"${REDACTED}"`;
        }

        text = `${text.slice(0, valueStart)}${replacement}${text.slice(valueEnd)}`;
        searchFrom = valueStart + replacement.length;
    }
    return text;
}

function redactText(value) {
    let text = redactStructuredSecrets(String(value));

    text = text.replace(
        /\bBearer\s+(?:\[REDACTED\]|[^\s,"'<>]+)/gi,
        `Bearer ${REDACTED}`
    );

    text = text.replace(
        new RegExp(`([?&]${KEY_PATTERN}=)(?:%5BREDACTED%5D|\\[REDACTED\\]|[^&#\\s]*)`, 'gi'),
        (_match, prefix) => `${prefix}${REDACTED}`
    );

    text = text.replace(
        new RegExp(`\\b(${KEY_PATTERN})\\b\\s*([:=])\\s*(?:Bearer\\s+)?(?:\\[REDACTED\\]|"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'|[^\\s,;&}\\]]+)`, 'gi'),
        (_match, key, separator) => `${key}${separator}${REDACTED}`
    );

    text = text.replace(
        /\b(https?:\/\/[^\s\/:@]+:)(?:\[REDACTED\]|[^@\s\/]+)(@)/gi,
        `$1${REDACTED}$2`
    );

    return text;
}

function sanitize(value, seen = new WeakSet()) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string') return redactText(value);
    if (['number', 'boolean'].includes(typeof value)) return value;
    if (typeof value === 'bigint') return String(value);
    if (typeof value === 'function' || typeof value === 'symbol') return String(value);
    if (value instanceof Error) {
        return sanitize({
            name: value.name,
            message: value.message,
            code: value.code || null,
            stack: value.stack || null,
            details: value.details ?? null,
            cause: value.cause ?? null
        }, seen);
    }
    if (typeof value !== 'object') return redactText(value);
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const output = Array.isArray(value) ? [] : {};
    for (const [key, child] of Object.entries(value)) {
        if (child === undefined) continue;
        output[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitize(child, seen);
    }
    return output;
}

module.exports = Object.freeze({ sanitize, redactText, SENSITIVE_KEY, REDACTED });