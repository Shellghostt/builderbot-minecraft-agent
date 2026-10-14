// Autopilot: deterministic survival progression built ONLY from verified job types queued
// through the normal worker queue, so Stop, reflexes and failure handling all keep working.
// The ladder is a pure function of a name->count inventory map so it can be unit tested.
import fs from 'node:fs';
import path from 'node:path';
import {Vec3} from 'vec3';
import {dayTicks,isNight,NIGHT_START} from './daytime.js';
import {EDIBLE_SKIP} from './observe.js';

const BED=/(_bed)$/;
const WOOLS=['white_wool','light_gray_wool','gray_wool','black_wool','brown_wool','red_wool','orange_wool','yellow_wool','lime_wool','green_wool','cyan_wool','light_blue_wool','blue_wool','purple_wool','magenta_wool','pink_wool'];
const countFactory=count=>name=>count[name]||0;
// COMBAT_SPEC 7a gear: one sword and one axe per tier, a full armour set, bow and arrows.
const GEAR=/^(diamond|iron|stone|golden|wooden)_(sword|axe|pickaxe|shovel|helmet|chestplate|leggings|boots)$/;
const WORN_LIMIT=0.2; // craft the replacement while a fifth of the durability is left
const REPLACE_COST={sword:2,axe:3,pickaxe:3,shovel:1,helmet:5,chestplate:8,leggings:7,boots:4};
const REPLACE_STICKS={sword:1,axe:2,pickaxe:3,shovel:1};
const REPLACE_ORDER={sword:0,axe:1,helmet:2,chestplate:3,leggings:4,boots:5,pickaxe:6,shovel:7};
// Payable replacement tiers per kind: stone and wood armour do not exist, so armour is only
// ever re-crafted in iron or diamond; leather and chainmail are never crafted by the ladder.
const REPLACE_TIERS={
 weapon:[['diamond','diamond'],['iron','iron_ingot'],['stone','cobblestone'],['wooden',null]],
 armour:[['diamond','diamond'],['iron','iron_ingot']]
};
const ARMOURED=new Set(['helmet','chestplate','leggings','boots']);
const COOKABLE_MEAT=['beef','porkchop','chicken','mutton'];
const ARROWS=32; // COMBAT_SPEC 7a: keep 32+ arrows when possible
const GRAZE=new Set(['plains','sunflower_plains','meadow','savanna','savanna_plateau','forest','flower_forest','birch_forest','old_growth_birch_forest','river','beach']);
const HARSH=new Set(['jagged_peaks','frozen_peaks','stony_peaks','snowy_slopes','grove','ice_spikes','windswept_hills','windswept_gravelly_hills','windswept_forest','snowy_plains','snowy_taiga','frozen_river','stony_shore']);
function biomeName(bot,x,y,z){
 try{
  const column=bot.world&&bot.world.getColumn&&bot.world.getColumn(x>>4,z>>4);
  const id=column&&column.getBiome&&column.getBiome({x:x&15,y:y,z:z&15});
  return id==null?null:(''+(bot.registry&&bot.registry.biomes&&bot.registry.biomes[id]&&bot.registry.biomes[id].name||'')).replace('minecraft:','');
 }catch{return null;}
}
// Pick a cardinal that has graze biome at MULTIPLE distances (GLM soak 6: probing only
// 16/48 walked the bot 200+ blocks into a taiga river valley - the near sample said
// "meadow" and the far terrain was animal-less). A direction scores +2 per graze sample,
// -1 per harsh sample; rivers/beaches only count when close (animals are not on water).
export function grazeDirection(bot){
 const me=bot&&bot.entity&&bot.entity.position;
 if(!me)return 'random';
 const y=Math.floor(me.y);
 let best='random',bestScore=-Infinity;
 for(const [name,dx,dz] of [['north',0,-1],['south',0,1],['east',1,0],['west',-1,0]]){
  let score=0;
  for(const dist of [16,48,96,160]){
   const biome=biomeName(bot,Math.floor(me.x+dx*dist),y,Math.floor(me.z+dz*dist));
   if(!biome)continue; // unloaded: neutral
   if(GRAZE.has(biome))score+=dist>=96?3:2; // far graze matters most: packs are sparse
   else if(HARSH.has(biome))score-=2;
  }
  if(score>bestScore){bestScore=score;best=name;}
 }
 return bestScore>0?best:'random';
}
// M5 (iron): [item, ingots, sticks] crafted first, in this order; then the rest of the kit.
const IRON_CORE=[['iron_pickaxe',3,2],['iron_sword',2,1],['shield',1,0]];
const STONE_KIT=[['stone_pickaxe',3],['stone_sword',2],['stone_axe',3],['stone_shovel',1]];
const IRON_REST=[['iron_axe',3],['iron_helmet',5],['iron_chestplate',8],['iron_leggings',7],['iron_boots',4],['bucket',3]];
// Staircase target for ore: the 1.18+ iron band peaks at y=16 (-24..56) and the gather's
// radius-32 block scan (findBlocks sees ore inside stone, deepslate included) from y=32
// covers 0..64, so most digs stop well above the deepslate layer.
const IRON_Y=32;
// Smelt raw iron with coal: a coal item smelts 8, so a short coal dig (coal ore is the most
// common ore around the iron band) beats burning the planks the sticks and shield need.
// Wood still counts (worker.fuelPlan burns planks/logs at 1.5 items each) beyond 8 planks.
function smeltIron(c,ctx){
 const count=Math.min(48,c('raw_iron'));
 const fuel=8*(c('coal')+c('charcoal'))+1.5*(Math.max(0,ctx.planksTotal-8)+ctx.logsTotal);
 if(fuel<count)return {type:'gather',block:'coal_ore',count:Math.ceil((count-fuel)/8),radius:32,searchIfMissing:true,targetY:IRON_Y};
 return {type:'smelt',item:'raw_iron',count};
}
const DIAMOND_GEAR=[['diamond_sword',2],['diamond_axe',3],['diamond_helmet',5],['diamond_chestplate',8],['diamond_leggings',7],['diamond_boots',4]];
// Ensure planks for a craft: gather a few logs when none are held, else craft from the held species.
const planksJob=(c,ctx,need)=>{
 if(ctx.planksTotal>=need)return null;
 if(ctx.logsTotal<2)return {type:'gather',block:'log',count:4,radius:32,searchIfMissing:true,belowFoots:true,surface:true};
 return {type:'craft',item:(ctx.heldLog||'oak_log').replace('_log','_planks'),count:need-ctx.planksTotal};
};
// COMBAT_SPEC 7a repair-by-replacement: a nearly-broken item with no fresh spare is re-crafted
// in the best tier the inventory can pay for before it breaks mid-fight. The counts map marks
// worn items as _worn_<name> (see Autopilot.counts); one fresh spare stops the crafting.
function replacementJob(c,ctx){
 const worn=[];
 for(const tier of ['diamond','iron','stone','golden','wooden'])for(const kind of Object.keys(REPLACE_ORDER)){
  const name=tier+'_'+kind;
  if(c('_worn_'+name)>=1&&c(name)<=c('_worn_'+name))worn.push({kind,priority:REPLACE_ORDER[kind]});
 }
 if(!worn.length)return null;
 worn.sort((a,b)=>a.priority-b.priority);
 const {kind}=worn[0],cost=REPLACE_COST[kind],sticks=REPLACE_STICKS[kind]||0;
 for(const [tier,material] of REPLACE_TIERS[ARMOURED.has(kind)?'armour':'weapon']){
  const pay=material?c(material):ctx.planksTotal;
  if(pay>=cost&&c('stick')>=sticks)return {type:'craft',item:tier+'_'+kind,count:1};
 }
 return null; // no materials for a spare: keep using the worn item
}

