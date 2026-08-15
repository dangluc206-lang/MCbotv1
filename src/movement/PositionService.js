'use strict';
class PositionService{constructor({context}){this.context=context;}current(){const p=this.context.require().entity?.position;if(!p)return null;return Object.freeze({x:p.x,y:p.y,z:p.z});}distance(a,b){if(!a||!b)return Infinity;return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);}hasMoved(from,distance=1){return this.distance(from,this.current())>=distance;}}
module.exports=PositionService;
