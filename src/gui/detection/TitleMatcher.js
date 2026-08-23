'use strict';

const TitleTextExtractor = require('./TitleTextExtractor');

const SMALL_CAPS = Object.freeze({
    'ᴀ': 'a', 'ʙ': 'b', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e', 'ꜰ': 'f', 'ғ': 'f',
    'ɢ': 'g', 'ʜ': 'h', 'ɪ': 'i', 'ᴊ': 'j', 'ᴋ': 'k', 'ʟ': 'l', 'ᴍ': 'm',
    'ɴ': 'n', 'ᴏ': 'o', 'ᴘ': 'p', 'ʀ': 'r', 'ѕ': 's', 'ᴛ': 't', 'ᴜ': 'u',
    'ᴠ': 'v', 'ᴡ': 'w', 'ʏ': 'y', 'ᴢ': 'z'
});

class TitleMatcher {
    constructor({ extractor = new TitleTextExtractor() } = {}) {
        this.extractor = extractor;
    }

    match(window, rule = {}) {
        const rawTitle = this.#raw(this.extractor.extract(window?.title));
        const normalizedTitle = this.#normalize(rawTitle);

        if (rule.regex) {
            // Keep raw matching for exact server/resource-pack glyph contracts,
            // then retry against a folded representation. This prevents every
            // new MinerUA small-caps title (for example ᴄʜế ᴛạᴏ / ѕố ʟượɴɢ)
            // from requiring another one-off config regex hotfix.
            const expression = new RegExp(rule.regex, 'i');
            return expression.test(rawTitle) || expression.test(normalizedTitle);
        }

        const rawExpected = this.#raw(rule.value || '');
        const normalizedExpected = this.#normalize(rawExpected);
        return rule.exact
            ? rawTitle === rawExpected || normalizedTitle === normalizedExpected
            : rawTitle.includes(rawExpected) || normalizedTitle.includes(normalizedExpected);
    }

    #raw(value) {
        return String(value ?? '').toLowerCase();
    }

    #normalize(value) {
        return String(value ?? '')
            .replace(/§[0-9a-fk-or]/gi, '')
            .replace(/[ᴀʙᴄᴅᴇꜰғɢʜɪᴊᴋʟᴍɴᴏᴘʀѕᴛᴜᴠᴡʏᴢ]/g, character => SMALL_CAPS[character] || character)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[đĐ]/g, 'd')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }
}

module.exports = TitleMatcher;
