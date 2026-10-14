// Ported from AltoClef tasks/container/CraftInTableTask.java ("Crafts an item in a
// crafting table, obtaining and placing the table down if none was found") merged with
// our verified craft job's provisioning flow (find within 4, craft one from planks, place,
// run confirmed clicks, pick the placed table back up).
// MIT License, Copyright (c) 2020 Adris Jautakas. See third_party/ALTOCLEF_LICENSE.
import {craftConfirmed} from '../../crafting.js';
import {countOf,workerOf,runStep,stepPending,tokenOf} from '../resources/util.js';
import {ResourceTask} from '../resources/ResourceTask.js';

// The table provisioning the tests exercise directly: a table within 4 blocks wins; else
// craft one in the 2x2 grid; else place one beside the bot. `craft` is injectable so unit
// tests can fake the confirmed-click phase.
export async function ensureTableFor(bot,worker,token,craft=craftConfirmed){
 const existing=bot.findBlock({matching:bot.registry.blocksByName.crafting_table.id,maxDistance:4});
 if(existing)return {block:existing,created:null};
 const check=worker?()=>worker.check(token):()=>{};
 if(worker.count('crafting_table')<1){
  const recipe=bot.recipesFor(bot.registry.itemsByName.crafting_table.id,null,1,null)[0];
  if(!recipe)throw Error('Missing ingredients: need a crafting table, or 4 planks to make one');
  const before=worker.count('crafting_table');
  await craft(bot,recipe,null,check);
  if(worker.count('crafting_table')<=before)throw Error('Crafting a table produced no confirmed item');
 }
 const placedAt=await worker.placeBlockNear(token,'crafting_table');
 const block=bot.blockAt(placedAt);
 if(!block||block.name!=='crafting_table')throw Error('Placing a crafting table was not verified');
 return {block,created:placedAt};
}

export class CraftInTableTask extends ResourceTask {
 constructor(item,count=1){
  super({matches:[item],count});
  this.item=item;
 }
 onResourceTick(bot,ctx){
  if(stepPending(this))return null;
  const worker=workerOf(ctx);
  return runStep(this,bot,ctx,async(b,c)=>{
   const token=tokenOf(c);
   const check=()=>worker.check(token);
   let placedAt=null;
   try{
    while(countOf(b,this.item)<this.targets[0].count){
     const {block,created}=await ensureTableFor(b,worker,token);
     placedAt=created??placedAt;
     const recipe=b.recipesFor(b.registry.itemsByName[this.item].id,null,1,block)[0];
     if(!recipe)throw Error('Missing ingredients or a nearby crafting table');
     const before=countOf(b,this.item);
     await craftConfirmed(b,recipe,block,check);
     check();
     if(countOf(b,this.item)<=before)throw Error('Crafting produced no confirmed items');
    }
   }finally{
    if(placedAt){try{await worker.pickUp(placedAt,'crafting_table',token);}catch(e){worker.log?.('Left the crafting table at '+JSON.stringify(placedAt));}}
   }
  });
 }
 isEqualResource(other){return other instanceof CraftInTableTask&&other.item===this.item;}
 toString(){return `Craft in table: ${this.targets[0].matches[0]} x${this.targets[0].count}`;}
}
