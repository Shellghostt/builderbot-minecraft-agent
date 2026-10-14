// Ported from AltoClef tasks/resources/CraftWithMatchingMaterialsTask.java,
// CraftWithMatchingPlanksTask.java and CraftWithMatchingWoolTask.java.
// MIT License, Copyright (c) 2020 Adris Jautakas. See third_party/ALTOCLEF_LICENSE.
// Java crafts a "samed" recipe by hand; here the craft goes through the verified obtain
// job so howto.js (minecraft-data) stays the recipe source of truth for this server
// version - the majority species is baked into the requested output item instead.
import {countOf,countTarget,workerOf,runStep,stepPending,tokenOf,speciesForPlank,logOf,taskCtx,adopt,childFactories} from './util.js';
import {ResourceTask} from './ResourceTask.js';
import {getItemTask} from '../catalogue.js';

export class CraftWithMatchingMaterialsTask extends ResourceTask {
 // target: {matches,count}; recipe: {slots:[target|null,...],outputCount}; sameMask: bool per slot.
 constructor(target,recipe,sameMask){
  super(target);
  this.recipe=recipe;
  this.sameMask=sameMask;
  if(recipe.slots.length!==sameMask.length)throw Error('CraftWithMatchingMaterialsTask: recipe size must equal sameMask size');
  let perRecipe=0,sameResourceTarget=null;
  for(let i=0;i<recipe.slots.length;i++)if(sameMask[i]){perRecipe++;sameResourceTarget=recipe.slots[i];}
  this.perRecipe=perRecipe;
  this.sameResourceTarget=sameResourceTarget;
 }
 onResourceTick(bot,ctx){
  ctx=taskCtx(this,ctx);
  if(stepPending(this))return null;
  const needed=this.targets[0].count-countTarget(bot,this.targets[0]);
  let canCraftTotal=0,majorityCraftCount=0,majorityItem=null;
  for(const same of this.sameResourceTarget.matches){
   const count=this.getExpectedTotalCountOfSameItem(bot,same);
   const canCraft=Math.floor(count/this.perRecipe)*this.recipe.outputCount;
   canCraftTotal+=canCraft;
   if(canCraft>majorityCraftCount){majorityCraftCount=canCraft;majorityItem=same;}
  }
  if(canCraftTotal>=needed){
   // We have enough of the same resource, counting conversions...
   let trueCanCraftTotal=0;
   for(const same of this.sameResourceTarget.matches)trueCanCraftTotal+=Math.floor(countOf(bot,same)/this.perRecipe)*this.recipe.outputCount;
   if(trueCanCraftTotal<needed)return this.getSpecificSameResourceTask(bot,ctx,needed);
   const toCraftTotal=Math.max(1,Math.min(majorityCraftCount+countTarget(bot,this.targets[0]),this.targets[0].count));
   const output=this.getSpecificItemCorrespondingToMajorityResource(majorityItem);
   const worker=workerOf(ctx);
   return runStep(this,bot,ctx,(b,c)=>c.worker.obtain({spec:{type:'obtain',item:output,count:toCraftTotal}},tokenOf(c)));
  }
  // Collect SAME resources first!!!
  return this.getAllSameResourcesTask(bot,ctx);
 }
 getAllSameResourcesTask(bot,ctx){return getItemTask(bot,this.sameResourceTarget.matches[0],999999,ctx);}
 getExpectedTotalCountOfSameItem(bot,same){return countOf(bot,same);}
 getSpecificSameResourceTask(){return null;} // "Uh oh!!! ... Now we're stuck." (Java logs the same)
 isEqualResource(other){
  return other instanceof this.constructor&&JSON.stringify(other.targets)===JSON.stringify(this.targets);
 }
}

export class CraftWithMatchingPlanksTask extends CraftWithMatchingMaterialsTask {
 // validTargets: every wood variant of the item; getTargetItem(prefix) maps a species to
 // its variant (e.g. oak_stairs); counts logs as 4 planks like ItemHelper does.
 constructor(validTargets,getTargetItem,recipe,sameMask,count){
  super({matches:validTargets,count},recipe,sameMask);
  this.getTargetItem=getTargetItem;
 }
 getExpectedTotalCountOfSameItem(bot,same){return countOf(bot,same)+countOf(bot,logOf(same))*4;}
 getSpecificSameResourceTask(bot,ctx,needed){
  for(const plank of this.sameResourceTarget.matches)if(countOf(bot,logOf(plank))>=1)return getItemTask(bot,plank,Math.max(1,needed),ctx);
  return null;
 }
 getSpecificItemCorrespondingToMajorityResource(majority){return this.getTargetItem(speciesForPlank(majority));}
 getAllSameResourcesTask(bot,ctx){return getItemTask(bot,'planks',999999,ctx);}
 toString(){return `Crafting: [${this.targets[0].matches}] x${this.targets[0].count}`;}
}

export class CraftWithMatchingWoolTask extends CraftWithMatchingMaterialsTask {
 constructor(target,getTargetItem,recipe,sameMask){
  super(target,recipe,sameMask);
  this.getTargetItem=getTargetItem;
 }
 getSpecificItemCorrespondingToMajorityResource(majority){return this.getTargetItem(majority.replace(/_wool$/,''));}
}
// CollectBedTask goes through this factory: a top-level extends would be a cycle hazard.
childFactories.craftWithMatchingWool=(target,getTargetItem,recipe,sameMask)=>new CraftWithMatchingWoolTask(target,getTargetItem,recipe,sameMask);
