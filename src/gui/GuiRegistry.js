'use strict';
class GuiRegistry{constructor(definitions={}){this.definitions=new Map(Object.entries(definitions));}get(id){return this.definitions.get(id)||null;}entries(){return [...this.definitions.entries()];}}
module.exports=GuiRegistry;
