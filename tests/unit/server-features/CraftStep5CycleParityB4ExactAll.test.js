'use strict';
// ACT E-pre3 - B4 exact-ALL parity lock (legacy reference: service.legacyCycle;
// production execution: service.cycle = generic CraftCycleCoordinator post-E-CUTOVER).
const test = require('node:test');
const assert = require('node:assert/strict');
const Result = require('../../../src/shared/result/Result');
const CraftAutomationService = require('../../../src/server-features/crafting/CraftAutomationService');
const StageExecutionContract = require('../../../src/server-features/crafting/verification/StageExecutionContract');
class HarnessContract extends StageExecutionContract {
  verifyOutput(o){ const d=Number(o?.after)-Number(o?.before);
    if(!Number.isFinite(Number(o?.after))||d<=0) return {...o,tolerated:true};
    return super.verifyOutput(o); }
  requireSettled(o){ if(o?.settlement&&o.settlement.settled===false) return o.settlement;
    return super.requireSettled(o); }
}
function rig(){
  const calls=[]; const counts={x:128,y:256,carbon:0};
  const planningService={ async inspectAdditional(){ return Result.ok({
    personalVault:{totals:{super_alloy:0}}, fullPlan:{targetId:'super_alloy',feasible:true},
    chains:[], finalSteps:[{recipeId:'carbon-recipe',outputId:'carbon',crafts:32},
      {recipeId:'super-alloy-recipe',outputId:'super_alloy',crafts:1}] }); } };
  const recipes={'carbon-recipe':{output:'carbon',inputs:{x:4,y:8}},
    'super-alloy-recipe':{output:'super_alloy',inputs:{carbon:32}}};
  const service=new CraftAutomationService({ craftingVerificationService:new HarnessContract(),
    planningService,
    crafting:{ async craft(rid,q){ calls.push('craft:'+rid+':'+q);
      if(rid==='carbon-recipe'){counts.x=0;counts.y=0;counts.carbon=32; return Result.ok({actualCrafts:32});}
      counts.carbon=0; return Result.ok({actualCrafts:1}); } },
    personalVault:{ async deposit(id){calls.push('deposit:'+id);
        return Result.ok({actualCrafts:1,verification:{before:0,after:1}});},
      async read(){return Result.ok({totals:{super_alloy:1}});},
      async withdraw(id){calls.push('withdraw:'+id); return Result.ok({movedStacks:0});} },
    storage:{},
    b1Materials:{ async ensureBaseAvailable(){return Result.ok({actualCrafts:1,verification:{before:0,after:1}});},
      async compact(){return Result.ok({actualCrafts:1,verification:{before:0,after:1}});},
      async compactAll(){return Result.ok({actualCrafts:1,verification:{before:0,after:1}});},
      async sellLargestStoredBlock(){return Result.ok({}); } },
    inventoryReader:{readBotInventory:()=>({source:'bot-inventory',emptySlotCount:0,counts:{...counts}})},
    inventoryCounter:{count:(s,id)=>Number(s.counts?.[id]||0)},
    recipeRegistry:{require:id=>recipes[id]},
    operationManager:{ async run(op){ const tk={throwIfCancelled(){},onCancelled(){return()=>{};}};
      return Result.ok(await op.executor({cancellation:{token:tk}})); } },
    config:{targetId:'super_alloy',timeoutMs:1000,inventorySafetyEmptySlots:2,
      quantityOptimization:{enabled:true,useAllForB2:true,useAllForB3:true,useAllForB4WhenExact:true,useAllForB5:false}} });
  return {service,calls};
}
function ctx(){ return { cancellation:{token:{throwIfCancelled(){},onCancelled(){return()=>{};}}},
  trace:null, connectionGeneration:1 }; }
function opts(){ return { additional:true, mode:'production', craftFinalTarget:true, allowNewB2:true,
  freshInspection:false, recoveryOnly:false, decompressionPolicy:'unbounded',
  decompressionMaxUsageRatio:null, requireKnownCapacity:false, targetId:'super_alloy' }; }
test('e-pre3: legacy final B4 ALL with no withdraw (locked)', async () => {
  const {service,calls}=rig();
  const r=await service.legacyCycle.execute(1,ctx(),opts());
  assert.equal(r.completedTarget,true);
  assert.deepEqual(calls.filter(c=>c.startsWith('craft:')),['craft:carbon-recipe:ALL','craft:super-alloy-recipe:1']);
  assert.equal(calls.some(c=>c.startsWith('withdraw:')),false,'locked: '+JSON.stringify(calls));
});

// E-pre3 parity lock: generic promotion leaves the exact-ALL final
// reservation to the final chain, so both stacks craft ALL with no withdraw.
test('e-pre3: generic matches legacy final B4 ALL with no withdraw', async () => {
  const {service,calls}=rig();
  const r=await service.cycle.execute(1,ctx(),opts());
  assert.equal(r.completedTarget,true);
  assert.deepEqual(calls.filter(c=>c.startsWith('craft:')),['craft:carbon-recipe:ALL','craft:super-alloy-recipe:1']);
  assert.equal(calls.some(c=>c.startsWith('withdraw:')),false,'parity: '+JSON.stringify(calls));
});
