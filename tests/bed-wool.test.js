// Round 10, bug B / habit 5: no bed in any round-9 run. The rung asked for a bed only with
// a sheep already within 32 (and gave up otherwise), and the dusk bed prep never runs on the
// frozen-day normal runs. Now: wool by day at any step after the wood kit, a log gather for
// the bed's planks when the wool is held, and sheep-search legs before the bed is set aside.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Vec3} from 'vec3';
import {Autopilot,bedJob,woolJob,isBedJob,BED_SEARCH_LEGS,BED_OFF_MS} from '../src/autopilot.js';
import {jobSchema} from '../src/schema.js';
const c=map=>n=>map[n]||0;
const WOOD={wooden_pickaxe:1,wooden_sword:1,wooden_axe:1,crafting_table:1};
test('bedJob: wool held and no wood -> a short log gather; no sheep -> a search leg only when asked',()=>{
 const j=bedJob(c({white_wool:3,crafting_table:1}),{planksTotal:0,logsTotal:0});
 assert.deepEqual(j,{type:'gather',block:'log',count:1,radius:32,belowFoots:true});
 assert.equal(jobSchema.safeParse(j).success,true);
 assert.deepEqual(bedJob(c({white_wool:3}),{planksTotal:1,logsTotal:0}),{type:'gather',block:'log',count:2,radius:32,belowFoots:true},'7 planks without a table');
 assert.deepEqual(bedJob(c({white_wool:3,crafting_table:1}),{planksTotal:0,logsTotal:1,heldLog:'birch_log'}),{type:'craft',item:'birch_planks',count:3});
 assert.deepEqual(bedJob(c({white_wool:3,crafting_table:1}),{planksTotal:3,logsTotal:0}),{type:'craft',item:'white_bed',count:1});
 const kit={stone_sword:1,crafting_table:1};
 assert.equal(bedJob(c(kit),{sheepNear:0,planksTotal:3,logsTotal:0}),null);
 const leg=bedJob(c(kit),{sheepNear:0,planksTotal:3,logsTotal:0,bedSearch:true,grazeDirection:'east'});
 assert.deepEqual(leg,{type:'explore',direction:'east',distance:32});
 assert.equal(jobSchema.safeParse(leg).success,true);
 // No wood at all: the wool still comes first (the log gather pays the planks later).
 assert.deepEqual(bedJob(c({...kit,white_wool:2}),{sheepNear:1,planksTotal:0,logsTotal:0}),{type:'hunt',entity:'sheep',count:1});
});
test('woolJob: a sheep in reach by day after the wood kit; never at night, near a hostile or while set aside',()=>{
 assert.deepEqual(woolJob({...WOOD},{sheepNear:2,tod:3000}),{type:'hunt',entity:'sheep',count:2});
 assert.equal(woolJob({wooden_pickaxe:1},{sheepNear:2,tod:3000}),null,'the wood kit first');
 assert.equal(woolJob({...WOOD},{sheepNear:2,tod:12500}),null,'after sunset');
 assert.equal(woolJob({...WOOD},{sheepNear:2,tod:3000,hostileDistance:10}),null);
 assert.equal(woolJob({...WOOD},{sheepNear:2,tod:3000,bedOff:true}),null);
 assert.equal(woolJob({...WOOD,white_bed:1},{sheepNear:2,tod:3000}),null,'a bed held');
 assert.equal(woolJob({...WOOD},{sheepNear:0,tod:3000}),null,'no search legs outside the rung');
 assert.deepEqual(woolJob({...WOOD,shears:1},{sheepNear:1,tod:3000}),{type:'shear'});
});
function autopilot({tod=3000,items={},sheep=[]}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bed-wool-'));
 const submitted=[],jobs=[];
 const inv=Object.entries(items).map(([name,count])=>({name,count}));
 const entities={};sheep.forEach((p,i)=>{entities[100+i]={name:'sheep',position:new Vec3(...p)};});
 const worker={ready:true,userStopped:false,deathResume:false,jobs,log(){},
  submit(spec){jobSchema.parse(spec);submitted.push(spec);const job={id:'j'+submitted.length,status:'running',spec};jobs.push(job);return job;},
  cancel(id){const j=jobs.find(x=>x.id===id);if(j)j.status='cancelled';},
  bot:{time:{timeOfDay:tod,day:3},inventory:{items:()=>inv,slots:[]},entities,
   registry:{blocksByName:{},foodsByName:{cooked_beef:{}},itemsByName:{}},findBlock(){return null;},blockAt(){return null;},
   entity:{position:new Vec3(0.5,64,0.5)}}};
 const ap=new Autopilot(worker,root);ap.start();
 return {ap,worker,inv,jobs,submitted,done(){fs.rmSync(root,{recursive:true,force:true});}};
}
test('the stone step takes a passing sheep for its wool, as a bed job',()=>{
 const t=autopilot({items:{...WOOD,stick:4,oak_planks:4},sheep:[[8,64,3]]});
 try{
  t.ap.tick();
  assert.deepEqual(t.submitted[0],{type:'hunt',entity:'sheep',count:1});
  assert.equal(t.ap.currentStep,'bed-rung');
  t.jobs[0].status='failed';t.ap.tick();
  assert.equal(t.ap.failures.stone||0,0,'the stone step is not charged');
  t.ap.coolUntil=0;t.ap.tick();
  assert.equal(t.submitted.at(-1).block,'stone','set aside: back to the stone step');
 }finally{t.done();}
});
test('a sheep 30 blocks off is out of the hunt reach: no wool job',()=>{
 const t=autopilot({items:{...WOOD,stick:4,oak_planks:4},sheep:[[30,64,0]]});
 try{t.ap.tick();assert.equal(t.submitted[0].block,'stone');}finally{t.done();}
});
const RUNG={oak_planks:8,stick:10,crafting_table:1,wooden_pickaxe:1,wooden_sword:1,wooden_axe:1,cobblestone:32,stone_pickaxe:2,stone_sword:1,stone_axe:1,stone_shovel:1,furnace:1,cooked_beef:8,
 iron_pickaxe:1,iron_sword:1,shield:1,torch:16,iron_helmet:1,iron_chestplate:1};
