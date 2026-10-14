// Ported from AltoClef TaskCatalogue.java: the hardcoded item -> task mapping for the
// overworld resources BuilderBot needs. MIT License, Copyright (c) 2020 Adris Jautakas.
// See third_party/ALTOCLEF_LICENSE.
// Java hardcodes every shaped recipe; per the port spec our minecraft-data based howto.js
// stays the recipe source of truth, so the long tail of craftables resolves through the
// verified obtain job (CataloguedObtainTask) instead of per-recipe tasks. Nether/End,
// speedrun and butler entries are skipped.
import {buildChain} from '../howto.js';
import {SMELTING} from '../smelting.js';
import {countOf,blocksOfMatches,tokenOf,taskCtx,stampWorker,WOOL_COLORS,WOOD_SPECIES} from './resources/util.js';
import {Task} from './task.js';
import {MineAndCollectTask} from './resources/MineAndCollectTask.js';
import {CollectPlanksTask,CollectSticksTask} from './resources/collectWood.js';
import {CollectCobblestoneTask,CollectCobbledDeepslateTask,CollectFlintTask,CollectSandstoneTask,CollectRedSandstoneTask,CollectCoarseDirtTask} from './resources/collectMining.js';
import {CollectCropTask,CollectWheatTask,CollectWheatSeedsTask,CollectHayBlockTask} from './resources/collectCrops.js';
import {KillAndLootTask,CollectWoolTask,ShearAndCollectBlockTask} from './resources/collectMobs.js';
import {CollectFuelTask,CollectBucketLiquidTask,CollectBedTask,bedFamily,woolFamily,planksFamily} from './resources/collectMisc.js';
import {SmeltInFurnaceTask} from './container/SmeltInFurnaceTask.js';

// Generic resource: run the howto acquisition chain through the verified obtain job.
export class CataloguedObtainTask extends Task {
 constructor(item,count){
  super('CataloguedResource:'+item);
  this.item=item;
  this.count=count;
 }
 onStart(){this._step=null;this._error=null;}
 isFinished(bot){return countOf(bot,this.item)>=this.count;}
 onTick(bot,ctx){
  ctx=taskCtx(this,ctx);
  if(this._error){const e=this._error;this._error=null;throw e;}
  if(stepPending(this))return null;
  const worker=ctx?.worker;
  if(!worker)throw Error('catalogue task needs ctx.worker');
  return runStep(this,bot,ctx,(b,c)=>c.worker.obtain({spec:{type:'obtain',item:this.item,count:this.count}},tokenOf(c)));
 }
 isEqual(other){return other instanceof CataloguedObtainTask&&other.item===this.item;}
 toString(){return `Obtain ${this.count} ${this.item}`;}
}

const ENTRIES={};
function put(name,entry){
 if(ENTRIES[name])throw Error('Tried cataloguing '+name+' twice!');
 ENTRIES[name]=entry;
}
function matchesOf(entry,name){return entry.matches??[name];}
// mine(): MineAndCollectTask with a minimum pickaxe requirement.
function mine(name,requirement,blocks,matches){
 put(name,{matches:matches??[name],noMine:true,make:(bot,count)=>new MineAndCollectTask({matches:matches??[name],count},blocks,requirement)});
}
// simple(): a dedicated collect task; the tasks mine their own blocks, so no mineIfPresent.
function simple(name,make,matches,autoMine=false){put(name,{matches,noMine:true,autoMine,make});}
// mob(): KillAndLootTask for overworld mob drops.
function mob(name,entity){put(name,{matches:[name],noMine:true,make:(bot,count)=>new KillAndLootTask(entity,{matches:[name],count})});}

