'use strict';
const StateStore=require('../core/StateStore');
// Phase 1 lifecycle contract: lifecycleState CREATED → INITIALIZED → RUNNING →
// STOPPING → STOPPED | FAILED. STOPPING is patched before lifecycle.stop() so
// reconcile paths (FleetReconciler) fail closed mid-shutdown (invariant I5).
class BotState extends StateStore{constructor(){super({lifecycleState:'CREATED',connectionState:'DISCONNECTED',lastError:null,startedAt:null,stoppedAt:null});}}
module.exports=BotState;
