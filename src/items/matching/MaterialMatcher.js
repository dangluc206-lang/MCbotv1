'use strict';
class MaterialMatcher{match(item,rule){return{matched:String(item.name||'').toLowerCase()===String(rule.value||'').toLowerCase(),strength:'STRONG',field:'material'};}}
module.exports=MaterialMatcher;
