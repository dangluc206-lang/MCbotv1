'use strict';
const {immutableClone}=require('../../shared/utils/object');
class CraftingRecipeRegistry{constructor(recipes={}){this.recipes=new Map(Object.entries(recipes));}get(id){return this.recipes.has(id)?immutableClone(this.recipes.get(id)):null;}require(id){const value=this.get(id);if(!value)throw new Error(`Crafting recipe not found: ${id}`);return value;}ids(){return [...this.recipes.keys()];}}
module.exports=CraftingRecipeRegistry;
