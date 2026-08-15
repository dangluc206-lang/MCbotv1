'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');

async function loadBotProfiles({loader,validator,directory='config/bots'}){
    const absolute=path.resolve(directory);
    let names=[];
    try{names=(await fs.readdir(absolute)).filter(name=>name.endsWith('.json')).sort();}
    catch(error){if(error.code==='ENOENT')return[];throw error;}

    // Profiles are independent. Load them concurrently so adding many bots does
    // not make application bootstrap scale linearly with filesystem latency.
    const profiles=await Promise.all(names.map(async name=>{
        const profile=await loader.load(path.join(absolute,name));
        validator.assertValid('bot',profile);
        const envKey=`MCBOT_${profile.id.toUpperCase().replace(/[^A-Z0-9]/g,'_')}_PASSWORD`;
        return Object.freeze({...profile,password:process.env[envKey]||undefined});
    }));
    return profiles;
}
module.exports=loadBotProfiles;
