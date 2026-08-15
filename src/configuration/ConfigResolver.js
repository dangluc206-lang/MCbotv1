'use strict';
class ConfigResolver{
    constructor(registry){this.registry=registry;}
    get(path, fallback=null){if(typeof path!=='string'||!path.trim())return fallback;const [root,...parts]=path.split('.');let value=this.registry.get(root);for(const part of parts){if(value===null||value===undefined||!Object.prototype.hasOwnProperty.call(value,part))return fallback;value=value[part];}return value;}
    require(path){const value=this.get(path,Symbol.for('missing'));if(value===Symbol.for('missing'))throw new Error(`Configuration path not found: ${path}`);return value;}
}
module.exports=ConfigResolver;
