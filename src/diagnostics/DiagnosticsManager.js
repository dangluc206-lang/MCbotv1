'use strict';
class DiagnosticsManager{constructor(diagnostics={}){this.diagnostics=diagnostics;}get(name){return this.diagnostics[name]||null;}snapshot(){return Object.fromEntries(Object.entries(this.diagnostics).map(([name,value])=>[name,value.snapshot?.()||null]));}}
module.exports=DiagnosticsManager;
