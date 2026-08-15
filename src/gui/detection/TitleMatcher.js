'use strict';

const TitleTextExtractor = require('./TitleTextExtractor');

class TitleMatcher {
    constructor({ extractor = new TitleTextExtractor() } = {}) {
        this.extractor = extractor;
    }

    match(window, rule = {}) {
        const title = this.extractor.extract(window?.title).toLowerCase();
        const expected = String(rule.value || '').toLowerCase();
        return rule.regex
            ? new RegExp(rule.regex, 'i').test(title)
            : rule.exact
                ? title === expected
                : title.includes(expected);
    }
}

module.exports = TitleMatcher;
