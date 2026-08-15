'use strict';
class MovementGuard{constructor({positionValidator,lockPolicy=null}){this.positionValidator=positionValidator;this.lockPolicy=lockPolicy;}assert(destination,owner=null){if(!this.positionValidator.validate(destination))throw new TypeError('Invalid movement destination.');const lockOwner=this.lockPolicy?.owner?.('movement');if(lockOwner&&lockOwner!==owner)throw new Error('Movement is locked by another operation.');return true;}}
module.exports=MovementGuard;
