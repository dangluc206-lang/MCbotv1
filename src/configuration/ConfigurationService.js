'use strict';
const Result=require('../shared/result/Result');
const Status=require('../shared/result/Status');
class ConfigurationService{
    constructor({loader,validator,registry,logger=null}){this.loader=loader;this.validator=validator;this.registry=registry;this.logger=logger;}
    async load(key,filePath,schemaName=null){try{const value=await this.loader.load(filePath);if(schemaName)this.validator.assertValid(schemaName,value);this.registry.register(key,value);return Result.ok(value,{key,filePath});}catch(error){this.logger?.error?.('Configuration load failed.',{key,filePath,error});return Result.fail(Status.FAILED,error.message,error,{key,filePath});}}
    async reload(key,filePath,schemaName=null){try{const value=await this.loader.load(filePath);if(schemaName)this.validator.assertValid(schemaName,value);this.registry.register(key,value,{replace:true});return Result.ok(value,{key,filePath,reloaded:true});}catch(error){return Result.fail(Status.FAILED,error.message,error,{key,filePath,reloaded:false});}}
    get(key){return this.registry.get(key);} has(key){return this.registry.has(key);}
}
module.exports=ConfigurationService;
