'use strict';
const {immutableClone}=require('../shared/utils/object');
class ItemRegistry{constructor(definitions={}){this.definitions=new Map(Object.entries(definitions));}register(id,definition,{replace=false}={}){if(!replace&&this.definitions.has(id))throw new Error(`Item already registered: ${id}`);this.definitions.set(id,immutableClone(definition));}get(id){return this.definitions.has(id)?immutableClone(this.definitions.get(id)):null;}require(id){const value=this.get(id);if(!value)throw new Error(`Item definition not found: ${id}`);return value;}ids(){return [...this.definitions.keys()];}}
module.exports=ItemRegistry;
