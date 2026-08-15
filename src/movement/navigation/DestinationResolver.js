'use strict';
class DestinationResolver{constructor(locations={}){this.locations=locations;}resolve(destination){if(typeof destination==='string'){const value=this.locations[destination];if(!value)throw new Error(`Location not found: ${destination}`);return{...value,id:destination};}if(destination&&[destination.x,destination.y,destination.z].every(Number.isFinite))return{...destination};throw new TypeError('Invalid destination');}}
module.exports=DestinationResolver;
