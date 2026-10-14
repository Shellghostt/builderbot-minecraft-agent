// Ported from AltoClef tasks/resources/CollectCropTask.java, CollectWheatTask.java,
// CollectWheatSeedsTask.java and CollectHayBlockTask.java.
// MIT License, Copyright (c) 2020 Adris Jautakas. See third_party/ALTOCLEF_LICENSE.
// Block tracking (P4) is replaced by bot.findBlocks scans; harvesting digs mature crops
// only, and replanting goes through the verified use job.
import {countOf,hasItem,workerOf,runStep,stepPending,tokenOf,nearestBlocks,nearestBlock,blockMature,taskCtx,adopt} from './util.js';
import {ResourceTask} from './ResourceTask.js';
import {MineAndCollectTask} from './MineAndCollectTask.js';
import {getItemTask} from '../catalogue.js';

export class CollectCropTask extends ResourceTask {
 // cropToCollect: target; cropBlocks: crop block names; cropSeeds: seed item names.
 constructor(cropToCollect,cropBlocks,cropSeeds){
  super(cropToCollect);
  this.cropBlocks=Array.isArray(cropBlocks)?cropBlocks:[cropBlocks];
  this.cropSeeds=Array.isArray(cropSeeds)?cropSeeds:[cropSeeds];
  this.emptyCropland=[];
 }
 isFinished(bot){
  // Don't stop while we're replanting crops.
  if(this.shouldReplantNow(bot))return false;
  return super.isFinished(bot);
 }
 shouldReplantNow(bot){return this.emptyCropland.length>0&&this.cropSeeds.some(s=>hasItem(bot,s));}
 onStart(bot){super.onStart(bot);this.emptyCropland=[];}
 onResourceTick(bot,ctx){
  ctx=taskCtx(this,ctx);
  if(stepPending(this))return null;
  const worker=workerOf(ctx);
  if(this.shouldReplantNow(bot)){
   const spot=this.emptyCropland.map(key=>key.split(',').map(Number)).map(([x,y,z])=>({x,y,z})).find(p=>{
    const here=bot.blockAt?.(p),below=bot.blockAt?.({x:p.x,y:p.y-1,z:p.z});
    return here&&here.boundingBox==='empty'&&below?.name==='farmland';
   });
   if(spot){
    const seed=this.cropSeeds.find(s=>hasItem(bot,s));
    return runStep(this,bot,ctx,(b,c)=>c.worker.use({spec:{type:'use',item:seed,position:spot}},tokenOf(c)));
   }
  }
  const mature=nearestBlocks(bot,this.cropBlocks,32).map(p=>bot.blockAt(p)).filter(b=>b&&blockMature(bot,b))[0];
  if(mature){
   return runStep(this,bot,ctx,async(b,c)=>{
    const below=mature.position.offset(0,-1,0);
    await worker.walk(mature.position,tokenOf(c),2);
    if(b.blockAt(mature.position)?.name!==mature.name)return; // gone; re-decide next tick
    await b.dig(mature);
    if(b.blockAt(below)?.name==='farmland')this.emptyCropland.push(`${below.x},${below.y},${below.z}`);
    await worker.sweepDrops(tokenOf(c));
   });
  }
  // Java wanders (TimeoutWanderTask); the explore job is our verified wander.
  return runStep(this,bot,ctx,(b,c)=>c.worker.explore({spec:{type:'explore',direction:'random',distance:32}},tokenOf(c)));
 }
 isEqualResource(other){
  return other instanceof CollectCropTask&&JSON.stringify(other.cropBlocks)===JSON.stringify(this.cropBlocks)&&JSON.stringify(other.cropSeeds)===JSON.stringify(this.cropSeeds)&&JSON.stringify(other.targets)===JSON.stringify(this.targets);
 }
 toString(){return `Collecting crops: ${this.targets[0].matches}`;}
}

export class CollectWheatTask extends ResourceTask {
 constructor(count=1){super({matches:['wheat'],count});}
 onResourceTick(bot,ctx){
  ctx=taskCtx(this,ctx);
  if(stepPending(this))return null;
  const wanted=this.targets[0].count;
  const potential=countOf(bot,'wheat')+9*countOf(bot,'hay_block');
  if(potential>=wanted){
   const needed=Math.max(1,wanted-countOf(bot,'wheat'));
   const worker=workerOf(ctx);
   return runStep(this,bot,ctx,(b,c)=>c.worker.craft({spec:{type:'craft',item:'wheat',count:needed}},tokenOf(c)));
  }
  if(nearestBlock(bot,['hay_block'],32))return adopt(this,new MineAndCollectTask({matches:['hay_block'],count:999999},['hay_block'],'hand'));
  return adopt(this,new CollectCropTask(this.targets,['wheat'],['wheat_seeds']));
 }
 toString(){return `Collecting ${this.targets[0].count} wheat.`;}
}

export class CollectWheatSeedsTask extends ResourceTask {
 constructor(count=1){super({matches:['wheat_seeds'],count});}
 onResourceTick(bot,ctx){
  ctx=taskCtx(this,ctx);
  if(nearestBlock(bot,['wheat'],32)){
   // Collect the dropped seeds; the crop item itself is not the goal here.
   return adopt(this,new CollectCropTask(this.targets,['wheat'],['wheat_seeds']));
  }
  return adopt(this,new MineAndCollectTask(this.targets,grassNames(bot),'hand'));
 }
 toString(){return `Collecting ${this.targets[0].count} wheat seeds.`;}
}
function grassNames(bot){
 const names=bot.registry?.blocksByName;
 const wanted=['short_grass','tall_grass','grass','fern'];
 return names?wanted.filter(n=>names[n]):['short_grass','tall_grass'];
}

export class CollectHayBlockTask extends ResourceTask {
 constructor(count=1){super({matches:['hay_block'],count});}
 onResourceTick(bot,ctx){
  ctx=taskCtx(this,ctx);
  if(stepPending(this))return null;
  if(nearestBlock(bot,['hay_block'],32))return adopt(this,new MineAndCollectTask(this.targets,['hay_block'],'hand'));
  // Java crafts 9 wheat -> hay in a table; the howto-driven obtain plans the same chain
  // and gathers the wheat first when needed.
  const worker=workerOf(ctx);
  return runStep(this,bot,ctx,(b,c)=>c.worker.obtain({spec:{type:'obtain',item:'hay_block',count:this.targets[0].count}},tokenOf(c)));
 }
 toString(){return `Collecting ${this.targets[0].count} hay blocks.`;}
}
