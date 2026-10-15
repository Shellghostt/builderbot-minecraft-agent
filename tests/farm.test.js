// Round 10, habit 11: food security beyond hunting - a wheat patch beside home, breeding, hay.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Vec3} from 'vec3';
import {Worker,blockAge} from '../src/worker.js';
import {Autopilot,farmJob,plan,FARM_PLOTS,BREED_EVERY_MS} from '../src/autopilot.js';
import {jobSchema} from '../src/schema.js';
const farm={nearHome:true,water:true,plots:0,ripe:0,farmland:null,tillable:{x:3,y:63,z:0},grass:true};
const kit={stick:4,oak_planks:8,crafting_table:1};
test('farmJob: seeds from grass, a hoe, till beside the water, plant, harvest ripe wheat',()=>{
 assert.deepEqual(farmJob(kit,{farm}),{type:'gather',block:'short_grass',count:2,radius:16});
 assert.deepEqual(farmJob({...kit,wheat_seeds:4},{farm}),{type:'craft',item:'wooden_hoe',count:1});
 assert.deepEqual(farmJob({...kit,wheat_seeds:4,stone_hoe:1},{farm}),{type:'use',item:'stone_hoe',position:{x:3,y:63,z:0}});
 assert.deepEqual(farmJob({...kit,wheat_seeds:4},{farm:{...farm,farmland:{x:3,y:63,z:0}}}),{type:'use',item:'wheat_seeds',position:{x:3,y:63,z:0}});
 assert.deepEqual(farmJob({...kit},{farm:{...farm,ripe:3}}),{type:'gather',block:'wheat',count:3,radius:12});
 assert.equal(farmJob({...kit,wheat_seeds:4,wooden_hoe:1},{farm:{...farm,plots:FARM_PLOTS}}),null,'the patch is full');
 assert.equal(farmJob({...kit,wheat_seeds:4,wooden_hoe:1},{farm:{...farm,water:false}}),null,'no water: no farm');
 assert.equal(farmJob({...kit,wheat_seeds:4,wooden_hoe:1},{farm:{...farm,nearHome:false}}),null);
 assert.equal(farmJob({...kit,wheat_seeds:4,wooden_hoe:1},{farm,tod:13000}),null,'not at night');
 assert.equal(farmJob({...kit,wheat_seeds:4,wooden_hoe:1},{farm,farmOff:true}),null);
 for(const j of [farmJob(kit,{farm}),farmJob({...kit,wheat_seeds:4},{farm:{...farm,farmland:{x:3,y:63,z:0}}}),farmJob(kit,{farm:{...farm,ripe:3}})])assert.ok(jobSchema.safeParse(j).success);
});
const STONE={oak_planks:8,stick:10,crafting_table:1,wooden_pickaxe:1,wooden_sword:1,wooden_axe:1,cobblestone:32,stone_pickaxe:1,stone_sword:1,stone_axe:1,stone_shovel:1,furnace:1};
test('the food step: hay into wheat, a pair bred, a village hay bale taken',()=>{
 assert.deepEqual(plan({...STONE,_edible:1,hay_block:1}).job,{type:'craft',item:'wheat',count:9});
 assert.deepEqual(plan({...STONE,_edible:1,wheat:2},{breedable:'cow'}).job,{type:'breed',entity:'cow'});
 assert.equal(plan({...STONE,_edible:0,wheat:2},{breedable:'cow',animalsNearby:'cow'}).job.type,'fight','starving: hunt first');
 assert.deepEqual(plan({...STONE,_edible:1},{hayNear:2}).job,{type:'gather',block:'hay_block',count:2,radius:32});
});
test('breedable: two of a kind in 16 and 2 of their food, once per 5 minutes',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'breed-'));
 try{
  const me=new Vec3(0,64,0);
  const bot={entity:{position:me},entities:{1:{name:'cow',position:new Vec3(3,64,0)},2:{name:'cow',position:new Vec3(5,64,2)},3:{name:'pig',position:new Vec3(2,64,0)}}};
  const ap=new Autopilot({log(){},bot},root);
  assert.equal(ap.breedable(bot,{wheat:2}),'cow');
  assert.equal(ap.breedable(bot,{wheat:1,carrot:5}),null,'one pig only');
  ap.bredAt={cow:Date.now()};assert.equal(ap.breedable(bot,{wheat:2}),null);
  ap.bredAt={cow:Date.now()-BREED_EVERY_MS};assert.equal(ap.breedable(bot,{wheat:2}),'cow');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('use wheat_seeds on farmland plants the crop above it',async()=>{
 const cells={'3,63,0':'farmland','3,64,0':'air'};
 const bot={heldItem:null,inventory:{items:()=>[{name:'wheat_seeds',count:4}]},registry:{itemsByName:{wheat_seeds:{id:1}}},
  blockAt:p=>{const n=cells[p.x+','+p.y+','+p.z]||'stone';return {name:n,position:p,boundingBox:n==='air'||n==='wheat'?'empty':'block'};},
  async equip(i){bot.heldItem=i;},async activateBlock(bl){cells['3,64,0']='wheat';}};
 const w=Object.assign(Object.create(Worker.prototype),{bot,check(){},async walk(){},async flushTick(){}});
 await w.use({spec:{type:'use',item:'wheat_seeds',position:{x:3,y:63,z:0}}},0);
 assert.equal(cells['3,64,0'],'wheat');
 cells['3,64,0']='air';bot.activateBlock=async()=>{};
 await assert.rejects(w.use({spec:{type:'use',item:'wheat_seeds',position:{x:3,y:63,z:0}}},0),/grew nothing/);
});
test('a wheat gather counts wheat and takes only ripe crops',async()=>{
 const crops=new Map([['2,64,0',7],['4,64,0',3],['6,64,0',7]]);
 let wheat=0;const dug=[];
 const registry={blocksByName:{wheat:{id:191}},blocks:{191:{drops:[884]}},items:{884:{name:'wheat_seeds'}}};
 const block=k=>{const [x,y,z]=k.split(',').map(Number);return {name:'wheat',type:191,position:new Vec3(x,y,z),boundingBox:'empty',getProperties:()=>({age:crops.get(k)})};};
 const bot={registry,entity:{position:new Vec3(0.5,64,0.5)},heldItem:null,inventory:{items(){return [];},emptySlotCount(){return 30;}},pathfinder:{movements:null,setMovements(){}},
  findBlocks(){return [...crops.keys()].map(k=>block(k).position);},blockAt(p){const k=p.x+','+p.y+','+p.z;return crops.has(k)?block(k):{name:'air',boundingBox:'empty',position:p};},
  canDigBlock(){return true;},tool:{async equipForBlock(){}},async dig(bl){const k=bl.position.x+','+bl.position.y+','+bl.position.z;dug.push(k);crops.delete(k);wheat++;}};
 const w={bot,config:{limits:{radius:32}},count(n){return n==='wheat'?wheat:0;},save(){},check(){},update(){},log(){},exploreMovements(){return {};},
  async walk(){},async sweepDrops(){},gatherFailed:Worker.prototype.gatherFailed,gatherBlacklisted:Worker.prototype.gatherBlacklisted,takeStrandedTunnel:Worker.prototype.takeStrandedTunnel};
 await Worker.prototype.gather.call(w,{spec:{type:'gather',block:'wheat',count:2,radius:12}},0);
 assert.deepEqual(dug.sort(),['2,64,0','6,64,0'],'the green one stays');
 assert.equal(blockAge({properties:{age:5}}),5);
});
