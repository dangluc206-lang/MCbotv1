'use strict';
class ItemDiagnostics{constructor({itemInspector}){this.itemInspector=itemInspector;}inspect(item,context){return this.itemInspector.inspect(item,context);}}
module.exports=ItemDiagnostics;
