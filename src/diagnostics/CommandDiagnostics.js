'use strict';
class CommandDiagnostics{constructor({commandRegistry}){this.commandRegistry=commandRegistry;}snapshot(){return{keys:this.commandRegistry.keys()};}}
module.exports=CommandDiagnostics;
