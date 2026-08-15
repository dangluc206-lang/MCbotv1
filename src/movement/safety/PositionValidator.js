'use strict';
class PositionValidator{validate(position){return Boolean(position&&[position.x,position.y,position.z].every(Number.isFinite));}}
module.exports=PositionValidator;
