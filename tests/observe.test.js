import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {survey} from '../src/observe.js';
const catalog={};let nextId=1;
const idOf=name=>catalog[name]??(catalog[name]=nextId++);
function fakeBot({position=[0,-60,0],timeOfDay=1000,raining=false,thunder=0,blocks={},entities={},withColumn=true}={}){
 const world=new Map(Object.entries(blocks).map(([key,name])=>[key,{id:idOf(name),name,light:0,skyLight:15}]));
 const bot={entity:{position:new Vec3(...position)},game:{dimension:'minecraft:overworld'},time:{timeOfDay},isRaining:raining,thunderState:thunder,
  health:20,food:20,foodSaturation:5,oxygenLevel:20,heldItem:{name:'iron_pickaxe',count:1},
  inventory:{items:()=>[{name:'oak_log',count:4},{name:'oak_log',count:4},{name:'cobblestone',count:3}],slots:[]},
  blockAt:p=>world.get(`${p.x},${p.y},${p.z}`)||{id:0,name:'air',light:0,skyLight:15},
  world:{getColumn:withColumn?(cx,cz)=>({getBiome:pos=>5}):undefined},
  registry:{biomes:{5:{name:'minecraft:plains'}}},entities};
 return bot;
}
test('observes environment, vitals, armour and grouped inventory',()=>{
 const bot=fakeBot({blocks:{'0,-60,0':'grass_block'}});
 bot.inventory.slots[5]={name:'iron_helmet'};bot.inventory.slots[8]={name:'iron_boots'};
 const s=survey(bot);
 assert.equal(s.dimension,'overworld');assert.equal(s.biome,'plains');assert.deepEqual(s.position,{x:0,y:-60,z:0});
 assert.equal(s.timeOfDay,'day');assert.equal(s.weather,'clear');assert.equal(s.light,15);
 assert.equal(s.health,20);assert.equal(s.food,20);assert.equal(s.saturation,5);assert.equal(s.oxygen,20);
 assert.deepEqual(s.held,{name:'iron_pickaxe',count:1});
 assert.deepEqual(s.armor,{head:'iron_helmet',chest:null,legs:null,feet:'iron_boots'});
 assert.deepEqual(s.inventory,{oak_log:8,cobblestone:3});
 const fb=survey({...fakeBot({withColumn:false}),blockAt:()=>({id:0,name:'air',biome:{name:'minecraft:plains'},light:0,skyLight:15})});
 assert.equal(fb.biome,'plains');
});
test('counts nearby blocks by category with nearest positions and merges deepslate ores',()=>{
 const bot=fakeBot({blocks:{
  '2,-60,2':'iron_ore','3,-60,2':'deepslate_iron_ore','4,-60,2':'nether_gold_ore',
  '5,-60,5':'oak_log','6,-60,6':'oak_log','0,-61,-1':'water','1,-63,0':'lava','10,-60,10':'clay',
  '1,-58,1':'red_bed','2,-59,1':'wheat','3,-60,1':'sand','1,-60,3':'chest','2,-60,3':'trapped_chest',
  '1,-60,4':'crafting_table','1,-60,5':'furnace','1,-60,6':'gravel','20,-60,20':'stone','30,-60,0':'stone'}});
 const s=survey(bot);
 assert.equal(s.blocks.iron_ore.count,2);assert.deepEqual(s.blocks.iron_ore.at,{x:2,y:-60,z:2});
 assert.equal(s.blocks.log.count,2);assert.deepEqual(s.blocks.log.at,{x:5,y:-60,z:5});
 assert.equal(s.blocks.water.count,1);assert.equal(s.blocks.lava.count,1);
 assert.equal(s.blocks.chest.count,2);assert.equal(s.blocks.bed.count,1);assert.equal(s.blocks.crops.count,1);
 assert.equal(s.blocks.sand.count,1);assert.equal(s.blocks.clay.count,1);
 assert.equal(s.blocks.crafting_table.count,1);assert.equal(s.blocks.furnace.count,1);assert.equal(s.blocks.gravel.count,1);
 assert.equal(s.blocks.stone,undefined);assert.equal(s.blocks.nether_gold_ore,undefined);
});
test('lists nearest living entities first with classes, excluding the bot and drops, capped at 15',()=>{
 const self={type:'player',username:'BuilderBot',position:new Vec3(0,-60,0)};
 const entities={1:self};
 for(let i=0;i<20;i++)entities[i+2]={type:'hostile',name:'zombie',position:new Vec3(2+i,-60,0)};
 entities[99]={type:'animal',name:'pig',position:new Vec3(1,-60,-1)};
 entities[100]={type:'player',username:'SH1FU_01',position:new Vec3(0,-60,3)};
 entities[101]={type:'other',name:'item',position:new Vec3(1,-60,1)};
 entities[102]={type:'orb',name:'experience_orb',position:new Vec3(2,-60,1)};
 entities[103]={type:'projectile',name:'arrow',position:new Vec3(3,-60,1)};
 const bot=fakeBot({entities});bot.entity=self;
 const s=survey(bot);
 assert.ok(!s.entities.some(e=>e.type==='BuilderBot'));
 assert.equal(s.entities.length,15);
 assert.equal(s.entities[0].type,'pig');assert.equal(s.entities[0].class,'passive');
 assert.equal(s.entities.find(e=>e.class==='player')?.type,'SH1FU_01');
 assert.ok(s.entities.every((e,i,a)=>['player','hostile','passive'].includes(e.class)&&(i===0||a[i-1].d<=e.d)));
 assert.ok(!s.entities.some(e=>['item','experience_orb','arrow'].includes(e.type)));
 assert.equal(s.drops,2);
});
test('maps time of day and weather',()=>{
 assert.equal(survey(fakeBot({timeOfDay:6000})).timeOfDay,'day');
 assert.equal(survey(fakeBot({timeOfDay:12500})).timeOfDay,'dusk');
 assert.equal(survey(fakeBot({timeOfDay:15000})).timeOfDay,'night');
 assert.equal(survey(fakeBot({timeOfDay:23000})).timeOfDay,'dawn');
 assert.equal(survey(fakeBot({raining:true})).weather,'rain');
 assert.equal(survey(fakeBot({raining:true,thunder:1})).weather,'thunder');
});
test('stays compact (under ~3 KB) in a busy world',()=>{
 const blocks={};
 for(let i=0;i<17;i++){blocks[`${i},-60,${i}`]='oak_log';blocks[`${-i},-61,${i}`]='water';if(i)blocks[`${i},-61,${-i}`]='lava';}
 const named=['coal_ore','iron_ore','copper_ore','gold_ore','diamond_ore','redstone_ore','lapis_ore','deepslate_diamond_ore','stone','crafting_table','furnace','chest','sand','gravel','clay','red_bed','wheat'];
 named.forEach((name,i)=>blocks[`${i+1},-59,0`]=name);
 const entities={};for(let i=0;i<15;i++)entities[i+1]={type:'hostile',name:'zombie',position:new Vec3(1+i,-60,1)};
 entities[50]={type:'player',username:'SH1FU_01',position:new Vec3(3,-60,3)};
 const bot=fakeBot({blocks,entities});
 bot.inventory.items=()=>Array.from({length:12},(_,i)=>({name:'item_'+i,count:64}));
 const s=survey(bot),size=Buffer.byteLength(JSON.stringify(s));
 assert.equal(s.entities.length,15);assert.equal(s.blocks.log.count,17);
 assert.equal(s.blocks.iron_ore.count,1);assert.equal(s.blocks.clay.count,1);
 assert.ok(size<3072,'survey payload is '+size+' bytes');
});
