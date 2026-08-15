'use strict';

function isObject(value) {
    return value !== null && typeof value === 'object';
}

function deepFreeze(value, seen = new WeakSet()) {
    if (!isObject(value) || seen.has(value)) return value;
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
    return Object.freeze(value);
}

function deepClone(value, seen = new WeakMap()) {
    if (!isObject(value)) return value;
    if (seen.has(value)) return seen.get(value);
    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            code: value.code,
            stack: value.stack
        };
    }
    const clone = Array.isArray(value) ? [] : {};
    seen.set(value, clone);
    for (const key of Reflect.ownKeys(value)) clone[key] = deepClone(value[key], seen);
    return clone;
}

function immutableClone(value) {
    return deepFreeze(deepClone(value));
}

module.exports = { isObject, deepFreeze, deepClone, immutableClone };
