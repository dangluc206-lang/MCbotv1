'use strict';
module.exports=value=>{const errors=[];if(!value||typeof value!=='object')errors.push('commands config must be an object');for(const [key,command] of Object.entries(value||{}))if(typeof command!=='string'||!command.startsWith('/'))errors.push(`${key} must be a server command string`);return{valid:errors.length===0,errors};};
