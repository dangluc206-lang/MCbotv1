'use strict';
class SessionManager{constructor({botId}){this.botId=botId;this.session=null;}open(client,generation){this.session=Object.freeze({client,generation,openedAt:Date.now()});return this.session;}current(){return this.session;}isCurrent(client,generation){return Boolean(this.session&&this.session.client===client&&this.session.generation===generation);}close(client=null){if(!this.session)return false;if(client&&this.session.client!==client)return false;this.session=null;return true;}}
module.exports=SessionManager;
