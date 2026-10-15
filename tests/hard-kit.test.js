// Cloud round 5, task 4: the hard runs never crafted a furnace. Round 4: hard1 crafted the
// stone pickaxe at 541 s, the tools by 20:26Z, then sheltered at 20:27Z; hard2 crafted the
// pickaxe at 631 s and ended the night holding 24 cobble. On a dawn start the pickaxe lands
// at sunset, the night cancelled the gather and the shelter held the rest of the run; the
// shelter preferred cobble, and its dawn cleanup dug the box bare-handed (no drops).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Vec3} from 'vec3';
import {Autopilot,duskKitJob,kitCobbleNeed,KIT_GRACE,plan} from '../src/autopilot.js';
import {SUNSET} from '../src/night.js';
import {Worker} from '../src/worker.js';
console.error=()=>{};
const WOOD={oak_log:2,oak_planks:8,stick:10,crafting_table:1,wooden_pickaxe:1,wooden_sword:1,wooden_axe:1};
test('kitCobbleNeed: the tools not held plus the furnace unless one is held or standing near',()=>{
 assert.equal(kitCobbleNeed({}),17);
 assert.equal(kitCobbleNeed({stone_pickaxe:1}),14);
 assert.equal(kitCobbleNeed({stone_pickaxe:1,stone_sword:1,stone_axe:1,stone_shovel:1}),8);
 assert.equal(kitCobbleNeed({stone_pickaxe:1,stone_sword:1,stone_axe:1,stone_shovel:1},{worldFurnace:true}),0);
});
test('the stone gather stops at what the kit costs: hard2 held 24 with 14 needed and was still digging',()=>{
 const r=plan({...WOOD,stone_pickaxe:1,cobblestone:24});
 assert.deepEqual([r.job.type,r.job.item],['craft','stone_sword'],'24 cobble: craft, do not gather');
 const g=plan({...WOOD,stone_pickaxe:1,cobblestone:1});
 assert.deepEqual([g.job.type,g.job.count],['gather',17],'14 for the rest of the kit + 4 spare - 1 held');
});
test('duskKitJob: the next affordable kit craft, in kit order, only between the wood and stone steps',()=>{
 assert.deepEqual(duskKitJob({...WOOD,stone_pickaxe:1,cobblestone:24}),{type:'craft',item:'stone_sword',count:1,keepTable:true});
 assert.deepEqual(duskKitJob({...WOOD,stone_pickaxe:1,stone_sword:1,stone_axe:1,stone_shovel:1,cobblestone:8}),{type:'craft',item:'furnace',count:1,keepTable:true,collectTable:true});
 assert.equal(duskKitJob({...WOOD,stone_pickaxe:1,cobblestone:1}),null,'not affordable: no craft');
 assert.deepEqual(duskKitJob({...WOOD,cobblestone:3,stick:1}),{type:'craft',item:'stick',count:5},'the pickaxe needs 2 sticks: craft them from the held planks (the whole kit needs 6)');
 assert.equal(duskKitJob({...WOOD,oak_log:0,oak_planks:0,cobblestone:3,stick:1}),null,'no wood for sticks and 3 cobble is no furnace');
 assert.equal(duskKitJob({wooden_pickaxe:1,cobblestone:30}),null,'wood step not done');
 assert.equal(duskKitJob({...WOOD,stone_pickaxe:1,stone_sword:1,stone_axe:1,stone_shovel:1,furnace:1,cobblestone:30}),null,'kit done');
});
function ladder({tod,items,jobs=[],hostile=null}){
 const root=fs.mkdtempSync(path.join(process.env.TEMP||os.tmpdir(),'hard-kit-'));
 const submitted=[],cancelled=[];
 const inv=Object.entries(items).map(([name,count])=>({name,count}));
 const worker={ready:true,userStopped:false,deathResume:false,jobs,log(){},
  submit(spec){submitted.push(spec);const job={id:'j'+submitted.length,status:'queued',spec};jobs.push(job);return job;},
  cancel(id){cancelled.push(id);const j=jobs.find(x=>x.id===id);if(j)j.status='cancelled';},
  bot:{health:20,food:20,time:{timeOfDay:tod,day:2},inventory:{items:()=>inv},entities:hostile?{9:{type:'hostile',name:'zombie',position:new Vec3(...hostile)}}:{},
   registry:{blocksByName:{},foodsByName:{},itemsByName:{}},findBlock(){return null;},blockAt(){return null;},
   entity:{position:new Vec3(0,64,0)}}};
 const ap=new Autopilot(worker,root);ap.start();
 return {ap,worker,submitted,cancelled,done(){fs.rmSync(root,{recursive:true,force:true});}};
}
test('sunset grace: the affordable kit is crafted before the shelter, then the shelter goes up',()=>{
 const t=ladder({tod:SUNSET+40,items:{...WOOD,stone_pickaxe:1,cobblestone:24}});
 try{
  t.ap.tick();
  assert.deepEqual(t.submitted.map(s=>s.item||s.type),['stone_sword']);
  const crafted=['stone_sword','stone_axe','stone_shovel','furnace'];
  for(let i=0;i<crafted.length;i++){
   t.worker.jobs.at(-1).status='complete';
   const inv=t.worker.bot.inventory.items();inv.push({name:crafted[i],count:1});
   inv.find(x=>x.name==='cobblestone').count-=[2,3,1,8][i];
   t.ap.tick();
  }
  assert.deepEqual(t.submitted.map(s=>s.item||s.type),['stone_sword','stone_axe','stone_shovel','furnace','shelter']);
  assert.equal(t.worker.cobbleReserve,0,'kit done: the shelter may use the last 10 cobble');
 }finally{t.done();}
});
test('a running kit craft is not cancelled at sunset; past the grace or with a mob near the shelter comes first',()=>{
 const craft={id:'c1',status:'running',spec:{type:'craft',item:'stone_axe'}};
 let t=ladder({tod:SUNSET+10,items:{...WOOD,stone_pickaxe:1,stone_sword:1,cobblestone:20},jobs:[craft]});
 try{t.ap.tick();assert.deepEqual(t.cancelled,[]);assert.deepEqual(t.submitted,[]);}finally{t.done();}
 t=ladder({tod:SUNSET+KIT_GRACE,items:{...WOOD,stone_pickaxe:1,cobblestone:24}});
 try{t.ap.tick();assert.deepEqual(t.submitted,[{type:'shelter'}]);}finally{t.done();}
 t=ladder({tod:SUNSET+40,items:{...WOOD,stone_pickaxe:1,cobblestone:24},hostile:[6,64,0]});
 try{t.ap.tick();assert.deepEqual(t.submitted,[{type:'shelter'}]);}finally{t.done();}
});
test('the shelter builds with dirt first and leaves the kit cobble alone; reserved cobble only as a last resort',()=>{
 const inv=[{name:'cobblestone',count:20,slot:36},{name:'dirt',count:12,slot:37}];
 const w=Object.assign(Object.create(Worker.prototype),{bot:{inventory:{items:()=>inv}},cobbleReserve:14});
 assert.equal(w.shelterStock(),18,'6 spare cobble + 12 dirt: short of 26, so the job digs dirt');
 assert.equal(w.shelterItem().name,'cobblestone','6 spare cobble go first');
 inv[0].count=14;
 assert.equal(w.shelterItem().name,'dirt','only reserved cobble left: dirt');
 inv[1].count=0;
 assert.equal(w.shelterItem().name,'cobblestone','nothing else: the box outranks the furnace');
 w.cobbleReserve=0;inv[0].count=30;
 assert.equal(w.shelterStock(),30);
});
test('the dawn cleanup digs each block with its tool, so the cobble comes back',async()=>{
 const cells=new Map([['1,64,0','cobblestone'],['0,66,0','dirt']]);
 const equipped=[],dug=[];
 const bot={blockAt:p=>{const n=cells.get(p.x+','+p.y+','+p.z)||'air';return {name:n,position:p,boundingBox:n==='air'?'empty':'block'};},
  tool:{equipForBlock:async bl=>{equipped.push(bl.name);}},dig:async bl=>{dug.push(bl.name);cells.delete(bl.position.x+','+bl.position.y+','+bl.position.z);}};
 const w=Object.assign(Object.create(Worker.prototype),{bot,check(){},update(){},sweepDrops:async()=>{}});
 const job={shell:[{x:1,y:64,z:0},{x:0,y:66,z:0}],placed:[{x:1,y:64,z:0},{x:0,y:66,z:0}]};
 await w.removeShelter(job,0);
 assert.deepEqual(equipped.sort(),['cobblestone','dirt']);
 assert.deepEqual(dug.sort(),['cobblestone','dirt']);
 assert.deepEqual(job.placed,[]);
});
// ---- round 6, task 4: hard1 held 19 cobble and a stone pickaxe and never crafted a furnace ----
const HARD1={oak_log:0,oak_planks:0,stick:0,crafting_table:1,wooden_pickaxe:1,wooden_sword:1,wooden_axe:1,stone_pickaxe:1,cobblestone:19};
test('duskKitJob: a stick shortage no longer costs the furnace',()=>{
 assert.deepEqual(duskKitJob(HARD1),{type:'craft',item:'furnace',count:1,keepTable:true,collectTable:false},'no wood for the sword\'s stick: the furnace (8 cobble, no sticks)');
 assert.deepEqual(duskKitJob({...HARD1,oak_planks:3}),{type:'craft',item:'stick',count:4},'planks held: the sticks the rest of the kit needs');
 assert.deepEqual(duskKitJob({...HARD1,birch_log:1}),{type:'craft',item:'birch_planks',count:4});
 assert.equal(duskKitJob({...HARD1,cobblestone:7}),null,'7 cobble: neither the sword (no stick) nor the furnace');
 assert.equal(duskKitJob({...HARD1,stone_sword:1,stone_axe:1,stone_shovel:1,cobblestone:8},{worldFurnace:true}),null,'a furnace stands near: kit done');
});
test('a day job running into sunset (hard1: the bed-prep sheep hunt) gives way to the kit, then the shelter',()=>{
 const hunt={id:'h1',status:'running',spec:{type:'hunt',entity:'sheep',count:3}};
 const t=ladder({tod:SUNSET+20,items:{...HARD1},jobs:[hunt]});
 try{
  t.ap.tick();
  assert.deepEqual(t.cancelled,['h1'],'the hunt is cut');
  assert.deepEqual(t.submitted.map(s=>s.item||s.type),['furnace']);
  t.ap.tick();t.ap.tick();
  assert.deepEqual(t.submitted.map(s=>s.item||s.type),['furnace'],'the queued kit craft is neither duplicated nor overtaken by the shelter');
  t.worker.jobs.at(-1).status='complete';
  const inv=t.worker.bot.inventory.items();inv.push({name:'furnace',count:1});inv.find(x=>x.name==='cobblestone').count-=8;
  t.ap.tick();
  assert.deepEqual(t.submitted.map(s=>s.item||s.type),['furnace','shelter']);
 }finally{t.done();}
});
test('in the dusk window an affordable kit craft outranks the bed prep; a hostile within 8 holds it',()=>{
 let t=ladder({tod:10500,items:{...HARD1,oak_planks:3}});
 try{t.ap.tick();assert.deepEqual(t.submitted.map(s=>s.item||s.type),['stick']);}finally{t.done();}
 t=ladder({tod:10500,items:{...HARD1,oak_planks:3},hostile:[5,64,0]});
 try{t.ap.tick();assert.ok(!t.submitted.some(s=>s.item==='stick'));}finally{t.done();}
 t=ladder({tod:SUNSET+40,items:{...HARD1},hostile:[12,64,0]});
 try{t.ap.tick();assert.deepEqual(t.submitted.map(s=>s.item||s.type),['furnace'],'a mob at 12 no longer blocks a 2-second craft');}finally{t.done();}
});
