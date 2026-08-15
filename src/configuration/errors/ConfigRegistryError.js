'use strict';
const ConfigurationError=require('../../shared/errors/ConfigurationError');
class ConfigRegistryError extends ConfigurationError{constructor(message,{code='CONFIG_REGISTRY_ERROR',key=null,cause=null}={}){super(message,{code,cause,details:{key}});this.name='ConfigRegistryError';this.key=key;}}
module.exports=ConfigRegistryError;
