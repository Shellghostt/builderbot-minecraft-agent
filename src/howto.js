// Version-accurate acquisition knowledge (autonomy spec Phase 6a): the full acquisition tree
// for an item, built from minecraft-data for the connected version. Pure planning - it never
// executes anything; the worker turns the returned step list into ordinary verified jobs.
import minecraftData from 'minecraft-data';
import {SMELTING} from './smelting.js';

// True leaf items of the other dimensions; deeper cases (eye of ender -> blaze rod) are
// explained automatically because their own ingredients resolve to these.
const NETHER=/^(nether|crimson|warped|soul|basalt|blackstone|ancient_debris|magma|glowstone|shroomlight|quartz|nylium|blaze|ghast|netherrack|gilded_blackstone|bone_block|weeping_vines|twisting_vines|netherite)/;
const END=/^(end_stone|purpur|chorus|shulker|elytra|dragon|end_crystal|end_rod|end_portal|popped_chorus)/;
// Mobs that spawn in the overworld, so hunting them is a real route.
const OVERWORLD_MOBS=new Set(['cow','pig','sheep','chicken','rabbit','horse','donkey','zombie','skeleton','spider','creeper','enderman','slime','drowned','husk','stray','witch','phantom','pillager','vindicator','cod','salmon','pufferfish','squid','glow_squid','bat','wolf','fox','ocelot','cat','bee','zombified_piglin']);
const BREED_FOOD={'cow':'wheat','sheep':'wheat','pig':'carrot','chicken':'wheat_seeds','rabbit':'golden_carrot','horse':'golden_carrot'};
const DEPTH_LIMIT=16,STEP_LIMIT=28;
const TIER=['wooden_','stone_','iron_','diamond_','netherite_'];
// Blocks worth walking to when a craft route also exists: terrain, trees and ores. Without
// this the planner would send the bot looking for generated stairs or lanterns to dig.
const NATURAL_GATHER=/(_log|_ore|_leaves)$|^(dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|mud|moss_block|sand|red_sand|gravel|clay|snow|snow_block|ice|packed_ice|blue_ice|stone|cobblestone|mossy_cobblestone|deepslate|cobbled_deepslate|andesite|granite|diorite|tuff|calcite|dripstone_block|sandstone|red_sandstone|terracotta|obsidian|crying_obsidian|netherrack|basalt|blackstone|soul_sand|soul_soil|amethyst_block|prismarine|dark_prismarine|prismarine_bricks|sea_lantern|glowstone|melon|pumpkin|hay_block|cactus|brown_mushroom|red_mushroom|sponge|wet_sponge|sculk|ancient_debris|bamboo|kelp|sugar_cane|short_grass|tall_grass|fern|large_fern|vine|glow_lichen|azalea|flowering_azalea|mangrove_roots|big_dripleaf|small_dripleaf|hanging_roots|spore_blossom|cocoa)$/;

