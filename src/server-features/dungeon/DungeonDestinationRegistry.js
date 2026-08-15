'use strict';
class DungeonDestinationRegistry{constructor(destinations={}){this.destinations=destinations;}get(id){return this.destinations[id]?{...this.destinations[id]}:null;}require(id){const value=this.get(id);if(!value)throw new Error(`Dungeon destination not found: ${id}`);return value;}}
module.exports=DungeonDestinationRegistry;
