'use strict';

class TitleTextExtractor {
    extract(value) {
        return this.#extract(value, 0, new WeakSet()).trim();
    }

    #extract(value, depth, seen) {
        if (value === null || value === undefined || depth > 16) return '';
        if (typeof value === 'string') return value;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        if (typeof value !== 'object') return '';
        if (seen.has(value)) return '';

        seen.add(value);
        try {
            if (Array.isArray(value)) {
                return value.map(entry => this.#extract(entry, depth + 1, seen)).join('');
            }

            // Prismarine-NBT string tag.
            if (value.type === 'string' && typeof value.value === 'string') {
                return value.value;
            }

            // Prismarine-NBT compound used by modern window titles.
            if (value.type === 'compound' && value.value && typeof value.value === 'object') {
                return this.#extractComponentObject(value.value, depth + 1, seen);
            }

            // Prismarine-NBT list wrapper.
            if (value.type === 'list' && value.value !== undefined) {
                const listValue = Array.isArray(value.value)
                    ? value.value
                    : value.value?.value;
                return this.#extract(listValue, depth + 1, seen);
            }

            return this.#extractComponentObject(value, depth + 1, seen);
        } finally {
            seen.delete(value);
        }
    }

    #extractComponentObject(value, depth, seen) {
        let output = '';

        if (Object.prototype.hasOwnProperty.call(value, 'text')) {
            output += this.#extract(value.text, depth + 1, seen);
        } else if (Object.prototype.hasOwnProperty.call(value, 'translate')) {
            output += this.#extract(value.translate, depth + 1, seen);
        }

        if (Object.prototype.hasOwnProperty.call(value, 'with')) {
            output += this.#extract(value.with, depth + 1, seen);
        }
        if (Object.prototype.hasOwnProperty.call(value, 'extra')) {
            output += this.#extract(value.extra, depth + 1, seen);
        }

        // Generic wrappers from serializers/protocol libraries.
        if (!output && Object.prototype.hasOwnProperty.call(value, 'value')) {
            output += this.#extract(value.value, depth + 1, seen);
        }

        return output;
    }
}

module.exports = TitleTextExtractor;