function dropNames(mcData,block){
 return (block.drops||[]).map(id=>mcData.items[id]?.name).filter(Boolean);
}
function isUnsupportedLeaf(name){
 return NETHER.test(name)?'nether (no portal ability)':END.test(name)?'the End (no portal ability)':null;
}
function routeCost(node){
 if(node.kind==='unsupported')return Infinity;
 // Deepslate costs extra: it sits below y=0, a real trip down for the bot.
 const leaf=node.kind==='gather'?node.want+(node.block&&/deepslate/.test(node.block)?3:0):node.kind==='smelt'?node.want:node.kind==='hunt'?(node.count||node.want):0;
 return (node.children||[]).reduce((a,c)=>a+routeCost(c),0)+leaf;
}
class Resolver{
 constructor(mcData,have,bot){
  this.mcData=mcData;this.have=have;this.unsupported=[];
  // Which log species actually grow near the bot (one 64-block probe per obtain): the
  // recipe tags resolve 'planks' to concrete species alphabetically, and the flat world
  // grows oak only - without this probe the plan picks pale_oak and the gather dies on
  // 'No matching blocks' (measured in the combat suite's shield craft).
  this.availableLogNames=new Set();
  if(bot){
   try{
    const logIds=Object.values(mcData.blocksByName).filter(b=>/_log$/.test(b.name)).map(b=>b.id);
    const found=bot.findBlocks?bot.findBlocks({matching:logIds,maxDistance:64,count:64}):[];
    for(const p of (found||[])){const b=bot.blockAt(p);if(b&&/_log$/.test(b.name))this.availableLogNames.add(b.name);}
   }catch{}
  }
 }
 mark(name,want,reason){
  if(!this.unsupported.some(u=>u.item===name))this.unsupported.push({item:name,reason});
  return {name,want,kind:'unsupported',reason};
 }
 haveTool(name){return name&&(this.have[name]||0)>=1;}
 cheapestTool(names){
  return names.filter(n=>TIER.some(p=>n.startsWith(p))).sort((a,b)=>TIER.findIndex(p=>a.startsWith(p))-TIER.findIndex(p=>b.startsWith(p)))[0]||null;
 }
 gatherableBlock(block){
  return !!block&&block.boundingBox==='block'&&block.hardness!==null&&block.diggable!==false
   &&block.material!=='fluid'&&!isUnsupportedLeaf(block.name)&&!/_(leaves|campfire)$/.test(block.name);
 }
 reasonWhy(name,block){
  if(/_leaves$/.test(name))return 'needs shears: gather leaves with the use job, not obtain';
  if(name==='water_bucket')return 'needs a water source: fill a bucket with the use job';
  if(name==='milk_bucket')return 'needs a cow and a bucket: use the use job';
  if(name==='lava_bucket')return 'unsupported: the bot never handles lava';
  if(block&&block.boundingBox==='block'&&dropNames(this.mcData,block).length===0)return 'needs silk touch (not supported)';
  return 'no recipe, overworld mob drop or gatherable block for it here (loot or trading only)';
 }
 resolve(name,want,path){
  const mcData=this.mcData;
  want=Math.max(1,want);
  if((this.have[name]||0)>=want)return {name,want,kind:'have'};
  // Wood families are interchangeable at the crafting table (the recipes take the planks
  // tag): any species already in the inventory satisfies a planks/log ingredient. Without
  // this the planner demands pale_oak in a world that grows oak only (measured: the shield
  // craft died on 'No matching blocks' with eight oak planks sitting in the inventory).
  const woodFamily=/_planks$/.test(name)?'_planks':/_log$/.test(name)?'_log':null;
  if(woodFamily){
   const owned=Object.entries(this.have).reduce((a,[k,v])=>a+(k.endsWith(woodFamily)?v:0),0);
   if(owned>=want)return {name,want,kind:'have'};
  }
  if(path.has(name))return this.mark(name,want,'circular recipe');
  if(path.size>DEPTH_LIMIT)return this.mark(name,want,'acquisition tree too deep');
  const dimension=isUnsupportedLeaf(name);
  if(dimension)return this.mark(name,want,dimension);
  const item=mcData.itemsByName[name],block=mcData.blocksByName[name],candidates=[];
  path.add(name);
  if(item){
   for(const recipe of (mcData.recipes[item.id]||[])){
    const batches=Math.ceil(want/(recipe.result.count||1)),children=[];let feasible=true;
    const tally={};
    for(const id of (recipe.inShape?recipe.inShape.flat():recipe.ingredients||[]))if(id>0)tally[mcData.items[id]?.name]=(tally[mcData.items[id]?.name]||0)+batches;
    for(const [ingredient,need] of Object.entries(tally)){
     const child=this.resolve(ingredient,need,path);
     if(child.kind==='unsupported')feasible=false;
     children.push(child);
    }
    if(feasible)candidates.push({name,want,kind:'craft',children});
   }
   for(const [input,output] of Object.entries(SMELTING)){
    if(output!==name||!mcData.itemsByName[input])continue;
    const child=this.resolve(input,want,path);
    if(child.kind!=='unsupported')candidates.push({name,want,kind:'smelt',input,children:[child]});
   }
   if(name==='charcoal')for(const logName of Object.keys(mcData.itemsByName).filter(n=>n.endsWith('_log'))){
    const child=this.resolve(logName,want,path);
    if(child.kind!=='unsupported')candidates.push({name,want,kind:'smelt',input:logName,children:[child]});
   }
   // minecraft-data models gravel as dropping only itself, which leaves flint with no
   // recipe, mob loot or dropper here - yet a plain gravel break yields flint about one
   // time in ten (COMBAT_SPEC 7a: arrows). Plan the gravel trip with a tenfold margin.
   if(name==='flint'&&this.gatherableBlock(mcData.blocksByName.gravel)){
    candidates.push({name,want:want*10,kind:'gather',block:'gravel',children:[]});
   }
   for(const loot of Object.values(mcData.entityLoot||{})){
    if(!OVERWORLD_MOBS.has(loot.entity))continue;
    const drop=(loot.drops||[]).find(d=>d.item===name&&d.dropChance>0);
    if(drop)candidates.push({name,want,kind:'hunt',entity:loot.entity,count:Math.ceil(want/((drop.stackSizeRange?.[0]||1)*drop.dropChance)),children:[]});
   }
  }
  const droppers=block&&dropNames(mcData,block).includes(name)?[block]:Object.values(mcData.blocksByName).filter(bl=>dropNames(mcData,bl).includes(name));
  droppers.sort((a,b)=>(b.name===name)-(a.name===name));
  for(const dropper of droppers){
   // Skip log species that do not grow here when other species do (the probe above).
   if(/_log$/.test(dropper.name)&&this.availableLogNames.size&&!this.availableLogNames.has(dropper.name))continue;
   if(!this.gatherableBlock(dropper)&&!/_ore$/.test(dropper.name))continue;
   // Never plan a digging trip to find generated structures or metal blocks: only terrain,
   // trees and ores are gather leaves.
   if(!NATURAL_GATHER.test(dropper.name)&&!/_ore$/.test(dropper.name))continue;
   const children=[];let feasible=true;
   if(dropper.harvestTools&&!Object.keys(dropper.harvestTools).some(id=>this.haveTool(mcData.items[id]?.name))){
    const tier=this.cheapestTool(Object.keys(dropper.harvestTools).map(id=>mcData.items[id]?.name).filter(Boolean));
    const tool=tier?this.resolve(tier,1,path):null;
    if(!tool||tool.kind==='unsupported')feasible=false;else children.push(tool);
   }
   if(feasible)candidates.push({name,want,kind:'gather',block:dropper.name,children});
  }
  path.delete(name);
  if(!candidates.length)return this.mark(name,want,this.reasonWhy(name,block));
  candidates.sort((a,b)=>routeCost(a)-routeCost(b));
  return candidates[0];
 }
}
// Flatten the chosen route into ordered, restart-safe steps: children first (gather,
// smelt, intermediates), then the step they enable. Each step carries an absolute
// inventory target (want) so a resumed obtain skips steps the inventory already satisfies.
function flatten(node,out){
 for(const child of node.children||[])flatten(child,out);
 if(node.kind==='craft')out.push({op:'craft',item:node.name,want:node.want});
 if(node.kind==='smelt')out.push({op:'smelt',item:node.input,want:node.want,output:node.name});
 if(node.kind==='gather')out.push({op:'gather',block:node.block,want:node.want,targetY:node.block.includes('diamond')?-58:/(_ore|deepslate|^stone$)/.test(node.block)?48:undefined});
 if(node.kind==='hunt')out.push({op:'hunt',entity:node.entity,want:node.want,item:node.name});
 return out;
}
function dedupe(steps){
 const seen=new Map();
 for(const step of steps){
  const key=step.op+':'+(step.block||step.item)+':'+(step.entity||'');
  const before=seen.get(key);
  if(!before||before.want<step.want)seen.set(key,step);
 }
 return [...seen.values()];
}
export function buildChain(bot,item,count,have){
 const mcData=minecraftData(bot.version);
 if(!mcData.itemsByName[item])throw Error('Unknown item '+item+' in '+bot.version);
 count=Math.max(1,Math.min(1024,count));
 const resolver=new Resolver(mcData,have||{},bot);
 const root=resolver.resolve(item,count,new Set());
 if(root.kind==='have')return {item,count,steps:[]};
 if(root.kind==='unsupported'){
  const error=Error(`Cannot obtain ${item}: ${root.reason}`);error.unsupported=resolver.unsupported;throw error;
 }
 const steps=dedupe(flatten(root,[]));
 if(steps.length>STEP_LIMIT)throw Error(`Cannot obtain ${item}: the plan needs ${steps.length} steps, over the ${STEP_LIMIT} limit`);
 return {item,count,version:String(bot.version),steps:steps.map(step=>({...step,batches:Math.ceil(step.want/(step.op==='smelt'?48:128))})),unsupported:resolver.unsupported};
}
// The human/tool-facing summary for minecraft_howto and GET /api/howto.
export function howto(bot,item,count=1,have={}){
 try{
  const chain=buildChain(bot,item,count,have);
  return {item,version:chain.version,count,status:chain.steps.length?'obtainable':'already satisfied',steps:chain.steps.map(({op,item:si,block,entity,want,batches,targetY})=>({op,item:si,block,entity,want,batches,targetY})),unsupported:chain.unsupported};
 }catch(e){
  return {item,version:String(bot.version),count,status:'unobtainable',reason:e.message,unsupported:e.unsupported||[]};
 }
}
export {BREED_FOOD};
