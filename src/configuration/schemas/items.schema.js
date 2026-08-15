'use strict';
module.exports=value=>({valid:Boolean(value&&typeof value==='object'),errors:value&&typeof value==='object'?[]:['items config must be an object']});
