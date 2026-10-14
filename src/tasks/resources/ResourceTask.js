// Ported from AltoClef tasks/ResourceTask.java: the parent for all "collect an item"
// tasks. MIT License, Copyright (c) 2020 Adris Jautakas. See third_party/ALTOCLEF_LICENSE.
// The slot/cursor phases and the container-cache phase need the slot system and P4 storage
// trackers, so they are guarded: the pickup phase uses bot.entities via the verified
// collect job, and the container phase only runs when ctx.trackers exposes containers.
import {Task} from '../task.js';
import {normalizeTargets,targetsMet,nearestDrop,nearestBlock,runStep,clearStep,tokenOf,childFactories,taskCtx,adopt} from './util.js';

export class ResourceTask extends Task {
 constructor(targets){
  super(new.target.name);
  this.targets=normalizeTargets(targets);
  this.mineBlocks=null; // set by the catalogue (CataloguedResource.mineIfPresent)
 }
 isFinished(bot){return targetsMet(bot,this.targets);}
 onStart(bot){
  clearStep(this);
  this.onResourceStart(bot);
 }
 onStop(bot,interrupt){
  clearStep(this);
  this.onResourceStop(bot,interrupt);
 }
 onTick(bot,ctx){
  ctx=taskCtx(this,ctx);
  if(!this.shouldAvoidPickingUp(bot,ctx)){
   const drop=nearestDrop(bot,this.targets);
   if(drop&&ctx?.worker)return runStep(this,bot,ctx,(b,c)=>c.worker.collect({spec:{type:'collect',radius:8}},tokenOf(c)));
  }
  if(this.mineBlocks?.length){
   const near=nearestBlock(bot,this.mineBlocks);
   if(near){
    // MineAndCollectTask satisfies the mining requirement itself, like the Java default.
    return this.minePresentChild();
   }
  }
  // Java loots the nearest cached container holding our targets; that needs P4's storage
  // trackers, so the phase stays dormant (guarded) until they land.
  const container=ctx?.trackers?.containers?.nearestWith?.(this.targets.flatMap(t=>t.matches),bot.entity?.position);
  if(container&&ctx?.worker?.lootContainerAt){ // P4 hook; absent today
   return runStep(this,bot,ctx,(b,c)=>c.worker.lootContainerAt(container.position,tokenOf(c)));
  }
  return this.onResourceTick(bot,ctx);
 }
 minePresentChild(){
  // Registered by MineAndCollectTask.js to break the extends cycle.
  const make=childFactories.mineAndCollect;
  if(!make)throw Error('MineAndCollectTask not loaded');
  return adopt(this,make(this.targets,this.mineBlocks,'hand'));
 }
 shouldAvoidPickingUp(){return false;}
 onResourceStart(){}
 onResourceStop(){}
 isEqual(other){return other instanceof this.constructor&&this.isEqualResource(other);}
 isEqualResource(){return true;}
}
