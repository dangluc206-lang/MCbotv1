'use strict';
class CommandRegistry{constructor(commands={}){this.commands=new Map(Object.entries(commands));}get(key){return this.commands.get(key)||null;}require(key){const value=this.get(key);if(!value)throw new Error(`Server command not configured: ${key}`);return value;}keys(){return [...this.commands.keys()];}}
module.exports=CommandRegistry;
