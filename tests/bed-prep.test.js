import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Vec3} from 'vec3';
import {Autopilot,bedPrepJob,BED_PREP_FROM} from '../src/autopilot.js';
// Soak 2026-10-14: every hard-run night was a 10-minute shelter (no bed). When wool is cheap
// (a sheep within 32 and shears or a sword) the ladder makes a bed before dusk; otherwise the
// dusk dirt + shelter stay the plan.
const kit={stone_sword:1,oak_planks:8,crafting_table:1};
test('bedPrepJob: wool first (shears beat a kill), then the bed; only before dusk',()=>{
 const ctx={tod:9500,sheepNear:2};
 assert.deepEqual(bedPrepJob(kit,ctx),{type:'hunt',entity:'sheep',count:2},'one wool per sheep, no more than are near');
 assert.deepEqual(bedPrepJob({...kit,white_wool:1},{tod:9500,sheepNear:5}),{type:'hunt',entity:'sheep',count:2});
 assert.deepEqual(bedPrepJob({...kit,shears:1},ctx),{type:'shear'});
 assert.deepEqual(bedPrepJob({...kit,white_wool:3},ctx),{type:'craft',item:'white_bed',count:1});
 assert.deepEqual(bedPrepJob({...kit,white_wool:2,black_wool:3},ctx),{type:'craft',item:'black_bed',count:1},'three of ONE colour');
 // Outside the window, or a bed already held/placed: nothing.
 assert.equal(bedPrepJob(kit,{...ctx,tod:BED_PREP_FROM-1}),null);
 assert.equal(bedPrepJob(kit,{...ctx,tod:12541}),null,'night: the night branch decides');
 assert.equal(bedPrepJob(kit,{...ctx,bedNear:true}),null);
 assert.equal(bedPrepJob({...kit,red_bed:1},ctx),null);
});
test('bedPrepJob: wool is not cheap without a sheep near or a way to take it',()=>{
 assert.equal(bedPrepJob(kit,{tod:9500,sheepNear:0}),null);
 assert.equal(bedPrepJob({oak_planks:8,crafting_table:1},{tod:9500,sheepNear:3}),null,'no shears, no sword');
 // The bed must be payable from what is held: 3 planks, +4 for a table when none is at hand.
 assert.equal(bedPrepJob({stone_sword:1,oak_planks:2,crafting_table:1},{tod:9500,sheepNear:3}),null);
 assert.equal(bedPrepJob({stone_sword:1,oak_planks:4},{tod:9500,sheepNear:3}),null,'no table: 7 planks needed');
 assert.ok(bedPrepJob({stone_sword:1,oak_planks:4},{tod:9500,sheepNear:3,worldTable:true}),'a table standing near is enough');
 // Wool in hand, planks short: craft them from a held log.
 assert.deepEqual(bedPrepJob({stone_sword:1,white_wool:3,crafting_table:1,dark_oak_log:2},{tod:9500,sheepNear:0}),{type:'craft',item:'dark_oak_planks',count:3});
});
function autopilot({tod,items={},sheep=[]}){
 const root=fs.mkdtempSync(path.join(process.env.TEMP||os.tmpdir(),'bedprep-test-'));
 const submitted=[],jobs=[];
 const inv=Object.entries(items).map(([name,count])=>({name,count}));
 const entities={};sheep.forEach((p,i)=>{entities[100+i]={name:'sheep',position:new Vec3(...p)};});
 const worker={
  ready:true,userStopped:false,deathResume:false,jobs,log(){},
  submit(spec){submitted.push(spec);const job={id:'j'+submitted.length,status:'running',spec};jobs.push(job);return job;},
  cancel(id){const j=jobs.find(x=>x.id===id);if(j)j.status='cancelled';},
  bot:{time:{timeOfDay:tod,day:3},inventory:{items:()=>inv},entities,
   registry:{blocksByName:{},foodsByName:{},itemsByName:{}},findBlock(){return null;},blockAt(){return null;},
   entity:{position:new Vec3(0.5,64,0.5)}}
 };
 const ap=new Autopilot(worker,root);ap.start();
 return {ap,worker,inv,jobs,submitted,done(){fs.rmSync(root,{recursive:true,force:true});}};
}
test('autopilot: a sheep near at late afternoon -> hunt for wool, then the bed, then sleep at night',()=>{
 const t=autopilot({tod:9600,items:{wooden_pickaxe:1,...kit},sheep:[[10,64,4],[14,64,-6]]});
 try{
  t.ap.tick();
  assert.deepEqual(t.submitted[0],{type:'hunt',entity:'sheep',count:2});
  assert.equal(t.ap.currentStep,'bed-prep');
  t.jobs[0].status='complete';t.inv.push({name:'white_wool',count:3});
  t.ap.tick();
  assert.deepEqual(t.submitted[1],{type:'craft',item:'white_bed',count:1});
  t.jobs[1].status='complete';t.inv.splice(t.inv.findIndex(i=>i.name==='white_wool'),1);t.inv.push({name:'white_bed',count:1});
  // Dusk: a bed is held, so no shelter dirt; night: sleep.
  t.worker.bot.time.timeOfDay=11000;t.ap.tick();
  assert.notEqual(t.submitted[2]?.block,'grass_block');
  for(const j of t.jobs)j.status='complete';
  t.worker.bot.time.timeOfDay=13000;t.ap.tick();
  assert.deepEqual(t.submitted.at(-1),{type:'sleep'});
 }finally{t.done();}
});
test('autopilot: no sheep near -> the dusk dirt and the night shelter, unchanged',()=>{
 const t=autopilot({tod:11000,items:{wooden_pickaxe:1,...kit}});
 try{
  t.ap.tick();
  assert.equal(t.submitted[0].block,'grass_block');
  assert.equal(t.ap.currentStep,'dusk-dirt');
 }finally{t.done();}
});
test('autopilot: a failed bed-prep job ends the prep for the day (shelter tonight)',()=>{
 const t=autopilot({tod:9600,items:{wooden_pickaxe:1,...kit},sheep:[[10,64,4]]});
 try{
  t.ap.tick();
  assert.equal(t.submitted[0].type,'hunt');
  t.jobs[0].status='failed';
  t.ap.tick(); // settles the failure; the ladder's own day job goes out
  for(const j of t.jobs)if(j.status==='running')j.status='complete';
  t.ap.tick();t.ap.coolUntil=0;t.worker.bot.time.timeOfDay=11000;
  for(const j of t.jobs)if(j.status==='running')j.status='complete';
  t.ap.tick();
  assert.equal(t.submitted.at(-1).block,'grass_block','dusk dirt for the shelter');
  assert.equal(t.submitted.filter(s=>s.type==='hunt').length,1,'no second wool hunt today');
 }finally{t.done();}
});
