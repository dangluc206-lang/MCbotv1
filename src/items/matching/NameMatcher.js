'use strict';
class NameMatcher{match(item,rule){const expected=String(rule.value||'').toLowerCase();const actual=String(item.displayName||item.name||'').toLowerCase();return{matched:rule.exact?actual===expected:actual.includes(expected),strength:'WEAK',field:'name'};}}
module.exports=NameMatcher;
