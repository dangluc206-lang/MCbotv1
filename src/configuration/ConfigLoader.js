'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const ConfigLoadError=require('./errors/ConfigLoadError');
const {deepFreeze}=require('../shared/utils/object');
class ConfigLoader{
    constructor({baseDir=process.cwd()}={}){this.baseDir=path.resolve(baseDir);}
    async load(filePath){
        if(typeof filePath!=='string'||!filePath.trim())throw new TypeError('filePath must be a non-empty string');
        const resolved=path.isAbsolute(filePath)?filePath:path.resolve(this.baseDir,filePath);
        let text;try{text=await fs.readFile(resolved,'utf8');}catch(e){if(e.code==='ENOENT')throw ConfigLoadError.notFound(resolved,e);throw ConfigLoadError.readFailed(resolved,e);}
        try{return deepFreeze(JSON.parse(text));}catch(e){throw ConfigLoadError.invalidJson(resolved,e);}
    }
}
module.exports=ConfigLoader;
