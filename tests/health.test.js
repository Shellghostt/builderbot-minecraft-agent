// Round 10, habit 10: health like a player. Natural regeneration needs a bar of 18+: hurt with
// the bar under 18, top it up with food that fits (bug C still bars the big meals above 14),
// and heal before a deep dig instead of going down hurt.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Vec3} from 'vec3';
import {FoodChain} from '../src/chains/foodChain.js';
import {Autopilot,healFirst,riskyJob,RISKY_HEALTH,HEAL_WAIT_MS,ironGather} from '../src/autopilot.js';
import {nightMineWanted,NIGHT_MINE_FROM} from '../src/night.js';
import {jobSchema} from '../src/schema.js';
const settle=async()=>{for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));};
function foodBot(food,{count=3,health=20,fills=8,name='cooked_porkchop'}={}){
 const items=[{name,count,slot:36}];
 const bot={entity:{position:{x:0,y:0,z:0},metadata:[0]},health,food,consumed:0,
  inventory:{items:()=>items.filter(i=>i.count>0)},registry:{foodsByName:{[name]:{foodPoints:fills,saturation:3}}},
  equip:async()=>{},consume:async()=>{bot.consumed++;bot.food=Math.min(20,bot.food+fills);items[0].count--;}};
 return bot;
}
test('hurt with the bar under 18: a top-up with food that fits, never a wasteful meal',async()=>{
 const carrot=foodBot(16,{health:12,fills:3,name:'carrot'});
 new FoodChain().priority(carrot,{worker:{meals:{}}});await settle();
 assert.equal(carrot.consumed,1,'16 + 3 fits: regeneration back on at 19');
 const pork=foodBot(16,{health:12,fills:8});
 new FoodChain().priority(pork,{worker:{meals:{}}});await settle();
 assert.equal(pork.consumed,0,'16 + 8 wastes 4: bug C, no meal');
 const fine=foodBot(16,{health:15,fills:3,name:'carrot'});
 new FoodChain().priority(fine,{worker:{meals:{}}});await settle();
 assert.equal(fine.consumed,0,'health 15: not hurt enough');
 const regen=foodBot(18,{health:12,fills:2,name:'carrot'});
 new FoodChain().priority(regen,{worker:{meals:{}}});await settle();
 assert.equal(regen.consumed,0,'bar 18: regeneration runs on its own');
});
test('healFirst: a deep dig waits for health, eating to 18 first, at most HEAL_WAIT_MS',()=>{
 const dig=ironGather(6);
 assert.equal(riskyJob(dig),true);
 assert.equal(riskyJob({type:'gather',block:'log',count:3}),false);
 assert.deepEqual(healFirst({job:dig,health:12,food:15,edible:3}),{type:'eat'});
 assert.equal(healFirst({job:dig,health:12,food:15,edible:3,ate:true}),'wait');
 assert.equal(healFirst({job:dig,health:12,food:19,edible:3}),'wait','bar 18+: just wait');
 assert.equal(healFirst({job:dig,health:RISKY_HEALTH,food:15,edible:3}),null);
 assert.equal(healFirst({job:dig,health:12,food:15,edible:3,since:1,now:1+HEAL_WAIT_MS}),null,'waited long enough');
 assert.equal(healFirst({job:{type:'craft',item:'torch',count:4},health:5,food:10,edible:3}),null,'only risky work waits');
});
test('no night mine while hurt',()=>{
 assert.equal(nightMineWanted({tod:NIGHT_MINE_FROM,pickaxe:true,blocks:8,health:12}),false);
 assert.equal(nightMineWanted({tod:NIGHT_MINE_FROM,pickaxe:true,blocks:8,health:18}),true);
});
test('autopilot: hurt before the iron dig, it eats, waits, then digs',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'heal-'));
 const submitted=[],jobs=[];
 const items={oak_planks:8,stick:10,crafting_table:1,wooden_pickaxe:1,wooden_sword:1,wooden_axe:1,cobblestone:32,stone_pickaxe:2,stone_sword:1,stone_axe:1,stone_shovel:1,furnace:1,cooked_beef:8};
 const worker={ready:true,userStopped:false,deathResume:false,jobs,log(){},config:{limits:{minHealth:10}},
  submit(spec){jobSchema.parse(spec);submitted.push(spec);const job={id:'j'+submitted.length,status:'running',spec};jobs.push(job);return job;},cancel(){},
  bot:{health:12,food:15,time:{timeOfDay:3000,day:3},inventory:{items:()=>Object.entries(items).map(([name,count])=>({name,count})),slots:[]},entities:{},
   registry:{blocksByName:{},foodsByName:{cooked_beef:{}},itemsByName:{}},findBlock(){return null;},blockAt(){return null;},entity:{position:new Vec3(0.5,64,0.5)}}};
 const ap=new Autopilot(worker,root);
 try{
  ap.start();ap.tick();
  assert.deepEqual(submitted[0],{type:'eat'});assert.equal(ap.currentStep,'heal');
  worker.bot.food=20;jobs[0].status='complete';ap.tick();
  assert.equal(submitted.length,1);assert.match(ap.state,/^healing before iron \(health 12\)/);
  worker.bot.health=RISKY_HEALTH;ap.tick();
  assert.equal(submitted[1].block,'iron_ore','healed: down it goes');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
