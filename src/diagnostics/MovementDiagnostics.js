'use strict';
class MovementDiagnostics{constructor({movementState,positionService}){Object.assign(this,{movementState,positionService});}snapshot(){return{state:this.movementState.get(),position:this.positionService.current()};}}
module.exports=MovementDiagnostics;
