// Ported from AltoClef tasks/container/SmeltInFurnaceTask.java and the fuel/material
// collection it delegates to (CollectFuelTask.java). MIT License, Copyright (c) 2020
// Adris Jautakas. See third_party/ALTOCLEF_LICENSE.
// The furnace run itself is the verified smelt job: it finds or provisions a furnace
// (crafting one from 8 cobblestone through a table first), plans fuel, waits for the
// output and verifies the count. Inputs/outputs come from src/smelting.js.
import {craftConfirmed} from '../../crafting.js';
import {smeltingOutput} from '../../smelting.js';
import {countOf,countAny,fuelValueOf,workerOf,runStep,stepPending,tokenOf,woodSpecies} from '../resources/util.js';
import {ResourceTask} from '../resources/ResourceTask.js';
import {CollectFuelTask} from '../resources/collectMisc.js';
import {getItemTask} from '../catalogue.js';
import {ensureTableFor} from './CraftInTableTask.js';

export async function ensureFurnaceFor(bot,worker,token,craft=craftConfirmed){
 const existing=bot.findBlock({matching:bot.registry.blocksByName.furnace.id,maxDistance:16});
 if(existing)return {block:existing,created:null};
 const check=worker?()=>worker.check(token):()=>{};
 if(worker.count('furnace')<1){
  const table=await ensureTableFor(bot,worker,token,craft); // the verified smelt job provisions a table too
  const recipe=bot.recipesFor(bot.registry.itemsByName.furnace.id,null,1,table.block)[0];
  if(!recipe)throw Error('Missing ingredients: need a furnace, or 8 cobblestone to make one');
  const before=worker.count('furnace');
  await craft(bot,recipe,table.block,check);
  if(worker.count('furnace')<=before)throw Error('Crafting a furnace produced no confirmed item');
 }
 const placedAt=await worker.placeBlockNear(token,'furnace');
 const block=bot.blockAt(placedAt);
 if(!block||block.name!=='furnace')throw Error('Placing a furnace was not verified');
 return {block,created:placedAt};
}

function outputOf(input,forced){
 const output=forced??smeltingOutput(input);
 if(!output)throw Error('Unknown smelting output for '+input);
 return output;
}
export class SmeltInFurnaceTask extends ResourceTask {
 // input: item (or 'log' for any species); count: total outputs wanted.
 constructor(input,count=1,output=null){
  super({matches:[outputOf(input,output)],count});
  this.input=input;
 }
 inputCount(bot){
  if(this.input!=='log')return countOf(bot,this.input);
  return countAny(bot,woodSpecies(bot).map(s=>`${s}_log`));
 }
 concreteInput(bot){
  if(this.input!=='log')return this.input;
  // Smelt whichever species we hold most of; every log smelts to charcoal.
  return woodSpecies(bot).map(s=>`${s}_log`).sort((a,b)=>countOf(bot,b)-countOf(bot,a))[0];
 }
 onResourceTick(bot,ctx){
  if(stepPending(this))return null;
  const wanted=this.targets[0].count;
  const remaining=wanted-countOf(bot,this.targets[0].matches[0]);
  if(remaining<=0)return null;
  if(this.inputCount(bot)<remaining){
   // Collect materials first (Java: the SmeltTarget material collection).
   return getItemTask(bot,this.input,remaining,ctx);
  }
  if(fuelValueOf(bot)<=0)return new CollectFuelTask(remaining);
  const worker=workerOf(ctx);
  return runStep(this,bot,ctx,async(b,c)=>{
   const item=this.concreteInput(b);
   const batch=Math.min(48,remaining,this.inputCount(b));
   await worker.smelt({spec:{type:'smelt',item,count:batch}},tokenOf(c));
  });
 }
 isEqualResource(other){return other instanceof SmeltInFurnaceTask&&other.input===this.input;}
 toString(){return `Smelt ${this.input} -> ${this.targets[0].matches[0]} x${this.targets[0].count}`;}
}
