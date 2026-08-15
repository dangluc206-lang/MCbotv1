'use strict';
class LayoutMatcher{match(window,rule={}){if(rule.slotCount!==undefined&&window?.slots?.length!==rule.slotCount)return false;if(rule.type&&window?.type!==rule.type)return false;return true;}}
module.exports=LayoutMatcher;
