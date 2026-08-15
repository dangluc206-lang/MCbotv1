'use strict';
class GuiDiagnostics{constructor({guiManager}){this.guiManager=guiManager;}snapshot(){const session=this.guiManager.current();return session?{active:session.active,id:session.id,definitionId:session.definitionId,title:session.window?.title,slotCount:session.window?.slots?.length||0}:{active:false};}}
module.exports=GuiDiagnostics;
