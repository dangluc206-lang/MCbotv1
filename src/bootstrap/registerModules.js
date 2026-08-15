'use strict';
function registerModules(application,runtimes=[]){for(const runtime of runtimes)application.registerRuntime(runtime);return application;}
module.exports=registerModules;