// The progression ladder. Each entry: name, done(counts) and next(counts, ctx) producing the
// next job spec (ctx: {slotsFull, animalsNearby, huntPhase, home, homeChest, chestSpot,
// heldLog, logsTotal, planksTotal}). Any log species works for the wood step.
export const STEPS=[
 {name:'wood',done:(c,ctx)=>c('wooden_pickaxe')>=1&&(c('crafting_table')>=1||!!ctx?.worldTable)&&c('wooden_sword')>=1&&c('wooden_axe')>=1,next(c,ctx){
  // KIT-FIRST (review directive): the whole wood kit costs 11 planks (table 4 + sticks 2
  // + sword 2 + pickaxe 3) = 3 logs - gather all of it BEFORE crafting, because batches
  // that stop halfway feed the mobs and strand the run between steps. Then craft in
  // survival order: table, sticks, then the pickaxe (unless a hostile is within 16 blocks,
  // in which case the sword still comes first).
  // Search radius stays 32 (MEASURED): radius 96 finds distant trees the pathfinder cannot
  // route to through forest terrain ('No path to the goal' x7, soak 20261013-020850, 0
  // logs in all 3 runs), while radius 32 gathered logs 3-4 in the earlier soaks. Reaching
  // groves beyond 32 blocks needs wood-aware explore, not a longer grab (next session).
  const plank=((ctx.heldLog||'oak_log').replace('_log','_planks'));
  const gather3=()=>({type:'gather',block:'log',count:3,radius:32,searchIfMissing:true,belowFoots:true,surface:true});
  const KIT=11;
  // 0. Planks for the whole kit: convert held logs; when short even after that, gather 3.
  if(ctx.planksTotal<KIT)return ctx.logsTotal>=1?{type:'craft',item:plank,count:Math.min(ctx.logsTotal*4,KIT-ctx.planksTotal)}:gather3();
  // 1. Table (4 planks).
  if(c('crafting_table')<1)return {type:'craft',item:'crafting_table',count:1};
  // 2. Sticks (4 covers the sword and the pickaxe; 2 planks).
  if(c('stick')<4)return {type:'craft',item:'stick',count:4};
  // Pickaxe before the sword when nothing is close: the pickaxe unlocks stone, and sword
  // retries are what burned the normal3 soak. A hostile within 16 blocks still takes the sword first.
  const threatened=(ctx.hostileDistance??Infinity)<=16;
  if(threatened&&c('wooden_sword')<1)return {type:'craft',item:'wooden_sword',count:1,keepTable:true};
  if(c('wooden_pickaxe')<1)return {type:'craft',item:'wooden_pickaxe',count:1,keepTable:true};
  if(c('wooden_sword')<1)return {type:'craft',item:'wooden_sword',count:1,keepTable:true};
  // 5. 7a axe (3 planks + 2 sticks): swords AND axes in every tier it can reach. The axe is
  // the step's last craft, so it collects the table again (end-of-wood-step pickup).
  if(c('wooden_axe')<1){
   if(c('stick')<2)return {type:'craft',item:'stick',count:2,keepTable:true};
   return {type:'craft',item:'wooden_axe',count:1,keepTable:true,collectTable:true};
  }
  // Tools done: top up logs for the stone step in small batches.
  if(ctx.logsTotal<12)return {type:'gather',block:'log',count:4,radius:32,searchIfMissing:true,belowFoots:true,surface:true};
  return null;
 }},
 {name:'stone',done:(c,ctx)=>(c('furnace')>=1||!!ctx?.worldFurnace)&&c('stone_pickaxe')>=1&&c('stone_axe')>=1&&c('stone_sword')>=1&&c('stone_shovel')>=1,next(c,ctx){
  if(c('stick')<10){
   // Sticks need planks: gather or craft them first, or the craft fails with none held.
   const planks=planksJob(c,ctx,2);if(planks)return planks;
   return {type:'craft',item:'stick',count:10-c('stick')};
  }
  const plank=((ctx.heldLog||'oak_log').replace('_log','_planks'));
  if(ctx.planksTotal<8&&ctx.logsTotal>=2)return {type:'craft',item:plank,count:8};
  // Each piece is crafted as soon as its cobble is held, in kit order (pickaxe, then the
  // sword - COMBAT_SPEC 7f - axe, shovel, furnace). Round 3 hard1/hard2 held dig-down cobble
  // at 150 s and 241 s but never a stone pickaxe: the 32-cobble gather had to finish first,
  // and on the hard anchor it failed short every time, so the ladder looped on the gather.
  const piece=STONE_KIT.find(([item])=>c(item)<1);
  if(piece&&c('cobblestone')>=piece[1])return {type:'craft',item:piece[0],count:1,keepTable:true};
  if(!piece&&!(c('furnace')>=1||ctx?.worldFurnace)&&c('cobblestone')>=8)return {type:'craft',item:'furnace',count:1,keepTable:true,collectTable:true};
  if(c('cobblestone')<32)return {type:'gather',block:'stone',count:32-c('cobblestone'),radius:32,searchIfMissing:true};
  if(c('stone_pickaxe')<1)return {type:'craft',item:'stone_pickaxe',count:1,keepTable:true};
  // COMBAT_SPEC 7f: the stone sword comes right after the stone pickaxe.
  if(c('stone_sword')<1)return {type:'craft',item:'stone_sword',count:1,keepTable:true};
  if(c('stone_axe')<1)return {type:'craft',item:'stone_axe',count:1,keepTable:true};
  if(c('stone_shovel')<1)return {type:'craft',item:'stone_shovel',count:1,keepTable:true};
  // leave the table standing through the kit; pick it up with the furnace (last stone craft)
  return {type:'craft',item:'furnace',count:1,keepTable:true,collectTable:true};
 }},
 {name:'food',done:c=>c('_edible')>=8&&!COOKABLE_MEAT.some(m=>c(m)>=1&&c('furnace')>=1),next(c,ctx){
  // COMBAT_SPEC 7a: keep cooked food - raw meat is smelted through the existing flow
  // whenever a furnace is available, even while enough raw food is already held.
  const meat=COOKABLE_MEAT.find(m=>c(m)>=1);
  if(meat&&c('furnace')>=1)return {type:'smelt',item:meat,count:Math.min(48,c(meat))};
  if(c('wheat')>=3)return {type:'craft',item:'bread',count:1};
  // COMBAT_SPEC 7a: replace a nearly-broken weapon before hunting.
  const fix=replacementJob(c,ctx);if(fix)return fix;
  if(ctx.animalsNearby)return ctx.huntPhase?{type:'collect',radius:16}:{type:'fight',entity:ctx.animalsNearby,maxSeconds:90};
  // 90 s, not 30: chickens/pigs panic-run when hit and the 30 s window timed out every
  // chase after the first (soak 6 hard3: one kill, then five consecutive timeouts).
  // 32-block legs re-decide every ~20 s and the tick cancels the moment animals come
  // into hunt range. The ceiling is anchored to the WOOD STEP's stand (lastSurfaceY),
  // not the current Y: a standY+8 ceiling per leg ratcheted the bot up a peak +8 per leg
  // (soak 7 normal1: y=156 on frozen_peaks, animal-less terrain).
  // The anchor is fixed for the run (the Autopilot latches the first food stand when no
  // surface gather set one): min(current,anchor) ratcheted DOWN into valleys, and a bare
  // current-Y anchor ratchets up again. A bot already above the cap may not climb further,
  // but its legs must still start (navigation rejects any position above the cap).
  const anchorY=Number.isFinite(ctx.lastSurfaceY)?ctx.lastSurfaceY:ctx.standY;
  let cap=Number.isFinite(anchorY)?anchorY+8:undefined;
  if(cap!=null&&Number.isFinite(ctx.standY)&&ctx.standY>cap)cap=ctx.standY;
  return {type:'explore',distance:32,direction:ctx.grazeDirection||'random',...(cap!=null?{surfaceCeiling:cap}:{})};
 }},
 {name:'iron',done:c=>c('iron_pickaxe')>=1&&c('iron_sword')>=1&&c('iron_axe')>=1&&c('shield')>=1&&c('bow')>=1&&c('arrow')>=ARROWS&&c('iron_helmet')>=1&&c('iron_chestplate')>=1&&c('iron_leggings')>=1&&c('iron_boots')>=1&&c('bucket')>=1&&c('torch')>=8,next(c,ctx){
  // M5 core FIRST: iron pickaxe, then iron sword, then the shield (COMBAT_SPEC 7a: right after
  // the first ingots) - 6 ingots from one short dig, before the 16-coal / 36-ore expedition
  // that used to stand between the stone kit and any iron tool at all.
  const core=IRON_CORE.filter(([item])=>c(item)<1);
  if(core.length){
   const ingots=core.reduce((a,[,n])=>a+n,0),sticks=core.reduce((a,[,,n])=>a+n,0);
   const short=ingots-c('iron_ingot');
   if(short>0){
    if(c('raw_iron')<short)return {type:'gather',block:'iron_ore',count:short-c('raw_iron'),radius:32,searchIfMissing:true,targetY:IRON_Y};
    return smeltIron(c,ctx);
   }
   if(c('stick')<sticks){
    const planks=planksJob(c,ctx,2);if(planks)return planks;
    return {type:'craft',item:'stick',count:sticks-c('stick')};
   }
   const [item]=core[0];
   if(item==='shield'){const planks=planksJob(c,ctx,6);if(planks)return planks;}
   return {type:'craft',item,count:1};
  }
  if(c('coal')<16)return {type:'gather',block:'coal_ore',count:16-c('coal'),radius:32,searchIfMissing:true,targetY:IRON_Y};
  // The rest of the kit after the core: axe 3, bucket 3 and the armour set 24 = 30 ingots.
  const rest=IRON_REST.filter(([item])=>c(item)<1).reduce((a,[,n])=>a+n,0);
  if(c('raw_iron')+c('iron_ingot')<rest)return {type:'gather',block:'iron_ore',count:rest-c('raw_iron')-c('iron_ingot'),radius:32,searchIfMissing:true,targetY:IRON_Y};
  if(c('raw_iron')>=1&&c('iron_ingot')<rest)return smeltIron(c,ctx);
  if(c('iron_ore')>=1)return {type:'smelt',item:'iron_ore',count:Math.min(48,c('iron_ore'))};
  // COMBAT_SPEC 7a: replace a nearly-broken weapon before the spider and chicken hunts.
  const fix=replacementJob(c,ctx);if(fix)return fix;
  // Bow: sticks + string from spiders.
  if(c('bow')<1){
   if(c('string')<3)return {type:'hunt',entity:'spider',count:6,maxSeconds:120};
   if(c('stick')<3){
    const planks=planksJob(c,ctx,2);if(planks)return planks;
    return {type:'craft',item:'stick',count:3-c('stick')};
   }
   return {type:'craft',item:'bow',count:1};
  }
  // Arrows: flint from gravel, feathers from chickens, sticks - crafted, not hunted.
  if(c('arrow')<ARROWS){
   const need=Math.ceil((ARROWS-c('arrow'))/4);
   if(c('flint')<need)return {type:'gather',block:'gravel',count:64,radius:32,searchIfMissing:true,belowFoots:true};
   if(c('feather')<need)return {type:'hunt',entity:'chicken',count:Math.min(16,need*2),maxSeconds:120};
   if(c('stick')<need){
    const planks=planksJob(c,ctx,4);if(planks)return planks;
    return {type:'craft',item:'stick',count:need-c('stick')};
   }
   return {type:'craft',item:'arrow',count:ARROWS-c('arrow')};
  }
  if(c('stick')<5){
   const planks=planksJob(c,ctx,4);if(planks)return planks;
   return {type:'craft',item:'stick',count:5-c('stick')};
  }
  if(c('iron_pickaxe')<1)return {type:'craft',item:'iron_pickaxe',count:1};
  if(c('iron_sword')<1)return {type:'craft',item:'iron_sword',count:1};
  if(c('iron_axe')<1)return {type:'craft',item:'iron_axe',count:1};
  // COMBAT_SPEC 7a: the full armour set right after the iron gear.
  if(c('iron_helmet')<1)return {type:'craft',item:'iron_helmet',count:1};
  if(c('iron_chestplate')<1)return {type:'craft',item:'iron_chestplate',count:1};
  if(c('iron_leggings')<1)return {type:'craft',item:'iron_leggings',count:1};
  if(c('iron_boots')<1)return {type:'craft',item:'iron_boots',count:1};
  if(c('bucket')<1)return {type:'craft',item:'bucket',count:1};
  if(c('stick')<2){
   const planks=planksJob(c,ctx,2);if(planks)return planks;
   return {type:'craft',item:'stick',count:2-c('stick')};
  }
  if(c('torch')<8)return {type:'craft',item:'torch',count:8-c('torch')};
  return null;
 }},
 {name:'bed',done:c=>WOOLS.some(w=>c(w.replace('_wool','_bed'))>=1),next(c,ctx){
  // COMBAT_SPEC 7a: replace worn combat gear before hunting sheep.
  const fix=replacementJob(c,ctx);if(fix)return fix;
  const wool=WOOLS.find(w=>c(w)>=3);
  if(!wool)return ctx.huntPhase?{type:'collect',radius:16}:{type:'fight',entity:'sheep',maxSeconds:30};
  return {type:'craft',item:wool.replace('_wool','_bed'),count:1};
 }},
 {name:'home',done:()=>false,next(c,ctx){
  if(ctx.slotsFull>0.8&&ctx.homeChest)return {type:'deposit',position:ctx.home};
  if(ctx.slotsFull>0.8&&c('chest')>=1&&ctx.chestSpot)return {type:'place',block:'chest',position:ctx.chestSpot};
  if(ctx.slotsFull>0.8)return {type:'craft',item:'chest',count:1};
  return {type:'explore',distance:96};
 }},
 // COMBAT_SPEC 7a: diamond sword, axe and the full armour set, cheapest piece first.
 {name:'diamonds',done:c=>DIAMOND_GEAR.every(([name])=>c(name)>=1),next(c){
  const remaining=DIAMOND_GEAR.filter(([name])=>c(name)<1);
  if(!remaining.length)return null;
  const [item,cost]=remaining[0];
  if(c('diamond')>=cost)return {type:'craft',item,count:1};
  return {type:'gather',block:'diamond_ore',count:remaining.reduce((a,[,need])=>a+need,0)-c('diamond'),radius:32,searchIfMissing:true,targetY:-58,strip:true};
 }},
];