test('the rung searches for sheep before it gives the bed up, then moves on to diamonds',()=>{
 const slots=[];slots[5]={name:'iron_helmet',count:1};slots[6]={name:'iron_chestplate',count:1};
 const t=autopilot({items:RUNG});t.worker.bot.inventory.slots=slots;
 try{
  for(let i=0;i<BED_SEARCH_LEGS;i++){
   t.ap.coolUntil=0;t.ap.tick();
   assert.equal(t.submitted.at(-1).type,'explore','search leg '+(i+1));
   assert.equal(t.ap.currentStep,'bed-rung');
   t.jobs.at(-1).status='complete';
  }
  assert.ok(t.ap.bedOffUntil>Date.now()+BED_OFF_MS-1000,'set aside after the last leg');
  t.ap.coolUntil=0;t.ap.tick();
  assert.equal(t.submitted.at(-1).block,'diamond_ore');
 }finally{t.done();}
});
test('a log gather the bed asked for is a bed job (never charged to the iron step)',()=>{
 assert.equal(isBedJob({type:'gather',block:'log',count:1}),false,'a plain log gather is not');
 const slots=[];slots[5]={name:'iron_helmet',count:1};slots[6]={name:'iron_chestplate',count:1};
 const t=autopilot({items:{...RUNG,oak_planks:0,stick:4,white_wool:3}});t.worker.bot.inventory.slots=slots;
 try{
  t.ap.tick();
  assert.equal(t.submitted[0].type,'gather');assert.equal(t.submitted[0].block,'log');
  assert.equal(t.ap.currentStep,'bed-rung');
  t.jobs[0].status='failed';t.ap.tick();
  assert.equal(t.ap.failures.iron||0,0,'the iron step is not charged');
  assert.ok(t.ap.bedOffUntil>Date.now()+BED_OFF_MS-1000);
 }finally{t.done();}
});
