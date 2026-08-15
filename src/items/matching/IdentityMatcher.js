'use strict';

const { identitiesEquivalent } = require('../ItemIdentity');

class IdentityMatcher {
    match(item, rule) {
        const expected = String(rule?.value || '').trim();
        const values = [
            ...(Array.isArray(item?.identityComponents) ? item.identityComponents : []),
            ...(Array.isArray(item?.identityNbt) ? item.identityNbt : [])
        ].filter(Boolean).map(String);
        const actual = values.find(value => identitiesEquivalent(expected, value)) || null;
        return {
            matched: Boolean(expected && actual),
            strength: 'VERY_STRONG',
            field: 'identity',
            expected,
            actual
        };
    }
}

module.exports = IdentityMatcher;