// Pure step selection for tests and the tick: first unmet step and its next job. Logs and
// planks are counted across all species; planks are crafted from whichever log is held.
const woodTotals=(counts,ctx)=>{
 ctx.logsTotal=ctx.logsTotal??Object.keys(counts).filter(n=>/_log$/.test(n)).reduce((a,n)=>a+counts[n],0);
 ctx.planksTotal=ctx.planksTotal??Object.keys(counts).filter(n=>/_planks$/.test(n)).reduce((a,n)=>a+counts[n],0);
 ctx.heldLog=ctx.heldLog??(Object.keys(counts).filter(n=>/_log$/.test(n)).sort((a,b)=>counts[b]-counts[a])[0]||null);
 return ctx;
};
// Bed before dusk (soak 2026-10-14: every night was a shelter, no bed). Only when wool is
// cheap: a sheep within 32 and shears (shear: 1-3 wool, the sheep lives) or a sword (hunt:
// one wool each). From BED_PREP_FROM until dusk: wool of one colour, 3 planks from logs
// held, then the bed. Null otherwise - the dusk dirt and the night shelter stay the plan.
// ctx: {tod, bedNear, sheepNear, worldTable} plus the counts' wood totals. The bed is a 3x3
// recipe: without a table held or standing near, the craft makes one first (4 more planks).
export const BED_PREP_FROM=9000,BED_PREP_JOBS=5;
// After a low-health stop the ladder waits (up to RECOVER_MS) for the health to come back
// instead of submitting jobs the worker's check() refuses at once - three of those would
// count as three failures and block the step. Natural regen needs a food bar of 18+.
export const RECOVER_MS=60000;
export function bedPrepJob(counts,ctx){
 const c=countFactory(counts);
 ctx=woodTotals(counts,{...ctx});
 if(ctx.bedNear||ctx.tod==null||ctx.tod<BED_PREP_FROM||ctx.tod>=NIGHT_START)return null;
 if(WOOLS.some(w=>c(w.replace('_wool','_bed'))>=1))return null;
 const wool=WOOLS.reduce((a,w)=>c(w)>c(a)?w:a,WOOLS[0]);
 const planks=3+(c('crafting_table')>=1||ctx.worldTable?0:4);
 if(c(wool)>=3){
  if(ctx.planksTotal<planks)return ctx.logsTotal>=1?{type:'craft',item:(ctx.heldLog||'oak_log').replace('_log','_planks'),count:planks-ctx.planksTotal}:null;
  return {type:'craft',item:wool.replace('_wool','_bed'),count:1};
 }
 // The bed itself must be payable from what is held: no log hunt at dusk.
 if(!ctx.sheepNear||ctx.planksTotal+4*ctx.logsTotal<planks)return null;
 if(c('shears')>=1)return {type:'shear'};
 if(Object.keys(counts).some(n=>/_sword$/.test(n)&&counts[n]>0))return {type:'hunt',entity:'sheep',count:Math.min(3-c(wool),ctx.sheepNear)};
 return null;
}
export function plan(counts,ctx={}){
 const c=countFactory(counts);
 ctx=woodTotals(counts,{...ctx});
 for(const entry of STEPS){
  if(ctx.blocked===entry.name)continue;
  if(entry.done(c,ctx))continue;
  return {step:entry.name,job:entry.next(c,ctx)};
 }
 return {step:null,job:null};
}

