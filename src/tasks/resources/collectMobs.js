// Ported from AltoClef tasks/resources/KillAndLootTask.java, CollectWoolTask.java and
// ShearAndCollectBlockTask.java (the last extends MineAndCollectTask in Java too; here it
// goes through the registered factory so the module graph stays cycle-safe).
// MIT License, Copyright (c) 2020 Adris Jautakas. See third_party/ALTOCLEF_LICENSE.
// The kill phase uses the verified hunt job; shearing uses the verified shear job.
import {countOf,hasItem,workerOf,runStep,stepPending,tokenOf,nearestBlock,nearestEntity,WOOL_COLORS,taskCtx,adopt,childFactories} from './util.js';
import {ResourceTask} from './ResourceTask.js';
import {MineAndCollectTask} from './MineAndCollectTask.js';
import {getItemTask} from '../catalogue.js';

export class KillAndLootTask extends ResourceTask {
 constructor(entity,targets){
  super(targets);
  this.entity=entity;
 }
 onResourceTick(bot,ctx){
  ctx=taskCtx(this,ctx);
  if(stepPending(this))return null;
  const worker=workerOf(ctx);
  if(!nearestEntity(bot,this.entity)){
   // Searching for mob... (Java: TimeoutWanderTask)
   return runStep(this,bot,ctx,(b,c)=>c.worker.explore({spec:{type:'explore',direction:'random',distance:32}},tokenOf(c)));
  }
  return this.killStep(bot,ctx);
 }
 killStep(bot,ctx){
  const worker=workerOf(ctx);
  const needed=Math.max(1,...this.targets.map(t=>t.count-countOf(bot,t.matches[0])));
  return runStep(this,bot,ctx,(b,c)=>c.worker.hunt({spec:{type:'hunt',entity:this.entity,count:Math.min(64,needed),maxSeconds:60}},tokenOf(c)));
 }
 isEqualResource(other){return other instanceof KillAndLootTask&&other.entity===this.entity;}
 toString(){return `Collect items from ${this.entity}`;}
}

export class CollectWoolTask extends ResourceTask {
 constructor(count=1,colors=WOOL_COLORS){
  super({matches:colors.map(c=>`${c}_wool`),count});
  this.colors=colors;
 }
 onResourceTick(bot,ctx){
  ctx=taskCtx(this,ctx);
  if(stepPending(this))return null;
  const woolBlocks=this.targets[0].matches;
  if(nearestBlock(bot,woolBlocks,32))return adopt(this,new MineAndCollectTask(this.targets,woolBlocks,'hand'));
  // If we have shears, shear the nearest sheep; otherwise kill + loot wool.
  if(hasItem(bot,'shears')){
   const worker=workerOf(ctx);
   return runStep(this,bot,ctx,(b,c)=>c.worker.shear({spec:{type:'shear'}},tokenOf(c)));
  }
  return adopt(this,new KillAndLootTask('sheep',this.targets));
 }
 toString(){return `Collect ${this.targets[0].count} wool.`;}
}

export class ShearAndCollectBlockTask extends ResourceTask {
 constructor(targets,blocks){
  super(targets);
  this.blocks=Array.isArray(blocks)?blocks:[blocks];
 }
 onResourceTick(bot,ctx){
  ctx=taskCtx(this,ctx);
  if(!hasItem(bot,'shears'))return getItemTask(bot,'shears',1,ctx);
  return childFactories.mineAndCollect(this.targets,this.blocks,'hand');
 }
 isEqualResource(other){return other instanceof ShearAndCollectBlockTask&&JSON.stringify(other.blocks)===JSON.stringify(this.blocks);}
 toString(){return `Shear and collect: ${this.targets[0].matches}`;}
}
