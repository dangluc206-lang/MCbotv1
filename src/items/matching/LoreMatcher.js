'use strict';
class LoreMatcher{match(item,rule){const lore=(item.lore||[]).join('\n').toLowerCase();const expected=String(rule.value||'').toLowerCase();return{matched:rule.exact?lore===expected:lore.includes(expected),strength:'MEDIUM',field:'lore'};}}
module.exports=LoreMatcher;
