'use strict';
class RouteRegistry{constructor(routes={}){this.routes=routes;}get(id){return this.routes[id]?this.routes[id].map(point=>({...point})):null;}require(id){const route=this.get(id);if(!route)throw new Error(`Route not found: ${id}`);return route;}}
module.exports=RouteRegistry;