export class Autopilot{
 constructor(worker,root){
  this.worker=worker;this.root=root;
  this.enabled=false;this.goal=null;this.state='idle';this.current=null;this.currentStep=null;
  this.failures={};this.lastNightKey=null;this.lastDuskKey=null;this.lastHomeScan=0;this.huntPhase=false;
  this.lastSurfaceY=null; // the stand-Y of the last surface gather (unblock-explore cap)
  this.foodAnchorY=null;  // the food-graze anchor when no surface gather set lastSurfaceY
  this.file=path.join(root,'data/autopilot.json');
  this.home=null;this.homeChest=false;
  try{const saved=JSON.parse(fs.readFileSync(this.file,'utf8'));if(saved&&saved.home){this.home=saved.home;this.homeChest=!!saved.homeChest;}}catch{}
 }
 save(){try{fs.writeFileSync(this.file,JSON.stringify({home:this.home,homeChest:this.homeChest},null,2));}catch{}
 }
  start(goal){
   this.enabled=true;this.goal=goal||null;this.state='starting';this.current=null;this.currentStep=null;
   this.failures={};this.coolUntil=0;this.lastSurfaceY=null;this.foodAnchorY=null;this.huntPhase=false;
   this.lastNightKey=null;this.lastDuskKey=null;
   this.worker.userStopped=false;this.worker.deathResume=false;
   this.log('Autopilot started'+(this.goal?' (goal: '+this.goal+')':''));this.save();
  }
  stop(){if(this.enabled||this.state!=='idle'){this.enabled=false;this.state='idle';this.current=null;this.coolUntil=0;this.log('Autopilot stopped');this.save();}}
  log(message){this.worker.log(message);}
  status(){return {enabled:this.enabled,state:this.state,step:this.currentStep,goal:this.goal,home:this.home};}
  tick(){
   if(!this.enabled)return;
   const w=this.worker,b=w.bot;
   if(!w.ready||!b){this.state='waiting: not connected';return;}
   if(this.coolUntil&&Date.now()<this.coolUntil){
    // Back off after failures so a step that cannot succeed right now does not storm the
    // queue with one job per second.
    this.state='backing off ('+Math.ceil((this.coolUntil-Date.now())/1000)+'s): '+String(this.currentStep||'retry');
    return;
   }
   if(w.deathResume){this.state='paused: died - resume to continue';return;}
  if(w.userStopped){this.enabled=false;this.state='idle';this.current=null;this.log('Autopilot stopped (Stop all)');return;}
  const active=w.jobs.find(j=>['running','queued'].includes(j.status));
  if(active){
   this.state=active.status==='running'?'working: '+active.spec.type:'queued: '+active.spec.type;
   if(this.current&&active.id===this.current.id){
    if(active.status==='paused'&&String(active.message).startsWith('Reflex:'))this.state='reflex handling: '+active.message;
    if(['complete','failed'].includes(active.status))this.settle(active);
   }
   // The food explore must not walk PAST animals (soak 6 normal1/2: the bot wandered
   // 200+ blocks with 0 food while animals could have been behind it): a running food-step
   // explore is cancelled the moment animals come into hunt range, and the next decide()
   // submits the fight. Job-after-job ordering would wait out the whole 64-block leg.
   if(active.status==='running'&&active.spec.type==='explore'&&this.currentStep==='food'&&this.animalsNearby(b)){
    // 'autopilot' source: a user-sourced cancel set userStopped and the next tick switched
    // the ladder off as if Stop all was pressed (soak normal3 idled twice this way).
    try{this.worker.cancel(active.id,'autopilot');this.log('Autopilot: food explore cancelled - animals in range');}
    catch(e){this.state='cancel failed: '+e.message;}
   }
   // Night prep OUTRANKS the ladder's day jobs (first-night milestone): the night branch
   // used to sit behind this active-job return, and a continuously busy ladder never
   // reached it - soak 6's hard runs tanked the whole night with no shelter attempt.
   // A running fight/eat or night job is never cut off: the idle branch below submits the
   // night job the moment it settles (the key is only spent when the job goes out).
   const busy=active.status==='running'&&['fight','eat','sleep','shelter'].includes(active.spec?.type);
   if(isNight(b)&&!busy&&this.lastNightKey!==String(b.time?.day)){
    this.lastNightKey=String(b.time?.day); // once per day even if the submit loses the race
    const bedNear=b.inventory.items().some(i=>/_bed$/.test(i.name))||b.findBlock({matching:Object.values(b.registry.blocksByName).filter(bl=>/_bed$/.test(bl.name)).map(bl=>bl.id),maxDistance:16});
    if(active.status==='running'){try{this.worker.cancel(active.id,'autopilot');}catch(e){this.state='cancel failed: '+e.message;return;}}
    this.submit('night',bedNear?{type:'sleep'}:{type:'shelter'});
    return;
   }
   return;
  }
  if(this.current)this.settle(w.jobs.find(j=>j.id===this.current.id)||{status:'complete',id:this.current.id});
  if(!isNight(b)&&this.recovering(b))return; // the night job (shelter or sleep) still goes out
  this.rememberHome(b);
  // Dusk prep: without a bed the night shelter needs 25 dirt/cobble in the inventory, so
  // gather the dirt while there is still daylight (once per day). Grass blocks drop dirt.
  const bedNear=b.inventory.items().some(i=>BED.test(i.name))||b.findBlock({matching:Object.values(b.registry.blocksByName).filter(bl=>BED.test(bl.name)).map(bl=>bl.id),maxDistance:16});
  const todNow=dayTicks(b)??0;
  // Bed before dusk when wool is cheap (bedPrepJob); a failed prep job ends it for the day.
  const day=String(b.time?.day);
  if(this.bedPrep?.day!==day)this.bedPrep={day,jobs:0,off:false};
  if(!this.bedPrep.off&&this.bedPrep.jobs<BED_PREP_JOBS){
   const worldTable=!!b.findBlock({matching:b.registry.blocksByName.crafting_table?.id,maxDistance:4});
   const job=bedPrepJob(this.counts(),{tod:dayTicks(b),bedNear:!!bedNear,sheepNear:this.sheepNear(b),worldTable});
   if(job){this.bedPrep.jobs++;this.submit('bed-prep',job);return;}
  }
  const dusk=todNow>=10500&&todNow<12541;
  if(dusk&&this.lastDuskKey!==String(b.time.day)&&!bedNear&&b.inventory.items().some(i=>/_pickaxe$/.test(i.name))){
   const dirt=b.inventory.items().filter(i=>i.name==='dirt'||i.name==='cobblestone').reduce((a,i)=>a+i.count,0);
   if(dirt<25){
    this.lastDuskKey=String(b.time.day);
    this.submit('dusk-dirt',{type:'gather',block:'grass_block',count:25,radius:32});
    return;
   }
  }
  if(isNight(b)&&this.lastNightKey!==String(b.time.day)){
   this.lastNightKey=String(b.time.day);
   const bedNear=b.inventory.items().some(i=>/_bed$/.test(i.name))||b.findBlock({matching:Object.values(b.registry.blocksByName).filter(bl=>BED.test(bl.name)).map(bl=>bl.id),maxDistance:16});
   this.submit('night',bedNear?{type:'sleep'}:{type:'shelter'});return;
  }
  this.decide(b);
 }
 recovering(b){
  const min=this.worker.config?.limits?.minHealth??10;
  if(!(b.health<min)){this.lowSince=0;this.recoverAte=false;return false;}
  if(!this.lowSince)this.lowSince=Date.now();
  if(Date.now()-this.lowSince>=RECOVER_MS)return false;
  if(b.food<18&&!this.recoverAte&&this.counts()._edible>0){this.recoverAte=true;this.submit('recover',{type:'eat'});return true;}
  this.state='recovering: health '+Math.round(b.health);
  return true;
 }
 settle(job){
  if(!this.current)return;
  if(job&&job.status==='failed'){
   const step=this.current.step;
   this.failures[step]=(this.failures[step]||0)+1;
   this.coolUntil=Date.now()+8000; // give the world (and reflexes) time before retrying
   if(step==='bed-prep'&&this.bedPrep)this.bedPrep.off=true; // shelter tonight
   if(this.failures[step]>=3){this.state='blocked: '+step+' (exploring elsewhere)';this.log('Autopilot: '+step+' failed '+this.failures[step]+' times; exploring before retry');}
   else this.state='retry: '+step+' ('+this.failures[step]+'/3)';
  }else{
   this.failures[this.currentStep]=0;
   this.coolUntil=0;
   this.state='step done: '+this.currentStep;
  }
  this.current=null;this.currentStep=null;
 }
 counts(){
  const map={};
  const registry=this.worker.bot.registry;
  for(const item of this.worker.bot.inventory.items()){
   map[item.name]=(map[item.name]||0)+item.count;
   // COMBAT_SPEC 7a: mark nearly-broken gear so the ladder can craft a replacement
   // before it breaks mid-fight (repair-by-replacement).
   if(GEAR.test(item.name)){
    const max=registry.itemsByName?.[item.name]?.maxDurability,used=item.durabilityUsed||0;
    if(max&&1-used/max<=WORN_LIMIT)map['_worn_'+item.name]=(map['_worn_'+item.name]||0)+1;
   }
  }
  map._edible=Object.keys(map).filter(n=>registry.foodsByName[n]&&!EDIBLE_SKIP.has(n)).reduce((a,n)=>a+map[n],0);
  map._wool_total=Object.keys(map).filter(n=>/_wool$/.test(n)).reduce((a,n)=>a+map[n],0);
  return map;
 }
 rememberHome(b){
  const now=Date.now();
  if(now-this.lastHomeScan<15000)return;
  this.lastHomeScan=now;
  if(this.home&&this.homeChest)return;
  const registry=b.registry;
  if(!this.home){
   const bed=b.findBlock({matching:Object.values(b.registry.blocksByName).filter(bl=>BED.test(bl.name)).map(bl=>bl.id),maxDistance:16});
   if(bed){this.home={x:bed.position.x,y:bed.position.y,z:bed.position.z};this.save();this.log('Autopilot: home set to the bed at '+bed.position.floored());}
  }
  if(this.home&&!this.homeChest){
   const chest=b.findBlock({matching:[b.registry.blocksByName.chest.id],maxDistance:16});
   if(chest){this.homeChest=true;this.save();this.log('Autopilot: home chest found at '+chest.position.floored());}
  }
 }
 hostileDistance(b){
  let best=Infinity;
  const me=b.entity&&b.entity.position;
  if(!me)return best;
  for(const e of Object.values(b.entities||{})){
   if(!e||e===b.entity||e.type!=='hostile'||!e.position)continue;
   const d=e.position.distanceTo(me);
   if(d<best)best=d;
  }
  return best;
 }
 sheepNear(b,radius=32){
  let n=0;
  for(const e of Object.values(b.entities||{}))if(e&&e!==b.entity&&e.name==='sheep'&&e.position&&b.entity?.position&&e.position.distanceTo(b.entity.position)<=radius)n++;
  return n;
 }
 animalsNearby(b){
  const counts={};
  for(const e of Object.values(b.entities)){
   if(e===b.entity||!e.position)continue;
   if(['cow','pig','sheep','chicken'].includes(e.name)&&e.position.distanceTo(b.entity.position)<=48)counts[e.name]=(counts[e.name]||0)+1;
  }
  const best=Object.keys(counts).sort((a,c)=>counts[c]-counts[a])[0];
  return best?{type:best,near:counts[best]}:null;
 }
 chestSpotNear(b){
  const origin=b.entity.position.floored();
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[2,0],[-2,0],[0,2],[0,-2]]){
   const point=origin.offset(dx,0,dz);
   const top=b.blockAt(point),ground=b.blockAt(point.offset(0,-1,0));
   if(top?.boundingBox==='empty'&&ground?.boundingBox==='block')return {x:point.x,y:point.y,z:point.z};
  }
  return null;
 }
 // The table a keepTable craft left standing (worker.leftTable). It counts as the wood step's
 // table while it stands within 32, so a reflex flee or a night shelter mid-kit no longer
 // regresses the ladder into crafting (and abandoning) a second table.
 leftTable(b){
  const t=this.worker.leftTable;
  if(!t||!b.entity||!b.entity.position)return null;
  const block=b.blockAt(new Vec3(t.x,t.y,t.z));
  if(!block)return null; // unloaded: keep the memory, but it is not usable from here
  if(block.name!=='crafting_table'){this.worker.leftTable=null;return null;} // picked up or broken
  return {position:{x:t.x,y:t.y,z:t.z},distance:b.entity.position.distanceTo(new Vec3(t.x+0.5,t.y,t.z+0.5))};
 }
 decide(b){
  const counts=this.counts();
  const animals=this.animalsNearby(b);
  const items=b.inventory.items().length;
  const left=this.leftTable(b);
  const worldTable=!!b.findBlock({matching:b.registry.blocksByName.crafting_table?.id,maxDistance:8})||!!(left&&left.distance<=32);
  const worldFurnace=!!b.findBlock({matching:b.registry.blocksByName.furnace?.id,maxDistance:16});
  const standY=b.entity&&b.entity.position?Math.floor(b.entity.position.y):null;
  const ctx={slotsFull:items/36,animalsNearby:animals?animals.type:null,huntPhase:this.huntPhase,homeChest:this.homeChest,home:this.home,chestSpot:this.home?this.chestSpotNear(b):null,hostileDistance:this.hostileDistance(b),worldTable,worldFurnace,grazeDirection:grazeDirection(b),standY,lastSurfaceY:this.lastSurfaceY??this.foodAnchorY};
  const choice=plan(counts,{...ctx,blocked:this.state.startsWith('blocked: ')?this.state.slice(9).split(' ')[0]:null});
  if(!choice.step){this.state='all steps satisfied';return;}
  // While ANY step is blocked the ladder must not run later steps' jobs on top of the gap
  // (a stone-step craft with no planks only burns failures); explore, then UNBLOCK and
  // retry the step from the new position. The unblock is the whole point of the explore -
  // without it the step stayed blocked forever and the ladder explored in circles
  // (measured: soak 20261012-020850, 13+ 'No path' failures, wood never retried).
  if(this.state.startsWith('blocked: ')){
   const step=this.state.slice(9).split(' ')[0];
   this.currentStep=step;
   // Wood only: the stand-Y cap. Stone gathers sit in a pit 20-40 below the grove; applying
   // the wood surfaceY there makes every path fail "left the surface" and the step retries
   // in place forever (soak 20261014-0239 normal3, 3 min backing off at y=86).
   const surface=(step==='wood'&&this.lastSurfaceY!=null)?{surface:true,surfaceY:this.lastSurfaceY}:{};
   this.submit(step,{type:'explore',direction:'random',distance:step==='wood'?48:64,...surface});
   this.failures[step]=0;
   this.state='retry: '+step; // unblocked: the explore was the cooldown
   return;
  }
  if(choice.step==='food'&&choice.job?.type==='explore'&&this.lastSurfaceY==null&&this.foodAnchorY==null)this.foodAnchorY=standY;
  if(choice.step==='food'||choice.step==='bed')this.huntPhase=!this.huntPhase;
  this.currentStep=choice.step;
  if(!choice.job){this.state=choice.step+': satisfied';return;}
  // A step-kit craft with its table standing out of the craft's 6-block reach: walk back to
  // it rather than craft and place a second one (4 planks, and the first is abandoned).
  // Two trips that do not get the bot near it forget the table.
  const tableCraft=choice.job.type==='craft'&&(choice.job.keepTable||choice.job.collectTable);
  if(tableCraft&&left&&left.distance>5&&left.distance<=32&&!b.findBlock({matching:b.registry.blocksByName.crafting_table?.id,maxDistance:6})){
   const key=left.position.x+','+left.position.y+','+left.position.z;
   this.tableTrips=this.tableTrips&&this.tableTrips.key===key?this.tableTrips:{key,n:0};
   if(++this.tableTrips.n<=2){this.submit(choice.step,{type:'goto',position:left.position});return;}
   this.worker.leftTable=null;
  }else if(left&&left.distance<=5)this.tableTrips=null; // reached: the trips worked
  this.submit(choice.step,choice.job);
 }
 submit(step,spec){
  try{
   // Remember where surface gathers started: the step's unblock explores cap themselves
   // to that stand-Y (explore legs used to walk the bot off the grove).
   if(spec.type==='gather'&&spec.surface&&this.worker.bot){
    try{this.lastSurfaceY=Math.floor(this.worker.bot.entity.position.y);}catch{}
   }
   const job=this.worker.submit(spec);
   this.current={id:job.id,step,spec};this.currentStep=step;this.state=step+': '+spec.type;
   this.log('Autopilot ['+step+'] '+JSON.stringify(spec));
  }catch(e){this.state='submit failed: '+e.message;this.log('Autopilot submit failed: '+e.message);}
 }
}
