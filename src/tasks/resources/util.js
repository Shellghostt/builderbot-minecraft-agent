// Ported from AltoClef util/ItemTarget.java, util/MiningRequirement.java and the parts of
// util/helpers/{ItemHelper,StorageHelper,WorldHelper}.java the resource tasks use.
// MIT License, Copyright (c) 2020 Adris Jautakas. See third_party/ALTOCLEF_LICENSE.
// Item targets are {matches:[registry item names],count}; helpers stay registry-light so
// fake bots work in unit tests (every bot lookup is optional-chained).
export const MINING_TIERS={hand:0,wood:1,stone:2,iron:3,diamond:4};
export const REQUIREMENT_TOOL={wood:'wooden_pickaxe',stone:'stone_pickaxe',iron:'iron_pickaxe',diamond:'diamond_pickaxe'};
// Overworld species; nether wood (crimson/warped) is skipped per the port spec.
export const WOOD_SPECIES=['oak','spruce','birch','jungle','acacia','dark_oak','mangrove','cherry'];
export const WOOL_COLORS=['white','orange','magenta','light_blue','yellow','lime','pink','gray','light_gray','cyan','purple','blue','brown','green','red','black'];
export const CROP_MAX_AGE={wheat:7,carrots:7,potatoes:7,beetroots:3};
export const FUEL_VALUE=name=>name==='coal'||name==='charcoal'?8:name.endsWith('_planks')||name.endsWith('_log')?1.5:0;
// Breaks the ResourceTask -> MineAndCollectTask extends cycle: MineAndCollectTask.js
// registers its constructor here at module load.
export const childFactories={};

