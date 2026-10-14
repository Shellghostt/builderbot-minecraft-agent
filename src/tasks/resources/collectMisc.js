// Ported from AltoClef tasks/resources/CollectFuelTask.java, CollectBucketLiquidTask.java
// and CollectBedTask.java. MIT License, Copyright (c) 2020 Adris Jautakas.
// See third_party/ALTOCLEF_LICENSE.
// Bucket liquid goes through the verified use job, which only ever fills at water.
import {Task} from '../task.js';
import {countOf,fuelValueOf,workerOf,runStep,stepPending,clearStep,tokenOf,nearestBlock,WOOL_COLORS,WOOD_SPECIES,taskCtx,adopt,childFactories} from './util.js';
import {ResourceTask} from './ResourceTask.js';
import {MineAndCollectTask} from './MineAndCollectTask.js';
import {getItemTask} from '../catalogue.js';

export class CollectFuelTask extends Task {
 constructor(targetFuel){
  super('CollectFuelTask');
  this.targetFuel=targetFuel;
 }
 onStart(){clearStep(this);this._error=null;}
 isFinished(bot){return fuelValueOf(bot)>=this.targetFuel;}
 onTick(bot,ctx){
  ctx=taskCtx(this,ctx);
  if(this._error){const e=this._error;this._error=null;throw e;}
  if(stepPending(this))return null;
  // Just collect coal for now (8 smelts each), like the Java comment admits.
  const remaining=this.targetFuel-fuelValueOf(bot);
  return getItemTask(bot,'coal',Math.max(1,Math.ceil(remaining/8)),ctx);
 }
 isEqual(other){return other instanceof CollectFuelTask&&Math.abs(other.targetFuel-this.targetFuel)<0.01;}
 toString(){return `Collect Fuel: x${this.targetFuel}`;}
}

export class CollectBucketLiquidTask extends ResourceTask {
 // liquidName 'water' only: the verified use job refuses lava, and so do we.
 constructor(liquidName,filledBucket,count=1){
  super({matches:[filledBucket],count});
  this.liquidName=liquidName;
  this.filledBucket=filledBucket;
 }
 onResourceTick(bot,ctx){
  ctx=taskCtx(this,ctx);
  if(stepPending(this))return null;
  const source=nearestBlock(bot,[this.liquidName],32);
  if(source){
   const worker=workerOf(ctx);
   return runStep(this,bot,ctx,(b,c)=>c.worker.use({spec:{type:'use',item:'bucket',position:{x:source.position.x,y:source.position.y,z:source.position.z}}},tokenOf(c)));
  }
  // Java wanders; the explore job is our verified wander.
  return runStep(this,bot,ctx,(b,c)=>c.worker.explore({spec:{type:'explore',direction:'random',distance:32}},tokenOf(c)));
 }
 isEqualResource(other){return other instanceof CollectBucketLiquidTask&&other.filledBucket===this.filledBucket;}
 toString(){return `Collect ${this.targets[0].count} ${this.filledBucket}`;}
}

export class CollectBedTask extends ResourceTask {
 // Top 3 slots are wool and must match; the bottom 3 are any planks. Java extends
 // CraftWithMatchingWoolTask; here the subclass decision tree runs through the registered
 // factory so the module graph stays cycle-safe.
 constructor(beds,woolMatches,count=1){
  super({matches:beds,count});
  this.beds=beds;
  this.woolMatches=woolMatches;
 }
 onResourceTick(bot,ctx){
  ctx=taskCtx(this,ctx);
  if(stepPending(this))return null;
  const beds=this.beds;
  // Break beds from the world if possible, that would be pretty fast.
  const near=nearestBlock(bot,beds,32);
  if(near)return adopt(this,new MineAndCollectTask({matches:beds,count:1},beds,'hand'));
  const w={matches:this.woolMatches,count:1},p={matches:['planks'],count:1};
  return childFactories.craftWithMatchingWool(this.targets[0],color=>`${color}_bed`,{slots:[w,w,w,p,p,p,null,null,null],outputCount:1},[true,true,true,false,false,false,false,false,false]);
 }
 toString(){return `Crafting bed: ${this.targets[0].matches} x${this.targets[0].count}`;}
}
export function bedFamily(bot){
 const names=bot.registry?.itemsByName;
 const colors=names?WOOL_COLORS.filter(c=>names[`${c}_bed`]):WOOL_COLORS;
 return colors.map(c=>`${c}_bed`);
}
export function woolFamily(bot){
 const names=bot.registry?.itemsByName;
 const colors=names?WOOL_COLORS.filter(c=>names[`${c}_wool`]):WOOL_COLORS;
 return colors.map(c=>`${c}_wool`);
}
export function planksFamily(bot){
 const names=bot.registry?.itemsByName;
 return (names?WOOD_SPECIES.filter(s=>names[`${s}_planks`]):WOOD_SPECIES).map(s=>`${s}_planks`);
}
