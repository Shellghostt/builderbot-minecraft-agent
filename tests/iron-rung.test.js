// Round 8, task 3: the rung after the iron core - torches, the iron helmet and chestplate
// (worn at once), a bed when wool is cheap, and the bed preferred to the shelter at night.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Vec3} from 'vec3';
import {Autopilot,ironRung,armourToWear,bedJob,isBedJob,BED_OFF_MS,TORCHES,diamondPickJob,isDiamondJob,diamondGather,DIAMOND_OFF_MS,DIAMOND_Y,DIAMOND_TOP} from '../src/autopilot.js';
import {descentTarget} from '../src/worker.js';
import {jobSchema} from '../src/schema.js';
const c=map=>n=>map[n]||0;
const base={iron_pickaxe:1,iron_sword:1,shield:1,stone_sword:1,stick:8,oak_planks:8,crafting_table:1,cobblestone:20,stone_pickaxe:2};
const wood={planksTotal:8,logsTotal:0,heldLog:null};
test('ironRung: torches before armour; coal in reach is mined without a staircase',()=>{
 let j=ironRung(c(base),{...wood});
 assert.deepEqual(j,{type:'gather',block:'coal_ore',count:4,radius:32,searchIfMissing:true,targetY:32,bandTop:64});
 assert.equal(jobSchema.safeParse(j).success,true);
 j=ironRung(c(base),{...wood,coalNear:true});
 assert.deepEqual(j,{type:'gather',block:'coal_ore',count:4,radius:32,bandTop:64});
 assert.equal(jobSchema.safeParse(j).success,true);
 // charcoal counts as torch fuel; 12 torches held need one more coal only
 assert.deepEqual(ironRung(c({...base,charcoal:4}),{...wood}),{type:'craft',item:'torch',count:TORCHES});
 assert.deepEqual(ironRung(c({...base,torch:12,coal:1}),{...wood}),{type:'craft',item:'torch',count:4});
 // no sticks and no planks: planks from held logs first
 assert.deepEqual(ironRung(c({...base,coal:4,stick:0,oak_planks:0,birch_log:2}),{planksTotal:0,logsTotal:2,heldLog:'birch_log'}),{type:'craft',item:'birch_planks',count:2});
});
test('armourToWear: held pieces that beat the worn slot, as a signature',()=>{
 assert.equal(armourToWear({}),null);
 assert.equal(armourToWear({iron_helmet:1}),'iron_helmet');
 assert.equal(armourToWear({iron_helmet:1,_equipped_iron_helmet:1}),null,'the one held is worn');
 assert.equal(armourToWear({iron_helmet:2,_equipped_iron_helmet:1}),null,'a spare of the same tier is no upgrade');
 assert.equal(armourToWear({iron_chestplate:1,leather_chestplate:1,_equipped_leather_chestplate:1,diamond_boots:1}),'iron_chestplate,diamond_boots');
 assert.equal(armourToWear({iron_helmet:1,diamond_helmet:1,_equipped_diamond_helmet:1}),null,'never a downgrade');
});
test('bedJob: cheap wool only, and the bed jobs are recognised',()=>{
 const kit={stone_sword:1,crafting_table:1};
 assert.deepEqual(bedJob(c(kit),{sheepNear:1,planksTotal:3,logsTotal:0}),{type:'hunt',entity:'sheep',count:1});
 assert.equal(bedJob(c(kit),{sheepNear:0,planksTotal:3,logsTotal:0}),null);
 assert.equal(bedJob(c({crafting_table:1}),{sheepNear:3,planksTotal:3,logsTotal:0}),null,'no sword, no shears');
 assert.equal(bedJob(c({...kit,red_bed:1}),{sheepNear:3,planksTotal:3,logsTotal:0}),null);
 for(const job of [{type:'shear'},{type:'hunt',entity:'sheep',count:2},{type:'craft',item:'red_bed',count:1}])assert.equal(isBedJob(job),true);
 for(const job of [{type:'hunt',entity:'cow',count:2},{type:'craft',item:'torch',count:4},null])assert.equal(isBedJob(job),false);
});
function autopilot({tod=6000,items={},slots=[],sheep=[]}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'iron-rung-'));
 const submitted=[],jobs=[];
 const inv=Object.entries(items).map(([name,count])=>({name,count}));
 const entities={};sheep.forEach((p,i)=>{entities[100+i]={name:'sheep',position:new Vec3(...p)};});
 const worker={
  ready:true,userStopped:false,deathResume:false,jobs,log(){},
  submit(spec){jobSchema.parse(spec);submitted.push(spec);const job={id:'j'+submitted.length,status:'running',spec};jobs.push(job);return job;},
  cancel(id){const j=jobs.find(x=>x.id===id);if(j)j.status='cancelled';},
  bot:{time:{timeOfDay:tod,day:3},inventory:{items:()=>inv,slots},entities,
   registry:{blocksByName:{},foodsByName:{cooked_beef:{}},itemsByName:{}},findBlock(){return null;},blockAt(){return null;},
   entity:{position:new Vec3(0.5,64,0.5)}}
 };
 const ap=new Autopilot(worker,root);ap.start();
 return {ap,worker,inv,jobs,submitted,done(){fs.rmSync(root,{recursive:true,force:true});}};
}
test('counts(): worn armour and the off-hand shield are held, marked _equipped_',()=>{
 const slots=[];slots[6]={name:'iron_chestplate',count:1};slots[45]={name:'shield',count:1};
 const t=autopilot({items:{iron_helmet:1},slots});
 try{
  const m=t.ap.counts();
  assert.equal(m.iron_chestplate,1);assert.equal(m._equipped_iron_chestplate,1);
  assert.equal(m.shield,1,'an off-hand shield is not crafted again');assert.equal(m._equipped_shield,1);
  assert.equal(m.iron_helmet,1);assert.equal(m._equipped_iron_helmet,undefined);
  assert.equal(armourToWear(m),'iron_helmet');
 }finally{t.done();}
});
const STONE={oak_planks:8,stick:10,crafting_table:1,wooden_pickaxe:1,wooden_sword:1,wooden_axe:1,cobblestone:32,stone_pickaxe:2,stone_sword:1,stone_axe:1,stone_shovel:1,furnace:1,cooked_beef:8};
test('autopilot: the rung equips crafted armour once, and a failed sheep hunt sets the bed aside without blocking iron',()=>{
 const t=autopilot({items:{...STONE,iron_pickaxe:1,iron_sword:1,shield:1,torch:16,iron_helmet:1,iron_chestplate:1},sheep:[[6,64,2]]});
 try{
  t.ap.tick();
  assert.deepEqual(t.submitted[0],{type:'equip'});assert.equal(t.ap.currentStep,'iron');
  t.jobs[0].status='complete';
  t.ap.tick(); // the equip changed nothing in this fake: no second equip
  assert.deepEqual(t.submitted[1],{type:'hunt',entity:'sheep',count:1});
  assert.equal(t.ap.currentStep,'bed-rung');
  t.jobs[1].status='failed';
  t.ap.tick();
  assert.equal(t.ap.failures.iron||0,0,'the iron step is not charged');
  assert.ok(t.ap.bedOffUntil>Date.now()+BED_OFF_MS-1000);
  t.ap.coolUntil=0;t.ap.tick();
  assert.notEqual(t.submitted.at(-1).entity,'sheep','the ladder moved on');
  assert.equal(t.submitted.at(-1).block,'diamond_ore','on to the diamond pickaxe');
  assert.equal(t.ap.currentStep,'diamond-rung');
  // a failed trip is not charged to the iron step either, and waits DIAMOND_OFF_MS
  t.jobs.at(-1).status='failed';t.ap.tick();
  assert.equal(t.ap.failures.iron||0,0);assert.ok(t.ap.diamondOffUntil>Date.now()+DIAMOND_OFF_MS-1000);
  t.ap.coolUntil=0;t.ap.tick();
  assert.equal(t.submitted.at(-1).block,'coal_ore','then the rest of the iron step');
 }finally{t.done();}
});
test('night: a bed held means sleep; a sleep that failed tonight falls back to the shelter',()=>{
 const t=autopilot({tod:13000,items:{wooden_pickaxe:1,red_bed:1,cobblestone:30}});
 try{
  t.ap.tick();
  assert.deepEqual(t.submitted.at(-1),{type:'sleep'});
  t.jobs.at(-1).status='failed';t.jobs.at(-1).message='Server refused sleep: monsters nearby';
  t.ap.tick();t.ap.coolUntil=0;t.ap.tick();
  assert.deepEqual(t.submitted.at(-1),{type:'shelter'},'the shelter, not a second refused sleep');
  assert.equal(t.submitted.filter(s=>s.type==='sleep').length,1);
 }finally{t.done();}
});
// Round 8, task 4: the diamond pickaxe after the iron kit.
test('diamondPickJob: 3 diamonds in the -58..-54 band, torches held, then the pickaxe',()=>{
 const kit={iron_pickaxe:1,torch:16,stick:4};
 const j=diamondPickJob(c(kit),{...wood});
 assert.deepEqual(j,{type:'gather',block:'diamond_ore',count:3,radius:32,targetY:-58,bandTop:-54,strip:true});
 assert.equal(jobSchema.safeParse(j).success,true);
 assert.equal(diamondPickJob(c({...kit,diamond:2}),{...wood}).count,1,'only what is missing');
 assert.deepEqual(diamondPickJob(c({...kit,diamond:3}),{...wood}),{type:'craft',item:'diamond_pickaxe',count:1});
 assert.deepEqual(diamondPickJob(c({...kit,diamond:3,stick:0,oak_planks:0,oak_log:2}),{planksTotal:0,logsTotal:2,heldLog:'oak_log'}),{type:'craft',item:'oak_planks',count:2},'sticks from planks first');
 assert.equal(diamondPickJob(c({...kit,torch:4}),{...wood}),null,'no trip into the dark without torches');
 assert.equal(diamondPickJob(c({...kit,iron_pickaxe:0,stone_pickaxe:2}),{...wood}),null,'diamond ore needs the iron pickaxe');
 assert.equal(diamondPickJob(c({...kit,diamond_pickaxe:1}),{...wood}),null);
 assert.equal(diamondPickJob(c(kit),{...wood,diamondOff:true}),null);
 assert.equal(isDiamondJob(j),true);assert.equal(isDiamondJob({type:'craft',item:'diamond_pickaxe',count:1}),true);
 assert.equal(isDiamondJob({type:'gather',block:'iron_ore',count:6}),false);
});
test('the diamond descent enters the band at -54, ends at -58 and never goes below it',()=>{
 const s=diamondGather(3);
 assert.equal(descentTarget(s,70),DIAMOND_TOP,'one staircase leg straight to the band top');
 assert.equal(descentTarget(s,-54),DIAMOND_Y);
 assert.equal(descentTarget(s,-58),DIAMOND_Y);
 assert.ok(DIAMOND_Y>-60,'clear of the bedrock layers');
});
