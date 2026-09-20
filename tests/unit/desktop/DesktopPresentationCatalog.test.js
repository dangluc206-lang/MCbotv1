'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const MessageCatalog = require('../../../src/desktop/presentation/MessageCatalog');
const CommandPaletteCatalog = require('../../../src/desktop/presentation/CommandPaletteCatalog');

test('Desktop presentation catalogs provide Vietnamese fallback and progressive disclosure', () => {
    assert.equal(MessageCatalog.message('term.incident'), 'Sự cố');
    assert.match(MessageCatalog.message('missing.key'), /missing\.key/);
    assert.equal(CommandPaletteCatalog.search('', { experienceLevel: 'standard' }).some(entry => entry.group === 'ADVANCED'), false);
    assert.equal(CommandPaletteCatalog.search('diagnostics', { experienceLevel: 'advanced' })[0].route, 'diagnostics');
    assert.equal(CommandPaletteCatalog.search('diagnostics', { experienceLevel: 'standard' }).length, 0);
    assert.equal(CommandPaletteCatalog.ENTRIES.some(entry => entry.route === 'incidents'), true);
});
