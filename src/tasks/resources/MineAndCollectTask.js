// Ported from AltoClef tasks/resources/MineAndCollectTask.java.
// MIT License, Copyright (c) 2020 Adris Jautakas. See third_party/ALTOCLEF_LICENSE.
// The Java inner MineOrCollectTask walks Baritone's mining processes; here the verified
// gather job does the same job (nearest block, drop sweeping, search-when-missing, safe
// staircase descents) under the runner's control ownership.
import {normalizeTargets,countTarget,miningRequirementMet,workerOf,runStep,stepPending,tokenOf,nearestBlock,childFactories,taskCtx,adopt} from './util.js';
import {ResourceTask} from './ResourceTask.js';
import {SatisfyMiningRequirementTask} from './SatisfyMiningRequirementTask.js';

export class MineAndCollectTask extends ResourceTask {
 constructor(targets,blocks,requirement='hand'){
  super(targets);
  this.blocks=Array.isArray(blocks)?blocks:[blocks];
  this.requirement=requirement;
 }
 shouldAvoidPickingUp(){return true;} // the gather job sweeps its own drops, like MineOrCollectTask
 onResourceTick(bot,ctx){
  ctx=taskCtx(this,ctx);
  if(!miningRequirementMet(bot,this.requirement))return adopt(this,new SatisfyMiningRequirementTask(this.requirement));
  const worker=workerOf(ctx);
  if(stepPending(this))return null;
  const needed=Math.max(1,...this.targets.map(t=>t.count-countTarget(bot,t)));
  return runStep(this,bot,ctx,async(b,c)=>{
   // Prefer the closest visible block of the set (port of getClosestTo); when none is in
   // range the gather job's own search explores onward.
   const visible=nearestBlock(b,this.blocks);
   const block=this.blocks.includes(visible?.name)?visible.name:this.blocks[0];
   await worker.gather({spec:{type:'gather',block,count:Math.min(128,needed),searchIfMissing:true}},tokenOf(c));
  });
 }
 isEqualResource(other){return other instanceof MineAndCollectTask&&JSON.stringify(other.blocks)===JSON.stringify(this.blocks)&&JSON.stringify(other.targets)===JSON.stringify(this.targets);}
 toString(){return `Mine And Collect: [${this.blocks}]`;}
}
childFactories.mineAndCollect=(targets,blocks,requirement)=>new MineAndCollectTask(targets,blocks,requirement);