export function normalizeTargets(targets){
 const list=Array.isArray(targets)?targets:[targets];
 return list.map(t=>typeof t==='string'?{matches:[t],count:1}:{matches:t.matches||[t.name],count:t.count??1});
}
export function flatMatches(targets){return targets.flatMap(t=>t.matches);}
export function countOf(bot,name){return bot.inventory.items().filter(i=>i.name===name).reduce((a,i)=>a+i.count,0);}
export function countAny(bot,names){return names.reduce((a,n)=>a+countOf(bot,n),0);}
export function countTarget(bot,target){return countAny(bot,target.matches);}
export function targetsMet(bot,targets){return targets.every(t=>countTarget(bot,t)>=t.count);}
export function hasItem(bot,name){return countOf(bot,name)>0;}
export function fuelValueOf(bot){return bot.inventory.items().reduce((a,i)=>a+FUEL_VALUE(i.name)*i.count,0);}
// StorageHelper.miningRequirementMet: a pickaxe of the required tier (or better) reachable.
export function miningRequirementMet(bot,requirement){
 const tier=MINING_TIERS[requirement]??0;
 if(tier<=0)return true;
 return bot.inventory.items().some(i=>{
  const m=/^(wooden|golden|stone|iron|diamond|netherite)_pickaxe$/.exec(i.name);
  const held=MINING_TIERS[m?.[1]==='wooden'?'wood':m?.[1]];
  return held!==undefined&&held>=tier;
 });
}
export function woodSpecies(bot){
 const names=bot.registry?.itemsByName;
 if(!names)return WOOD_SPECIES;
 return WOOD_SPECIES.filter(s=>names[`${s}_log`]);
}
export function speciesForPlank(plank){return plank.replace(/_planks$/,'');}
export function logOf(plank){return `${speciesForPlank(plank)}_log`;}
export function plankOf(log){return `${log.replace(/_log$/,'')}_planks`;}
// tokenOf: the runner holds worker.controlToken while a tree is active; fall back to the
// worker epoch so worker.check() aborts the wrapped job when someone stops the tree.
export function tokenOf(ctx){return ctx?.token??ctx?.worker?.controlToken??ctx?.worker?.epoch??0;}
export function workerOf(ctx){
 const w=ctx?.worker;
 if(!w)throw Error('resource task needs ctx.worker');
 return w;
}
export function checkOf(ctx){const w=ctx?.worker;return w?()=>w.check(tokenOf(ctx)):()=>{};}
// The runner hands ctx to chains but only `bot` reaches task.onTick(bot), so resource tasks
// carry the long-lived worker reference (it survives reconnects, unlike bot): the catalogue
// stamps it at creation, and each callback synthesizes the ctx when none is passed in.
// The stamp is non-enumerable so debug/inspection tooling never walks worker.bot.registry.
export function stampWorker(task,worker){
 if(worker==null)return;
 Object.defineProperty(task,'worker',{value:worker,writable:true,enumerable:false,configurable:true});
}
export function taskCtx(task,ctx){
 if(ctx?.worker){stampWorker(task,ctx.worker);return ctx;}
 if(task.worker)return {worker:task.worker,token:task.worker.controlToken};
 return undefined;
}
// Children built during a tick inherit the parent's worker so they self-resolve too.
export function adopt(parent,child){
 if(child)stampWorker(child,parent.worker??child.worker);
 return child;
}
// runStep bridges the verified async jobs into the sync tick model: the first tick starts
// the awaited job, later ticks return null while it runs, a failure rethrows on the next
// tick (a silent null would busy-loop forever). onStart/onStop clear the stale state.
export function runStep(task,bot,ctx,fn){
 if(task._error){const e=task._error;task._error=null;throw e;}
 if(!task._step){
  task._step=Promise.resolve().then(()=>fn(bot,ctx));
  task._step.then(()=>{task._step=null;},e=>{task._step=null;task._error=e instanceof Error?e:new Error(String(e?.message??e));});
 }
 return null;
}
export function stepPending(task){return !!task._step;}
export function clearStep(task){task._step=null;task._error=null;}
function dropItemName(bot,entity){
 if(entity.itemName)return entity.itemName;
 const meta=(entity.metadata||[]).find(m=>m&&m.itemId!==undefined);
 return meta?bot.registry?.items?.[meta.itemId]?.name??null:null;
}
export function nearestDrop(bot,targets,range=16){
 const want=new Set(flatMatches(targets));
 const pos=bot.entity.position;
 let best=null,bestDist=Infinity;
 for(const e of Object.values(bot.entities||{})){
  if(!e||e.name!=='item'||!e.position)continue;
  const name=dropItemName(bot,e);
  if(name&&!want.has(name))continue;
  const dist=e.position.distanceTo(pos);
  if(dist<=range&&dist<bestDist){best=e;bestDist=dist;}
 }
 return best;
}
function blockIds(bot,names){
 const blocks=bot.registry?.blocksByName;
 if(!blocks)return names.map(n=>({name:n,id:n}));
 return names.map(n=>blocks[n]).filter(Boolean).map(b=>({name:b.name,id:b.id}));
}
export function nearestBlock(bot,names,range=32){
 const ids=blockIds(bot,names).map(b=>b.id);
 if(!ids.length)return null;
 const found=bot.findBlock?.({matching:ids.length===1?ids[0]:ids,maxDistance:range});
 return found||null;
}
export function nearestBlocks(bot,names,range=32,count=64){
 const ids=blockIds(bot,names).map(b=>b.id);
 if(!ids.length)return [];
 return bot.findBlocks?.({matching:ids.length===1?ids[0]:ids,maxDistance:range,count})||[];
}
export function blockMature(bot,block){
 const age=block.properties?.age;
 if(age===undefined)return true;
 return age>=(CROP_MAX_AGE[block.name]??7);
}
export function isMatureBlockNear(bot,names,range=32){
 const found=nearestBlocks(bot,names,range).map(p=>bot.blockAt(p)).filter(Boolean);
 return found.find(b=>blockMature(bot,b))||null;
}
export function nearestEntity(bot,type,range=24){
 const pos=bot.entity.position;
 let best=null,bestDist=Infinity;
 for(const e of Object.values(bot.entities||{})){
  if(!e||e.name!==type||!e.position)continue;
  const dist=e.position.distanceTo(pos);
  if(dist<=range&&dist<bestDist){best=e;bestDist=dist;}
 }
 return best;
}
// Catalogue help: which matches are mineable blocks (CataloguedResource.mineIfPresent default).
export function blocksOfMatches(bot,matches){
 const blocks=bot.registry?.blocksByName;
 if(!blocks)return matches.filter(m=>m.endsWith('_log')||m.endsWith('_wool')||m.endsWith('_bed'));
 return matches.filter(m=>blocks[m]);
}
