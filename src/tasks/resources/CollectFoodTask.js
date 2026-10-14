// Ported from AltoClef tasks/resources/CollectFoodTask.java.
// MIT License, Copyright (c) 2020 Adris Jautakas. See third_party/ALTOCLEF_LICENSE.
// Fish are skipped entirely (the Java FISH_PENALTY is 0 because Baritone plays badly
// underwater; ours hunts on land too). Crafting/smelting/killing go through the verified
// craft/smelt/hunt jobs.
import {Task} from '../task.js';
import {countOf,workerOf,runStep,stepPending,clearStep,tokenOf,nearestBlock,nearestEntity,taskCtx,adopt} from './util.js';
import {KillAndLootTask} from './collectMobs.js';
import {CollectCropTask} from './collectCrops.js';
import {MineAndCollectTask} from './MineAndCollectTask.js';

// Preferred mobs first, like the Java table.
const COOKABLE=[
 {raw:'beef',cooked:'cooked_beef',mob:'cow',units:8},
 {raw:'porkchop',cooked:'cooked_porkchop',mob:'pig',units:8},
 {raw:'mutton',cooked:'cooked_mutton',mob:'sheep',units:6},
 {raw:'chicken',cooked:'cooked_chicken',mob:'chicken',units:6},
 {raw:'rabbit',cooked:'cooked_rabbit',mob:'rabbit',units:5},
];
const PICKUPABLE=['enchanted_golden_apple','golden_apple','golden_carrot','bread','baked_potato'];
const CROPS=[
 {item:'wheat',block:'wheat',seed:'wheat_seeds'},
 {item:'carrot',block:'carrots',seed:'carrot'},
 {item:'potato',block:'potatoes',seed:'potato'},
 {item:'beetroot',block:'beetroots',seed:'beetroot_seeds'},
];
function foodPoints(bot,name){return bot.registry?.foodsByName?.[name]?.foodPoints??0;}
export function foodScore(bot){
 return bot.inventory.items().reduce((a,i)=>a+foodPoints(bot,i.name)*i.count,0);
}
export function foodPotential(bot){
 let potential=foodScore(bot);
 for(const c of COOKABLE)potential+=countOf(bot,c.raw)*c.units;
 const breads=Math.floor(countOf(bot,'wheat')/3)+countOf(bot,'hay_block')*3;
 return potential+breads*foodPoints(bot,'bread');
}
export class CollectFoodTask extends Task {
 constructor(unitsNeeded){
  super('CollectFoodTask');
  this.unitsNeeded=unitsNeeded;
 }
 onStart(){clearStep(this);this.current=null;}
 onStop(){clearStep(this);}
 isFinished(bot){return foodScore(bot)>=this.unitsNeeded;}
 onTick(bot,ctx){
  ctx=taskCtx(this,ctx);
  if(this._error){const e=this._error;this._error=null;throw e;}
  if(stepPending(this))return null;
  if(this.current&&!this.current.isFinished(bot))return this.current;
  this.current=null;
  const worker=workerOf(ctx);
  if(foodPotential(bot)>=this.unitsNeeded){
   // Convert our raw foods: wheat -> bread, hay -> wheat, raw -> cooked.
   if(countOf(bot,'wheat')>=3){
    const loaves=Math.floor(countOf(bot,'wheat')/3);
    return runStep(this,bot,ctx,(b,c)=>c.worker.craft({spec:{type:'craft',item:'bread',count:loaves}},tokenOf(c)));
   }
   if(countOf(bot,'hay_block')>=1){
    return runStep(this,bot,ctx,(b,c)=>c.worker.craft({spec:{type:'craft',item:'wheat',count:countOf(bot,'hay_block')*9}},tokenOf(c)));
   }
   const cookable=COOKABLE.find(c=>countOf(bot,c.raw)>0);
   if(cookable){
    return runStep(this,bot,ctx,(b,c)=>c.worker.smelt({spec:{type:'smelt',item:cookable.raw,count:Math.min(48,countOf(bot,cookable.raw))}},tokenOf(c)));
   }
   return null;
  }
  // Gather: pick up good food on the ground, harvest crops, then hunt.
  const drops=Object.values(bot.entities||{}).filter(e=>e&&e.name==='item'&&e.position&&e.position.distanceTo(bot.entity.position)<=20);
  const dropNames=drops.map(e=>e.itemName||e.metadata?.find(m=>m?.itemId)&&bot.registry?.items?.[e.metadata.find(m=>m?.itemId).itemId]?.name).filter(Boolean);
  const pickable=PICKUPABLE.concat(COOKABLE.flatMap(c=>[c.raw,c.cooked])).find(n=>dropNames.includes(n));
  if(pickable&&ctx?.worker){
   return runStep(this,bot,ctx,(b,c)=>c.worker.collect({spec:{type:'collect',radius:16}},tokenOf(c)));
  }
  for(const crop of CROPS){
   const near=nearestBlock(bot,[crop.block],32);
   if(near){
    this.current=adopt(this,new CollectCropTask({matches:[crop.item],count:999999},[crop.block],[crop.seed]));
    return this.current;
   }
  }
  let best=null,bestScore=0;
  const pos=bot.entity.position;
  for(const c of COOKABLE){
   const entity=nearestEntity(bot,c.mob);
   if(!entity)continue;
   const score=100*c.units/Math.max(1,entity.position.distanceTo(pos)**2);
   if(score>bestScore){bestScore=score;best=c;}
  }
  if(best){
   this.current=adopt(this,new KillAndLootTask(best.mob,{matches:[best.raw],count:1}));
   return this.current;
  }
  if(nearestBlock(bot,['sweet_berry_bush'],32)){
   this.current=adopt(this,new MineAndCollectTask({matches:['sweet_berries'],count:999999},['sweet_berry_bush'],'hand'));
   return this.current;
  }
  // Look for food (Java: TimeoutWanderTask).
  return runStep(this,bot,ctx,(b,c)=>c.worker.explore({spec:{type:'explore',direction:'random',distance:32}},tokenOf(c)));
 }
 isEqual(other){return other instanceof CollectFoodTask&&other.unitsNeeded===this.unitsNeeded;}
 toString(){return `Collect ${this.unitsNeeded} units of food.`;}
}
