'use strict';
class RecoveryPositionStore{constructor(){this.position=null;}save(position){this.position=position?Object.freeze({...position}):null;}get(){return this.position?{...this.position}:null;}clear(){this.position=null;}}
module.exports=RecoveryPositionStore;
