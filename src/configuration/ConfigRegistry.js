'use strict';
const ConfigRegistryError=require('./errors/ConfigRegistryError');
const {immutableClone}=require('../shared/utils/object');
class ConfigRegistry{
    constructor(){this.values=new Map();}
    register(key,value,{replace=false}={}){this.#key(key);if(this.values.has(key)&&!replace)throw new ConfigRegistryError(`Configuration key already exists: ${key}`,{code:'CONFIG_KEY_ALREADY_EXISTS',key});this.values.set(key,immutableClone(value));return this.get(key);}
    has(key){return this.values.has(key);}
    get(key){return this.values.has(key)?immutableClone(this.values.get(key)):null;}
    require(key){const value=this.get(key);if(value===null)throw new ConfigRegistryError(`Configuration key not found: ${key}`,{code:'CONFIG_KEY_NOT_FOUND',key});return value;}
    keys(){return [...this.values.keys()];}
    clear(){this.values.clear();}
    #key(key){if(typeof key!=='string'||!key.trim())throw new ConfigRegistryError('Configuration key must be a non-empty string.',{code:'CONFIG_KEY_INVALID',key});}
}
module.exports=ConfigRegistry;
