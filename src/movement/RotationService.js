'use strict';
class RotationService{constructor({context}){this.context=context;}look(yaw,pitch,force=true){return this.context.require().look(yaw,pitch,force);}lookAt(position,force=true){return this.context.require().lookAt(position,force);}}
module.exports=RotationService;
