// Ported from AltoClef tasks/resources/CollectPlanksTask.java and CollectSticksTask.java.
// MIT License, Copyright (c) 2020 Adris Jautakas. See third_party/ALTOCLEF_LICENSE.
// Crafting goes through the verified craft job (minecraft-data recipes, confirmed clicks).
import {countOf,countAny,plankOf,logOf,workerOf,runStep,stepPending,tokenOf,nearestBlock,taskCtx,adopt} from './util.js';
import {ResourceTask} from './ResourceTask.js';
import {MineAndCollectTask} from './MineAndCollectTask.js';

export class CollectPlanksTask extends ResourceTask {
 // targets: 'oak_planks' for one species, or {matches:[...all species]} for the family.
 constructor(targets,count=1){
  super(typeof targets==='string'?{matches:[targets],count}:{matches:targets.matches,count:targets.count??count});
 }
 onResourceTick(bot,ctx){
  ctx=taskCtx(this,ctx);
  if(stepPending(this))return null;
  const family=this.targets[0].matches;
  const wanted=this.targets[0].count;
  const totalPlanks=countAny(bot,family);
  const totalLogs=family.reduce((a,p)=>a+countOf(bot,logOf(p)),0);
  if(totalPlanks+totalLogs*4>=wanted){
   // Craft from whichever log species we hold (Java iterates the logs the same way).
   const withLogs=family.find(plank=>countOf(bot,logOf(plank))>0);
   const plank=withLogs??family[0];
   const needed=Math.max(1,wanted-totalPlanks);
   const worker=workerOf(ctx);
   return runStep(this,bot,ctx,(b,c)=>c.worker.craft({spec:{type:'craft',item:plank,count:needed}},tokenOf(c)));
  }
  // Collect logs; the 'log' gather matches every species so the bot is not pinned to oak.
  const blocks=family.length>1?['log']:family.map(plankOf);
  return adopt(this,new MineAndCollectTask(this.targets,blocks,'hand'));
 }
 toString(){return `Crafting ${this.targets[0].count} planks [${this.targets[0].matches}]`;}
}

export class CollectSticksTask extends ResourceTask {
 constructor(count=1){
  super({matches:['stick'],count});
 }
 onResourceTick(bot,ctx){
  ctx=taskCtx(this,ctx);
  if(stepPending(this))return null;
  // Java mines a nearby dead bush first (sticks drop from it).
  const bush=nearestBlock(bot,['dead_bush'],20);
  if(bush)return adopt(this,new MineAndCollectTask({matches:['stick'],count:999999},['dead_bush'],'hand'));
  const needed=Math.max(1,this.targets[0].count-countOf(bot,'stick'));
  const worker=workerOf(ctx);
  return runStep(this,bot,ctx,(b,c)=>c.worker.craft({spec:{type:'craft',item:'stick',count:needed}},tokenOf(c)));
 }
 toString(){return `Crafting ${this.targets[0].count} sticks`;}
}
