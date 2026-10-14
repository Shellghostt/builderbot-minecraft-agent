// Ported from AltoClef tasks/CraftInInventoryTask.java: craft in the personal 2x2 grid,
// collecting materials first. MIT License, Copyright (c) 2020 Adris Jautakas.
// See third_party/ALTOCLEF_LICENSE. Recipes come from bot.recipesFor (minecraft-data).
import {craftConfirmed} from '../../crafting.js';
import {countOf,workerOf,runStep,stepPending,tokenOf} from '../resources/util.js';
import {ResourceTask} from '../resources/ResourceTask.js';

export class CraftInInventoryTask extends ResourceTask {
 constructor(item,count=1){
  super({matches:[item],count});
  this.item=item;
 }
 onResourceTick(bot,ctx){
  if(stepPending(this))return null;
  const worker=workerOf(ctx);
  return runStep(this,bot,ctx,async(b,c)=>{
   const check=()=>worker.check(tokenOf(c));
   while(countOf(b,this.item)<this.targets[0].count){
    // Only 2x2 recipes: a 3x3 recipe must go through CraftInTableTask.
    const recipe=b.recipesFor(b.registry.itemsByName[this.item].id,null,1,null).find(r=>!r.requiresTable);
    if(!recipe)throw Error(`${this.item} needs a crafting table; use the table craft task`);
    const before=countOf(b,this.item);
    await craftConfirmed(b,recipe,null,check);
    check();
    if(countOf(b,this.item)<=before)throw Error('Crafting produced no confirmed items');
   }
  });
 }
 isEqualResource(other){return other instanceof CraftInInventoryTask&&other.item===this.item;}
 toString(){return `Craft 2x2: ${this.item} x${this.targets[0].count}`;}
}
