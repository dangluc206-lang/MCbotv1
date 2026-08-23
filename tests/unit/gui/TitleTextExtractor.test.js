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


test('TitleMatcher folds MinerUA small-caps Unicode titles before regex fallback matching', () => {
    const matcher = new TitleMatcher();
    assert.equal(matcher.match({ title: 'ᴄʜế ᴛạᴏ' }, { regex: 'chế tạo|che tao|craft' }), true);
    assert.equal(matcher.match({ title: 'ѕố ʟượɴɢ' }, { regex: 'số lượng|so luong|quantity' }), true);
    assert.equal(matcher.match({ title: 'ɴᴜɴɢ' }, { regex: 'nung|smelt' }), true);
});

test('TitleMatcher normalized exact matching remains compatible with raw stylized exact rules', () => {
    const matcher = new TitleMatcher();
    assert.equal(matcher.match({ title: 'ᴄʜọɴ ᴍáʏ ᴄʜủ' }, { value: 'chon may chu', exact: true }), true);
    assert.equal(matcher.match({ title: 'ᴋʜᴏ đồ #2' }, { value: 'kho do #2', exact: true }), true);
    assert.equal(matcher.match({ title: 'unrelated' }, { value: 'kho do #2', exact: true }), false);
});
