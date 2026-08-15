'use strict';
class ItemInspector{constructor({normalizer,resolver}){this.normalizer=normalizer;this.resolver=resolver;}inspect(item,context='inventory'){return{normalized:this.normalizer.normalize(item),resolved:this.resolver.resolve(item,context)};}}
module.exports=ItemInspector;
