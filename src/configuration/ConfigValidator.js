'use strict';
const ConfigValidationError=require('./errors/ConfigValidationError');
class ConfigValidator{
    constructor(schemas={}){this.schemas=new Map(Object.entries(schemas));}
    register(name,validator){if(typeof name!=='string'||!name.trim())throw new TypeError('schema name is required');if(typeof validator!=='function')throw new TypeError('validator must be a function');if(this.schemas.has(name))throw new Error(`Schema already registered: ${name}`);this.schemas.set(name,validator);return this;}
    validate(name,value){const validator=this.schemas.get(name);if(!validator)return{valid:false,errors:[`Schema not found: ${name}`]};try{const result=validator(value);if(!result||typeof result.valid!=='boolean')return{valid:false,errors:['Validator returned an invalid contract.']};return{valid:result.valid,errors:Array.isArray(result.errors)?result.errors:[]};}catch(e){return{valid:false,errors:[e.message],cause:e};}}
    assertValid(name,value){const result=this.validate(name,value);if(!result.valid)throw new ConfigValidationError(name,result.errors,{cause:result.cause});return value;}
}
module.exports=ConfigValidator;
