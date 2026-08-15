'use strict';
class SlotDiagnostics{constructor({slotInspector,guiManager}){Object.assign(this,{slotInspector,guiManager});}inspect(slot){const session=this.guiManager.current();if(!session)throw new Error('No active GUI session.');return this.slotInspector.inspect(session.window,slot);}}
module.exports=SlotDiagnostics;