const SPECIES=WOOD_SPECIES;
/// RAW RESOURCES (TaskCatalogue static block, overworld only)
mine('log','hand',['log'],SPECIES.map(s=>`${s}_log`));
for(const s of SPECIES)mine(`${s}_log`,'hand',[`${s}_log`]);
mine('dirt','hand',['dirt','grass_block','dirt_path']);
simple('cobblestone',(bot,count)=>new CollectCobblestoneTask(count));
simple('cobbled_deepslate',(bot,count)=>new CollectCobbledDeepslateTask(count));
mine('andesite','wood',['andesite']);
mine('granite','wood',['granite']);
mine('diorite','wood',['diorite']);
mine('calcite','wood',['calcite']);
mine('tuff','wood',['tuff']);
mine('coal','wood',['coal_ore','deepslate_coal_ore']);
mine('raw_iron','stone',['iron_ore','deepslate_iron_ore']);
mine('raw_gold','iron',['gold_ore','deepslate_gold_ore']);
mine('raw_copper','stone',['copper_ore','deepslate_copper_ore']);
mine('diamond','iron',['diamond_ore','deepslate_diamond_ore']);
mine('emerald','iron',['emerald_ore','deepslate_emerald_ore']);
mine('redstone','iron',['redstone_ore','deepslate_redstone_ore']);
mine('lapis_lazuli','iron',['lapis_ore','deepslate_lapis_ore']);
mine('sand','hand',['sand']);
mine('red_sand','hand',['red_sand']);
mine('gravel','hand',['gravel']);
mine('clay_ball','hand',['clay'],['clay_ball']);
mine('obsidian','diamond',['obsidian']);
mine('sugar_cane','hand',['sugar_cane']);
simple('sandstone',(bot,count)=>new CollectSandstoneTask(count));
simple('red_sandstone',(bot,count)=>new CollectRedSandstoneTask(count));
simple('coarse_dirt',(bot,count)=>new CollectCoarseDirtTask(count));
simple('flint',(bot,count)=>new CollectFlintTask(count));
simple('stick',(bot,count)=>new CollectSticksTask(count));
// WOOL (and per colour)
simple('wool',(bot,count)=>new CollectWoolTask(count),woolFamily({registry:null}),true);
for(const c of WOOL_COLORS)simple(`${c}_wool`,(bot,count)=>new CollectWoolTask(count,[c]),[`${c}_wool`]);
/// CROPS
simple('wheat',(bot,count)=>new CollectWheatTask(count));
simple('wheat_seeds',(bot,count)=>new CollectWheatSeedsTask(count));
for(const [name,block,seed] of [['carrot','carrots','carrot'],['potato','potatoes','potato'],['beetroot','beetroots','beetroot_seeds']]){
 simple(name,(bot,count)=>new CollectCropTask({matches:[name],count},[block],[seed]));
}
simple('hay_block',(bot,count)=>new CollectHayBlockTask(count));
/// WOOD MATERIALS
simple('planks',(bot,count)=>new CollectPlanksTask({matches:planksFamily({registry:null}),count}));
for(const s of SPECIES)simple(`${s}_planks`,(bot,count)=>new CollectPlanksTask(`${s}_planks`,count),[`${s}_planks`]);
/// FURNITURE / UTILITY (the named overworld items from the port spec)
simple('water_bucket',(bot,count)=>new CollectBucketLiquidTask('water','water_bucket',count));
simple('fuel',(bot,count)=>new CollectFuelTask(count));
simple('bed',(bot,count)=>new CollectBedTask(bedFamily({registry:null}),woolFamily({registry:null}),count),null,true);
for(const c of WOOL_COLORS)simple(`${c}_bed`,(bot,count)=>new CollectBedTask([`${c}_bed`],[`${c}_wool`],count),[`${c}_bed`]);
/// SMELTING (inputs/outputs from our verified smelting map; first input wins an output)
for(const [input,output] of Object.entries(SMELTING)){
 if(ENTRIES[output])continue;
 simple(output,(bot,count)=>new SmeltInFurnaceTask(input,count),[output]);
}
simple('charcoal',(bot,count)=>new SmeltInFurnaceTask('log',count),['charcoal']);
/// MOB DROPS (KillAndLootTask)
const MOBS={bone:'skeleton',gunpowder:'creeper',ender_pearl:'enderman',spider_eye:'spider',string:'spider',leather:'cow',feather:'chicken',rotten_flesh:'zombie',rabbit_foot:'rabbit',rabbit_hide:'rabbit',slime_ball:'slime',ink_sac:'squid',glow_ink_sac:'glow_squid'};
for(const [name,entity] of Object.entries(MOBS))mob(name,entity);

export function taskExists(name){return Object.hasOwn(ENTRIES,name);}
export function getItemMatches(name){return ENTRIES[name]?matchesOf(ENTRIES[name],name):[];}
export function resourceNames(){return Object.keys(ENTRIES);}
export function isObtainable(bot,name){
 if(taskExists(name))return true;
 try{buildChain(bot,name,1,{});return true;}catch{return false;}
}
// The item -> task mapping (Java getItemTask). Returns null for unknown names.
export function getItemTask(bot,name,count,ctx){
 const entry=ENTRIES[name];
 if(entry){
  const task=entry.make(bot,count,ctx);
  if(task){
   stampWorker(task,ctx?.worker); // tasks self-resolve ctx later (onTick gets bot only)
   if(entry.autoMine){
    const blocks=blocksOfMatches(bot,matchesOf(entry,name));
    if(blocks.length)task.mineBlocks=blocks;
   }
  }
  return task;
 }
 // Long tail: howto (minecraft-data) decides, the verified obtain job executes.
 if(canBuildChain(bot,name,count))return new CataloguedObtainTask(name,count);
 return null; // Java logs a warning and returns null too
}
function canBuildChain(bot,name,count){
 try{buildChain(bot,name,count,{});return true;}catch{return false;}
}
