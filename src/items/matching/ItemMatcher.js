'use strict';
class ItemMatcher{constructor({normalizer,composite}){this.normalizer=normalizer;this.composite=composite;}match(rawItem,definition,context='inventory'){const item=this.normalizer.normalize(rawItem);if(!item)return{matched:false,strength:'NONE',reason:'No item'};const representation=definition?.representations?.[context]||definition?.representations?.default||definition;return this.composite.match(item,representation?.rules||[]);}}
module.exports=ItemMatcher;
