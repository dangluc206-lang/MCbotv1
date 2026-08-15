'use strict';
const path=require('node:path');
const loadConfiguration=require('../src/bootstrap/loadConfiguration');
loadConfiguration({baseDir:path.resolve(__dirname,'..')}).then(({registry})=>{console.log(`Loaded ${registry.keys().length} configuration groups.`);for(const key of registry.keys())console.log(`- ${key}`);}).catch(error=>{console.error(error);process.exitCode=1;});
