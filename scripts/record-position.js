'use strict';
const fs=require('node:fs');const path=require('node:path');
const [name,x,y,z]=process.argv.slice(2);if(!name||![x,y,z].every(v=>Number.isFinite(Number(v)))){console.error('Usage: node scripts/record-position.js <name> <x> <y> <z>');process.exitCode=1;}else{const file=path.resolve(__dirname,'../config/movement/locations.json');const data=JSON.parse(fs.readFileSync(file,'utf8'));data[name]={x:Number(x),y:Number(y),z:Number(z)};fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');console.log(`Recorded ${name}.`);}
