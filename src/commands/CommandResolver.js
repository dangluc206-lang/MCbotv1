'use strict';
class CommandResolver{constructor({registry}){this.registry=registry;}resolve(key,args={}){let command=this.registry.require(key);for(const [name,value] of Object.entries(args))command=command.replaceAll(`{${name}}`,String(value));if(/\{[^}]+\}/.test(command))throw new Error(`Missing command arguments for ${key}`);return command;}}
module.exports=CommandResolver;
