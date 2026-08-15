'use strict';
class InventoryCounter{constructor({scanner}){this.scanner=scanner;}count(snapshot,logicalId,context='inventory'){return this.scanner.scan(snapshot,logicalId,context).reduce((sum,item)=>sum+Number(item.count||0),0);}}
module.exports=InventoryCounter;
