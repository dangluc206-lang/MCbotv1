'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const TitleTextExtractor = require('../../../src/gui/detection/TitleTextExtractor');
const TitleMatcher = require('../../../src/gui/detection/TitleMatcher');

const richTitle = {
    type: 'compound',
    value: {
        text: { type: 'string', value: 'ᴄʜọɴ ᴍáʏ ᴄʜủ' },
        color: { type: 'string', value: 'black' }
    }
};

test('extracts visible text from a Prismarine-NBT GUI title without style fields', () => {
    const extractor = new TitleTextExtractor();
    assert.equal(extractor.extract(richTitle), 'ᴄʜọɴ ᴍáʏ ᴄʜủ');
});

test('TitleMatcher can exactly identify the captured /sky server-selection GUI title', () => {
    const matcher = new TitleMatcher();
    assert.equal(matcher.match(
        { title: richTitle },
        { value: 'ᴄʜọɴ ᴍáʏ ᴄʜủ', exact: true }
    ), true);
});
