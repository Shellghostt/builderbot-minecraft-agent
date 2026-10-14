// Ported from AltoClef tasks/container/StoreInAnyContainerTask.java (with
// AbstractDoToStorageContainerTask.java): park items in the nearest chest, trapped chest
// or barrel. MIT License, Copyright (c) 2020 Adris Jautakas. See third_party/ALTOCLEF_LICENSE.
// Java scans via the storage tracker; we scan bot.findBlock over the container blocks and
// deposit through the verified deposit job. Without P4 trackers the "get if not present"
// stored-count bookkeeping is skipped.
import {countOf,workerOf,runStep,stepPending,tokenOf,taskCtx} from '../resources/util.js';
import {Task} from '../task.js';

const CONTAINERS=['chest','trapped_chest','barrel'];
export class StoreInAnyContainerTask extends Task {
 // targets: [{name,count?}] - the amount that must end up stored; deposit moves whole
 // stacks, so finite counts over-deposit to the next whole stack (documented
 // simplification vs the Java slot-level moves).
 constructor(targets,getIfNotPresent=false){
  super('StoreInAnyContainer');
  this.targets=(Array.isArray(targets)?targets:[targets]).map(t=>typeof t==='string'?{name:t,count:Infinity}:{name:t.name,count:t.count??Infinity});
  this.getIfNotPresent=getIfNotPresent;
 }
 isFinished(bot){
  return this.targets.every(t=>countOf(bot,t.name)<=(t.count===Infinity?0:t.count));
 }
 onStart(){this._step=null;this._error=null;}
 onTick(bot,ctx){
  ctx=taskCtx(this,ctx);
  if(this._error){const e=this._error;this._error=null;throw e;}
  if(stepPending(this))return null;
  const remaining=this.targets.filter(t=>countOf(bot,t.name)>0);
  if(!remaining.length)return null;
  const ids=CONTAINERS.map(n=>bot.registry?.blocksByName?.[n]?.id).filter(id=>id!==undefined);
  const container=ids.length?bot.findBlock?.({matching:ids.length===1?ids[0]:ids,maxDistance:32}):null;
  if(!container){
   // No container known: Java wanders with TimeoutWanderTask.
   const worker=workerOf(ctx);
   return runStep(this,bot,ctx,(b,c)=>c.worker.explore({spec:{type:'explore',direction:'random',distance:32}},tokenOf(c)));
  }
  const worker=workerOf(ctx);
  return runStep(this,bot,ctx,async(b,c)=>{
   for(const t of remaining){
    await worker.deposit({spec:{type:'deposit',position:{x:container.position.x,y:container.position.y,z:container.position.z},item:t.name}},tokenOf(c));
   }
  });
 }
 isEqual(other){return other instanceof StoreInAnyContainerTask&&JSON.stringify(other.targets)===JSON.stringify(this.targets);}
 toString(){return `Store [${this.targets.map(t=>t.name)}] in any container`;}
}
