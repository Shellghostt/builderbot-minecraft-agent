// Perception summary for /api/observe and minecraft_observe (autonomy spec Phase 1).
// A compact JSON document built only from real game state; never executes generated code.
const BOUND=24,LIMIT=BOUND*BOUND,MAX_ENTITIES=15;
const ORES=['coal','copper','iron','gold','diamond','redstone','lapis'];
const CROPS=['wheat','carrots','potatoes','beetroots'];
const SIMPLE=['water','lava','crafting_table','furnace','gravel','clay'];
// mineflayer e.type is the minecraft-data category string; 'other'/'orb' are dropped items and xp.
const PASSIVE_TYPES=['animal','passive','water_creature','ambient','mob'];
const DROPPED_TYPES=['other','orb'];
const categories={};
function categoryOf(name){
 let key=categories[name];
 if(key===undefined){
  if(name.endsWith('_log'))key='log';
  else if(name==='stone')key='stone';
  else if(name.endsWith('_ore')){const base=name.replace(/^deepslate_/,'').slice(0,-4);key=ORES.includes(base)?base+'_ore':null;}
  else if(name==='chest'||name==='trapped_chest')key='chest';
  else if(name.endsWith('_bed'))key='bed';
  else if(CROPS.includes(name))key='crops';
  else if(name==='sand'||name==='red_sand')key='sand';
  else key=SIMPLE.includes(name)?name:null;
  categories[name]=key;
 }
 return key;
}
const at=(x,y,z)=>({x,y,z});
const floored=p=>({x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)});
const cleanName=name=>name?(''+name).replace('minecraft:',''):null;
// prismarine-chunk stores biomes per 4x4x4 cell; x/z must be chunk-local, y absolute.
function biomeAt(bot,origin){
 const column=bot.world?.getColumn?.(origin.x>>4,origin.z>>4);
 const id=column?.getBiome?.({x:origin.x&15,y:origin.y,z:origin.z&15});
 return id==null?null:cleanName(bot.registry?.biomes?.[id]?.name);
}
// Food the bot would actually eat (registry foods minus the autopilot's never-eat list).
// The soak's food metric reads this: its old `_edible` key never existed in observe.
export const EDIBLE_SKIP=new Set(['rotten_flesh','spider_eye','poisonous_potato','pufferfish']);
export function edibleCount(bot){
 const foods=bot.registry&&bot.registry.foodsByName||{};
 return bot.inventory.items().filter(i=>foods[i.name]&&!EDIBLE_SKIP.has(i.name)).reduce((a,i)=>a+i.count,0);
}
function timeOfDay(value){const tick=((value||0)%24000+24000)%24000;return tick<12000?'day':tick<13800?'dusk':tick<22200?'night':'dawn';}
export function survey(bot){
 const origin=bot.entity.position.floored(),feet=bot.blockAt(origin),blocks={};
 for(let dx=-BOUND;dx<=BOUND;dx++)for(let dy=-BOUND;dy<=BOUND;dy++)for(let dz=-BOUND;dz<=BOUND;dz++){
  const d2=dx*dx+dy*dy+dz*dz;if(d2>LIMIT)continue;
  const block=bot.blockAt(origin.offset(dx,dy,dz));if(!block)continue;
  const key=categoryOf(block.name);if(!key)continue;
  const entry=blocks[key]||(blocks[key]={count:0,d2,at:at(origin.x+dx,origin.y+dy,origin.z+dz)});
  entry.count++;if(d2<entry.d2){entry.d2=d2;entry.at=at(origin.x+dx,origin.y+dy,origin.z+dz);}
 }
 const centre=bot.entity.position;
 let drops=0,creeper=null;
 const creatures=[];
 for(const e of Object.values(bot.entities)){
  if(e===bot.entity||!e.position||e.position.distanceTo(centre)>BOUND)continue;
  if(e.name==='creeper'&&!creeper)creeper={swell:e.metadata&&e.metadata[16],powered:e.metadata&&e.metadata[17],ignited:e.metadata&&e.metadata[18]};
  if(e.type==='player'||e.type==='hostile'||PASSIVE_TYPES.includes(e.type))creatures.push({type:e.username||e.name||'unknown',class:e.type==='player'?'player':e.type==='hostile'?'hostile':'passive',d:Math.round(e.position.distanceTo(centre)*10)/10,at:floored(e.position)});
  else if(DROPPED_TYPES.includes(e.type))drops++;
 }
 const entities=creatures.sort((a,b)=>a.d-b.d).slice(0,MAX_ENTITIES);
 const slot=i=>bot.inventory.slots[i]?.name||null;
 return {position:{x:origin.x,y:origin.y,z:origin.z},
  dimension:cleanName(bot.game?.dimension),biome:cleanName(feet?.biome?.name)||biomeAt(bot,origin),
  timeOfDay:timeOfDay(bot.time?.timeOfDay),weather:bot.thunderState>0?'thunder':bot.isRaining?'rain':'clear',
  light:feet?Math.max(feet.light||0,feet.skyLight||0):null,
  health:bot.health??null,food:bot.food??null,saturation:bot.foodSaturation??null,oxygen:bot.oxygenLevel??null,
  held:bot.heldItem?{name:bot.heldItem.name,count:bot.heldItem.count}:null,
  armor:{head:slot(5),chest:slot(6),legs:slot(7),feet:slot(8)},
  inventory:bot.inventory.items().reduce((map,item)=>{map[item.name]=(map[item.name]||0)+item.count;return map;},{}),
  edible:edibleCount(bot),
  blocks:Object.fromEntries(Object.entries(blocks).map(([key,entry])=>[key,{count:entry.count,at:entry.at}])),entities,drops,...(creeper?{creeper}:{})};
}
